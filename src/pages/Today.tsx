import { useEffect } from 'react';
import type { Block } from '../../shared/day';
import { dayAdd, fmtDur, isDay } from '../../shared/time';
import { TrackingControl } from '../components/Shell';
import { Timeline } from '../components/Timeline';
import { Icon } from '../components/ui';
import { longDay, minuteOfDay, nowMinFor, relativeDay, today } from '../lib/dates';
import { Link, navigate, useSearch } from '../lib/router';
import { useApp } from '../lib/store';

export function Today() {
  const app = useApp();
  const search = useSearch();
  const t = today();
  const param = search.get('day');
  const day = isDay(param) && param <= dayAdd(t, 1) ? param : t;
  const isToday = day === t;

  useEffect(() => {
    app.ensureDays(day);
  }, [day, app]);

  // A notification tap lands here as /app?log=2026-11-16:855:15
  const logParam = search.get('log');
  useEffect(() => {
    if (!logParam || !app.ready) return;
    const [d, start, dur] = logParam.split(':');
    if (isDay(d) && Number(start) >= 0 && Number(dur) > 0) {
      app.openLog({ day: d, start: Number(start), end: Number(start) + Number(dur), mode: 'pulse' });
    }
    navigate(app.base, { replace: true });
  }, [logParam, app]);

  const blocks = app.blocksFor(day);
  const sum = app.summaryFor(day);
  const hasRecord = blocks.some((b) => b.type !== 'idle');
  const gaps = blocks.filter((b) => b.type === 'gap');
  const go = (d: string) => navigate(d === t ? app.base : `${app.base}?day=${d}`);

  const pick = (b: Block) => {
    const end = b.start + b.dur;
    if (b.type === 'entry') app.openLog({ day, start: b.start, end, mode: 'edit', current: { cat: b.cat, tag: b.tag } });
    else if (b.type === 'gap') app.openLog({ day, start: b.start, end, mode: 'gap' });
    else if (b.type === 'idle') {
      const i = app.me.settings.interval;
      app.openLog({ day, start: b.start, end: Math.min(end, b.start + i), mode: 'new' });
    }
  };

  const logNow = () => {
    const i = app.me.settings.interval;
    const end = isToday ? Math.max(app.me.settings.rollover + i, Math.floor(minuteOfDay() / i) * i) : 10 * 60;
    app.openLog({ day, start: end - i, end, mode: 'new' });
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">{relativeDay(day)}</p>
          <h1>{longDay(day)}</h1>
        </div>
        <div className="day-nav">
          <button className="icon-btn" onClick={() => go(dayAdd(day, -1))} aria-label="Previous day">
            <Icon name="left" />
          </button>
          {!isToday && (
            <button className="btn btn-ghost btn-sm" onClick={() => go(t)}>
              Today
            </button>
          )}
          <button className="icon-btn" onClick={() => go(dayAdd(day, 1))} disabled={day >= t} aria-label="Next day">
            <Icon name="right" />
          </button>
        </div>
      </header>

      {isToday && (
        <div className="only-narrow">
          <TrackingControl variant="bar" />
        </div>
      )}

      {hasRecord && (
        <dl className="strip">
          <div>
            <dt>Focus</dt>
            <dd>{sum.score === null ? '–' : `${sum.score}%`}</dd>
          </div>
          <div>
            <dt>Logged</dt>
            <dd>{fmtDur(sum.loggedMin)}</dd>
          </div>
          <div>
            <dt>Wasted</dt>
            <dd>{fmtDur(sum.wasteMin)}</dd>
          </div>
          <div className={sum.gapMin ? 'strip-warn' : ''}>
            <dt>Unaccounted</dt>
            <dd>{fmtDur(sum.gapMin)}</dd>
          </div>
        </dl>
      )}

      {isToday && hasRecord && minuteOfDay(app.now) >= app.me.settings.reportAt && (
        <Link href={`${app.base}/report`} className="report-call">
          <span>
            <strong>Today’s report is ready.</strong> Focus score {sum.score === null ? '–' : `${sum.score}%`}.
          </span>
          <span className="link">See the verdict</span>
        </Link>
      )}

      {gaps.length > 0 && (
        <button className="gap-call" onClick={() => pick(gaps[0])}>
          <span className="gap-dots" aria-hidden="true" />
          <span>
            <strong>
              {gaps.length === 1 ? 'One gap' : `${gaps.length} gaps`} in {isToday ? 'today’s' : 'this day’s'} thread.
            </strong>{' '}
            {fmtDur(sum.gapMin)} unaccounted for.
          </span>
          <span className="gap-go">Close {gaps.length === 1 ? 'it' : 'them'}</span>
        </button>
      )}

      {!app.ready ? (
        <div className="thread-skeleton" aria-hidden="true" />
      ) : hasRecord ? (
        <Timeline blocks={blocks} categories={app.me.categories} nowMin={isToday ? nowMinFor(day, app.now) : null} onPick={pick} />
      ) : (
        <div className="empty">
          <span className="empty-thread" aria-hidden="true" />
          <h2>{isToday ? 'Nothing on the record yet.' : 'No record for this day.'}</h2>
          <p className="muted">
            {isToday
              ? 'Start the clock and Fifteen will check in with you. Or log something by hand.'
              : 'You weren’t tracking, and nothing was logged afterwards.'}
          </p>
          <button className="btn btn-ghost" onClick={logNow}>
            <Icon name="plus" size={18} /> Log time by hand
          </button>
        </div>
      )}
    </div>
  );
}
