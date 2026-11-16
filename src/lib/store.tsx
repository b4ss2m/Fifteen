import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildBlocks, summarize, trackedSpans, type Block, type Summary } from '../../shared/day';
import { dayAdd } from '../../shared/time';
import type { Category, DaysResponse, Entry, Me, Settings, TrackWindow } from '../../shared/types';
import { api, messageFor, type EntryInput } from './api';
import { browserTz, epochAt, minuteOfDay, nowMinFor, setRollover, today } from './dates';
import { announcePulse } from './pulse';

/** Everything the app needs from a data source. The real API and the in-browser demo both fit this. */
export interface Backend {
  days(from: string, to: string): Promise<DaysResponse>;
  putEntries(day: string, items: EntryInput[]): Promise<Entry[]>;
  saveSettings(s: Settings): Promise<Settings>;
  startTrack(day: string, start: number, end: number, until: number): Promise<{ trackUntil: number; window: TrackWindow }>;
  stopTrack(day: string, end: number): Promise<TrackWindow[]>;
  addCategory(c: Pick<Category, 'name' | 'color' | 'kind'>): Promise<Category>;
  patchCategory(id: number, patch: Partial<Pick<Category, 'name' | 'color' | 'kind' | 'archived'>>): Promise<Category>;
  deleteCategory(id: number): Promise<{ archived: boolean }>;
  orderCategories(ids: number[]): Promise<void>;
}

export const apiBackend: Backend = {
  days: api.days,
  putEntries: async (day, items) => (await api.putEntries(day, items)).entries,
  saveSettings: api.saveSettings,
  startTrack: api.startTrack,
  stopTrack: async (day, end) => (await api.stopTrack(day, end)).windows,
  addCategory: api.addCategory,
  patchCategory: api.patchCategory,
  deleteCategory: api.deleteCategory,
  orderCategories: async (ids) => void (await api.orderCategories(ids)),
};

export interface LogRequest {
  day: string;
  start: number;
  end: number;
  mode: 'pulse' | 'gap' | 'edit' | 'new';
  current?: { cat: number; tag: string | null };
}

export interface Tracking {
  kind: 'manual' | 'schedule' | null;
  untilMin: number | null;
  nextPulseMin: number | null;
}

interface AppValue {
  demo: boolean;
  base: string;
  me: Me;
  entries: Entry[];
  windows: TrackWindow[];
  now: Date;
  ready: boolean;
  tracking: Tracking;
  sheet: LogRequest | null;
  toast: string | null;
  blocksFor(day: string): Block[];
  summaryFor(day: string): Summary;
  ensureDays(from: string): void;
  refresh(): void;
  log(day: string, items: EntryInput[]): Promise<boolean>;
  updateSettings(patch: Partial<Settings>): Promise<boolean>;
  startTracking(untilMin: number): Promise<void>;
  stopTracking(): Promise<void>;
  setCategories(next: Category[]): void;
  setMe(me: Me): void;
  backend: Backend;
  openLog(req: LogRequest | null): void;
  say(message: string): void;
}

const AppContext = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

const HISTORY_DAYS = 21;

interface Props {
  backend: Backend;
  initial: Me;
  demo?: boolean;
  onSignedOut?: () => void;
  children: ReactNode;
}

export function AppProvider({ backend, initial, demo = false, onSignedOut, children }: Props) {
  const [me, setMe] = useState(initial);
  // Every date helper below depends on where this user's day ends.
  setRollover(me.settings.rollover);
  const dayCap = me.settings.rollover + 1440;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [windows, setWindows] = useState<TrackWindow[]>([]);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [sheet, setSheet] = useState<LogRequest | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const loadedFrom = useRef<string | null>(null);
  const lastPulse = useRef<string>(sessionStorage.getItem('fifteen.pulse') ?? '');
  const toastTimer = useRef<number>(0);

  const say = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const handle = useCallback(
    (err: unknown) => {
      if (err instanceof Error && err.message === 'signed_out') onSignedOut?.();
      say(messageFor(err));
    },
    [onSignedOut, say],
  );

  const load = useCallback(
    async (from: string, to: string, replace: boolean) => {
      try {
        const res = await backend.days(from, to);
        const keep = (d: string) => d < from || d > to;
        setEntries((prev) => (replace ? res.entries : [...prev.filter((e) => keep(e.day)), ...res.entries]));
        setWindows((prev) => (replace ? res.windows : [...prev.filter((w) => keep(w.day)), ...res.windows]));
      } catch (err) {
        handle(err);
      }
    },
    [backend, handle],
  );

  const refresh = useCallback(() => {
    const t = today();
    const from = loadedFrom.current && loadedFrom.current < dayAdd(t, -HISTORY_DAYS) ? loadedFrom.current : dayAdd(t, -HISTORY_DAYS);
    loadedFrom.current = from;
    void load(from, dayAdd(t, 1), true).then(() => setReady(true));
  }, [load]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const ensureDays = useCallback(
    (from: string) => {
      const have = loadedFrom.current;
      if (!have || from >= have) return;
      // Fetch a comfortable margin so paging back through days is not one request per tap.
      const start = dayAdd(from, -14);
      loadedFrom.current = start;
      void load(start, dayAdd(have, -1), false);
    },
    [load],
  );

  // The clock: a tick every 15 seconds, and straight away when the tab comes back.
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = window.setInterval(tick, 15_000);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Keep the stored time zone in step with the device, so server-side pulses land at the right time.
  useEffect(() => {
    const tz = browserTz();
    if (!demo && tz !== me.settings.tz) {
      backend.saveSettings({ ...me.settings, tz }).then(
        (settings) => setMe((m) => ({ ...m, settings })),
        () => {},
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = me.settings.theme;
    if (!demo) localStorage.setItem('fifteen.theme', me.settings.theme);
  }, [me.settings.theme, demo]);

  const t = today();
  const nowMin = minuteOfDay(now);
  const nowSec = Math.floor(now.getTime() / 1000);

  const blocksFor = useCallback(
    (day: string) =>
      buildBlocks(
        entries.filter((e) => e.day === day),
        trackedSpans(day, me.settings, windows),
        nowMinFor(day, now),
        me.settings.rollover,
      ),
    [entries, windows, me.settings, now],
  );

  const summaryFor = useCallback(
    (day: string) => summarize(blocksFor(day), me.categories, me.settings.wakingHours),
    [blocksFor, me.categories, me.settings.wakingHours],
  );

  const tracking = useMemo<Tracking>(() => {
    const s = me.settings;
    let kind: Tracking['kind'] = null;
    let untilMin: number | null = null;
    if (me.trackUntil && me.trackUntil > nowSec) {
      kind = 'manual';
      const end = new Date(me.trackUntil * 1000);
      untilMin = today(end) === t ? minuteOfDay(end) : dayCap;
    } else if (trackedSpans(t, s, []).some((sp) => sp.start <= nowMin && nowMin < sp.end)) {
      kind = 'schedule';
      untilMin = s.dayEnd;
    }
    const next = (Math.floor(nowMin / s.interval) + 1) * s.interval;
    return { kind, untilMin, nextPulseMin: kind && untilMin !== null && next <= untilMin ? next : null };
  }, [me.settings, me.trackUntil, nowSec, nowMin, t, dayCap]);

  // The pulse: when a slot closes inside tracked time and nothing is logged for it, ask.
  useEffect(() => {
    if (!ready || sheet) return;
    const s = me.settings;
    const boundary = Math.floor(nowMin / s.interval) * s.interval;
    const key = `${t}:${boundary}`;
    if (key === lastPulse.current || nowMin - boundary > Math.min(s.interval, 10)) return;
    const spans = trackedSpans(t, s, windows);
    if (!spans.some((sp) => sp.start < boundary && boundary <= sp.end)) return;
    const start = Math.max(s.rollover, boundary - s.interval);
    const covered = entries.some((e) => e.day === t && e.start < boundary && e.start + e.dur > start);
    lastPulse.current = key;
    sessionStorage.setItem('fifteen.pulse', key);
    if (covered) return;
    setSheet({ day: t, start, end: boundary, mode: 'pulse' });
    announcePulse(start, boundary, s.sound, demo);
  }, [ready, sheet, nowMin, t, me.settings, windows, entries, demo]);

  const log = useCallback(
    async (day: string, items: EntryInput[]) => {
      try {
        const next = await backend.putEntries(day, items);
        setEntries((prev) => [...prev.filter((e) => e.day !== day), ...next]);
        return true;
      } catch (err) {
        handle(err);
        return false;
      }
    },
    [backend, handle],
  );

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const optimistic = { ...me.settings, ...patch };
      setMe((m) => ({ ...m, settings: optimistic }));
      try {
        const saved = await backend.saveSettings(optimistic);
        setMe((m) => ({ ...m, settings: saved }));
        // Moving the end of the day re-files entries on the server, so fetch them again.
        if (patch.rollover !== undefined && patch.rollover !== me.settings.rollover) {
          setRollover(saved.rollover);
          refresh();
        }
        return true;
      } catch (err) {
        setMe((m) => ({ ...m, settings: me.settings }));
        handle(err);
        return false;
      }
    },
    [backend, handle, me.settings, refresh],
  );

  const startTracking = useCallback(
    async (untilMin: number) => {
      const s = me.settings;
      const start = Math.floor(minuteOfDay() / s.interval) * s.interval;
      const end = Math.min(dayCap, Math.max(untilMin, start + s.interval));
      try {
        const res = await backend.startTrack(today(), start, end, epochAt(today(), end));
        setMe((m) => ({ ...m, trackUntil: res.trackUntil }));
        setWindows((prev) => [...prev, res.window]);
        say('You’re on the clock.');
      } catch (err) {
        handle(err);
      }
    },
    [backend, handle, me.settings, say, dayCap],
  );

  const stopTracking = useCallback(async () => {
    const s = me.settings;
    const end = Math.min(dayCap, Math.ceil(minuteOfDay() / s.interval) * s.interval);
    try {
      const day = today();
      const next = await backend.stopTrack(day, end);
      setMe((m) => ({ ...m, trackUntil: null }));
      setWindows((prev) => [...prev.filter((w) => w.day !== day), ...next]);
      say('Off the clock.');
    } catch (err) {
      handle(err);
    }
  }, [backend, handle, me.settings, say, dayCap]);

  const setCategories = useCallback((categories: Category[]) => setMe((m) => ({ ...m, categories })), []);

  const value: AppValue = {
    demo,
    base: demo ? '/demo' : '/app',
    me,
    entries,
    windows,
    now,
    ready,
    tracking,
    sheet,
    toast,
    blocksFor,
    summaryFor,
    ensureDays,
    refresh,
    log,
    updateSettings,
    startTracking,
    stopTracking,
    setCategories,
    setMe,
    backend,
    openLog: setSheet,
    say,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
