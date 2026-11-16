import type { Category, Entry, Settings, TrackWindow } from './types';
import { weekdayOf } from './time';

/** Everything is reasoned about in 5-minute cells; every interval we offer is a multiple of 5. */
const CELL = 5;
const CELLS = 1440 / CELL;

export type Block =
  | { type: 'entry'; start: number; dur: number; cat: number; tag: string | null }
  | { type: 'gap'; start: number; dur: number }
  | { type: 'ahead'; start: number; dur: number }
  | { type: 'idle'; start: number; dur: number };

export interface Span {
  start: number;
  end: number;
}

/** The stretches of a day that count as "on the clock": manual sessions plus the workday schedule. */
export function trackedSpans(day: string, settings: Settings, windows: TrackWindow[]): Span[] {
  const spans: Span[] = windows.filter((w) => w.day === day && w.end > w.start).map((w) => ({ start: w.start, end: w.end }));
  const scheduled =
    settings.autoTrack &&
    settings.autoSince !== null &&
    day >= settings.autoSince &&
    settings.workdays.includes(weekdayOf(day)) &&
    settings.dayEnd > settings.dayStart;
  if (scheduled) spans.push({ start: settings.dayStart, end: settings.dayEnd });
  return spans;
}

/**
 * Lays a day out as an ordered run of blocks.
 * `nowMin` is the current minute for today, anything huge for past days and 0 for days still to come.
 * `rollover` is where the day starts and ends, in minutes past midnight.
 */
export function buildBlocks(entries: Entry[], spans: Span[], nowMin: number, rollover = 0): Block[] {
  type CellState = { cat: number; tag: string | null } | 'gap' | 'ahead' | null;
  const cells: CellState[] = new Array(CELLS).fill(null);
  // Cell 0 is the first five minutes after the rollover, not after midnight.
  const cell = (min: number, round: (n: number) => number) => Math.min(CELLS, Math.max(0, round((min - rollover) / CELL)));

  // Time between the first and last thing you logged is on the record too.
  const all = [...spans];
  if (entries.length) {
    const first = Math.min(...entries.map((e) => e.start));
    const last = Math.max(...entries.map((e) => e.start + e.dur));
    all.push({ start: first, end: last });
  }
  for (const s of all) {
    for (let c = cell(s.start, Math.floor); c < cell(s.end, Math.ceil); c++) {
      cells[c] = rollover + (c + 1) * CELL <= nowMin ? 'gap' : 'ahead';
    }
  }
  for (const e of entries) {
    for (let c = cell(e.start, Math.floor); c < cell(e.start + e.dur, Math.ceil); c++) {
      cells[c] = { cat: e.cat, tag: e.tag };
    }
  }

  const same = (a: CellState, b: CellState) => {
    if (a === b) return true;
    if (a && b && typeof a === 'object' && typeof b === 'object') return a.cat === b.cat && a.tag === b.tag;
    return false;
  };

  const blocks: Block[] = [];
  let i = 0;
  while (i < CELLS) {
    let j = i + 1;
    while (j < CELLS && same(cells[i], cells[j])) j++;
    const start = rollover + i * CELL;
    const dur = (j - i) * CELL;
    const s = cells[i];
    if (s === null) blocks.push({ type: 'idle', start, dur });
    else if (s === 'gap') blocks.push({ type: 'gap', start, dur });
    else if (s === 'ahead') blocks.push({ type: 'ahead', start, dur });
    else blocks.push({ type: 'entry', start, dur, cat: s.cat, tag: s.tag });
    i = j;
  }
  return blocks;
}

export interface Summary {
  focusMin: number;
  neutralMin: number;
  wasteMin: number;
  gapMin: number;
  loggedMin: number;
  /** 0–100, or null when nothing has been tracked yet. */
  score: number | null;
  /** Wasted time as a share of the waking day, 0–100. */
  burnPct: number;
  byCat: Array<{ cat: number; min: number }>;
}

export function summarize(blocks: Block[], categories: Category[], wakingHours: number): Summary {
  const kinds = new Map(categories.map((c) => [c.id, c.kind]));
  const per = new Map<number, number>();
  let focusMin = 0;
  let neutralMin = 0;
  let wasteMin = 0;
  let gapMin = 0;
  for (const b of blocks) {
    if (b.type === 'gap') gapMin += b.dur;
    if (b.type !== 'entry') continue;
    per.set(b.cat, (per.get(b.cat) ?? 0) + b.dur);
    const kind = kinds.get(b.cat) ?? 'neutral';
    if (kind === 'focus') focusMin += b.dur;
    else if (kind === 'waste') wasteMin += b.dur;
    else neutralMin += b.dur;
  }
  // Unaccounted time counts against you: a gap is treated the same as wasted time.
  const audited = focusMin + wasteMin + gapMin;
  return {
    focusMin,
    neutralMin,
    wasteMin,
    gapMin,
    loggedMin: focusMin + neutralMin + wasteMin,
    score: audited ? Math.round((focusMin / audited) * 100) : null,
    burnPct: wakingHours > 0 ? Math.round((wasteMin / (wakingHours * 60)) * 100) : 0,
    byCat: [...per.entries()].map(([cat, min]) => ({ cat, min })).sort((a, b) => b.min - a.min),
  };
}

/** Splits a range into slots that sit on the interval grid: 9:05–9:40 at 15 → 9:05, 9:15, 9:30. */
export function slotsIn(start: number, end: number, interval: number): Span[] {
  const out: Span[] = [];
  let s = start;
  while (s < end) {
    const e = Math.min(end, (Math.floor(s / interval) + 1) * interval);
    out.push({ start: s, end: e });
    s = e;
  }
  return out;
}

export interface Suggestion {
  /** Up to four categories, most likely first. */
  top: number[];
  likely: number | null;
  tag: string | null;
}

/**
 * Guesses what a slot was from your own history: what you were doing right before,
 * and what you usually do at this time on this weekday.
 */
export function suggest(day: string, start: number, history: Entry[], categories: Category[]): Suggestion {
  const live = categories.filter((c) => !c.archived).sort((a, b) => a.pos - b.pos);
  const ok = new Set(live.map((c) => c.id));
  const habit = new Map<number, number>();
  const here = new Map<number, number>();
  const wd = weekdayOf(day);
  let prev: Entry | null = null;

  for (const e of history) {
    if (!ok.has(e.cat)) continue;
    habit.set(e.cat, (habit.get(e.cat) ?? 0) + e.dur);
    if (e.day === day) {
      if (e.start + e.dur === start) prev = e;
      continue;
    }
    if (e.start < start + 30 && e.start + e.dur > start - 15) {
      here.set(e.cat, (here.get(e.cat) ?? 0) + (weekdayOf(e.day) === wd ? 3 : 1));
    }
  }

  let likely: number | null = prev ? prev.cat : null;
  if (likely === null && here.size) {
    const [cat, weight] = [...here.entries()].sort((a, b) => b[1] - a[1])[0];
    if (weight >= 2) likely = cat;
  }

  const ranked = live
    .map((c) => ({ id: c.id, w: (habit.get(c.id) ?? 0) + (here.get(c.id) ?? 0) * 30, pos: c.pos }))
    .sort((a, b) => b.w - a.w || a.pos - b.pos)
    .map((c) => c.id);
  const top = ranked.slice(0, 4);
  if (likely !== null && !top.includes(likely)) top[top.length - 1] = likely;
  // Keep a steady order on screen so the buttons do not jump around between pulses.
  const order = new Map(live.map((c, i) => [c.id, i]));
  top.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));

  return { top, likely, tag: prev ? prev.tag : null };
}
