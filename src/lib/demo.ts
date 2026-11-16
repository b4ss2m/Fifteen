import { dayAdd, weekdayOf } from '../../shared/time';
import { DEFAULT_SETTINGS, type Category, type Entry, type Me, type TrackWindow } from '../../shared/types';
import { browserTz, minuteOfDay, today } from './dates';
import type { Backend } from './store';
import { getTheme } from './theme';

/** Made-up data for the demo and the screenshots on the home page. Nothing here touches the server. */

export const DEMO_CATEGORIES: Category[] = [
  { id: 1, name: 'Deep Work', color: 'blue', kind: 'focus', pos: 0, archived: false },
  { id: 2, name: 'Admin', color: 'amber', kind: 'focus', pos: 1, archived: false },
  { id: 3, name: 'Health', color: 'green', kind: 'focus', pos: 2, archived: false },
  { id: 4, name: 'Wasted', color: 'red', kind: 'waste', pos: 3, archived: false },
  { id: 5, name: 'Personal', color: 'stone', kind: 'neutral', pos: 4, archived: false },
  { id: 6, name: 'Learning', color: 'violet', kind: 'focus', pos: 5, archived: false },
  { id: 7, name: 'Sleep', color: 'slate', kind: 'neutral', pos: 6, archived: false },
];

type Step = [cat: number, dur: number, tag?: string] | ['gap', number];

/** A believable workday, 09:00–18:00. A few variations keep the history from looking copy-pasted. */
const SHAPES: Step[][] = [
  [[2, 30, 'Email'], [1, 105, 'Q3 report'], [4, 15, 'Instagram'], [1, 60, 'Q3 report'], [5, 45, 'Lunch'], [2, 30, 'Standup'], [1, 90, 'API redesign'], ['gap', 30], [4, 30, 'YouTube'], [2, 45, 'Invoices'], [1, 60, 'API redesign']],
  [[1, 120, 'Pitch deck'], [2, 30, 'Email'], [4, 30, 'News'], [1, 45, 'Pitch deck'], [3, 45, 'Gym'], [5, 30, 'Lunch'], [2, 60, 'Planning'], [1, 75, 'Pitch deck'], [4, 15, 'Instagram'], [6, 45, 'Course'], [2, 45, 'Email']],
  [[2, 45, 'Email'], [1, 90, 'API redesign'], ['gap', 15], [1, 45, 'API redesign'], [5, 60, 'Lunch'], [4, 45, 'YouTube'], [1, 105, 'Code review'], [2, 30, 'Standup'], [3, 30, 'Walk'], [1, 60, 'Code review'], ['gap', 15]],
  [[1, 150, 'Q3 report'], [2, 30, 'Invoices'], [5, 45, 'Lunch'], [1, 60, 'Q3 report'], [4, 15, 'Instagram'], [2, 45, 'Standup'], [1, 120, 'Q3 report'], [6, 30, 'Reading'], [2, 45, 'Email']],
];

function layDay(day: string, shape: Step[], upTo: number): Entry[] {
  const out: Entry[] = [];
  let at = 9 * 60;
  for (const step of shape) {
    // The stretch that is still running gets cut off at the last quarter hour.
    const dur = Math.min(step[1], Math.floor((upTo - at) / 15) * 15);
    if (dur <= 0) break;
    if (step[0] !== 'gap') out.push({ day, start: at, dur, cat: step[0], tag: (step as [number, number, string?])[2] ?? null });
    at += dur;
  }
  return out;
}

export function seedDemo(): { me: Me; entries: Entry[]; windows: TrackWindow[] } {
  const t = today();
  const entries: Entry[] = [];
  for (let i = 21; i >= 1; i--) {
    const day = dayAdd(t, -i);
    const wd = weekdayOf(day);
    if (wd === 0 || wd === 6) continue;
    entries.push(...layDay(day, SHAPES[i % SHAPES.length], 18 * 60));
  }
  // Today runs up to about half an hour ago, so the demo opens with a gap waiting to be closed.
  const now = minuteOfDay();
  entries.push(...layDay(t, SHAPES[0], Math.max(9 * 60, now - 35)));

  const me: Me = {
    email: 'you@example.com',
    createdAt: Math.floor(Date.now() / 1000) - 30 * 86400,
    settings: {
      ...DEFAULT_SETTINGS,
      tz: browserTz(),
      theme: getTheme(),
      autoTrack: true,
      autoSince: dayAdd(t, -30),
      workdays: [...new Set([1, 2, 3, 4, 5, weekdayOf(t)])].sort(),
      dayStart: 9 * 60,
      dayEnd: Math.max(18 * 60, Math.min(1440, Math.ceil((now + 90) / 60) * 60)),
    },
    categories: DEMO_CATEGORIES,
    trackUntil: null,
    pushEnabled: false,
  };
  return { me, entries, windows: [] };
}

export function demoBackend(seed: { entries: Entry[]; windows: TrackWindow[]; me: Me }): Backend {
  let entries = [...seed.entries];
  let windows = [...seed.windows];
  let categories = [...seed.me.categories];
  let nextId = 100;

  return {
    async days(from, to) {
      return { entries: entries.filter((e) => e.day >= from && e.day <= to), windows: windows.filter((w) => w.day >= from && w.day <= to) };
    },
    async putEntries(day, items) {
      let dayEntries = entries.filter((e) => e.day === day);
      for (const it of items) {
        const a = it.start;
        const b = a + it.dur;
        const next: Entry[] = [];
        for (const e of dayEntries) {
          const end = e.start + e.dur;
          if (e.start >= b || end <= a) {
            next.push(e);
            continue;
          }
          if (e.start < a) next.push({ ...e, dur: a - e.start });
          if (end > b) next.push({ ...e, start: b, dur: end - b });
        }
        if (it.cat !== null) next.push({ day, start: a, dur: it.dur, cat: it.cat, tag: it.tag });
        dayEntries = next;
      }
      dayEntries.sort((x, y) => x.start - y.start);
      entries = [...entries.filter((e) => e.day !== day), ...dayEntries];
      return dayEntries;
    },
    async saveSettings(s) {
      return { ...s, autoSince: s.autoTrack ? (s.autoSince ?? today()) : null };
    },
    async startTrack(day, start, end, until) {
      const window = { day, start, end };
      windows.push(window);
      return { trackUntil: until, window };
    },
    async stopTrack(day, end) {
      windows = windows
        .map((w) => (w.day === day && w.start < end && w.end > end ? { ...w, end } : w))
        .filter((w) => !(w.day === day && w.start >= end));
      return windows.filter((w) => w.day === day);
    },
    async addCategory(c) {
      const cat: Category = { id: nextId++, ...c, pos: categories.length, archived: false };
      categories.push(cat);
      return cat;
    },
    async patchCategory(id, patch) {
      const cur = categories.find((c) => c.id === id)!;
      const next = { ...cur, ...patch };
      categories = categories.map((c) => (c.id === id ? next : c));
      return next;
    },
    async deleteCategory(id) {
      const used = entries.some((e) => e.cat === id);
      categories = used ? categories.map((c) => (c.id === id ? { ...c, archived: true } : c)) : categories.filter((c) => c.id !== id);
      return { archived: used };
    },
    async orderCategories() {},
  };
}

/** The fixed day shown in the phone mock-ups on the home page: a Tuesday, seen at 15:40. */
export const SHOWCASE_NOW = 15 * 60 + 40;
export const SHOWCASE_DAY = '2026-11-10';
export const SHOWCASE_ENTRIES: Entry[] = [
  { day: SHOWCASE_DAY, start: 540, dur: 30, cat: 2, tag: 'Email' },
  { day: SHOWCASE_DAY, start: 570, dur: 105, cat: 1, tag: 'Q3 report' },
  { day: SHOWCASE_DAY, start: 675, dur: 15, cat: 4, tag: 'Instagram' },
  { day: SHOWCASE_DAY, start: 690, dur: 60, cat: 1, tag: 'Q3 report' },
  { day: SHOWCASE_DAY, start: 750, dur: 45, cat: 3, tag: 'Gym' },
  { day: SHOWCASE_DAY, start: 795, dur: 30, cat: 5, tag: 'Lunch' },
  { day: SHOWCASE_DAY, start: 825, dur: 75, cat: 1, tag: 'API redesign' },
];
export const SHOWCASE_SPANS = [{ start: 540, end: 1080 }];

/** A finished day for the report mock-up. Works out to a 72% focus score with 1.5 hours wasted. */
export const REPORT_ENTRIES: Entry[] = [
  { day: SHOWCASE_DAY, start: 540, dur: 30, cat: 2, tag: 'Email' },
  { day: SHOWCASE_DAY, start: 570, dur: 105, cat: 1, tag: 'Q3 report' },
  { day: SHOWCASE_DAY, start: 675, dur: 30, cat: 4, tag: 'Instagram' },
  { day: SHOWCASE_DAY, start: 705, dur: 60, cat: 1, tag: 'Q3 report' },
  { day: SHOWCASE_DAY, start: 765, dur: 45, cat: 3, tag: 'Gym' },
  { day: SHOWCASE_DAY, start: 810, dur: 60, cat: 5, tag: 'Lunch' },
  { day: SHOWCASE_DAY, start: 870, dur: 60, cat: 1, tag: 'API redesign' },
  { day: SHOWCASE_DAY, start: 975, dur: 60, cat: 4, tag: 'YouTube' },
  { day: SHOWCASE_DAY, start: 1035, dur: 45, cat: 2, tag: 'Invoices' },
];
