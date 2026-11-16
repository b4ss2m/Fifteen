import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildBlocks } from '../shared/day';
import { epochFromLocal, logicalParts, nextPulse } from '../shared/time';
import { DEFAULT_SETTINGS } from '../shared/types';
import { createTestApp, type TestApp } from './helpers';
import { daysFromToday, getMe, json } from './util';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const tz = 'Europe/Berlin';

describe('a day that ends after midnight', () => {
  test('the small hours belong to the day before', () => {
    const at = epochFromLocal('2025-03-12', 90, tz);
    expect(logicalParts(at, tz, 120)).toEqual({ day: '2025-03-11', min: 1530 });
    expect(logicalParts(at, tz, 0)).toEqual({ day: '2025-03-12', min: 90 });
    expect(logicalParts(epochFromLocal('2025-03-12', 150, tz), tz, 120)).toEqual({ day: '2025-03-12', min: 150 });
  });

  test('blocks run from the rollover to the rollover', () => {
    const entries = [{ day: '2025-03-11', start: 1380, dur: 150, cat: 1, tag: null }];
    const blocks = buildBlocks(entries, [], 99_999, 120);
    expect(blocks[0]).toMatchObject({ type: 'idle', start: 120 });
    expect(blocks.at(-1)).toMatchObject({ type: 'idle', start: 1530, dur: 30 });
    expect(blocks.find((b) => b.type === 'entry')).toMatchObject({ start: 1380, dur: 150 });
    expect(blocks.reduce((sum, b) => sum + b.dur, 0)).toBe(1440);
  });

  test('a workday can run past midnight', () => {
    const s = { ...DEFAULT_SETTINGS, tz, rollover: 120, autoTrack: true, autoSince: '2025-01-01', dayStart: 18 * 60, dayEnd: 26 * 60 };
    // Tuesday 11 March, 00:50 on the 12th by the clock: still inside Tuesday's shift.
    const now = epochFromLocal('2025-03-12', 50, tz);
    expect(nextPulse(now, s, null)).toBe(epochFromLocal('2025-03-12', 60, tz));
    // After 02:00 the shift is over and the next pulse is Wednesday evening.
    const later = epochFromLocal('2025-03-12', 125, tz);
    expect(nextPulse(later, s, null)).toBe(epochFromLocal('2025-03-12', 18 * 60 + 15, tz));
  });

  test('entries after midnight are accepted once the day is stretched, and rejected before', async () => {
    const u = await t.signup();
    const me = await getMe(t, u.cookie);
    const day = daysFromToday(-2);
    const item = { start: 1470, dur: 30, cat: me.categories[0].id, tag: null };
    expect((await t.call('PUT', '/entries', { cookie: u.cookie, body: { day, items: [item] } })).status).toBe(400);

    const saved = await t.call('PUT', '/settings', { cookie: u.cookie, body: { ...me.settings, rollover: 120 } });
    expect(saved.status).toBe(200);
    expect((await t.call('PUT', '/entries', { cookie: u.cookie, body: { day, items: [item] } })).status).toBe(200);
    // And the hours before 02:00 no longer exist on that day.
    const early = { start: 60, dur: 30, cat: me.categories[0].id, tag: null };
    expect((await t.call('PUT', '/entries', { cookie: u.cookie, body: { day, items: [early] } })).status).toBe(400);
  });

  test('moving the end of the day re-files what was logged in those hours, both ways', async () => {
    const u = await t.signup();
    const me = await getMe(t, u.cookie);
    const cat = me.categories[0].id;
    const day = daysFromToday(-3);
    await t.call('PUT', '/entries', { cookie: u.cookie, body: { day, items: [{ start: 30, dur: 60, cat, tag: 'late' }, { start: 600, dur: 60, cat, tag: null }] } });

    await t.call('PUT', '/settings', { cookie: u.cookie, body: { ...me.settings, rollover: 120 } });
    const read = async () => (await json(await t.call('GET', `/days?from=${daysFromToday(-5)}&to=${daysFromToday(0)}`, { cookie: u.cookie }))).entries;
    expect((await read()).map((e: { day: string; start: number }) => [e.day, e.start])).toEqual([
      [daysFromToday(-4), 1470],
      [day, 600],
    ]);

    await t.call('PUT', '/settings', { cookie: u.cookie, body: { ...me.settings, rollover: 0 } });
    expect((await read()).map((e: { day: string; start: number }) => [e.day, e.start])).toEqual([
      [day, 30],
      [day, 600],
    ]);
  });

  test('rejects an end of day that is out of range or not on the half hour', async () => {
    const u = await t.signup();
    const me = await getMe(t, u.cookie);
    for (const rollover of [-30, 45, 390, '120']) {
      expect((await t.call('PUT', '/settings', { cookie: u.cookie, body: { ...me.settings, rollover } })).status).toBe(400);
    }
  });
});
