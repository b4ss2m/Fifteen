import { useMemo, useRef, useState } from 'react';
import { suggest, type Suggestion } from '../../shared/day';
import { fmtDur, fmtMin } from '../../shared/time';
import { LIMITS, type Category } from '../../shared/types';
import { relativeDay } from '../lib/dates';
import { useApp, type LogRequest } from '../lib/store';
import { Icon, Sheet } from './ui';

const TITLES: Record<LogRequest['mode'], string> = {
  pulse: 'What did you just do?',
  gap: 'What happened here?',
  edit: 'Change this block',
  new: 'Log time',
};

interface PanelProps {
  mode: LogRequest['mode'];
  dayLabel: string;
  start: number;
  end: number;
  interval: number;
  /** First minute of the day, when the day does not start at midnight. */
  dayStart?: number;
  categories: Category[];
  suggestion: Suggestion;
  recentTags(cat: number): string[];
  current?: { cat: number; tag: string | null };
  busy?: boolean;
  onRange?(start: number, end: number): void;
  onLog(cat: number, tag: string | null): void;
  onErase?(): void;
}

/** The four-button answer to "what did you just do?". Hold a category (or tap its tag icon) to add a tag. */
export function LogPanel(p: PanelProps) {
  const [tagFor, setTagFor] = useState<number | null>(null);
  const [tag, setTag] = useState('');
  const [showAll, setShowAll] = useState(false);
  const press = useRef<{ timer: number; fired: boolean }>({ timer: 0, fired: false });

  const live = p.categories.filter((c) => !c.archived).sort((a, b) => a.pos - b.pos);
  const byId = new Map(live.map((c) => [c.id, c]));
  const top = p.suggestion.top.map((id) => byId.get(id)).filter((c): c is Category => !!c);
  const rest = live.filter((c) => !p.suggestion.top.includes(c.id));

  const openTag = (cat: number) => {
    setTag(p.current?.cat === cat ? (p.current.tag ?? '') : p.suggestion.likely === cat ? (p.suggestion.tag ?? '') : '');
    setTagFor(cat);
  };

  const hold = (cat: number) => ({
    onPointerDown: () => {
      press.current.fired = false;
      press.current.timer = window.setTimeout(() => {
        press.current.fired = true;
        navigator.vibrate?.(15);
        openTag(cat);
      }, 450);
    },
    onPointerUp: () => window.clearTimeout(press.current.timer),
    onPointerLeave: () => window.clearTimeout(press.current.timer),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClick: () => {
      if (press.current.fired) return;
      // Tapping the suggested category carries on with the same tag as the stretch before.
      p.onLog(cat, p.suggestion.likely === cat ? p.suggestion.tag : null);
    },
  });

  const times = useMemo(() => {
    const set = new Set<number>([p.start, p.end]);
    const from = p.dayStart ?? 0;
    for (let m = from; m <= from + 1440; m += p.interval) set.add(m);
    return [...set].sort((a, b) => a - b);
  }, [p.start, p.end, p.interval, p.dayStart]);

  const picked = tagFor !== null ? byId.get(tagFor) : undefined;

  return (
    <div className="log">
      <header className="log-head">
        <h2>{TITLES[p.mode]}</h2>
        <div className="log-range">
          <span className="faint">{p.dayLabel}</span>
          {p.onRange ? (
            <span className="log-times num">
              <select aria-label="From" value={p.start} onChange={(e) => p.onRange!(Number(e.target.value), p.end)}>
                {times.filter((m) => m < p.end).map((m) => (
                  <option key={m} value={m}>
                    {fmtMin(m)}
                  </option>
                ))}
              </select>
              <span aria-hidden="true">→</span>
              <select aria-label="To" value={p.end} onChange={(e) => p.onRange!(p.start, Number(e.target.value))}>
                {times.filter((m) => m > p.start).map((m) => (
                  <option key={m} value={m}>
                    {fmtMin(m)}
                  </option>
                ))}
              </select>
            </span>
          ) : (
            <span className="log-times num">
              {fmtMin(p.start)} <span aria-hidden="true">→</span> {fmtMin(p.end)}
            </span>
          )}
          <span className="faint num">{fmtDur(p.end - p.start)}</span>
        </div>
      </header>

      {picked ? (
        <form
          className="log-tag"
          onSubmit={(e) => {
            e.preventDefault();
            p.onLog(picked.id, tag.trim() || null);
          }}
        >
          <button type="button" className="log-back" onClick={() => setTagFor(null)}>
            <Icon name="left" size={18} />
            <span className="dot" style={{ ['--c' as string]: `var(--c-${picked.color})` }} />
            {picked.name}
          </button>
          <input
            className="input"
            autoFocus
            value={tag}
            maxLength={LIMITS.tagLen}
            onChange={(e) => setTag(e.target.value)}
            placeholder="Add a tag, like “Gym” or “Laundry”"
            aria-label={`Tag for ${picked.name}`}
          />
          {p.recentTags(picked.id).length > 0 && (
            <div className="chips">
              {p.recentTags(picked.id).map((t) => (
                <button type="button" key={t} className={`chip${t === tag ? ' chip-on' : ''}`} onClick={() => setTag(t)}>
                  {t}
                </button>
              ))}
            </div>
          )}
          <button className="btn btn-primary btn-block" disabled={p.busy}>
            Log {picked.name}
            {tag.trim() ? ` · ${tag.trim()}` : ''}
          </button>
        </form>
      ) : (
        <>
          <div className="cat-grid">
            {top.map((c) => {
              const likely = p.suggestion.likely === c.id;
              return (
                <div key={c.id} className={`cat-tile${likely ? ' cat-likely' : ''}`} style={{ ['--c' as string]: `var(--c-${c.color})` }}>
                  <button type="button" className="cat-main" disabled={p.busy} {...hold(c.id)}>
                    <span className="cat-name">{c.name}</span>
                    <span className="cat-sub">{likely ? (p.suggestion.tag ? `Likely · ${p.suggestion.tag}` : 'Likely') : ' '}</span>
                  </button>
                  <button type="button" className="cat-tagbtn" aria-label={`Add a tag to ${c.name}`} onClick={() => openTag(c.id)}>
                    <Icon name="tag" size={16} />
                  </button>
                </div>
              );
            })}
          </div>

          {rest.length > 0 && (
            <div className="log-more">
              {showAll ? (
                <div className="chips">
                  {rest.map((c) => (
                    <button type="button" key={c.id} className="chip chip-cat" disabled={p.busy} {...hold(c.id)}>
                      <span className="dot" style={{ ['--c' as string]: `var(--c-${c.color})` }} />
                      {c.name}
                    </button>
                  ))}
                </div>
              ) : (
                <button type="button" className="log-expand" onClick={() => setShowAll(true)}>
                  Something else <Icon name="down" size={16} />
                </button>
              )}
            </div>
          )}

          <p className="log-hint faint">
            Hold a category to add a tag.
            {p.onErase && (
              <button type="button" className="log-erase" onClick={p.onErase} disabled={p.busy}>
                Clear this block
              </button>
            )}
          </p>
        </>
      )}
    </div>
  );
}

/** The live sheet, wired to the store. Opened by a pulse, by tapping the timeline, or from a notification. */
export function LogSheet() {
  const app = useApp();
  const req = app.sheet;
  const [busy, setBusy] = useState(false);

  const history = app.entries;
  const suggestion = useMemo(() => {
    if (!req) return { top: [], likely: null, tag: null };
    const guess = suggest(req.day, req.start, history, app.me.categories);
    if (!req.current) return guess;
    // When changing a block, what it already says is the starting point.
    const top = guess.top.includes(req.current.cat) ? guess.top : [...guess.top.slice(0, 3), req.current.cat];
    return { top, likely: req.current.cat, tag: req.current.tag };
  }, [req, history, app.me.categories]);

  const recentTags = (cat: number) => {
    const seen: string[] = [];
    for (let i = history.length - 1; i >= 0 && seen.length < 6; i--) {
      const e = history[i];
      if (e.cat === cat && e.tag && !seen.includes(e.tag)) seen.push(e.tag);
    }
    return seen;
  };

  const close = () => app.openLog(null);

  const submit = async (cat: number | null, tag: string | null) => {
    if (!req) return;
    setBusy(true);
    const ok = await app.log(req.day, [{ start: req.start, dur: req.end - req.start, cat, tag }]);
    setBusy(false);
    if (!ok) return;
    const name = app.me.categories.find((c) => c.id === cat)?.name;
    app.say(cat === null ? 'Cleared.' : `Logged ${name} · ${fmtMin(req.start)}–${fmtMin(req.end)}`);
    close();
  };

  return (
    <Sheet open={!!req} onClose={close} label="Log time">
      {req && (
        <LogPanel
          key={`${req.day}:${req.mode}`}
          mode={req.mode}
          dayLabel={relativeDay(req.day)}
          start={req.start}
          end={req.end}
          interval={app.me.settings.interval}
          dayStart={app.me.settings.rollover}
          categories={app.me.categories}
          suggestion={suggestion}
          recentTags={recentTags}
          current={req.current}
          busy={busy}
          onRange={(start, end) => app.openLog({ ...req, start, end })}
          onLog={(cat, tag) => void submit(cat, tag)}
          onErase={req.mode === 'edit' ? () => void submit(null, null) : undefined}
        />
      )}
    </Sheet>
  );
}
