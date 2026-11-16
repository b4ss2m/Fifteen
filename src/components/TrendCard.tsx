import { useEffect, useState } from 'react';
import { dayAdd, fmtDur } from '../../shared/time';
import { shortDay, today } from '../lib/dates';
import { useApp } from '../lib/store';

type Range = 'week' | 'month' | 'quarter';

const RANGES: Array<{ id: Range; label: string; days: number }> = [
  { id: 'week', label: 'Week', days: 7 },
  { id: 'month', label: 'Month', days: 30 },
  { id: 'quarter', label: '3 months', days: 91 },
];

interface Bar {
  key: string;
  /** Day a tap should open, or null for a bar that stands for a whole week. */
  day: string | null;
  label: string;
  score: number | null;
  focusMin: number;
}

/** Focus score over time: one bar a day for a week or a month, one bar a week for three months. */
export function TrendCard({ onPickDay }: { onPickDay(day: string): void }) {
  const app = useApp();
  const [range, setRange] = useState<Range>('week');
  const [hover, setHover] = useState<number | null>(null);
  const t = today();
  const days = RANGES.find((r) => r.id === range)!.days;
  const from = dayAdd(t, -(days - 1));

  useEffect(() => {
    app.ensureDays(from);
  }, [from, app]);

  const daily = Array.from({ length: days }, (_, i) => {
    const day = dayAdd(from, i);
    const sum = app.summaryFor(day);
    return { day, score: sum.score, focusMin: sum.focusMin };
  });

  let bars: Bar[];
  if (range === 'quarter') {
    bars = [];
    for (let i = 0; i < daily.length; i += 7) {
      const week = daily.slice(i, i + 7);
      const scored = week.filter((d) => d.score !== null);
      bars.push({
        key: week[0].day,
        day: null,
        label: `Week of ${shortDay(week[0].day)}`,
        score: scored.length ? Math.round(scored.reduce((n, d) => n + (d.score ?? 0), 0) / scored.length) : null,
        focusMin: scored.length ? Math.round(scored.reduce((n, d) => n + d.focusMin, 0) / scored.length) : 0,
      });
    }
  } else {
    bars = daily.map((d) => ({ key: d.day, day: d.day, label: shortDay(d.day), score: d.score, focusMin: d.focusMin }));
  }

  const scored = daily.filter((d) => d.score !== null);
  const average = scored.length ? Math.round(scored.reduce((n, d) => n + (d.score ?? 0), 0) / scored.length) : null;
  const perDay = scored.length ? Math.round(scored.reduce((n, d) => n + d.focusMin, 0) / scored.length / 5) * 5 : 0;
  const shown = hover !== null ? bars[hover] : null;

  return (
    <section className="trend card" aria-label="Focus score over time">
      <header className="trend-head">
        <div>
          <h3 className="card-title">Focus score over time</h3>
          <p className="trend-figure">
            {shown ? (
              <>
                <strong className="num">{shown.score === null ? '–' : `${shown.score}%`}</strong>
                <span className="muted">
                  {shown.label}
                  {shown.score !== null && ` · ${fmtDur(shown.focusMin)} productive`}
                  {shown.score === null && ' · no record'}
                </span>
              </>
            ) : (
              <>
                <strong className="num">{average === null ? '–' : `${average}%`}</strong>
                <span className="muted">
                  {average === null ? 'Nothing tracked in this stretch yet' : `average · ${fmtDur(perDay)} productive a day`}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="seg" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r.id} type="button" className={r.id === range ? 'on' : ''} aria-pressed={r.id === range} onClick={() => setRange(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
      </header>

      <div className="trend-plot">
        <span className="trend-grid" style={{ bottom: '100%' }}>
          <i className="num">100</i>
        </span>
        <span className="trend-grid" style={{ bottom: '50%' }}>
          <i className="num">50</i>
        </span>
        <div className={`trend-bars trend-${range}`} onMouseLeave={() => setHover(null)}>
          {bars.map((b, i) => (
            <button
              key={b.key}
              type="button"
              className={`trend-bar${hover === i ? ' on' : ''}${b.day === t ? ' today' : ''}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => (b.day ? onPickDay(b.day) : setHover(i))}
              aria-label={`${b.label}: ${b.score === null ? 'no record' : `${b.score}%`}`}
            >
              <span style={{ height: b.score === null ? 3 : `${Math.max(3, b.score)}%` }} className={b.score === null ? 'none' : ''} />
            </button>
          ))}
        </div>
      </div>
      <div className="trend-axis faint num">
        <span>{shortDay(from)}</span>
        <span>{range === 'quarter' ? 'weekly averages' : ''}</span>
        <span>Today</span>
      </div>
    </section>
  );
}
