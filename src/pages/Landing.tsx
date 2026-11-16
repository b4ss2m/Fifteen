import type { ReactNode } from 'react';
import { buildBlocks, summarize } from '../../shared/day';
import { CONTACT_EMAIL } from '../../shared/site';
import { LogPanel } from '../components/LogSheet';
import { ReportCard } from '../components/ReportCard';
import { Timeline } from '../components/Timeline';
import { Icon, Logo, ThemeToggle } from '../components/ui';
import { DEMO_CATEGORIES, REPORT_ENTRIES, SHOWCASE_ENTRIES, SHOWCASE_NOW, SHOWCASE_SPANS } from '../lib/demo';
import { Link } from '../lib/router';

function Phone({ children, label }: { children: ReactNode; label: string }) {
  return (
    <figure className="phone" aria-label={label}>
      <div className="phone-body">
        <span className="phone-island" aria-hidden="true" />
        <div className="phone-status num" aria-hidden="true">
          <span>15:40</span>
          <span className="phone-signal">
            <i />
            <i />
            <i />
            <b />
          </span>
        </div>
        {/* The screens below are the real components, fed made-up data. They are not interactive here. */}
        <div className="phone-screen" inert>
          {children}
          <span className="phone-fade" aria-hidden="true" />
        </div>
        <span className="phone-home" aria-hidden="true" />
      </div>
    </figure>
  );
}

const showcase = buildBlocks(SHOWCASE_ENTRIES, SHOWCASE_SPANS, SHOWCASE_NOW);
const showcaseSum = summarize(showcase, DEMO_CATEGORIES, 16);
const reportSum = summarize(buildBlocks(REPORT_ENTRIES, SHOWCASE_SPANS, 1440), DEMO_CATEGORIES, 16);
const TUNE_CATEGORIES = [
  ['Deep Work', 'blue', 'Productive'],
  ['Client calls', 'teal', 'Productive'],
  ['Writing', 'violet', 'Productive'],
  ['Gym', 'green', 'Productive'],
  ['Errands', 'stone', 'Neutral'],
  ['Scrolling', 'red', 'Wasted'],
] as const;

const week = [64, 81, 58, 77, null, null, 72].map((score, i) => ({ day: `2026-11-${String(4 + i).padStart(2, '0')}`, score }));

function TimelineScreen() {
  return (
    <div className="mock">
      <p className="page-eyebrow">Today</p>
      <h3 className="mock-title">Tuesday, 10 November</h3>
      <dl className="strip">
        <div>
          <dt>Focus</dt>
          <dd>{showcaseSum.score}%</dd>
        </div>
        <div>
          <dt>Logged</dt>
          <dd>6h</dd>
        </div>
        <div className="strip-warn">
          <dt>Unaccounted</dt>
          <dd>40 min</dd>
        </div>
      </dl>
      <Timeline blocks={showcase} categories={DEMO_CATEGORIES} nowMin={SHOWCASE_NOW} compact />
    </div>
  );
}

function PulseScreen() {
  return (
    <div className="mock-pulse">
      <TimelineScreen />
      <div className="mock-dim" />
      <div className="sheet mock-sheet">
        <span className="sheet-grip" />
        <LogPanel
          mode="pulse"
          dayLabel="Today"
          start={15 * 60 + 15}
          end={15 * 60 + 30}
          interval={15}
          categories={DEMO_CATEGORIES}
          suggestion={{ top: [1, 2, 3, 4], likely: 1, tag: 'API redesign' }}
          recentTags={() => []}
          onLog={() => {}}
        />
      </div>
    </div>
  );
}

function ReportScreen() {
  return (
    <div className="mock mock-report">
      <ReportCard
        dayLabel="Tue 10 Nov"
        summary={reportSum}
        categories={DEMO_CATEGORIES}
        trend={{ pct: 15, versus: 'last Tuesday' }}
        versus="last Tuesday"
        week={week}
        activeDay="2026-11-10"
        final
      />
    </div>
  );
}

export function Landing({ signedIn }: { signedIn: boolean }) {
  const start = signedIn ? '/app' : '/signup';
  return (
    <div className="land">
      <header className="land-nav">
        <Link href="/" aria-label="Fifteen">
          <Logo size={28} />
        </Link>
        <nav aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#report">The report</a>
          <a href="#privacy">Privacy</a>
        </nav>
        <div className="land-nav-cta">
          <ThemeToggle />
          {!signedIn && (
            <Link href="/login" className="land-login">
              Log in
            </Link>
          )}
          <Link href={start} className="btn btn-cta">
            {signedIn ? 'Open Fifteen' : 'Start free'}
          </Link>
        </div>
      </header>

      <section className="hero">
        <div className="hero-wash" aria-hidden="true" />
        <div className="hero-copy">
          <p className="eyebrow">Your day, audited</p>
          <h1>
            Know where
            <br />
            your day went.
          </h1>
          <p className="hero-sub">
            Most apps ask what you want to do. Fifteen asks what you just did. Every fifteen minutes, one question and one tap. By evening you
            have an honest record of your day, and a number to beat tomorrow.
          </p>
          <div className="hero-cta">
            <Link href={start} className="btn btn-cta btn-lg">
              {signedIn ? 'Open Fifteen' : 'Start free'}
            </Link>
            <Link href="/demo" className="btn btn-ghost btn-lg">
              Try the demo
            </Link>
          </div>
          <p className="hero-note faint">Free to use. No ads, no trackers, no card.</p>
        </div>
        <div className="hero-phone">
          <Phone label="The Fifteen timeline: a colour-coded thread of the day with one dotted gap">
            <TimelineScreen />
          </Phone>
        </div>
      </section>

      <section className="trio" id="how">
        <article>
          <span className="trio-num num">01</span>
          <h3>It checks in.</h3>
          <p>Start the clock, or let it start with your workday. Every fifteen minutes your phone gives a short pulse.</p>
        </article>
        <article>
          <span className="trio-num num">02</span>
          <h3>You tap once.</h3>
          <p>Deep Work, Admin, Health, Wasted. Your four most-used categories are always the four buttons. Hold one to add a tag.</p>
        </article>
        <article>
          <span className="trio-num num">03</span>
          <h3>The day adds up.</h3>
          <p>Each answer colours in fifteen minutes of your thread. At nine in the evening, Fifteen hands you the verdict.</p>
        </article>
      </section>

      <section className="feature">
        <div className="feature-copy">
          <p className="eyebrow">The thread</p>
          <h2>Your day as one unbroken line.</h2>
          <p>
            No grid, no spreadsheet. A single thread runs down the screen and takes on the colour of whatever you were doing: blue for deep work,
            grey for personal time, red for the minutes that got away.
          </p>
          <ul className="ticks">
            <li>
              <Icon name="check" size={18} /> Neighbouring check-ins merge into clean blocks
            </li>
            <li>
              <Icon name="check" size={18} /> Tap any block to correct it
            </li>
            <li>
              <Icon name="check" size={18} /> Looks the same on your phone and your laptop
            </li>
          </ul>
        </div>
        <div className="feature-art gapcard">
          <div className="gapcard-line" aria-hidden="true">
            <span style={{ background: 'var(--c-blue)', flexGrow: 5 }} />
            <span className="gapcard-gap" style={{ flexGrow: 3 }} />
            <span style={{ background: 'var(--c-red)', flexGrow: 2 }} />
            <span style={{ background: 'var(--c-amber)', flexGrow: 3 }} />
          </div>
          <h3>The gap</h3>
          <p>
            Miss a check-in and the thread breaks into dots. It stays broken until you go back and say what happened. Unaccounted time counts
            against your score, so you will want to close it.
          </p>
        </div>
      </section>

      <section className="feature feature-flip">
        <div className="feature-copy">
          <p className="eyebrow">The check-in</p>
          <h2>One question. Four buttons.</h2>
          <p>
            Answering takes about as long as dismissing the notification would. Fifteen looks at your own history, what you were doing a moment
            ago and what you usually do at this hour, and puts the likely answer first.
          </p>
          <p className="muted">
            A website can’t see which apps you had open or where you were, and Fifteen doesn’t pretend to. The guess comes from your past
            answers and nothing else.
          </p>
        </div>
        <div className="feature-art">
          <Phone label="A check-in: What did you just do? with four category buttons">
            <PulseScreen />
          </Phone>
        </div>
      </section>

      <section className="feature" id="report">
        <div className="feature-copy">
          <p className="eyebrow">The daily report</p>
          <h2>At 9 pm, the verdict.</h2>
          <p>One card, three things that matter, and no softening.</p>
          <dl className="verdicts">
            <div>
              <dt>Focus score</dt>
              <dd>The share of your tracked day that went to productive work. One big number.</dd>
            </div>
            <div>
              <dt>Burn rate</dt>
              <dd>“You wasted 1.5 hours today. That is 9% of your waking day.”</dd>
            </div>
            <div>
              <dt>Trend</dt>
              <dd>“You are up 15% in productive time compared to last Tuesday.”</dd>
            </div>
          </dl>
        </div>
        <div className="feature-art">
          <Phone label="The daily report card with a 72% focus score">
            <ReportScreen />
          </Phone>
        </div>
      </section>

      <section className="feature feature-flip" id="yours">
        <div className="feature-copy">
          <p className="eyebrow">Yours to shape</p>
          <h2>Your categories. Your rhythm.</h2>
          <p>
            Fifteen starts you off with a handful of categories, but the list is yours. Rename them, recolour them, add your own, and decide
            which ones count as productive, neutral or wasted.
          </p>
          <p>
            Check in every 10, 15, 20, 30 or 60 minutes. Track only when you press start, or automatically during your workday. And if your
            day runs past midnight, tell Fifteen when it really ends.
          </p>
        </div>
        <div className="feature-art">
          <div className="tune" aria-label="Example settings: a 15 minute interval and six custom categories">
            <div className="tune-row">
              <span className="tune-label">Ask me every</span>
              <div className="tune-seg num">
                {[10, 15, 20, 30, 60].map((m) => (
                  <span key={m} className={m === 15 ? 'on' : ''}>
                    {m}
                  </span>
                ))}
                <small>min</small>
              </div>
            </div>
            <ul className="tune-cats">
              {TUNE_CATEGORIES.map(([name, color, kind]) => (
                <li key={name}>
                  <span className="swatch" style={{ ['--c' as string]: `var(--c-${color})` }} />
                  <span className="tune-name">{name}</span>
                  <span className={`tune-kind tune-${kind.toLowerCase()}`}>{kind}</span>
                </li>
              ))}
              <li className="tune-new">
                <Icon name="plus" size={16} /> New category
              </li>
            </ul>
            <div className="tune-row tune-foot">
              <span>
                Workday <strong className="num">09:00–18:00</strong>
              </span>
              <span>
                Day ends at <strong className="num">02:00</strong>
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="privacy-band" id="privacy">
        <div>
          <p className="eyebrow">Privacy</p>
          <h2>A record of your day is nobody else’s business.</h2>
        </div>
        <ul>
          <li>
            <Icon name="lock" />
            <div>
              <strong>No ads, no analytics, no trackers.</strong>
              <span>The only cookie is the one that keeps you signed in.</span>
            </div>
          </li>
          <li>
            <Icon name="download" />
            <div>
              <strong>Take it with you.</strong>
              <span>Export everything as one file, whenever you like.</span>
            </div>
          </li>
          <li>
            <Icon name="trash" />
            <div>
              <strong>Delete means delete.</strong>
              <span>One button erases your account and every entry in it.</span>
            </div>
          </li>
          <li>
            <Icon name="check" />
            <div>
              <strong>Stored in the EU.</strong>
              <span>
                Built to follow the GDPR.{' '}
                <Link href="/privacy" className="link">
                  Read the policy
                </Link>
              </span>
            </div>
          </li>
        </ul>
      </section>

      <section className="closer">
        <div className="closer-wash" aria-hidden="true" />
        <h2>The next fifteen minutes are on the record.</h2>
        <p>Find out what your days are really made of.</p>
        <div className="hero-cta">
          <Link href={start} className="btn btn-cta btn-lg">
            {signedIn ? 'Open Fifteen' : 'Start free'}
          </Link>
          <Link href="/demo" className="btn btn-ghost btn-lg">
            Try the demo
          </Link>
        </div>
      </section>

      <footer className="land-foot">
        <Logo size={22} />
        <nav aria-label="Footer">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/login">Log in</Link>
        </nav>
        <a className="land-contact" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
      </footer>
    </div>
  );
}
