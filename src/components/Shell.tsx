import { useState, type ReactNode } from 'react';
import { fmtDur, fmtMin } from '../../shared/time';
import { minuteOfDay, today } from '../lib/dates';
import { Link, usePath } from '../lib/router';
import { useApp } from '../lib/store';
import { LogSheet } from './LogSheet';
import { Icon, Logo, Sheet, ThemeToggle, type IconName } from './ui';

const NAV: Array<{ path: string; label: string; icon: IconName }> = [
  { path: '', label: 'Today', icon: 'thread' },
  { path: '/report', label: 'Report', icon: 'report' },
  { path: '/settings', label: 'Settings', icon: 'settings' },
];

/** "On the clock until 18:00 · next check-in in 7 min", plus the button that starts or stops a session. */
export function TrackingControl({ variant }: { variant: 'bar' | 'rail' }) {
  const app = useApp();
  const [asking, setAsking] = useState(false);
  const s = app.me.settings;
  const nowMin = minuteOfDay(app.now);
  const { kind, untilMin, nextPulseMin } = app.tracking;

  const cap = s.rollover + 1440;
  const options: number[] = [];
  for (let m = (Math.floor(nowMin / 30) + 1) * 30; m <= cap && options.length < 24; m += 30) options.push(m);
  const fallback = s.dayEnd > nowMin + 15 ? s.dayEnd : Math.min(cap, (Math.floor(nowMin / 30) + 4) * 30);
  const [until, setUntil] = useState(fallback);
  const untilValue = options.includes(until) || until === s.dayEnd ? until : fallback;
  if (s.dayEnd > nowMin && !options.includes(s.dayEnd)) options.push(s.dayEnd);
  options.sort((a, b) => a - b);

  return (
    <div className={`track track-${variant}${kind ? ' track-on' : ''}`}>
      <div className="track-text">
        <span className="track-state">
          <span className="track-led" aria-hidden="true" />
          {kind === 'manual' && `On the clock until ${fmtMin(untilMin ?? 0)}`}
          {kind === 'schedule' && `Workday until ${fmtMin(untilMin ?? 0)}`}
          {kind === null && 'Off the clock'}
        </span>
        <span className="faint">
          {nextPulseMin !== null
            ? `Next check-in in ${fmtDur(Math.max(1, nextPulseMin - nowMin))}`
            : kind
              ? 'Last stretch of the session'
              : `A check-in every ${s.interval} min while you track`}
        </span>
      </div>
      {kind === 'manual' && (
        <button className="btn btn-ghost btn-sm" onClick={() => void app.stopTracking()}>
          <Icon name="stop" size={16} /> Stop
        </button>
      )}
      {kind === null && (
        <button className="btn btn-primary btn-sm" onClick={() => setAsking(true)}>
          <Icon name="play" size={16} /> Start tracking
        </button>
      )}

      <Sheet open={asking} onClose={() => setAsking(false)} label="Start tracking">
        <div className="log">
          <header className="log-head">
            <h2>Start the clock</h2>
            <p className="muted">
              Every {s.interval} minutes Fifteen asks what you just did. Anything you don’t answer shows up as a gap.
            </p>
          </header>
          <label className="field">
            <span>Track until</span>
            <select className="select num" value={untilValue} onChange={(e) => setUntil(Number(e.target.value))}>
              {options.map((m) => (
                <option key={m} value={m}>
                  {fmtMin(m)}
                  {m === s.dayEnd ? ' · end of workday' : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-primary btn-block"
            onClick={() => {
              setAsking(false);
              void app.startTracking(untilValue);
            }}
          >
            Start tracking
          </button>
        </div>
      </Sheet>
    </div>
  );
}

/** The right-hand column on wide screens: the running tally for today. */
function TodayAside() {
  const app = useApp();
  const sum = app.summaryFor(today());
  const cats = new Map(app.me.categories.map((c) => [c.id, c]));
  const total = sum.loggedMin + sum.gapMin;
  return (
    <aside className="aside">
      <div className="aside-top">
        <ThemeToggle onChange={(theme) => void app.updateSettings({ theme })} />
      </div>
      <section className="card">
        <h3 className="card-title">Today so far</h3>
        <div className="tally">
          <span className="tally-num">
            {sum.score ?? '–'}
            {sum.score !== null && <small>%</small>}
          </span>
          <span className="muted">focus score</span>
        </div>
        <dl className="stats">
          <div>
            <dt>Logged</dt>
            <dd className="num">{fmtDur(sum.loggedMin)}</dd>
          </div>
          <div>
            <dt>Wasted</dt>
            <dd className="num">{fmtDur(sum.wasteMin)}</dd>
          </div>
          <div>
            <dt>Unaccounted</dt>
            <dd className={`num${sum.gapMin ? ' warn' : ''}`}>{fmtDur(sum.gapMin)}</dd>
          </div>
        </dl>
        {total > 0 && (
          <ul className="mini-break">
            {sum.byCat.slice(0, 5).map(({ cat, min }) => (
              <li key={cat}>
                <span>{cats.get(cat)?.name ?? 'Removed'}</span>
                <span className="mini-bar">
                  <span style={{ width: `${(min / total) * 100}%`, background: `var(--c-${cats.get(cat)?.color ?? 'stone'})` }} />
                </span>
                <span className="num faint">{fmtDur(min)}</span>
              </li>
            ))}
          </ul>
        )}
        <Link href={`${app.base}/report`} className="link card-link">
          See the full report
        </Link>
      </section>
      <p className="aside-foot faint">
        <Link href="/privacy" className="link">
          Privacy
        </Link>
        <Link href="/terms" className="link">
          Terms
        </Link>
        <span>Fifteen</span>
      </p>
    </aside>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const app = useApp();
  const path = usePath();
  const sub = path.slice(app.base.length).replace(/\/$/, '');

  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <Link href={app.demo ? '/' : app.base} className="rail-logo" aria-label="Fifteen">
          <Logo />
        </Link>
        <div className="rail-nav">
          {NAV.map((n) => (
            <Link key={n.path} href={app.base + n.path} className={`rail-item${sub === n.path ? ' on' : ''}`} aria-current={sub === n.path ? 'page' : undefined}>
              <Icon name={n.icon} size={22} />
              <span>{n.label}</span>
            </Link>
          ))}
        </div>
        <button
          className={`btn btn-primary rail-log${sub === '' ? '' : ' rail-log-away'}`}
          onClick={() => {
            const i = app.me.settings.interval;
            const end = Math.max(app.me.settings.rollover + i, Math.floor(minuteOfDay() / i) * i);
            app.openLog({ day: today(), start: end - i, end, mode: 'new' });
          }}
        >
          <Icon name="plus" size={18} /> <span>Log time</span>
        </button>
        <div className="rail-foot">
          <TrackingControl variant="rail" />
          <span className="rail-user faint">{app.demo ? 'Demo · nothing is saved' : app.me.email}</span>
        </div>
      </nav>

      <main className="main">
        <div className="topbar">
          <Link href={app.demo ? '/' : app.base} className="topbar-logo" aria-label="Fifteen">
            <Logo size={24} />
          </Link>
          <ThemeToggle onChange={(theme) => void app.updateSettings({ theme })} />
        </div>
        {app.demo && (
          <div className="demo-banner">
            <span>This is the demo. Nothing is saved.</span>
            <Link href="/signup" className="link">
              Make it yours
            </Link>
          </div>
        )}
        {children}
      </main>

      <TodayAside />
      <LogSheet />
      <div className={`toast${app.toast ? ' toast-on' : ''}`} role="status" aria-live="polite">
        {app.toast}
      </div>
    </div>
  );
}
