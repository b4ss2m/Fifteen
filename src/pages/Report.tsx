import { useEffect } from 'react';
import { dayAdd, fmtMin, isDay } from '../../shared/time';
import { ReportCard, type Trend } from '../components/ReportCard';
import { Icon } from '../components/ui';
import { minuteOfDay, relativeDay, shortDay, today, weekdayName } from '../lib/dates';
import { Link, navigate, useSearch } from '../lib/router';
import { useApp } from '../lib/store';

export function Report() {
  const app = useApp();
  const search = useSearch();
  const t = today();
  const param = search.get('day');
  const day = isDay(param) && param <= t ? param : t;
  const lastWeek = dayAdd(day, -7);

  useEffect(() => {
    app.ensureDays(lastWeek);
  }, [lastWeek, app]);

  const sum = app.summaryFor(day);
  const before = app.summaryFor(lastWeek);
  const versus = `last ${weekdayName(day)}`;
  const trend: Trend | null = before.focusMin > 0 ? { pct: Math.round(((sum.focusMin - before.focusMin) / before.focusMin) * 100), versus } : null;

  const week = Array.from({ length: 7 }, (_, i) => {
    const d = dayAdd(day > dayAdd(t, -3) ? t : dayAdd(day, 3), i - 6);
    return { day: d, score: app.summaryFor(d).score };
  });

  const reportAt = app.me.settings.reportAt;
  const final = day < t || minuteOfDay(app.now) >= reportAt;
  const go = (d: string) => navigate(d === t ? `${app.base}/report` : `${app.base}/report?day=${d}`);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">{relativeDay(day)}</p>
          <h1>The verdict</h1>
        </div>
        <div className="day-nav">
          <button className="icon-btn" onClick={() => go(dayAdd(day, -1))} aria-label="Previous day">
            <Icon name="left" />
          </button>
          <button className="icon-btn" onClick={() => go(dayAdd(day, 1))} disabled={day >= t} aria-label="Next day">
            <Icon name="right" />
          </button>
        </div>
      </header>

      <ReportCard
        dayLabel={shortDay(day)}
        summary={sum}
        categories={app.me.categories}
        trend={trend}
        versus={versus}
        week={week}
        activeDay={day}
        final={final}
        onPickDay={go}
      />

      <p className="report-note faint">
        {day === t && !final ? `Today’s report closes at ${fmtMin(reportAt)}. ` : ''}
        The focus score is productive time divided by productive, wasted and unaccounted time. Neutral time, like sleep or lunch, is left out.{' '}
        <Link href={day === t ? app.base : `${app.base}?day=${day}`} className="link">
          Open the timeline
        </Link>
      </p>
    </div>
  );
}
