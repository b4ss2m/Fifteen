import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestApp, type TestApp } from './helpers';
import { dayAdd, epochFromLocal, localParts } from '../shared/time';
import { countRows, daysFromToday, getMe, json, today, userId } from './util';

let t: TestApp;
let n = 0;
const fresh = (label: string) => `${label.toLowerCase()}${++n}@example.com`;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

type Item = { start: number; dur: number; cat: number | null; tag?: string | null };
type Row = { start: number; dur: number; cat: number; tag: string | null };

async function setup(label = 'e') {
  const u = await t.signup(fresh(label));
  const me = await getMe(t, u.cookie);
  const [x, y] = me.categories.map((c: { id: number }) => c.id) as number[];
  const put = (items: Item[], day = today()) => t.call('PUT', '/entries', { cookie: u.cookie, body: { day, items } });
  const shape = async (res: Response) => ((await json(res)).entries as Row[]).map((e) => [e.start, e.dur, e.cat, e.tag]);
  return { ...u, me, x, y, put, shape };
}

describe('logging entries', () => {
  test('stores a single entry and returns the whole day', async () => {
    const s = await setup();
    const res = await s.put([{ start: 540, dur: 30, cat: s.x, tag: 'standup' }]);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ entries: [{ day: today(), start: 540, dur: 30, cat: s.x, tag: 'standup' }] });
  });

  test('treats a missing tag as none', async () => {
    const s = await setup();
    expect(await s.shape(await s.put([{ start: 0, dur: 15, cat: s.x }]))).toEqual([[0, 15, s.x, null]]);
  });

  test('collapses whitespace in tags', async () => {
    const s = await setup();
    expect(await s.shape(await s.put([{ start: 0, dur: 15, cat: s.x, tag: '  write   the   report ' }]))).toEqual([[0, 15, s.x, 'write the report']]);
  });

  test('keeps different days apart', async () => {
    const s = await setup();
    await s.put([{ start: 540, dur: 30, cat: s.x }], daysFromToday(-1));
    await s.put([{ start: 600, dur: 30, cat: s.y }]);
    const days = await json(await t.call('GET', `/days?from=${daysFromToday(-1)}&to=${today()}`, { cookie: s.cookie }));
    expect(days.entries.map((e: { day: string; start: number }) => [e.day, e.start])).toEqual([[daysFromToday(-1), 540], [today(), 600]]);
  });

  test('logs several items in one request', async () => {
    const s = await setup();
    const res = await s.put([{ start: 540, dur: 15, cat: s.x }, { start: 600, dur: 15, cat: s.y }, { start: 570, dur: 15, cat: s.x }]);
    expect(await s.shape(res)).toEqual([[540, 15, s.x, null], [570, 15, s.x, null], [600, 15, s.y, null]]);
  });

  test('a later item in the same request wins over an earlier one', async () => {
    const s = await setup();
    const res = await s.put([{ start: 540, dur: 30, cat: s.x, tag: 'first' }, { start: 540, dur: 15, cat: s.y, tag: 'second' }]);
    expect(await s.shape(res)).toEqual([[540, 15, s.y, 'second'], [555, 15, s.x, 'first']]);
  });

  test('allows an entry that ends exactly at midnight', async () => {
    const s = await setup();
    expect((await s.put([{ start: 1435, dur: 5, cat: s.x }])).status).toBe(200);
    expect((await s.put([{ start: 0, dur: 1440, cat: s.x }])).status).toBe(200);
  });

  test('allows logging tomorrow and refuses days further out', async () => {
    const s = await setup();
    expect((await s.put([{ start: 0, dur: 5, cat: s.x }], daysFromToday(1))).status).toBe(200);
    expect((await s.put([{ start: 0, dur: 5, cat: s.x }], daysFromToday(2))).status).toBe(400);
  });
});

describe('overlaps', () => {
  async function overlap(newItem: Item) {
    const s = await setup('ov');
    await s.put([{ start: 540, dur: 60, cat: s.x, tag: 'old' }]);
    const res = await s.put([newItem].map((i) => ({ ...i, cat: i.cat === 1 ? s.y : i.cat })));
    return { s, rows: await s.shape(res) };
  }

  test('a new entry inside an old one splits it in two', async () => {
    const { s, rows } = await overlap({ start: 555, dur: 15, cat: 1, tag: 'new' });
    expect(rows).toEqual([[540, 15, s.x, 'old'], [555, 15, s.y, 'new'], [570, 30, s.x, 'old']]);
  });

  test('a new entry covering an old one replaces it', async () => {
    const s = await setup('ov');
    await s.put([{ start: 555, dur: 15, cat: s.x, tag: 'old' }]);
    const rows = await s.shape(await s.put([{ start: 540, dur: 60, cat: s.y, tag: 'new' }]));
    expect(rows).toEqual([[540, 60, s.y, 'new']]);
    expect(await countRows(t, 'SELECT COUNT(*) AS n FROM entries WHERE user_id = ?', await userId(t, s.email))).toBe(1);
  });

  test('a new entry over the left edge trims the start of the old one', async () => {
    const { s, rows } = await overlap({ start: 510, dur: 45, cat: 1, tag: 'new' });
    expect(rows).toEqual([[510, 45, s.y, 'new'], [555, 45, s.x, 'old']]);
  });

  test('a new entry over the right edge trims the end of the old one', async () => {
    const { s, rows } = await overlap({ start: 580, dur: 60, cat: 1, tag: 'new' });
    expect(rows).toEqual([[540, 40, s.x, 'old'], [580, 60, s.y, 'new']]);
  });

  test('an exact replacement leaves one entry', async () => {
    const { s, rows } = await overlap({ start: 540, dur: 60, cat: 1, tag: 'new' });
    expect(rows).toEqual([[540, 60, s.y, 'new']]);
  });

  test('a new entry at the start of an old one leaves the tail', async () => {
    const { s, rows } = await overlap({ start: 540, dur: 20, cat: 1, tag: 'new' });
    expect(rows).toEqual([[540, 20, s.y, 'new'], [560, 40, s.x, 'old']]);
  });

  test('a new entry at the end of an old one leaves the head', async () => {
    const { s, rows } = await overlap({ start: 580, dur: 20, cat: 1, tag: 'new' });
    expect(rows).toEqual([[540, 40, s.x, 'old'], [580, 20, s.y, 'new']]);
  });

  test('a new entry spanning several old ones trims both ends and drops the middle', async () => {
    const s = await setup('ov');
    await s.put([{ start: 540, dur: 30, cat: s.x }, { start: 570, dur: 15, cat: s.y }, { start: 585, dur: 30, cat: s.x }]);
    const rows = await s.shape(await s.put([{ start: 555, dur: 45, cat: s.y, tag: 'span' }]));
    expect(rows).toEqual([[540, 15, s.x, null], [555, 45, s.y, 'span'], [600, 15, s.x, null]]);
  });

  test('neighbouring entries that only touch are left alone', async () => {
    const s = await setup('ov');
    await s.put([{ start: 540, dur: 30, cat: s.x }]);
    const rows = await s.shape(await s.put([{ start: 570, dur: 30, cat: s.x }, { start: 510, dur: 30, cat: s.y }]));
    expect(rows).toEqual([[510, 30, s.y, null], [540, 30, s.x, null], [570, 30, s.x, null]]);
  });

  test('the stored rows match what the response claims', async () => {
    const s = await setup('ov');
    await s.put([{ start: 540, dur: 60, cat: s.x }]);
    const res = await s.put([{ start: 555, dur: 15, cat: s.y }]);
    const days = await json(await t.call('GET', `/days?from=${today()}&to=${today()}`, { cookie: s.cookie }));
    expect(days.entries).toEqual((await json(res.clone())).entries);
  });

  test('a day never holds overlapping entries after many random writes', async () => {
    const s = await setup('ov');
    let seed = 7;
    const rnd = (m: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % m);
    for (let i = 0; i < 25; i++) {
      const start = rnd(280) * 5;
      const dur = (rnd(24) + 1) * 5;
      const res = await s.put([{ start, dur: Math.min(dur, 1440 - start), cat: rnd(4) === 0 ? null : rnd(2) ? s.x : s.y }]);
      expect(res.status).toBe(200);
    }
    const days = await json(await t.call('GET', `/days?from=${today()}&to=${today()}`, { cookie: s.cookie }));
    const rows = days.entries as Row[];
    for (let i = 1; i < rows.length; i++) expect(rows[i].start).toBeGreaterThanOrEqual(rows[i - 1].start + rows[i - 1].dur);
  });
});

describe('erasing', () => {
  test('cat null erases the stretch and splits what surrounds it', async () => {
    const s = await setup('er');
    await s.put([{ start: 540, dur: 60, cat: s.x, tag: 'keep' }]);
    const rows = await s.shape(await s.put([{ start: 555, dur: 15, cat: null }]));
    expect(rows).toEqual([[540, 15, s.x, 'keep'], [570, 30, s.x, 'keep']]);
  });

  test('erasing everything leaves an empty day and no rows', async () => {
    const s = await setup('er');
    await s.put([{ start: 540, dur: 60, cat: s.x }]);
    const res = await s.put([{ start: 480, dur: 240, cat: null }]);
    expect((await json(res)).entries).toEqual([]);
    expect(await countRows(t, 'SELECT COUNT(*) AS n FROM entries WHERE user_id = ?', await userId(t, s.email))).toBe(0);
  });

  test('erasing an empty stretch is harmless', async () => {
    const s = await setup('er');
    const res = await s.put([{ start: 0, dur: 60, cat: null }]);
    expect(res.status).toBe(200);
    expect((await json(res)).entries).toEqual([]);
  });

  test('an erase does not need a category the user still has', async () => {
    const s = await setup('er');
    await s.put([{ start: 540, dur: 30, cat: s.x }]);
    await t.call('PATCH', `/categories/${s.x}`, { cookie: s.cookie, body: { archived: true } });
    expect((await s.put([{ start: 540, dur: 30, cat: null }])).status).toBe(200);
  });

  test('erase then write in one request lands the write', async () => {
    const s = await setup('er');
    await s.put([{ start: 540, dur: 60, cat: s.x }]);
    const rows = await s.shape(await s.put([{ start: 540, dur: 60, cat: null }, { start: 570, dur: 15, cat: s.y }]));
    expect(rows).toEqual([[570, 15, s.y, null]]);
  });
});

describe('entry validation', () => {
  async function rejects(items: unknown, day: unknown = today()) {
    const s = await setup('val');
    const res = await t.call('PUT', '/entries', { cookie: s.cookie, body: { day, items } });
    expect(res.status).toBe(400);
    expect(await countRows(t, 'SELECT COUNT(*) AS n FROM entries WHERE user_id = ?', await userId(t, s.email))).toBe(0);
    return { s, res };
  }

  test('rejects a start that is not a multiple of 5', async () => {
    const s = await setup('val');
    await rejects([{ start: 541, dur: 15, cat: s.x }]);
  });

  test('rejects a duration that is not a multiple of 5', async () => {
    const s = await setup('val');
    await rejects([{ start: 540, dur: 12, cat: s.x }]);
  });

  test('rejects a stretch that runs past midnight', async () => {
    const s = await setup('val');
    await rejects([{ start: 1435, dur: 10, cat: s.x }]);
    await rejects([{ start: 1400, dur: 45, cat: s.x }]);
    await rejects([{ start: 0, dur: 1445, cat: s.x }]);
  });

  test('rejects out-of-range, fractional and non-numeric values', async () => {
    const s = await setup('val');
    for (const bad of [
      { start: -5, dur: 15, cat: s.x },
      { start: 1440, dur: 5, cat: s.x },
      { start: 540, dur: 0, cat: s.x },
      { start: 540, dur: -15, cat: s.x },
      { start: 540.5, dur: 15, cat: s.x },
      { start: '540', dur: 15, cat: s.x },
      { start: 540, dur: '15', cat: s.x },
      { start: 540, dur: 15 },
      { start: 540, dur: 15, cat: 0 },
      { start: 540, dur: 15, cat: 'x' },
      { start: 540, dur: 15, cat: s.x, tag: 5 },
    ]) {
      const res = await s.put([bad as Item]);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });

  test('rejects items that are not an array, empty, or not objects', async () => {
    await rejects('nope');
    await rejects([]);
    await rejects([null]);
    await rejects([5]);
  });

  test('rejects more than 100 items and accepts exactly 100', async () => {
    const s = await setup('val');
    const items = (k: number): Item[] => Array.from({ length: k }, (_, i) => ({ start: i * 5, dur: 5, cat: s.x }));
    expect((await s.put(items(101))).status).toBe(400);
    expect((await s.put(items(100))).status).toBe(200);
  });

  test('rejects a day far in the future', async () => {
    const s = await setup('val');
    for (const d of [daysFromToday(5), '2099-01-01']) expect((await s.put([{ start: 0, dur: 5, cat: s.x }], d)).status).toBe(400);
  });

  test('rejects a day before 2020 and accepts the first day of 2020', async () => {
    const s = await setup('val');
    expect((await s.put([{ start: 0, dur: 5, cat: s.x }], '2019-12-31')).status).toBe(400);
    expect((await s.put([{ start: 0, dur: 5, cat: s.x }], '2020-01-01')).status).toBe(200);
  });

  test.each(['yesterday', '2024-1-1', '2024-02-30', '2024-13-01', '20240101', '', null, 20240101])('rejects the malformed day %j', async (d) => {
    const s = await setup('val');
    const res = await s.put([{ start: 0, dur: 5, cat: s.x }], d as string);
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'bad_day' });
  });

  test('rejects an archived category with bad_category', async () => {
    const s = await setup('val');
    await t.call('PATCH', `/categories/${s.y}`, { cookie: s.cookie, body: { archived: true } });
    const res = await s.put([{ start: 0, dur: 5, cat: s.y }]);
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'bad_category' });
  });

  test('rejects a category that does not exist', async () => {
    const s = await setup('val');
    const res = await s.put([{ start: 0, dur: 5, cat: 999999 }]);
    expect(await json(res)).toEqual({ error: 'bad_category' });
  });

  test('one bad item means nothing at all is written', async () => {
    const s = await setup('val');
    const res = await s.put([{ start: 0, dur: 15, cat: s.x }, { start: 3, dur: 15, cat: s.x }]);
    expect(res.status).toBe(400);
    expect(await countRows(t, 'SELECT COUNT(*) AS n FROM entries WHERE user_id = ?', await userId(t, s.email))).toBe(0);
  });
});

describe('reading days', () => {
  test('returns entries and windows in order for a range', async () => {
    const s = await setup('rd');
    await s.put([{ start: 600, dur: 15, cat: s.x }, { start: 540, dur: 15, cat: s.y }]);
    await t.call('POST', '/track/start', { cookie: s.cookie, body: { day: today(), start: 540, end: 660, until: Math.floor(Date.now() / 1000) + 3600 } });
    const days = await json(await t.call('GET', `/days?from=${today()}&to=${today()}`, { cookie: s.cookie }));
    expect(days.entries.map((e: Row) => e.start)).toEqual([540, 600]);
    expect(days.windows).toEqual([{ day: today(), start: 540, end: 660 }]);
  });

  test('returns nothing for a day without data', async () => {
    const s = await setup('rd');
    expect(await json(await t.call('GET', `/days?from=2021-01-01&to=2021-01-02`, { cookie: s.cookie }))).toEqual({ entries: [], windows: [] });
  });

  test('rejects a range that ends before it starts', async () => {
    const s = await setup('rd');
    const res = await t.call('GET', `/days?from=${today()}&to=${daysFromToday(-1)}`, { cookie: s.cookie });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'bad_day' });
  });

  test('accepts a range of 93 days and rejects 94', async () => {
    const s = await setup('rd');
    expect((await t.call('GET', `/days?from=2024-01-01&to=${dayAdd('2024-01-01', 93)}`, { cookie: s.cookie })).status).toBe(200);
    expect((await t.call('GET', `/days?from=2024-01-01&to=${dayAdd('2024-01-01', 94)}`, { cookie: s.cookie })).status).toBe(400);
  });

  test('rejects missing or malformed bounds', async () => {
    const s = await setup('rd');
    for (const q of ['', `?from=${today()}`, `?to=${today()}`, '?from=a&to=b', `?from=2024-02-30&to=2024-03-01`]) {
      expect((await t.call('GET', `/days${q}`, { cookie: s.cookie })).status, q).toBe(400);
    }
  });
});

describe('tracking sessions', () => {
  const until = () => Math.floor(Date.now() / 1000) + 3600;
  const start = (cookie: string, body: Record<string, unknown>) => t.call('POST', '/track/start', { cookie, body });
  const stop = (cookie: string, body: Record<string, unknown>) => t.call('POST', '/track/stop', { cookie, body });

  test('start records a window and sets trackUntil', async () => {
    const s = await setup('tr');
    const u = until();
    const res = await start(s.cookie, { day: today(), start: 540, end: 600, until: u });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ trackUntil: u, window: { day: today(), start: 540, end: 600 } });
    expect((await getMe(t, s.cookie)).trackUntil).toBe(u);
  });

  test('stop clears trackUntil and trims the running window', async () => {
    const s = await setup('tr');
    await start(s.cookie, { day: today(), start: 540, end: 660, until: until() });
    const res = await stop(s.cookie, { day: today(), end: 600 });
    expect(await json(res)).toEqual({ windows: [{ day: today(), start: 540, end: 600 }] });
    expect((await getMe(t, s.cookie)).trackUntil).toBeNull();
  });

  test('stop drops windows that start at or after the stop time and keeps earlier ones', async () => {
    const s = await setup('tr');
    await start(s.cookie, { day: today(), start: 480, end: 540, until: until() });
    await start(s.cookie, { day: today(), start: 600, end: 660, until: until() });
    await start(s.cookie, { day: today(), start: 660, end: 720, until: until() });
    const res = await stop(s.cookie, { day: today(), end: 600 });
    expect(await json(res)).toEqual({ windows: [{ day: today(), start: 480, end: 540 }] });
  });

  test('stop only touches the given day', async () => {
    const s = await setup('tr');
    await start(s.cookie, { day: daysFromToday(-1), start: 540, end: 600, until: until() });
    await stop(s.cookie, { day: today(), end: 0 });
    const days = await json(await t.call('GET', `/days?from=${daysFromToday(-1)}&to=${daysFromToday(-1)}`, { cookie: s.cookie }));
    expect(days.windows).toHaveLength(1);
  });

  test('stop with nothing running is harmless', async () => {
    const s = await setup('tr');
    expect(await json(await stop(s.cookie, { day: today(), end: 600 }))).toEqual({ windows: [] });
  });

  test('start validates its numbers and day', async () => {
    const s = await setup('tr');
    const good = { day: today(), start: 540, end: 600, until: until() };
    for (const bad of [
      { ...good, start: 541 },
      { ...good, end: 543 },
      { ...good, end: 540 },
      { ...good, end: 535 },
      { ...good, end: 1445 },
      { ...good, start: 1440 },
      { ...good, until: Math.floor(Date.now() / 1000) - 10 },
      { ...good, until: Math.floor(Date.now() / 1000) + 90000 },
      { ...good, until: 'soon' },
      { ...good, day: 'today' },
      { ...good, day: daysFromToday(5) },
    ]) {
      expect((await start(s.cookie, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(await countRows(t, 'SELECT COUNT(*) AS n FROM windows WHERE user_id = ?', await userId(t, s.email))).toBe(0);
  });

  test('stop validates its numbers and day', async () => {
    const s = await setup('tr');
    expect((await stop(s.cookie, { day: today(), end: 601 })).status).toBe(400);
    expect((await stop(s.cookie, { day: today(), end: 1445 })).status).toBe(400);
    expect((await stop(s.cookie, { day: 'x', end: 600 })).status).toBe(400);
  });

  test('allows at most 24 windows per day', async () => {
    const s = await setup('tr');
    for (let i = 0; i < 24; i++) expect((await start(s.cookie, { day: today(), start: i * 5, end: i * 5 + 5, until: until() })).status).toBe(200);
    const res = await start(s.cookie, { day: today(), start: 600, end: 605, until: until() });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'too_many' });
    expect((await start(s.cookie, { day: daysFromToday(-1), start: 0, end: 5, until: until() })).status).toBe(200);
  });

  test('an expired trackUntil is not reported by /me', async () => {
    const s = await setup('tr');
    await start(s.cookie, { day: today(), start: 540, end: 600, until: until() });
    await t.env.DB.prepare('UPDATE users SET track_until = ? WHERE email = ?').bind(Math.floor(Date.now() / 1000) - 5, s.email).run();
    expect((await getMe(t, s.cookie)).trackUntil).toBeNull();
  });
});

describe('settings', () => {
  const base = {
    interval: 30,
    workdays: [1, 2, 3, 4, 5],
    dayStart: 480,
    dayEnd: 1020,
    autoTrack: false,
    reportAt: 1260,
    wakingHours: 16,
    tz: 'Europe/Berlin',
    theme: 'dark',
    sound: false,
  };
  const put = (cookie: string, body: unknown) => t.call('PUT', '/settings', { cookie, body });

  test('saves and returns a valid settings object', async () => {
    const s = await setup('st');
    const res = await put(s.cookie, base);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ...base, autoSince: null, rollover: 0 });
    expect((await getMe(t, s.cookie)).settings).toEqual({ ...base, autoSince: null, rollover: 0 });
  });

  test('sorts and de-duplicates workdays', async () => {
    const s = await setup('st');
    const res = await put(s.cookie, { ...base, workdays: [5, 1, 1, 3] });
    expect((await json(res)).workdays).toEqual([1, 3, 5]);
  });

  test('accepts every offered interval', async () => {
    const s = await setup('st');
    for (const interval of [10, 15, 20, 30, 60]) expect((await put(s.cookie, { ...base, interval })).status).toBe(200);
  });

  test.each([
    ['an interval that is not offered', { interval: 25 }],
    ['a tiny interval', { interval: 1 }],
    ['a huge interval', { interval: 120 }],
    ['a fractional interval', { interval: 7.5 }],
    ['dayEnd equal to dayStart', { dayStart: 600, dayEnd: 600 }],
    ['dayEnd before dayStart', { dayStart: 600, dayEnd: 540 }],
    ['dayStart off the 5-minute grid', { dayStart: 541 }],
    ['dayEnd past midnight', { dayEnd: 1445 }],
    ['an unknown time zone', { tz: 'Mars/Olympus' }],
    ['a non-string time zone', { tz: 5 }],
    ['an unknown theme', { theme: 'solarized' }],
    ['a non-boolean autoTrack', { autoTrack: 'yes' }],
    ['a non-boolean sound', { sound: 1 }],
    ['workdays outside 0-6', { workdays: [7] }],
    ['workdays that is not a list', { workdays: 'mon' }],
    ['too few waking hours', { wakingHours: 7 }],
    ['too many waking hours', { wakingHours: 21 }],
    ['a reportAt off the grid', { reportAt: 1261 }],
  ])('rejects %s', async (_label, patch) => {
    const s = await setup('st');
    const res = await put(s.cookie, { ...base, ...patch });
    expect(res.status).toBe(400);
    expect((await getMe(t, s.cookie)).settings.interval).toBe(15);
  });

  test('rejects a missing field and a non-object body', async () => {
    const s = await setup('st');
    const { theme: _theme, ...rest } = base;
    expect((await put(s.cookie, rest)).status).toBe(400);
    expect((await put(s.cookie, {})).status).toBe(400);
  });

  test('ignores a client supplied autoSince', async () => {
    const s = await setup('st');
    const res = await put(s.cookie, { ...base, autoTrack: true, autoSince: '2020-01-01' });
    expect((await json(res)).autoSince).toBe(localParts(Math.floor(Date.now() / 1000), 'Europe/Berlin').day);
  });

  test('switching autoTrack on sets autoSince to today in the user time zone', async () => {
    const s = await setup('st');
    const res = await put(s.cookie, { ...base, autoTrack: true, tz: 'Pacific/Auckland' });
    const out = await json(res);
    expect(out.autoSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out.autoSince).toBe(localParts(Math.floor(Date.now() / 1000), 'Pacific/Auckland').day);
  });

  test('keeps the original autoSince while autoTrack stays on', async () => {
    const s = await setup('st');
    await put(s.cookie, { ...base, autoTrack: true });
    await t.env.DB.prepare('UPDATE users SET settings = json_set(settings, ?, ?) WHERE email = ?').bind('$.autoSince', '2024-05-06', s.email).run();
    const res = await put(s.cookie, { ...base, autoTrack: true, interval: 20 });
    expect((await json(res)).autoSince).toBe('2024-05-06');
  });

  test('switching autoTrack off clears autoSince, and on again starts afresh', async () => {
    const s = await setup('st');
    await put(s.cookie, { ...base, autoTrack: true });
    await t.env.DB.prepare('UPDATE users SET settings = json_set(settings, ?, ?) WHERE email = ?').bind('$.autoSince', '2024-05-06', s.email).run();
    expect((await json(await put(s.cookie, { ...base, autoTrack: false }))).autoSince).toBeNull();
    const again = await json(await put(s.cookie, { ...base, autoTrack: true }));
    expect(again.autoSince).not.toBe('2024-05-06');
    expect(again.autoSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('categories', () => {
  const make = (cookie: string, body: Record<string, unknown>) => t.call('POST', '/categories', { cookie, body });

  test('creates a category at the end of the list', async () => {
    const s = await setup('ca');
    const res = await make(s.cookie, { name: 'Reading', color: 'violet', kind: 'neutral' });
    expect(res.status).toBe(201);
    const cat = await json(res);
    expect(cat).toMatchObject({ name: 'Reading', color: 'violet', kind: 'neutral', pos: 6, archived: false });
    expect(typeof cat.id).toBe('number');
    const me = await getMe(t, s.cookie);
    expect(me.categories.at(-1)).toEqual(cat);
  });

  test('trims and collapses whitespace in names', async () => {
    const s = await setup('ca');
    expect((await json(await make(s.cookie, { name: '  Side   project ', color: 'blue', kind: 'focus' }))).name).toBe('Side project');
  });

  test.each([
    ['a missing name', { color: 'blue', kind: 'focus' }],
    ['an empty name', { name: '   ', color: 'blue', kind: 'focus' }],
    ['a non-string name', { name: 5, color: 'blue', kind: 'focus' }],
    ['an unknown colour', { name: 'x', color: 'chartreuse', kind: 'focus' }],
    ['a missing colour', { name: 'x', kind: 'focus' }],
    ['an unknown kind', { name: 'x', color: 'blue', kind: 'evil' }],
    ['a missing kind', { name: 'x', color: 'blue' }],
  ])('rejects %s', async (_label, body) => {
    const s = await setup('ca');
    expect((await make(s.cookie, body)).status).toBe(400);
    expect((await getMe(t, s.cookie)).categories).toHaveLength(6);
  });

  test('patches only the fields that are sent', async () => {
    const s = await setup('ca');
    const before = s.me.categories[0];
    const res = await t.call('PATCH', `/categories/${s.x}`, { cookie: s.cookie, body: { name: 'Focus Time' } });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ...before, name: 'Focus Time' });
    const res2 = await t.call('PATCH', `/categories/${s.x}`, { cookie: s.cookie, body: { color: 'pink', kind: 'waste' } });
    expect(await json(res2)).toEqual({ ...before, name: 'Focus Time', color: 'pink', kind: 'waste' });
  });

  test('archives and restores through patch', async () => {
    const s = await setup('ca');
    expect((await json(await t.call('PATCH', `/categories/${s.x}`, { cookie: s.cookie, body: { archived: true } }))).archived).toBe(true);
    expect((await getMe(t, s.cookie)).categories[0].archived).toBe(true);
    expect((await json(await t.call('PATCH', `/categories/${s.x}`, { cookie: s.cookie, body: { archived: false } }))).archived).toBe(false);
    expect((await s.put([{ start: 0, dur: 5, cat: s.x }])).status).toBe(200);
  });

  test('patch rejects bad values and unknown ids', async () => {
    const s = await setup('ca');
    expect((await t.call('PATCH', `/categories/${s.x}`, { cookie: s.cookie, body: { color: 'nope' } })).status).toBe(400);
    expect((await t.call('PATCH', `/categories/${s.x}`, { cookie: s.cookie, body: { kind: 'nope' } })).status).toBe(400);
    expect((await t.call('PATCH', `/categories/${s.x}`, { cookie: s.cookie, body: { name: '' } })).status).toBe(400);
    expect((await t.call('PATCH', '/categories/999999', { cookie: s.cookie, body: { name: 'x' } })).status).toBe(404);
    expect((await t.call('PATCH', '/categories/abc', { cookie: s.cookie, body: { name: 'x' } })).status).toBe(400);
    expect((await t.call('PATCH', '/categories/0', { cookie: s.cookie, body: { name: 'x' } })).status).toBe(400);
    expect((await t.call('PATCH', '/categories/1.5', { cookie: s.cookie, body: { name: 'x' } })).status).toBe(400);
  });

  test('deleting an unused category removes it', async () => {
    const s = await setup('ca');
    const res = await t.call('DELETE', `/categories/${s.me.categories[5].id}`, { cookie: s.cookie });
    expect(await json(res)).toEqual({ archived: false });
    expect((await getMe(t, s.cookie)).categories).toHaveLength(5);
  });

  test('deleting a category that entries use archives it and keeps the entries', async () => {
    const s = await setup('ca');
    await s.put([{ start: 540, dur: 30, cat: s.x, tag: 'history' }]);
    const res = await t.call('DELETE', `/categories/${s.x}`, { cookie: s.cookie });
    expect(await json(res)).toEqual({ archived: true });
    const me = await getMe(t, s.cookie);
    expect(me.categories).toHaveLength(6);
    expect(me.categories.find((c: { id: number }) => c.id === s.x).archived).toBe(true);
    const days = await json(await t.call('GET', `/days?from=${today()}&to=${today()}`, { cookie: s.cookie }));
    expect(days.entries).toEqual([{ day: today(), start: 540, dur: 30, cat: s.x, tag: 'history' }]);
  });

  test('a category whose entries were all erased can be deleted outright', async () => {
    const s = await setup('ca');
    await s.put([{ start: 540, dur: 30, cat: s.x }]);
    await s.put([{ start: 540, dur: 30, cat: null }]);
    expect(await json(await t.call('DELETE', `/categories/${s.x}`, { cookie: s.cookie }))).toEqual({ archived: false });
  });

  test('deleting an unknown id changes nothing', async () => {
    const s = await setup('ca');
    const res = await t.call('DELETE', '/categories/999999', { cookie: s.cookie });
    expect(res.status).toBe(200);
    expect((await getMe(t, s.cookie)).categories).toHaveLength(6);
  });

  test('reordering changes the order and positions', async () => {
    const s = await setup('ca');
    const ids = s.me.categories.map((c: { id: number }) => c.id).reverse();
    expect((await t.call('PUT', '/categories/order', { cookie: s.cookie, body: { ids } })).status).toBe(200);
    const me = await getMe(t, s.cookie);
    expect(me.categories.map((c: { id: number }) => c.id)).toEqual(ids);
    expect(me.categories.map((c: { pos: number }) => c.pos)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('a new category after a reorder goes to the end', async () => {
    const s = await setup('ca');
    await t.call('PUT', '/categories/order', { cookie: s.cookie, body: { ids: s.me.categories.map((c: { id: number }) => c.id).reverse() } });
    const cat = await json(await make(s.cookie, { name: 'Last', color: 'red', kind: 'waste' }));
    expect(cat.pos).toBe(6);
  });

  test('reorder rejects bad ids and oversized lists, and accepts an empty list', async () => {
    const s = await setup('ca');
    const order = (ids: unknown) => t.call('PUT', '/categories/order', { cookie: s.cookie, body: { ids } });
    expect((await order('nope')).status).toBe(400);
    expect((await order([1.5])).status).toBe(400);
    expect((await order(['1'])).status).toBe(400);
    expect((await order([0])).status).toBe(400);
    expect((await order(Array.from({ length: 41 }, (_, i) => i + 1))).status).toBe(400);
    expect((await order([])).status).toBe(200);
  });
});

describe('notice', () => {
  test('describes the slot a pulse closes', async () => {
    const s = await setup('no');
    const stamp = epochFromLocal('2025-03-12', 615, 'Europe/Berlin');
    await s.put([{ start: 0, dur: 60, cat: s.y }], today());
    await t.env.DB.prepare('UPDATE users SET notice = ? WHERE email = ?').bind(`pulse:${stamp}`, s.email).run();
    const out = await json(await t.call('GET', '/notice', { cookie: s.cookie }));
    expect(out).toMatchObject({ type: 'pulse', day: '2025-03-12', start: 600, dur: 15, label: '10:00–10:15' });
    expect(out.actions).toHaveLength(2);
    expect(out.actions[0]).toEqual({ id: s.y, name: s.me.categories[1].name });
  });

  test('a pulse at midnight belongs to the previous day', async () => {
    const s = await setup('no');
    const stamp = epochFromLocal('2025-03-12', 0, 'Europe/Berlin');
    await t.env.DB.prepare('UPDATE users SET notice = ? WHERE email = ?').bind(`pulse:${stamp}`, s.email).run();
    const out = await json(await t.call('GET', '/notice', { cookie: s.cookie }));
    expect(out).toMatchObject({ type: 'pulse', day: '2025-03-11', start: 1425, dur: 15, label: '23:45–00:00' });
  });

  test('describes a report', async () => {
    const s = await setup('no');
    const stamp = epochFromLocal('2025-03-12', 1260, 'Europe/Berlin');
    await t.env.DB.prepare('UPDATE users SET notice = ? WHERE email = ?').bind(`report:${stamp}`, s.email).run();
    expect(await json(await t.call('GET', '/notice', { cookie: s.cookie }))).toEqual({ type: 'report', day: '2025-03-12' });
  });

  test('does not offer archived categories as quick actions', async () => {
    const s = await setup('no');
    for (const c of s.me.categories.slice(1)) await t.call('PATCH', `/categories/${c.id}`, { cookie: s.cookie, body: { archived: true } });
    await t.env.DB.prepare('UPDATE users SET notice = ? WHERE email = ?').bind(`pulse:${epochFromLocal('2025-03-12', 615, 'Europe/Berlin')}`, s.email).run();
    const out = await json(await t.call('GET', '/notice', { cookie: s.cookie }));
    expect(out.actions.map((a: { id: number }) => a.id)).toEqual([s.x]);
  });
});
