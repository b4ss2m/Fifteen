import type { Settings } from '../shared/types';
import { nextPulse, nextReport } from '../shared/time';
import { b64u, unb64u } from './crypto';
import type { Env } from './env';

/** Browsers hand us a push endpoint; only real push services are accepted so we never call arbitrary URLs. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/];

export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1000) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export const pushConfigured = (env: Env) => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

async function vapidHeader(env: Env, endpoint: string, subject: string): Promise<string> {
  const pub = unb64u(env.VAPID_PUBLIC_KEY);
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: env.VAPID_PRIVATE_KEY ?? '' },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const enc = new TextEncoder();
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(
    enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 6 * 3600, sub: subject })),
  );
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

/**
 * Sends an empty push. The service worker wakes up, asks /api/notice what to show,
 * so nothing about the user's day ever travels through a push service.
 */
async function sendPush(env: Env, endpoint: string, origin: string): Promise<'ok' | 'gone' | 'failed'> {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: await vapidHeader(env, endpoint, origin), TTL: '600', Urgency: 'high', 'Content-Length': '0' },
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}

/** Recomputes when a user is next due a pulse and a report. Only users with a push subscription are scheduled. */
export async function reschedule(env: Env, userId: string, now = Math.floor(Date.now() / 1000)): Promise<void> {
  const row = await env.DB.prepare(
    'SELECT settings, track_until, (SELECT COUNT(*) FROM push_subs WHERE user_id = users.id) AS subs FROM users WHERE id = ?',
  )
    .bind(userId)
    .first<{ settings: string; track_until: number | null; subs: number }>();
  if (!row) return;
  const s = JSON.parse(row.settings) as Settings;
  const on = row.subs > 0;
  await env.DB.prepare('UPDATE users SET next_pulse_at = ?, next_report_at = ? WHERE id = ?')
    .bind(on ? nextPulse(now, s, row.track_until) : null, on ? nextReport(now, s) : null, userId)
    .run();
}

const MAX_PUSHES_PER_TICK = 40;

export async function runCron(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  if (new Date().getUTCMinutes() === 0) {
    await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
  }
  if (!pushConfigured(env)) return;

  const due = await env.DB.prepare(
    `SELECT id, settings, track_until, next_pulse_at, next_report_at FROM users
     WHERE (next_pulse_at IS NOT NULL AND next_pulse_at <= ?1) OR (next_report_at IS NOT NULL AND next_report_at <= ?1)
     LIMIT 25`,
  )
    .bind(now)
    .all<{ id: string; settings: string; track_until: number | null; next_pulse_at: number | null; next_report_at: number | null }>();

  let budget = MAX_PUSHES_PER_TICK;
  for (const u of due.results) {
    const s = JSON.parse(u.settings) as Settings;
    const reportDue = u.next_report_at !== null && u.next_report_at <= now;
    const pulseDue = u.next_pulse_at !== null && u.next_pulse_at <= now;
    // A pulse that is badly late is not worth a buzz; the gap on the timeline does that job.
    const fresh = (reportDue && now - u.next_report_at! < 1800) || (pulseDue && now - u.next_pulse_at! < 600);
    const notice = reportDue ? `report:${u.next_report_at}` : `pulse:${u.next_pulse_at}`;

    const subs = await env.DB.prepare('SELECT endpoint, origin FROM push_subs WHERE user_id = ?')
      .bind(u.id)
      .all<{ endpoint: string; origin: string }>();

    if (fresh) {
      for (const sub of subs.results) {
        if (budget-- <= 0) break;
        if ((await sendPush(env, sub.endpoint, sub.origin)) === 'gone') {
          await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(sub.endpoint).run();
        }
      }
    }

    await env.DB.prepare('UPDATE users SET next_pulse_at = ?, next_report_at = ?, notice = ? WHERE id = ?')
      .bind(
        subs.results.length ? nextPulse(now, s, u.track_until) : null,
        subs.results.length ? nextReport(now, s) : null,
        fresh ? notice : null,
        u.id,
      )
      .run();
    if (budget <= 0) break;
  }
}
