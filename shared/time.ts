import type { Settings } from './types';

export const pad = (n: number) => String(n).padStart(2, '0');

/** 615 → "10:15". Minutes past midnight wrap, so 1530 (half past one the next morning) reads "01:30". */
export const fmtMin = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

export function fmtDur(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function isDay(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function dayAdd(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock date and minute-of-day for an instant in a time zone. */
export function localParts(epochSec: number, tz: string): { day: string; min: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochSec * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, min: Number(get('hour')) * 60 + Number(get('minute')) };
}

/**
 * Like localParts, but for a day that ends `rollover` minutes after midnight: the small
 * hours belong to the previous date and count on past 1440.
 */
export function logicalParts(epochSec: number, tz: string, rollover: number): { day: string; min: number } {
  const p = localParts(epochSec - rollover * 60, tz);
  return { day: p.day, min: p.min + rollover };
}

/** The instant a wall-clock time happens in a time zone. `min` may run past 1440. */
export function epochFromLocal(day: string, min: number, tz: string): number {
  const want = Date.parse(`${day}T00:00:00Z`) / 1000 + min * 60;
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const p = localParts(guess, tz);
    const got = Date.parse(`${p.day}T00:00:00Z`) / 1000 + p.min * 60;
    if (got === want) break;
    guess += want - got;
  }
  return guess;
}

/**
 * When the next "what did you just do?" is due, or null when nothing is being tracked.
 * A pulse lands on the interval boundary that closes a slot.
 */
export function nextPulse(now: number, s: Settings, trackUntil: number | null): number | null {
  const lp = logicalParts(now, s.tz, s.rollover);
  const after = (min: number) => (Math.floor(min / s.interval) + 1) * s.interval;
  let best: number | null = null;

  if (trackUntil && trackUntil > now) {
    const t = epochFromLocal(lp.day, after(lp.min), s.tz);
    if (t <= trackUntil + 60) best = t;
  }

  if (s.autoTrack && s.workdays.length && s.dayEnd > s.dayStart) {
    for (let i = 0; i < 8; i++) {
      const day = dayAdd(lp.day, i);
      if (!s.workdays.includes(weekdayOf(day))) continue;
      const cand = after(i === 0 ? Math.max(lp.min, s.dayStart) : s.dayStart);
      if (cand > s.dayEnd) continue;
      const t = epochFromLocal(day, cand, s.tz);
      if (best === null || t < best) best = t;
      break;
    }
  }
  return best;
}

export function nextReport(now: number, s: Settings): number {
  const lp = logicalParts(now, s.tz, s.rollover);
  const today = epochFromLocal(lp.day, s.reportAt, s.tz);
  return today > now ? today : epochFromLocal(dayAdd(lp.day, 1), s.reportAt, s.tz);
}
