import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  COLORS,
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  INTERVALS,
  LIMITS,
  type Category,
  type Color,
  type DaysResponse,
  type Entry,
  type Kind,
  type Me,
  type PublicConfig,
  type Settings,
} from '../shared/types';
import { dayAdd, fmtMin, isDay, isTimeZone, localParts, logicalParts } from '../shared/time';
import { hashAuthKey, newRecoveryCode, normalizeRecoveryCode, randomToken, safeEqual, sha256 } from './crypto';
import type { Env } from './env';
import { isPushEndpoint, pushConfigured, reschedule, runCron } from './push';

type Ctx = { Bindings: Env; Variables: { uid: string } };
type C = Context<Ctx>;

const SESSION_DAYS = 30;
const MAX_BODY = 64 * 1024;
const LOCK_AFTER = 8;
const LOCK_SECONDS = 15 * 60;
const KINDS: Kind[] = ['focus', 'neutral', 'waste'];

const now = () => Math.floor(Date.now() / 1000);

function fail(status: ContentfulStatusCode, error: string): never {
  throw new HTTPException(status, { res: Response.json({ error }, { status }) });
}

// ── Input ───────────────────────────────────────────────────────────────────

async function readBody(c: C): Promise<Record<string, unknown>> {
  if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('application/json')) fail(415, 'json_required');
  const text = await c.req.text();
  if (text.length > MAX_BODY) fail(413, 'too_large');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    fail(400, 'bad_json');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'bad_json');
  return data as Record<string, unknown>;
}

function int(v: unknown, min: number, max: number, step = 1): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max || v % step !== 0) fail(400, 'bad_input');
  return v;
}

/** Trims, collapses whitespace and drops control characters. */
function text(v: unknown, max: number, required = true): string {
  if (typeof v !== 'string') fail(400, 'bad_input');
  // Control characters and the Unicode line separators become plain spaces.
  const s = [...v]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 32 || code === 127 || code === 0x2028 || code === 0x2029 ? ' ' : ch;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > max || (required && !s.length)) fail(400, 'bad_input');
  return s;
}

function email(v: unknown): string {
  if (typeof v !== 'string') fail(400, 'bad_email');
  const s = v.trim().toLowerCase();
  if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) fail(400, 'bad_email');
  return s;
}

function authKey(v: unknown): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(v)) fail(400, 'bad_input');
  return v;
}

function day(v: unknown, tz = 'UTC'): string {
  if (!isDay(v)) fail(400, 'bad_day');
  // Nothing before 2020, nothing past tomorrow.
  if (v < '2020-01-01' || v > dayAdd(localParts(now(), tz).day, 1)) fail(400, 'bad_day');
  return v;
}

function parseSettings(input: unknown, prev: Settings): Settings {
  if (!input || typeof input !== 'object') fail(400, 'bad_input');
  const v = input as Record<string, unknown>;
  const workdays = Array.isArray(v.workdays) ? [...new Set(v.workdays.map((d) => int(d, 0, 6)))].sort() : fail(400, 'bad_input');
  const rollover = v.rollover === undefined ? prev.rollover : int(v.rollover, 0, LIMITS.maxRollover, 30);
  const dayStart = int(v.dayStart, rollover, rollover + 1435, 5);
  const dayEnd = int(v.dayEnd, rollover + 5, rollover + 1440, 5);
  if (dayEnd <= dayStart) fail(400, 'bad_input');
  if (!isTimeZone(v.tz)) fail(400, 'bad_input');
  if (typeof v.autoTrack !== 'boolean' || typeof v.sound !== 'boolean') fail(400, 'bad_input');
  if (v.theme !== 'light' && v.theme !== 'dark') fail(400, 'bad_input');
  const interval = int(v.interval, 5, 60);
  if (!(INTERVALS as readonly number[]).includes(interval)) fail(400, 'bad_input');
  return {
    interval,
    workdays,
    dayStart,
    dayEnd,
    autoTrack: v.autoTrack,
    // The schedule only ever applies from the day it was switched on.
    autoSince: v.autoTrack ? (prev.autoTrack && prev.autoSince ? prev.autoSince : logicalParts(now(), v.tz, rollover).day) : null,
    reportAt: int(v.reportAt, rollover, rollover + 1435, 5),
    rollover,
    wakingHours: int(v.wakingHours, 8, 20),
    tz: v.tz,
    theme: v.theme,
    sound: v.sound,
  };
}

// ── Sessions ────────────────────────────────────────────────────────────────

const isHttps = (c: C) => new URL(c.req.url).protocol === 'https:';
const cookieName = (c: C) => (isHttps(c) ? '__Host-fifteen' : 'fifteen');
const clientIp = (c: C) => c.req.header('cf-connecting-ip') ?? 'local';

async function startSession(c: C, userId: string): Promise<void> {
  const token = randomToken();
  const t = now();
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, t + SESSION_DAYS * 86400, t)
    .run();
  setCookie(c, cookieName(c), token, {
    path: '/',
    httpOnly: true,
    secure: isHttps(c),
    sameSite: 'Lax',
    maxAge: SESSION_DAYS * 86400,
  });
}

async function throttle(c: C): Promise<void> {
  if (c.env.AUTH_LIMITER && !(await c.env.AUTH_LIMITER.limit({ key: clientIp(c) })).success) fail(429, 'slow_down');
}

/** Bot checks for the signed-out endpoints that take credentials. */
async function guard(c: C, body: Record<string, unknown>): Promise<void> {
  await throttle(c);
  // A field real people never see or fill in.
  if (body.website !== undefined && body.website !== '') fail(400, 'bad_input');
  if (!c.env.TURNSTILE_SECRET || !c.env.TURNSTILE_SITE_KEY) return;
  const token = body.turnstile;
  if (typeof token !== 'string' || !token || token.length > 2048) fail(400, 'challenge_failed');
  const form = new FormData();
  form.append('secret', c.env.TURNSTILE_SECRET);
  form.append('response', token);
  form.append('remoteip', clientIp(c));
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const out = (await res.json().catch(() => ({}))) as { success?: boolean };
  if (out.success !== true) fail(400, 'challenge_failed');
}

async function loadMe(env: Env, uid: string): Promise<Me> {
  const [user, cats] = await env.DB.batch([
    env.DB.prepare(
      'SELECT email, created_at, settings, track_until, (SELECT COUNT(*) FROM push_subs WHERE user_id = users.id) AS subs FROM users WHERE id = ?',
    ).bind(uid),
    env.DB.prepare('SELECT id, name, color, kind, pos, archived FROM categories WHERE user_id = ? ORDER BY pos, id').bind(uid),
  ]);
  const u = user.results[0] as { email: string; created_at: number; settings: string; track_until: number | null; subs: number } | undefined;
  if (!u) fail(401, 'signed_out');
  return {
    email: u.email,
    createdAt: u.created_at,
    settings: { ...DEFAULT_SETTINGS, ...(JSON.parse(u.settings) as Partial<Settings>) },
    categories: (cats.results as Array<Omit<Category, 'archived'> & { archived: number }>).map((r) => ({ ...r, archived: !!r.archived })),
    trackUntil: u.track_until && u.track_until > now() ? u.track_until : null,
    pushEnabled: u.subs > 0,
  };
}

async function settingsOf(c: C): Promise<Settings> {
  const row = await c.env.DB.prepare('SELECT settings FROM users WHERE id = ?').bind(c.var.uid).first<{ settings: string }>();
  if (!row) fail(401, 'signed_out');
  return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.settings) as Partial<Settings>) };
}

// ── App ─────────────────────────────────────────────────────────────────────

const app = new Hono<Ctx>().basePath('/api');

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error('unhandled', err instanceof Error ? err.message : 'error');
  return c.json({ error: 'server' }, 500);
});
app.notFound((c) => c.json({ error: 'not_found' }, 404));

app.use('*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    // Cookies are SameSite=Lax; this closes what is left of cross-site request forgery.
    if (c.req.header('origin') !== new URL(c.req.url).origin) fail(403, 'bad_origin');
    if (Number(c.req.header('content-length') ?? 0) > MAX_BODY) fail(413, 'too_large');
  }
  if (c.env.API_LIMITER && !(await c.env.API_LIMITER.limit({ key: clientIp(c) })).success) fail(429, 'slow_down');
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Cross-Origin-Resource-Policy', 'same-origin');
});

app.get('/config', (c) =>
  c.json<PublicConfig>({
    turnstileSiteKey: c.env.TURNSTILE_SECRET ? c.env.TURNSTILE_SITE_KEY : '',
    vapidPublicKey: pushConfigured(c.env) ? c.env.VAPID_PUBLIC_KEY : '',
  }),
);

// ── Accounts ────────────────────────────────────────────────────────────────

app.post('/auth/signup', async (c) => {
  const body = await readBody(c);
  await guard(c, body);
  const addr = email(body.email);
  const key = authKey(body.authKey);
  const db = c.env.DB;
  if (await db.prepare('SELECT 1 FROM users WHERE email = ?').bind(addr).first()) fail(409, 'email_taken');

  const id = randomToken(16);
  const salt = randomToken(16);
  const code = newRecoveryCode();
  const settings: Settings = { ...DEFAULT_SETTINGS, tz: isTimeZone(body.tz) ? body.tz : 'UTC' };
  await db.batch([
    db
      .prepare('INSERT INTO users (id, email, pw_hash, pw_salt, recovery_hash, settings, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, addr, await hashAuthKey(key, salt), salt, await sha256(normalizeRecoveryCode(code)), JSON.stringify(settings), now()),
    ...DEFAULT_CATEGORIES.map((cat, i) =>
      db.prepare('INSERT INTO categories (user_id, name, color, kind, pos) VALUES (?, ?, ?, ?, ?)').bind(id, cat.name, cat.color, cat.kind, i),
    ),
  ]);
  await startSession(c, id);
  return c.json({ recoveryCode: code, me: await loadMe(c.env, id) }, 201);
});

interface Credentials {
  id: string;
  pw_hash: string;
  pw_salt: string;
  recovery_hash: string;
  failed_logins: number;
  locked_until: number;
}

/** Looks an account up and runs `check`. Repeated failures lock the account for a while. */
async function verify(c: C, addr: string, check: (u: Credentials) => Promise<boolean>): Promise<Credentials> {
  const db = c.env.DB;
  const u = await db
    .prepare('SELECT id, pw_hash, pw_salt, recovery_hash, failed_logins, locked_until FROM users WHERE email = ?')
    .bind(addr)
    .first<Credentials>();
  if (!u) {
    // Spend the same effort as a real check so response time says nothing about who has an account.
    await hashAuthKey('A'.repeat(43), 'AAAAAAAAAAAAAAAAAAAAAA');
    fail(401, 'bad_credentials');
  }
  if (u.locked_until > now()) fail(429, 'locked');
  if (!(await check(u))) {
    const fails = u.failed_logins + 1;
    const lock = fails >= LOCK_AFTER;
    await db
      .prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
      .bind(lock ? 0 : fails, lock ? now() + LOCK_SECONDS : 0, u.id)
      .run();
    fail(401, 'bad_credentials');
  }
  if (u.failed_logins) await db.prepare('UPDATE users SET failed_logins = 0 WHERE id = ?').bind(u.id).run();
  return u;
}

app.post('/auth/login', async (c) => {
  const body = await readBody(c);
  await guard(c, body);
  const key = authKey(body.authKey);
  const u = await verify(c, email(body.email), async (u) => safeEqual(await hashAuthKey(key, u.pw_salt), u.pw_hash));
  await startSession(c, u.id);
  return c.json({ me: await loadMe(c.env, u.id) });
});

app.post('/auth/recover', async (c) => {
  const body = await readBody(c);
  await guard(c, body);
  const key = authKey(body.authKey);
  const given = normalizeRecoveryCode(text(body.recoveryCode, 64));
  const u = await verify(c, email(body.email), async (u) => safeEqual(await sha256(given), u.recovery_hash));

  const salt = randomToken(16);
  const code = newRecoveryCode();
  const db = c.env.DB;
  await db.batch([
    db
      .prepare('UPDATE users SET pw_hash = ?, pw_salt = ?, recovery_hash = ? WHERE id = ?')
      .bind(await hashAuthKey(key, salt), salt, await sha256(normalizeRecoveryCode(code)), u.id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id),
  ]);
  await startSession(c, u.id);
  return c.json({ recoveryCode: code, me: await loadMe(c.env, u.id) });
});

app.post('/auth/logout', async (c) => {
  const token = getCookie(c, cookieName(c));
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(token)).run();
  deleteCookie(c, cookieName(c), { path: '/', secure: isHttps(c) });
  return c.json({ ok: true });
});

/** The signed-in user behind this request's cookie, if there is one. Renews sessions past half their life. */
async function sessionUser(c: C): Promise<string | null> {
  const token = getCookie(c, cookieName(c));
  if (!token || token.length !== 43) return null;
  const id = await sha256(token);
  const s = await c.env.DB.prepare('SELECT user_id, expires_at FROM sessions WHERE id = ? AND expires_at > ?')
    .bind(id, now())
    .first<{ user_id: string; expires_at: number }>();
  if (!s) return null;
  if (s.expires_at - now() < (SESSION_DAYS / 2) * 86400) {
    await c.env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').bind(now() + SESSION_DAYS * 86400, id).run();
    setCookie(c, cookieName(c), token, { path: '/', httpOnly: true, secure: isHttps(c), sameSite: 'Lax', maxAge: SESSION_DAYS * 86400 });
  }
  return s.user_id;
}

/** Lets the home page find out whether someone is signed in without an error in the console. */
app.get('/session', async (c) => {
  const uid = await sessionUser(c);
  return c.json({ me: uid ? await loadMe(c.env, uid) : null });
});

// Everything below needs a signed-in user.
app.use('*', async (c, next) => {
  const uid = await sessionUser(c);
  if (!uid) fail(401, 'signed_out');
  c.set('uid', uid);
  await next();
});

/** Re-checks the password for anything destructive, with the same lockout as login. */
async function confirmPassword(c: C, key: unknown): Promise<void> {
  const row = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(c.var.uid).first<{ email: string }>();
  if (!row) fail(401, 'signed_out');
  const k = authKey(key);
  await verify(c, row.email, async (u) => safeEqual(await hashAuthKey(k, u.pw_salt), u.pw_hash));
}

app.get('/me', async (c) => c.json(await loadMe(c.env, c.var.uid)));

app.post('/auth/password', async (c) => {
  const body = await readBody(c);
  await throttle(c);
  await confirmPassword(c, body.currentKey);
  const salt = randomToken(16);
  const db = c.env.DB;
  const current = await sha256(getCookie(c, cookieName(c)) ?? '');
  await db.batch([
    db.prepare('UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?').bind(await hashAuthKey(authKey(body.newKey), salt), salt, c.var.uid),
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(c.var.uid, current),
  ]);
  return c.json({ ok: true });
});

app.post('/auth/recovery-code', async (c) => {
  const body = await readBody(c);
  await throttle(c);
  await confirmPassword(c, body.authKey);
  const code = newRecoveryCode();
  await c.env.DB.prepare('UPDATE users SET recovery_hash = ? WHERE id = ?')
    .bind(await sha256(normalizeRecoveryCode(code)), c.var.uid)
    .run();
  return c.json({ recoveryCode: code });
});

app.get('/export', async (c) => {
  const db = c.env.DB;
  const uid = c.var.uid;
  const me = await loadMe(c.env, uid);
  const [entries, windows] = await db.batch([
    db.prepare('SELECT day, start, dur, cat, tag, at FROM entries WHERE user_id = ? ORDER BY day, start').bind(uid),
    db.prepare('SELECT day, start, "end" FROM windows WHERE user_id = ? ORDER BY day, start').bind(uid),
  ]);
  const out = {
    exportedAt: new Date().toISOString(),
    account: { email: me.email, createdAt: new Date(me.createdAt * 1000).toISOString() },
    settings: me.settings,
    categories: me.categories,
    entries: entries.results,
    trackingSessions: windows.results,
    notifications: { pushEnabled: me.pushEnabled },
  };
  c.header('Content-Disposition', `attachment; filename="fifteen-export-${new Date().toISOString().slice(0, 10)}.json"`);
  return c.json(out);
});

app.delete('/account', async (c) => {
  const body = await readBody(c);
  await throttle(c);
  await confirmPassword(c, body.authKey);
  const db = c.env.DB;
  const uid = c.var.uid;
  await db.batch([
    ...['entries', 'windows', 'categories', 'push_subs', 'sessions'].map((t) => db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(uid)),
    db.prepare('DELETE FROM users WHERE id = ?').bind(uid),
  ]);
  deleteCookie(c, cookieName(c), { path: '/', secure: isHttps(c) });
  return c.json({ ok: true });
});

app.put('/settings', async (c) => {
  const prev = await settingsOf(c);
  const next = parseSettings(await readBody(c), prev);
  const db = c.env.DB;
  const uid = c.var.uid;
  const stmts = [db.prepare('UPDATE users SET settings = ? WHERE id = ?').bind(JSON.stringify(next), uid)];
  // Moving the end of the day re-files whatever was logged in the hours that change sides:
  // 01:00 on the 4th becomes 25:00 on the 3rd when the day is stretched to 02:00, and back.
  if (next.rollover > prev.rollover) {
    stmts.push(
      db.prepare("UPDATE entries SET day = date(day, '-1 day'), start = start + 1440 WHERE user_id = ?1 AND start < ?2").bind(uid, next.rollover),
      db.prepare(`UPDATE windows SET day = date(day, '-1 day'), start = start + 1440, "end" = "end" + 1440 WHERE user_id = ?1 AND start < ?2`).bind(uid, next.rollover),
    );
  } else if (next.rollover < prev.rollover) {
    stmts.push(
      db.prepare("UPDATE entries SET day = date(day, '+1 day'), start = start - 1440 WHERE user_id = ?1 AND start >= ?2").bind(uid, 1440 + next.rollover),
      db.prepare(`UPDATE windows SET day = date(day, '+1 day'), start = start - 1440, "end" = "end" - 1440 WHERE user_id = ?1 AND start >= ?2`).bind(uid, 1440 + next.rollover),
    );
  }
  await db.batch(stmts);
  await reschedule(c.env, c.var.uid);
  return c.json(next);
});

// ── The day ─────────────────────────────────────────────────────────────────

app.get('/days', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!isDay(from) || !isDay(to) || to < from || dayAdd(from, LIMITS.rangeDays) < to) fail(400, 'bad_day');
  const db = c.env.DB;
  const [entries, windows] = await db.batch([
    db.prepare('SELECT day, start, dur, cat, tag FROM entries WHERE user_id = ? AND day BETWEEN ? AND ? ORDER BY day, start').bind(c.var.uid, from, to),
    db.prepare('SELECT day, start, "end" FROM windows WHERE user_id = ? AND day BETWEEN ? AND ? ORDER BY day, start').bind(c.var.uid, from, to),
  ]);
  return c.json({ entries: entries.results, windows: windows.results } as unknown as DaysResponse);
});

interface Row {
  start: number;
  dur: number;
  cat: number;
  tag: string | null;
  at: number;
}

/**
 * Logs (or, with `cat: null`, erases) stretches of one day. Whatever was there before is
 * trimmed around the new stretch, so a day never holds two answers for the same minute.
 */
app.put('/entries', async (c) => {
  const body = await readBody(c);
  const db = c.env.DB;
  const uid = c.var.uid;
  const { tz, rollover } = await settingsOf(c);
  const d = day(body.day, tz);
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > LIMITS.itemsPerWrite) fail(400, 'bad_input');

  const owned = await db.prepare('SELECT id FROM categories WHERE user_id = ? AND archived = 0').bind(uid).all<{ id: number }>();
  const cats = new Set(owned.results.map((r) => r.id));
  const items = (body.items as unknown[]).map((raw) => {
    if (!raw || typeof raw !== 'object') fail(400, 'bad_input');
    const it = raw as Record<string, unknown>;
    const start = int(it.start, rollover, rollover + 1435, 5);
    const dur = int(it.dur, 5, rollover + 1440 - start, 5);
    const cat = it.cat === null ? null : int(it.cat, 1, Number.MAX_SAFE_INTEGER);
    if (cat !== null && !cats.has(cat)) fail(400, 'bad_category');
    const tag = it.tag === null || it.tag === undefined ? null : text(it.tag, LIMITS.tagLen, false) || null;
    return { start, dur, cat, tag };
  });

  const existing = await db.prepare('SELECT start, dur, cat, tag, at FROM entries WHERE user_id = ? AND day = ?').bind(uid, d).all<Row>();
  const before = new Map(existing.results.map((r) => [r.start, r]));
  const after = new Map(before);
  const t = now();
  for (const it of items) {
    const a = it.start;
    const b = a + it.dur;
    for (const r of [...after.values()]) {
      const end = r.start + r.dur;
      if (r.start >= b || end <= a) continue;
      after.delete(r.start);
      if (r.start < a) after.set(r.start, { ...r, dur: a - r.start });
      if (end > b) after.set(b, { ...r, start: b, dur: end - b });
    }
    if (it.cat !== null) after.set(a, { start: a, dur: it.dur, cat: it.cat, tag: it.tag, at: t });
  }

  const stmts: D1PreparedStatement[] = [];
  for (const start of before.keys()) {
    if (!after.has(start)) stmts.push(db.prepare('DELETE FROM entries WHERE user_id = ? AND day = ? AND start = ?').bind(uid, d, start));
  }
  for (const r of after.values()) {
    const old = before.get(r.start);
    if (old && old.dur === r.dur && old.cat === r.cat && old.tag === r.tag) continue;
    stmts.push(
      db
        .prepare('INSERT OR REPLACE INTO entries (user_id, day, start, dur, cat, tag, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(uid, d, r.start, r.dur, r.cat, r.tag, r.at),
    );
  }
  if (stmts.length) await db.batch(stmts);

  const entries: Entry[] = [...after.values()].sort((x, y) => x.start - y.start).map((r) => ({ day: d, start: r.start, dur: r.dur, cat: r.cat, tag: r.tag }));
  return c.json({ entries });
});

app.post('/track/start', async (c) => {
  const body = await readBody(c);
  const db = c.env.DB;
  const uid = c.var.uid;
  const { tz, rollover } = await settingsOf(c);
  const d = day(body.day, tz);
  const start = int(body.start, rollover, rollover + 1435, 5);
  const end = int(body.end, start + 5, rollover + 1440, 5);
  const until = int(body.until, now() + 60, now() + 86400);
  const count = await db.prepare('SELECT COUNT(*) AS n FROM windows WHERE user_id = ? AND day = ?').bind(uid, d).first<{ n: number }>();
  if ((count?.n ?? 0) >= 24) fail(400, 'too_many');
  await db.batch([
    db.prepare('INSERT INTO windows (user_id, day, start, "end") VALUES (?, ?, ?, ?)').bind(uid, d, start, end),
    db.prepare('UPDATE users SET track_until = ? WHERE id = ?').bind(until, uid),
  ]);
  await reschedule(c.env, uid);
  return c.json({ trackUntil: until, window: { day: d, start, end } });
});

app.post('/track/stop', async (c) => {
  const body = await readBody(c);
  const db = c.env.DB;
  const uid = c.var.uid;
  const { tz, rollover } = await settingsOf(c);
  const d = day(body.day, tz);
  const end = int(body.end, rollover, rollover + 1440, 5);
  await db.batch([
    db.prepare('UPDATE windows SET "end" = ?1 WHERE user_id = ?2 AND day = ?3 AND start < ?1 AND "end" > ?1').bind(end, uid, d),
    db.prepare('DELETE FROM windows WHERE user_id = ?2 AND day = ?3 AND start >= ?1').bind(end, uid, d),
    db.prepare('UPDATE users SET track_until = NULL WHERE id = ?').bind(uid),
  ]);
  await reschedule(c.env, uid);
  const windows = await db.prepare('SELECT day, start, "end" FROM windows WHERE user_id = ? AND day = ? ORDER BY start').bind(uid, d).all();
  return c.json({ windows: windows.results });
});

// ── Categories ──────────────────────────────────────────────────────────────

const color = (v: unknown): Color => ((COLORS as readonly unknown[]).includes(v) ? (v as Color) : fail(400, 'bad_input'));
const kind = (v: unknown): Kind => ((KINDS as unknown[]).includes(v) ? (v as Kind) : fail(400, 'bad_input'));

app.post('/categories', async (c) => {
  const body = await readBody(c);
  const db = c.env.DB;
  const stats = await db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(pos), -1) AS top FROM categories WHERE user_id = ?').bind(c.var.uid).first<{ n: number; top: number }>();
  if ((stats?.n ?? 0) >= LIMITS.categories) fail(400, 'too_many');
  const cat = { name: text(body.name, LIMITS.nameLen), color: color(body.color), kind: kind(body.kind), pos: (stats?.top ?? -1) + 1 };
  const res = await db
    .prepare('INSERT INTO categories (user_id, name, color, kind, pos) VALUES (?, ?, ?, ?, ?)')
    .bind(c.var.uid, cat.name, cat.color, cat.kind, cat.pos)
    .run();
  return c.json<Category>({ id: res.meta.last_row_id, ...cat, archived: false }, 201);
});

app.put('/categories/order', async (c) => {
  const body = await readBody(c);
  if (!Array.isArray(body.ids) || body.ids.length > LIMITS.categories) fail(400, 'bad_input');
  const ids = body.ids.map((v) => int(v, 1, Number.MAX_SAFE_INTEGER));
  const db = c.env.DB;
  if (ids.length) await db.batch(ids.map((id, i) => db.prepare('UPDATE categories SET pos = ? WHERE id = ? AND user_id = ?').bind(i, id, c.var.uid)));
  return c.json({ ok: true });
});

app.patch('/categories/:id', async (c) => {
  const id = int(Number(c.req.param('id')), 1, Number.MAX_SAFE_INTEGER);
  const body = await readBody(c);
  const db = c.env.DB;
  const cur = await db.prepare('SELECT id, name, color, kind, pos, archived FROM categories WHERE id = ? AND user_id = ?').bind(id, c.var.uid).first<Omit<Category, 'archived'> & { archived: number }>();
  if (!cur) fail(404, 'not_found');
  const next: Category = {
    ...cur,
    name: body.name === undefined ? cur.name : text(body.name, LIMITS.nameLen),
    color: body.color === undefined ? cur.color : color(body.color),
    kind: body.kind === undefined ? cur.kind : kind(body.kind),
    archived: body.archived === undefined ? !!cur.archived : body.archived === true,
  };
  await db
    .prepare('UPDATE categories SET name = ?, color = ?, kind = ?, archived = ? WHERE id = ? AND user_id = ?')
    .bind(next.name, next.color, next.kind, next.archived ? 1 : 0, id, c.var.uid)
    .run();
  return c.json(next);
});

app.delete('/categories/:id', async (c) => {
  const id = int(Number(c.req.param('id')), 1, Number.MAX_SAFE_INTEGER);
  const db = c.env.DB;
  const used = await db.prepare('SELECT 1 FROM entries WHERE user_id = ? AND cat = ? LIMIT 1').bind(c.var.uid, id).first();
  // A category with history is archived instead, so old days keep their colours.
  if (used) await db.prepare('UPDATE categories SET archived = 1 WHERE id = ? AND user_id = ?').bind(id, c.var.uid).run();
  else await db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').bind(id, c.var.uid).run();
  return c.json({ archived: !!used });
});

// ── Notifications ───────────────────────────────────────────────────────────

app.post('/push/subscribe', async (c) => {
  const body = await readBody(c);
  if (!pushConfigured(c.env)) fail(400, 'push_unavailable');
  if (!isPushEndpoint(body.endpoint)) fail(400, 'bad_input');
  const db = c.env.DB;
  const count = await db.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ? AND endpoint != ?').bind(c.var.uid, body.endpoint).first<{ n: number }>();
  if ((count?.n ?? 0) >= LIMITS.pushSubs) fail(400, 'too_many');
  await db
    .prepare('INSERT OR REPLACE INTO push_subs (endpoint, user_id, origin, created_at) VALUES (?, ?, ?, ?)')
    .bind(body.endpoint, c.var.uid, new URL(c.req.url).origin, now())
    .run();
  await reschedule(c.env, c.var.uid);
  return c.json({ ok: true });
});

app.post('/push/unsubscribe', async (c) => {
  const body = await readBody(c);
  if (typeof body.endpoint === 'string') {
    await c.env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').bind(body.endpoint, c.var.uid).run();
  } else {
    await c.env.DB.prepare('DELETE FROM push_subs WHERE user_id = ?').bind(c.var.uid).run();
  }
  await reschedule(c.env, c.var.uid);
  return c.json({ ok: true });
});

/** The service worker calls this when a push arrives, to find out what it should show. */
app.get('/notice', async (c) => {
  const db = c.env.DB;
  const uid = c.var.uid;
  const row = await db.prepare('SELECT notice, settings FROM users WHERE id = ?').bind(uid).first<{ notice: string | null; settings: string }>();
  if (!row?.notice) return c.json({ type: 'none' });
  const s = { ...DEFAULT_SETTINGS, ...(JSON.parse(row.settings) as Partial<Settings>) };
  const [type, stamp] = row.notice.split(':');
  const lp = logicalParts(Number(stamp), s.tz, s.rollover);
  if (type === 'report') return c.json({ type: 'report', day: lp.day });

  // A pulse closes the slot that just ended; right at the end of the day that slot belongs to yesterday.
  const turned = lp.min === s.rollover;
  const end = turned ? s.rollover + 1440 : lp.min;
  const d = turned ? dayAdd(lp.day, -1) : lp.day;
  const start = Math.max(s.rollover, end - s.interval);
  const top = await db
    .prepare(
      `SELECT c.id, c.name FROM categories c
       LEFT JOIN entries e ON e.user_id = c.user_id AND e.cat = c.id AND e.day >= ?2
       WHERE c.user_id = ?1 AND c.archived = 0
       GROUP BY c.id ORDER BY COALESCE(SUM(e.dur), 0) DESC, c.pos LIMIT 2`,
    )
    .bind(uid, dayAdd(d, -14))
    .all<{ id: number; name: string }>();
  return c.json({ type: 'pulse', day: d, start, dur: end - start, label: `${fmtMin(start)}–${fmtMin(end)}`, actions: top.results });
});

export default {
  fetch(request, env, ctx) {
    if (new URL(request.url).pathname.startsWith('/api/')) return app.fetch(request, env, ctx);
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(runCron(env));
  },
} satisfies ExportedHandler<Env>;

export { app };
