export type Kind = 'focus' | 'neutral' | 'waste';

export const COLORS = ['blue', 'teal', 'green', 'amber', 'orange', 'red', 'pink', 'violet', 'stone', 'slate'] as const;
export type Color = (typeof COLORS)[number];

export const INTERVALS = [10, 15, 20, 30, 60] as const;

export interface Category {
  id: number;
  name: string;
  color: Color;
  kind: Kind;
  pos: number;
  archived: boolean;
}

/** One logged stretch of a day. `start` and `dur` are minutes; `day` is the local date. */
export interface Entry {
  day: string;
  start: number;
  dur: number;
  cat: number;
  tag: string | null;
}

/** A stretch of the day that was being tracked, whether or not anything was logged. */
export interface TrackWindow {
  day: string;
  start: number;
  end: number;
}

export interface Settings {
  interval: number;
  /** 0 = Sunday … 6 = Saturday */
  workdays: number[];
  dayStart: number;
  dayEnd: number;
  autoTrack: boolean;
  /** First day the workday schedule counts, so turning it on never invents gaps in the past. */
  autoSince: string | null;
  reportAt: number;
  /**
   * Minutes past midnight at which one day ends and the next begins. With 120, anything
   * before 02:00 still belongs to the day before, and times in that stretch are stored as
   * minutes past 1440 (01:30 → 1530).
   */
  rollover: number;
  wakingHours: number;
  tz: string;
  theme: 'light' | 'dark';
  sound: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  interval: 15,
  workdays: [1, 2, 3, 4, 5],
  dayStart: 9 * 60,
  dayEnd: 18 * 60,
  autoTrack: false,
  autoSince: null,
  reportAt: 21 * 60,
  rollover: 0,
  wakingHours: 16,
  tz: 'UTC',
  theme: 'light',
  sound: true,
};

export const DEFAULT_CATEGORIES: Array<Pick<Category, 'name' | 'color' | 'kind'>> = [
  { name: 'Deep Work', color: 'blue', kind: 'focus' },
  { name: 'Admin', color: 'amber', kind: 'focus' },
  { name: 'Health', color: 'green', kind: 'focus' },
  { name: 'Wasted', color: 'red', kind: 'waste' },
  { name: 'Personal', color: 'stone', kind: 'neutral' },
  { name: 'Sleep', color: 'slate', kind: 'neutral' },
];

export interface Me {
  email: string;
  createdAt: number;
  settings: Settings;
  categories: Category[];
  /** Epoch seconds a manually started session runs until, if one is running. */
  trackUntil: number | null;
  pushEnabled: boolean;
}

export interface PublicConfig {
  turnstileSiteKey: string;
  vapidPublicKey: string;
}

export interface DaysResponse {
  entries: Entry[];
  windows: TrackWindow[];
}

export const LIMITS = {
  categories: 40,
  nameLen: 28,
  tagLen: 40,
  itemsPerWrite: 100,
  rangeDays: 93,
  pushSubs: 5,
  maxRollover: 6 * 60,
} as const;
