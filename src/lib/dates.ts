import { dayAdd, pad } from '../../shared/time';

/** Local calendar date as YYYY-MM-DD. */
export function dayOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Minutes past midnight at which the user's day ends (0 = midnight). With 120, 01:30 on the
 * 4th is still "the 3rd", at minute 1530. The store keeps this in step with settings.
 */
let rollover = 0;
export const setRollover = (min: number) => void (rollover = min);
export const getRollover = () => rollover;

const shifted = (d: Date) => new Date(d.getTime() - rollover * 60_000);

/** The day it is for the user right now, which after midnight may still be yesterday's date. */
export const today = (now = new Date()) => dayOf(shifted(now));

/** Minutes since the midnight that started the user's current day; runs past 1440 in the small hours. */
export function minuteOfDay(d = new Date()): number {
  const s = shifted(d);
  return s.getHours() * 60 + s.getMinutes() + rollover;
}

/** Where "now" sits on a given day: its minute for today, past the end for old days, 0 for the future. */
export function nowMinFor(day: string, now = new Date()): number {
  const t = today(now);
  if (day === t) return minuteOfDay(now);
  return day < t ? 99_999 : 0;
}

const asDate = (day: string) => new Date(`${day}T12:00:00`);

export function longDay(day: string): string {
  return asDate(day).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function shortDay(day: string): string {
  return asDate(day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export const weekdayName = (day: string) => asDate(day).toLocaleDateString('en-GB', { weekday: 'long' });
export const weekdayLetter = (day: string) => asDate(day).toLocaleDateString('en-GB', { weekday: 'narrow' });

export function relativeDay(day: string): string {
  const t = today();
  if (day === t) return 'Today';
  if (day === dayAdd(t, -1)) return 'Yesterday';
  if (day === dayAdd(t, 1)) return 'Tomorrow';
  return weekdayName(day);
}

/** Epoch seconds for a local wall-clock minute of a local day. */
export function epochAt(day: string, min: number): number {
  const d = new Date(`${day}T00:00:00`);
  d.setMinutes(min);
  return Math.floor(d.getTime() / 1000);
}

export const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
