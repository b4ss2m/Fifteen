# Fifteen

Your day, audited.

Most apps ask what you want to do. Fifteen asks what you just did. Every fifteen minutes it checks in, you
tap one of four categories, and the answers build a timeline of your day: a single thread that takes the
colour of whatever you were doing, and breaks into dots wherever you didn't answer. In the evening you get
a report with a focus score, the time you wasted, and how today compares with the same day last week.

![The Fifteen home page](docs/home.png)

![The timeline on a laptop](docs/app.png)

## What it does

- **The thread.** A vertical timeline of the day. Neighbouring check-ins merge into blocks; tap one to change it.
- **Check-ins.** One question and your four most-used categories. Hold a category to add a tag such as "Gym".
- **Gaps.** Tracked time you didn't account for shows as a dotted stretch, and counts against your score.
- **Suggestions.** The likely answer is marked, based on what you were just doing and what you usually do
  at that hour. It is worked out on your device from your own history.
- **Daily report.** Focus score, burn rate ("You wasted 1.5 hours today. That is 9% of your waking day.")
  and a trend against the same weekday last week.
- **Yours to shape.** Your own categories and colours, a check-in every 10 to 60 minutes, tracking on demand
  or automatically during your workday, and a day that can end after midnight.
- **Private by design.** No ads, analytics or trackers. Export everything as one file, or delete your account
  and all its data with one button.
- **A demo** at `/demo` that runs entirely in the browser, and light and dark themes.

## How it's built

One Cloudflare Worker serves both the site and the API.

| Part | What it is |
| --- | --- |
| `src/` | The web app: React and plain CSS, built with Vite |
| `worker/` | The API, written with [Hono](https://hono.dev) |
| `shared/` | Time, scoring and gap logic used by both sides |
| `migrations/` | The D1 (SQLite) schema |
| `public/sw.js` | Service worker that shows check-in notifications |
| `test/` | API and logic tests (Vitest, against a real local D1) |

## Run it locally

You need Node 22 or newer.

```bash
npm install
```

```bash
npm run db:migrate:local
```

```bash
npm run dev
```

The app is then at http://localhost:5173.

```bash
npm test
```

```bash
npm run typecheck
```

## Security

Passwords never leave the browser in a usable form, sessions are stored hashed, and every page is served
with a strict Content Security Policy. [SECURITY.md](SECURITY.md) has the details and explains how to report
a problem.

No secrets live in this repository. The full git history is scanned with
[gitleaks](https://github.com/gitleaks/gitleaks) before every push (`npm run scan`) and again in CI.
