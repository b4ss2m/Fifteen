import type { Summary } from '../../shared/day';
import { fmtDur } from '../../shared/time';
import type { Category } from '../../shared/types';
import { weekdayLetter } from '../lib/dates';

export interface Trend {
  pct: number;
  versus: string;
}

interface Props {
  dayLabel: string;
  summary: Summary;
  categories: Category[];
  /** Change in productive time against the same weekday last week, or null when there is nothing to compare. */
  trend: Trend | null;
  versus: string;
  week?: Array<{ day: string; score: number | null }>;
  activeDay?: string;
  /** False while the day is still running, so the wording says "so far". */
  final: boolean;
  onPickDay?(day: string): void;
}

function hours(min: number): string {
  if (min < 60) return `${min} minutes`;
  const h = Math.round((min / 60) * 10) / 10;
  return `${h} ${h === 1 ? 'hour' : 'hours'}`;
}

function verdict(score: number | null): string {
  if (score === null) return 'Nothing on the record.';
  if (score >= 85) return 'A sharp day.';
  if (score >= 70) return 'Solid, with a few leaks.';
  if (score >= 50) return 'Half the day got away.';
  return 'The day ran you.';
}

export function ReportCard({ dayLabel, summary: s, categories, trend, versus, week, activeDay, final, onPickDay }: Props) {
  const cats = new Map(categories.map((c) => [c.id, c]));
  const total = s.loggedMin + s.gapMin;
  const when = final ? 'today' : 'so far today';

  return (
    <article className="report">
      <div className="report-wash" aria-hidden="true" />
      <header className="report-head">
        <span className="report-eyebrow">Daily report</span>
        <span className="faint">{dayLabel}</span>
      </header>

      <div className="report-score">
        <span className="report-num">
          {s.score ?? '–'}
          {s.score !== null && <small>%</small>}
        </span>
        <span className="report-label">
          <strong>Focus score</strong>
          <span className="muted">{verdict(s.score)}</span>
        </span>
      </div>

      <dl className="report-facts">
        <div>
          <dt>Burn rate</dt>
          <dd>
            {s.wasteMin > 0 ? (
              <>
                You wasted <strong>{hours(s.wasteMin)}</strong> {when}. That is <strong>{s.burnPct}%</strong> of your waking day.
              </>
            ) : (
              <>Nothing logged as wasted {when}. Either a clean day or a generous memory.</>
            )}
            {s.gapMin > 0 && (
              <>
                {' '}
                Another <strong>{hours(s.gapMin)}</strong> went unaccounted for, and that counts against you.
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Trend</dt>
          <dd>
            {trend === null ? (
              <>No {versus} on record to compare with yet.</>
            ) : trend.pct === 0 ? (
              <>Level with {trend.versus} on productive time.</>
            ) : (
              <>
                You are{' '}
                <strong className={trend.pct > 0 ? 'up' : 'down'}>
                  {trend.pct > 0 ? 'up' : 'down'} {Math.abs(trend.pct)}%
                </strong>{' '}
                in productive time compared to {trend.versus}.
              </>
            )}
          </dd>
        </div>
      </dl>

      {total > 0 && (
        <section className="report-break" aria-label="Where the time went">
          <div className="bar">
            {s.byCat.map(({ cat, min }) => (
              <span key={cat} style={{ flexGrow: min, background: `var(--c-${cats.get(cat)?.color ?? 'stone'})` }} />
            ))}
            {s.gapMin > 0 && <span className="bar-gap" style={{ flexGrow: s.gapMin }} />}
          </div>
          <ul>
            {s.byCat.map(({ cat, min }) => (
              <li key={cat}>
                <span className="dot" style={{ ['--c' as string]: `var(--c-${cats.get(cat)?.color ?? 'stone'})` }} />
                <span>{cats.get(cat)?.name ?? 'Removed category'}</span>
                <span className="num muted">{fmtDur(min)}</span>
                <span className="num faint">{Math.round((min / total) * 100)}%</span>
              </li>
            ))}
            {s.gapMin > 0 && (
              <li>
                <span className="dot dot-gap" />
                <span>Unaccounted</span>
                <span className="num muted">{fmtDur(s.gapMin)}</span>
                <span className="num faint">{Math.round((s.gapMin / total) * 100)}%</span>
              </li>
            )}
          </ul>
        </section>
      )}

      {week && (
        <section className="report-week" aria-label="Focus score, last seven days">
          {week.map((d) => (
            <button
              type="button"
              key={d.day}
              className={`week-day${d.day === activeDay ? ' week-on' : ''}`}
              onClick={onPickDay ? () => onPickDay(d.day) : undefined}
              disabled={!onPickDay}
              aria-label={`${d.day}: ${d.score === null ? 'no record' : `${d.score}%`}`}
            >
              <span className="week-bar">
                <span style={{ height: `${d.score ?? 0}%` }} />
              </span>
              <span className="num">{d.score ?? '–'}</span>
              <span className="faint">{weekdayLetter(d.day)}</span>
            </button>
          ))}
        </section>
      )}
    </article>
  );
}
