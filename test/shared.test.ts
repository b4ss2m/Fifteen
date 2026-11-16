import { describe, expect, test } from 'vitest';
import { buildBlocks, slotsIn, suggest, summarize, trackedSpans, type Block } from '../shared/day';
import { dayAdd, epochFromLocal, fmtDur, fmtMin, isDay, isTimeZone, localParts, nextPulse, nextReport, weekdayOf } from '../shared/time';
import { DEFAULT_SETTINGS, type Category, type Entry, type Kind, type Settings } from '../shared/types';

const utc = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe('fmtMin and fmtDur', () => {
  test('formats minutes of the day as HH:MM', () => {
    expect(fmtMin(0)).toBe('00:00');
    expect(fmtMin(5)).toBe('00:05');
    expect(fmtMin(615)).toBe('10:15');
    expect(fmtMin(1435)).toBe('23:55');
  });

  test('wraps past midnight', () => {
    expect(fmtMin(1440)).toBe('00:00');
    expect(fmtMin(1530)).toBe('01:30');
  });

  test('formats short durations in minutes', () => {
    expect(fmtDur(0)).toBe('0 min');
    expect(fmtDur(5)).toBe('5 min');
    expect(fmtDur(59)).toBe('59 min');
  });

  test('formats longer durations in hours and minutes', () => {
    expect(fmtDur(60)).toBe('1h');
    expect(fmtDur(75)).toBe('1h 15m');
    expect(fmtDur(120)).toBe('2h');
    expect(fmtDur(1440)).toBe('24h');
  });
});

describe('days', () => {
  test('isDay accepts real calendar dates', () => {
    expect(isDay('2025-03-12')).toBe(true);
    expect(isDay('2024-02-29')).toBe(true);
    expect(isDay('2020-01-01')).toBe(true);
  });

  test.each(['2025-02-29', '2025-13-01', '2025-00-10', '2025-04-31', '2025-3-12', '20250312', '2025-03-12T00:00', ' 2025-03-12', '', 'today'])('isDay rejects %j', (s) => {
    expect(isDay(s)).toBe(false);
  });

  test('isDay rejects non-strings', () => {
    for (const v of [null, undefined, 20250312, {}, []]) expect(isDay(v)).toBe(false);
  });

  test('dayAdd moves across month, year and leap boundaries', () => {
    expect(dayAdd('2025-03-12', 1)).toBe('2025-03-13');
    expect(dayAdd('2025-01-31', 1)).toBe('2025-02-01');
    expect(dayAdd('2024-02-28', 1)).toBe('2024-02-29');
    expect(dayAdd('2025-02-28', 1)).toBe('2025-03-01');
    expect(dayAdd('2025-12-31', 1)).toBe('2026-01-01');
    expect(dayAdd('2025-01-01', -1)).toBe('2024-12-31');
    expect(dayAdd('2025-03-12', 0)).toBe('2025-03-12');
    expect(dayAdd('2025-03-12', 93)).toBe('2025-06-13');
  });

  test('weekdayOf counts Sunday as 0', () => {
    expect(weekdayOf('2025-03-09')).toBe(0);
    expect(weekdayOf('2025-03-10')).toBe(1);
    expect(weekdayOf('2025-03-12')).toBe(3);
    expect(weekdayOf('2025-03-15')).toBe(6);
    expect(weekdayOf('2024-02-29')).toBe(4);
  });

  test('isTimeZone accepts IANA names and rejects junk', () => {
    expect(isTimeZone('Europe/Berlin')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    expect(isTimeZone('')).toBe(false);
    expect(isTimeZone(5)).toBe(false);
    expect(isTimeZone('A'.repeat(65))).toBe(false);
  });
});

describe('localParts', () => {
  test('reads the wall clock in several zones', () => {
    expect(localParts(0, 'UTC')).toEqual({ day: '1970-01-01', min: 0 });
    expect(localParts(utc('2025-07-01T12:00:00Z'), 'Europe/Berlin')).toEqual({ day: '2025-07-01', min: 14 * 60 });
    expect(localParts(utc('2025-01-15T12:00:00Z'), 'Europe/Berlin')).toEqual({ day: '2025-01-15', min: 13 * 60 });
    expect(localParts(utc('2025-01-15T12:00:00Z'), 'America/New_York')).toEqual({ day: '2025-01-15', min: 7 * 60 });
    expect(localParts(utc('2025-01-01T00:00:00Z'), 'Asia/Kathmandu')).toEqual({ day: '2025-01-01', min: 5 * 60 + 45 });
  });

  test('rolls the date over at local midnight', () => {
    expect(localParts(utc('2025-03-12T23:30:00Z'), 'Europe/Berlin')).toEqual({ day: '2025-03-13', min: 30 });
    expect(localParts(utc('2025-03-12T03:00:00Z'), 'America/New_York')).toEqual({ day: '2025-03-11', min: 23 * 60 });
  });

  test('reads midnight as 0, not 24', () => {
    expect(localParts(utc('2025-03-11T23:00:00Z'), 'Europe/Berlin')).toEqual({ day: '2025-03-12', min: 0 });
  });
});

describe('epochFromLocal', () => {
  const zones = ['Europe/Berlin', 'America/New_York', 'Asia/Kathmandu'];
  const days = ['2025-01-15', '2025-03-09', '2025-03-30', '2025-06-01', '2025-10-26', '2025-11-02'];
  const minutes = [0, 60, 180, 600, 1435];

  test.each(zones)('round-trips through localParts in %s', (tz) => {
    for (const day of days) {
      for (const min of minutes) {
        expect(localParts(epochFromLocal(day, min, tz), tz), `${day} ${min}`).toEqual({ day, min });
      }
    }
  });

  test('matches known offsets', () => {
    expect(epochFromLocal('2025-01-15', 0, 'UTC')).toBe(utc('2025-01-15T00:00:00Z'));
    expect(epochFromLocal('2025-01-15', 600, 'Europe/Berlin')).toBe(utc('2025-01-15T09:00:00Z'));
    expect(epochFromLocal('2025-07-01', 600, 'Europe/Berlin')).toBe(utc('2025-07-01T08:00:00Z'));
    expect(epochFromLocal('2025-01-15', 600, 'America/New_York')).toBe(utc('2025-01-15T15:00:00Z'));
    expect(epochFromLocal('2025-06-01', 0, 'Asia/Kathmandu')).toBe(utc('2025-05-31T18:15:00Z'));
  });

  test('accepts minutes past 1440 as the following day', () => {
    for (const tz of zones) {
      expect(epochFromLocal('2025-03-01', 1500, tz)).toBe(epochFromLocal('2025-03-02', 60, tz));
    }
  });

  test('Berlin loses an hour on the spring-forward day', () => {
    const span = epochFromLocal('2025-03-30', 240, 'Europe/Berlin') - epochFromLocal('2025-03-30', 60, 'Europe/Berlin');
    expect(span).toBe(2 * 3600);
    expect(epochFromLocal('2025-03-31', 0, 'Europe/Berlin') - epochFromLocal('2025-03-30', 0, 'Europe/Berlin')).toBe(23 * 3600);
  });

  test('Berlin gains an hour on the fall-back day', () => {
    const span = epochFromLocal('2025-10-26', 360, 'Europe/Berlin') - epochFromLocal('2025-10-26', 0, 'Europe/Berlin');
    expect(span).toBe(7 * 3600);
    expect(epochFromLocal('2025-10-27', 0, 'Europe/Berlin') - epochFromLocal('2025-10-26', 0, 'Europe/Berlin')).toBe(25 * 3600);
  });

  test('New York day lengths on DST changes', () => {
    expect(epochFromLocal('2025-03-10', 0, 'America/New_York') - epochFromLocal('2025-03-09', 0, 'America/New_York')).toBe(23 * 3600);
    expect(epochFromLocal('2025-11-03', 0, 'America/New_York') - epochFromLocal('2025-11-02', 0, 'America/New_York')).toBe(25 * 3600);
  });

  test('Kathmandu has no DST and a 45 minute offset', () => {
    for (const day of days) {
      expect(epochFromLocal(dayAdd(day, 1), 0, 'Asia/Kathmandu') - epochFromLocal(day, 0, 'Asia/Kathmandu')).toBe(86400);
    }
    expect(localParts(epochFromLocal('2025-03-12', 615, 'Asia/Kathmandu'), 'UTC')).toEqual({ day: '2025-03-12', min: 615 - 345 });
  });

  test('a wall-clock time that does not exist lands near the gap', () => {
    const t = epochFromLocal('2025-03-30', 150, 'Europe/Berlin');
    const lp = localParts(t, 'Europe/Berlin');
    expect(lp.day).toBe('2025-03-30');
    expect(Math.abs(lp.min - 150)).toBeLessThanOrEqual(60);
  });
});

describe('nextPulse', () => {
  const base: Settings = { ...DEFAULT_SETTINGS, tz: 'UTC', interval: 15, autoTrack: false, autoSince: null };
  const auto: Settings = { ...base, autoTrack: true, autoSince: '2025-01-01', workdays: [1, 2, 3, 4, 5], dayStart: 540, dayEnd: 1080 };
  const wed = (hhmm: string) => utc(`2025-03-12T${hhmm}:00Z`);

  test('is null when nothing is tracked', () => {
    expect(nextPulse(wed('10:07'), base, null)).toBeNull();
  });

  test('is null when the manual session has already ended', () => {
    expect(nextPulse(wed('10:07'), base, wed('10:00'))).toBeNull();
  });

  test('a manual session pulses on the next interval boundary', () => {
    expect(nextPulse(wed('10:07'), base, wed('11:07'))).toBe(wed('10:15'));
  });

  test('a manual session pulse on the boundary itself moves to the next one', () => {
    expect(nextPulse(wed('10:15'), base, wed('11:00'))).toBe(wed('10:30'));
  });

  test('a manual session that ends before the next boundary does not pulse', () => {
    expect(nextPulse(wed('10:07'), base, wed('10:08'))).toBeNull();
  });

  test('a manual session pulses once more at its end', () => {
    expect(nextPulse(wed('10:07'), base, wed('10:15'))).toBe(wed('10:15'));
  });

  test('follows the configured interval', () => {
    expect(nextPulse(wed('10:07'), { ...base, interval: 30 }, wed('12:00'))).toBe(wed('10:30'));
    expect(nextPulse(wed('10:07'), { ...base, interval: 60 }, wed('12:00'))).toBe(wed('11:00'));
    expect(nextPulse(wed('10:07'), { ...base, interval: 10 }, wed('12:00'))).toBe(wed('10:10'));
  });

  test('the workday schedule pulses during work hours', () => {
    expect(nextPulse(wed('10:07'), auto, null)).toBe(wed('10:15'));
  });

  test('waits for the first pulse after the day starts', () => {
    expect(nextPulse(wed('08:00'), auto, null)).toBe(wed('09:15'));
  });

  test('the last pulse of the day lands on the day end', () => {
    expect(nextPulse(wed('17:50'), auto, null)).toBe(wed('18:00'));
  });

  test('after the day ends it moves to tomorrow morning', () => {
    expect(nextPulse(wed('18:00'), auto, null)).toBe(utc('2025-03-13T09:15:00Z'));
    expect(nextPulse(wed('22:00'), auto, null)).toBe(utc('2025-03-13T09:15:00Z'));
  });

  test('skips the weekend', () => {
    expect(nextPulse(utc('2025-03-14T18:30:00Z'), auto, null)).toBe(utc('2025-03-17T09:15:00Z'));
    expect(nextPulse(utc('2025-03-15T12:00:00Z'), auto, null)).toBe(utc('2025-03-17T09:15:00Z'));
    expect(nextPulse(utc('2025-03-16T12:00:00Z'), auto, null)).toBe(utc('2025-03-17T09:15:00Z'));
  });

  test('a weekend manual session beats the schedule', () => {
    const sat = utc('2025-03-15T12:00:00Z');
    expect(nextPulse(sat, auto, sat + 3600)).toBe(utc('2025-03-15T12:15:00Z'));
  });

  test('is null with the schedule on but no workdays or an empty day', () => {
    expect(nextPulse(wed('10:07'), { ...auto, workdays: [] }, null)).toBeNull();
    expect(nextPulse(wed('10:07'), { ...auto, dayStart: 600, dayEnd: 600 }, null)).toBeNull();
  });

  test('works in the user time zone', () => {
    const s = { ...auto, tz: 'Europe/Berlin' };
    const now = epochFromLocal('2025-03-12', 607, 'Europe/Berlin');
    expect(nextPulse(now, s, null)).toBe(epochFromLocal('2025-03-12', 615, 'Europe/Berlin'));
  });

  test('keeps wall-clock times across a DST change', () => {
    const s = { ...auto, tz: 'Europe/Berlin' };
    const fri = epochFromLocal('2025-03-28', 1090, 'Europe/Berlin');
    expect(nextPulse(fri, s, null)).toBe(epochFromLocal('2025-03-31', 555, 'Europe/Berlin'));
  });

  test('half-hour offsets still land on local boundaries', () => {
    const s = { ...base, tz: 'Asia/Kathmandu' };
    const now = epochFromLocal('2025-03-12', 607, 'Asia/Kathmandu');
    const next = nextPulse(now, s, now + 7200)!;
    expect(localParts(next, 'Asia/Kathmandu')).toEqual({ day: '2025-03-12', min: 615 });
  });
});

describe('nextReport', () => {
  const s: Settings = { ...DEFAULT_SETTINGS, tz: 'UTC', reportAt: 21 * 60 };

  test('is later today when the report time is still ahead', () => {
    expect(nextReport(utc('2025-03-12T20:00:00Z'), s)).toBe(utc('2025-03-12T21:00:00Z'));
  });

  test('is tomorrow once the time has passed or arrived', () => {
    expect(nextReport(utc('2025-03-12T21:00:00Z'), s)).toBe(utc('2025-03-13T21:00:00Z'));
    expect(nextReport(utc('2025-03-12T23:59:00Z'), s)).toBe(utc('2025-03-13T21:00:00Z'));
  });

  test('uses the user time zone', () => {
    const berlin = { ...s, tz: 'Europe/Berlin' };
    expect(nextReport(utc('2025-03-12T19:00:00Z'), berlin)).toBe(utc('2025-03-12T20:00:00Z'));
    expect(nextReport(utc('2025-03-12T20:30:00Z'), berlin)).toBe(utc('2025-03-13T20:00:00Z'));
  });

  test('stays at the same local time over a DST change', () => {
    const berlin = { ...s, tz: 'Europe/Berlin' };
    const next = nextReport(utc('2025-03-29T21:00:00Z'), berlin);
    expect(localParts(next, 'Europe/Berlin')).toEqual({ day: '2025-03-30', min: 21 * 60 });
  });
});

const entry = (start: number, dur: number, cat: number, tag: string | null = null, day = '2025-03-12'): Entry => ({ day, start, dur, cat, tag });
const cat = (id: number, pos = id - 1, kind: Kind = 'focus', archived = false): Category => ({ id, name: `c${id}`, color: 'blue', kind, pos, archived });
const total = (blocks: Block[]) => blocks.reduce((sum, b) => sum + b.dur, 0);

describe('trackedSpans', () => {
  const s: Settings = { ...DEFAULT_SETTINGS, autoTrack: true, autoSince: '2025-03-01', workdays: [1, 2, 3, 4, 5], dayStart: 540, dayEnd: 1080 };

  test('includes manual windows for that day only', () => {
    const spans = trackedSpans('2025-03-15', DEFAULT_SETTINGS, [
      { day: '2025-03-15', start: 600, end: 660 },
      { day: '2025-03-14', start: 100, end: 200 },
    ]);
    expect(spans).toEqual([{ start: 600, end: 660 }]);
  });

  test('adds the workday schedule on workdays on or after autoSince', () => {
    expect(trackedSpans('2025-03-12', s, [])).toEqual([{ start: 540, end: 1080 }]);
    expect(trackedSpans('2025-03-15', s, [])).toEqual([]);
    expect(trackedSpans('2025-02-26', s, [])).toEqual([]);
  });

  test('does not invent a schedule without autoSince or with autoTrack off', () => {
    expect(trackedSpans('2025-03-12', { ...s, autoSince: null }, [])).toEqual([]);
    expect(trackedSpans('2025-03-12', { ...s, autoTrack: false }, [])).toEqual([]);
  });
});

describe('buildBlocks', () => {
  test('an empty day with nothing tracked is one idle block', () => {
    expect(buildBlocks([], [], 1440)).toEqual([{ type: 'idle', start: 0, dur: 1440 }]);
  });

  test('a single entry sits between idle stretches', () => {
    expect(buildBlocks([entry(540, 60, 1, 'x')], [], 1440)).toEqual([
      { type: 'idle', start: 0, dur: 540 },
      { type: 'entry', start: 540, dur: 60, cat: 1, tag: 'x' },
      { type: 'idle', start: 600, dur: 840 },
    ]);
  });

  test('the space between logged entries is a gap', () => {
    const blocks = buildBlocks([entry(540, 30, 1), entry(600, 30, 2)], [], 1440);
    expect(blocks.map((b) => [b.type, b.start, b.dur])).toEqual([
      ['idle', 0, 540],
      ['entry', 540, 30],
      ['gap', 570, 30],
      ['entry', 600, 30],
      ['idle', 630, 810],
    ]);
  });

  test('tracked time with nothing logged is a gap in the past and ahead in the future', () => {
    const blocks = buildBlocks([], [{ start: 540, end: 720 }], 600);
    expect(blocks.map((b) => [b.type, b.start, b.dur])).toEqual([
      ['idle', 0, 540],
      ['gap', 540, 60],
      ['ahead', 600, 120],
      ['idle', 720, 720],
    ]);
  });

  test('a day still to come is all ahead inside the span', () => {
    const blocks = buildBlocks([], [{ start: 540, end: 600 }], 0);
    expect(blocks.find((b) => b.start === 540)).toMatchObject({ type: 'ahead', dur: 60 });
  });

  test('a past day has no ahead blocks', () => {
    const blocks = buildBlocks([entry(540, 30, 1)], [{ start: 480, end: 1080 }], 1440);
    expect(blocks.some((b) => b.type === 'ahead')).toBe(false);
  });

  test('entries sit on top of the tracked span and leave gaps around them', () => {
    const blocks = buildBlocks([entry(600, 60, 1)], [{ start: 540, end: 720 }], 1440);
    expect(blocks.map((b) => [b.type, b.start, b.dur])).toEqual([
      ['idle', 0, 540],
      ['gap', 540, 60],
      ['entry', 600, 60],
      ['gap', 660, 60],
      ['idle', 720, 720],
    ]);
  });

  test('merges adjacent entries with the same category and tag', () => {
    const blocks = buildBlocks([entry(540, 30, 1, 'a'), entry(570, 30, 1, 'a'), entry(600, 15, 1, 'a')], [], 1440);
    expect(blocks.filter((b) => b.type === 'entry')).toEqual([{ type: 'entry', start: 540, dur: 75, cat: 1, tag: 'a' }]);
  });

  test('merges adjacent entries that both have no tag', () => {
    const blocks = buildBlocks([entry(540, 30, 2), entry(570, 30, 2)], [], 1440);
    expect(blocks.filter((b) => b.type === 'entry')).toHaveLength(1);
  });

  test('keeps adjacent entries apart when the tag differs', () => {
    const blocks = buildBlocks([entry(540, 30, 1, 'a'), entry(570, 30, 1, 'b'), entry(600, 30, 1, null)], [], 1440);
    expect(blocks.filter((b) => b.type === 'entry')).toHaveLength(3);
  });

  test('keeps adjacent entries apart when the category differs', () => {
    const blocks = buildBlocks([entry(540, 30, 1), entry(570, 30, 2)], [], 1440);
    expect(blocks.filter((b) => b.type === 'entry')).toHaveLength(2);
  });

  test('does not merge across a gap', () => {
    const blocks = buildBlocks([entry(540, 30, 1), entry(600, 30, 1)], [], 1440);
    expect(blocks.filter((b) => b.type === 'entry')).toHaveLength(2);
  });

  test('always covers exactly 24 hours without overlap', () => {
    const blocks = buildBlocks([entry(10 * 5, 20, 1), entry(300, 45, 2, 't')], [{ start: 480, end: 1100 }, { start: 1400, end: 1500 }], 700);
    expect(total(blocks)).toBe(1440);
    let at = 0;
    for (const b of blocks) {
      expect(b.start).toBe(at);
      at += b.dur;
    }
  });

  test('handles an entry that ends at midnight', () => {
    const blocks = buildBlocks([entry(1380, 60, 1)], [], 1440);
    expect(blocks.at(-1)).toEqual({ type: 'entry', start: 1380, dur: 60, cat: 1, tag: null });
    expect(total(blocks)).toBe(1440);
  });
});

describe('summarize', () => {
  const cats = [cat(1, 0, 'focus'), cat(2, 1, 'neutral'), cat(3, 2, 'waste')];
  const blocks: Block[] = [
    { type: 'entry', start: 0, dur: 60, cat: 1, tag: null },
    { type: 'entry', start: 60, dur: 30, cat: 3, tag: null },
    { type: 'gap', start: 90, dur: 30 },
    { type: 'entry', start: 120, dur: 60, cat: 2, tag: null },
    { type: 'idle', start: 180, dur: 1260 },
  ];

  test('adds up minutes per kind', () => {
    expect(summarize(blocks, cats, 16)).toMatchObject({ focusMin: 60, wasteMin: 30, neutralMin: 60, gapMin: 30, loggedMin: 150 });
  });

  test('score is focus over focus plus waste plus gap, rounded', () => {
    expect(summarize(blocks, cats, 16).score).toBe(50);
    const odd: Block[] = [
      { type: 'entry', start: 0, dur: 100, cat: 1, tag: null },
      { type: 'entry', start: 100, dur: 200, cat: 3, tag: null },
    ];
    expect(summarize(odd, cats, 16).score).toBe(33);
    expect(summarize([{ type: 'entry', start: 0, dur: 200, cat: 1, tag: null }, { type: 'entry', start: 200, dur: 100, cat: 3, tag: null }], cats, 16).score).toBe(67);
  });

  test('neutral time does not count either way', () => {
    const more: Block[] = [...blocks, { type: 'entry', start: 200, dur: 600, cat: 2, tag: null }];
    expect(summarize(more, cats, 16).score).toBe(50);
  });

  test('score is null when nothing is audited', () => {
    expect(summarize([], cats, 16).score).toBeNull();
    expect(summarize([{ type: 'idle', start: 0, dur: 1440 }], cats, 16).score).toBeNull();
    expect(summarize([{ type: 'entry', start: 0, dur: 60, cat: 2, tag: null }], cats, 16).score).toBeNull();
  });

  test('a day of only gaps scores zero, not null', () => {
    expect(summarize([{ type: 'gap', start: 0, dur: 60 }], cats, 16).score).toBe(0);
  });

  test('a day of only focus scores 100', () => {
    expect(summarize([{ type: 'entry', start: 0, dur: 60, cat: 1, tag: null }], cats, 16).score).toBe(100);
  });

  test('ahead blocks are not held against the score', () => {
    const withAhead: Block[] = [...blocks, { type: 'ahead', start: 400, dur: 300 }];
    expect(summarize(withAhead, cats, 16).score).toBe(50);
  });

  test('burnPct is waste as a share of the waking day', () => {
    expect(summarize(blocks, cats, 16).burnPct).toBe(3);
    expect(summarize([{ type: 'entry', start: 0, dur: 480, cat: 3, tag: null }], cats, 16).burnPct).toBe(50);
    expect(summarize([{ type: 'entry', start: 0, dur: 480, cat: 3, tag: null }], cats, 8).burnPct).toBe(100);
  });

  test('burnPct is zero without waking hours', () => {
    expect(summarize(blocks, cats, 0).burnPct).toBe(0);
  });

  test('an unknown category counts as neutral', () => {
    const s = summarize([{ type: 'entry', start: 0, dur: 60, cat: 99, tag: null }], cats, 16);
    expect(s).toMatchObject({ neutralMin: 60, focusMin: 0, wasteMin: 0 });
  });

  test('byCat is sorted by minutes, largest first', () => {
    expect(summarize(blocks, cats, 16).byCat).toEqual([
      { cat: 1, min: 60 },
      { cat: 2, min: 60 },
      { cat: 3, min: 30 },
    ]);
    const mixed: Block[] = [
      { type: 'entry', start: 0, dur: 15, cat: 3, tag: null },
      { type: 'entry', start: 15, dur: 45, cat: 1, tag: null },
      { type: 'entry', start: 60, dur: 30, cat: 2, tag: null },
    ];
    expect(summarize(mixed, cats, 16).byCat.map((c) => c.cat)).toEqual([1, 2, 3]);
  });

  test('works end to end with buildBlocks', () => {
    const b = buildBlocks([entry(540, 60, 1), entry(660, 60, 3)], [], 1440);
    expect(summarize(b, cats, 16)).toMatchObject({ focusMin: 60, wasteMin: 60, gapMin: 60, score: 33 });
  });
});

describe('slotsIn', () => {
  test('splits a range onto the interval grid', () => {
    expect(slotsIn(545, 580, 15)).toEqual([
      { start: 545, end: 555 },
      { start: 555, end: 570 },
      { start: 570, end: 580 },
    ]);
  });

  test('a range already on the grid gives whole slots', () => {
    expect(slotsIn(540, 600, 15)).toEqual([
      { start: 540, end: 555 },
      { start: 555, end: 570 },
      { start: 570, end: 585 },
      { start: 585, end: 600 },
    ]);
  });

  test('an empty or backwards range gives nothing', () => {
    expect(slotsIn(540, 540, 15)).toEqual([]);
    expect(slotsIn(600, 540, 15)).toEqual([]);
  });

  test('a range inside one slot stays one slot', () => {
    expect(slotsIn(542, 548, 15)).toEqual([{ start: 542, end: 548 }]);
  });

  test('works with the other intervals', () => {
    expect(slotsIn(570, 700, 60)).toEqual([
      { start: 570, end: 600 },
      { start: 600, end: 660 },
      { start: 660, end: 700 },
    ]);
    expect(slotsIn(0, 30, 10)).toHaveLength(3);
  });

  test('slots are contiguous and cover the whole range', () => {
    const slots = slotsIn(7, 1000, 20);
    expect(slots[0].start).toBe(7);
    expect(slots.at(-1)!.end).toBe(1000);
    for (let i = 1; i < slots.length; i++) expect(slots[i].start).toBe(slots[i - 1].end);
  });
});

describe('suggest', () => {
  const six = [1, 2, 3, 4, 5, 6].map((id) => cat(id));
  const day = '2025-03-12';

  test('with no history it offers the first four categories and no guess', () => {
    expect(suggest(day, 600, [], six)).toEqual({ top: [1, 2, 3, 4], likely: null, tag: null });
  });

  test('prefers the category and tag of the entry just before', () => {
    const history = [entry(540, 60, 1, 'a', '2025-03-11'), entry(540, 60, 1, 'a', '2025-03-10'), entry(570, 30, 3, 'review', day)];
    const out = suggest(day, 600, history, six);
    expect(out.likely).toBe(3);
    expect(out.tag).toBe('review');
    expect(out.top).toContain(3);
  });

  test('the entry before must end exactly at the slot and be on the same day', () => {
    const notTouching = [entry(540, 30, 3, 'x', day)];
    expect(suggest(day, 600, notTouching, six).likely).toBeNull();
    const otherDay = [entry(570, 30, 3, 'x', '2025-03-11')];
    expect(suggest(day, 600, otherDay, six).tag).toBeNull();
  });

  test('falls back to what you usually do at this time on this weekday', () => {
    const history = [entry(600, 30, 2, null, '2025-03-05'), entry(600, 30, 2, null, '2025-02-26'), entry(600, 30, 4, null, '2025-03-06')];
    const out = suggest(day, 600, history, six);
    expect(out.likely).toBe(2);
    expect(out.tag).toBeNull();
  });

  test('a single entry on another weekday is too weak to be a guess', () => {
    expect(suggest(day, 600, [entry(600, 30, 2, null, '2025-03-06')], six).likely).toBeNull();
  });

  test('a single entry on the same weekday is enough', () => {
    expect(suggest(day, 600, [entry(600, 30, 2, null, '2025-03-05')], six).likely).toBe(2);
  });

  test('habit ignores entries at very different times of day', () => {
    const history = [entry(60, 30, 2, null, '2025-03-05'), entry(60, 30, 2, null, '2025-02-26')];
    expect(suggest(day, 600, history, six).likely).toBeNull();
  });

  test('the entry just before wins over a stronger habit', () => {
    const history = [
      entry(600, 30, 2, null, '2025-03-05'),
      entry(600, 30, 2, null, '2025-02-26'),
      entry(600, 30, 2, null, '2025-02-19'),
      entry(570, 30, 5, null, day),
    ];
    expect(suggest(day, 600, history, six).likely).toBe(5);
  });

  test('never suggests an archived category', () => {
    const cats = [cat(1), cat(2, 1, 'focus', true), cat(3), cat(4), cat(5), cat(6)];
    const history = [
      entry(540, 600, 2, 'big', '2025-03-11'),
      entry(600, 30, 2, null, '2025-03-05'),
      entry(600, 30, 2, null, '2025-02-26'),
      entry(570, 30, 2, 'just-before', day),
    ];
    const out = suggest(day, 600, history, cats);
    expect(out.top).not.toContain(2);
    expect(out.likely).toBeNull();
    expect(out.tag).toBeNull();
  });

  test('returns at most four categories', () => {
    const many = Array.from({ length: 12 }, (_, i) => cat(i + 1));
    expect(suggest(day, 600, [], many).top).toHaveLength(4);
  });

  test('returns fewer when there are fewer categories', () => {
    expect(suggest(day, 600, [], [cat(1), cat(2)]).top).toEqual([1, 2]);
    expect(suggest(day, 600, [], [])).toEqual({ top: [], likely: null, tag: null });
  });

  test('ranks by how much time you spend in each category', () => {
    const history = [entry(0, 300, 6, null, '2025-03-01'), entry(0, 200, 5, null, '2025-03-02'), entry(0, 100, 4, null, '2025-03-03'), entry(0, 50, 3, null, '2025-03-04')];
    expect(suggest(day, 900, history, six).top).toEqual([3, 4, 5, 6]);
  });

  test('a likely category that would not make the top four is still included', () => {
    const history = [
      entry(0, 600, 1, null, '2025-03-01'),
      entry(0, 500, 2, null, '2025-03-02'),
      entry(0, 400, 3, null, '2025-03-03'),
      entry(0, 300, 4, null, '2025-03-04'),
      entry(570, 30, 6, null, day),
    ];
    const out = suggest(day, 600, history, six);
    expect(out.likely).toBe(6);
    expect(out.top).toHaveLength(4);
    expect(out.top).toContain(6);
  });

  test('keeps the on-screen order stable by category position', () => {
    const cats = [cat(10, 2), cat(11, 0), cat(12, 1), cat(13, 3)];
    const history = [entry(0, 100, 13, null, '2025-03-01'), entry(0, 50, 10, null, '2025-03-02')];
    expect(suggest(day, 900, history, cats).top).toEqual([11, 12, 10, 13]);
  });
});
