import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { cookieOf, createTestApp, fakeKey, type TestApp } from './helpers';
import { countRows, getMe, json, login, TABLES, today, userId } from './util';

let t: TestApp;
let n = 0;
const fresh = (label: string) => `${label.toLowerCase()}${++n}@example.com`;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

afterEach(() => {
  t.env.AUTH_LIMITER = undefined;
  t.env.API_LIMITER = undefined;
  t.env.TURNSTILE_SECRET = undefined;
  t.env.TURNSTILE_SITE_KEY = '';
  t.env.VAPID_PUBLIC_KEY = '';
  t.env.VAPID_PRIVATE_KEY = undefined;
  vi.restoreAllMocks();
});

const rowCounts = async () => Object.fromEntries(await Promise.all(TABLES.map(async (tb) => [tb, await countRows(t, `SELECT COUNT(*) AS n FROM ${tb}`)])));
const blocked = { limit: async () => ({ success: false }) };

describe('origin, content type and body', () => {
  test('rejects a foreign origin', async () => {
    const res = await t.call('POST', '/auth/login', { body: { email: 'a@example.com', authKey: fakeKey('a') }, headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: 'bad_origin' });
  });

  test('rejects a missing origin', async () => {
    const res = await t.call('POST', '/auth/login', { body: { email: 'a@example.com', authKey: fakeKey('a') }, headers: { origin: '' } });
    expect(res.status).toBe(403);
  });

  test('rejects the same host on another scheme or port', async () => {
    for (const origin of ['http://fifteen.test', 'https://fifteen.test:8443', 'null']) {
      const res = await t.call('POST', '/auth/logout', { body: {}, headers: { origin } });
      expect(res.status).toBe(403);
    }
  });

  test('checks the origin on signed-in writes too, before anything changes', async () => {
    const u = await t.signup(fresh('org'));
    const settings = (await getMe(t, u.cookie)).settings;
    const res = await t.call('PUT', '/settings', { cookie: u.cookie, body: { ...settings, theme: 'dark' }, headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    expect((await getMe(t, u.cookie)).settings.theme).toBe('light');
  });

  test('does not require an origin on reads', async () => {
    expect((await t.call('GET', '/config')).status).toBe(200);
  });

  test('rejects a non-JSON content type', async () => {
    const res = await t.call('POST', '/auth/login', { body: '{}', headers: { 'content-type': 'text/plain' } });
    expect(res.status).toBe(415);
    expect(await json(res)).toEqual({ error: 'json_required' });
  });

  test('rejects a body without any content type', async () => {
    const res = await t.call('POST', '/auth/login');
    expect(res.status).toBe(415);
  });

  test('accepts a JSON content type with a charset', async () => {
    const res = await t.call('POST', '/auth/login', { body: JSON.stringify({ email: 'a@example.com', authKey: fakeKey('a') }), headers: { 'content-type': 'application/json; charset=utf-8' } });
    expect(res.status).toBe(401);
  });

  test.each(['{nope', '', '{"a":', "{'a':1}"])('rejects malformed JSON %j', async (raw) => {
    const res = await t.call('POST', '/auth/login', { body: raw });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'bad_json' });
  });

  test.each(['[]', 'null', '42', '"text"'])('rejects JSON that is not an object: %s', async (raw) => {
    const res = await t.call('POST', '/auth/login', { body: raw });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'bad_json' });
  });

  test('rejects a body over 64 KB', async () => {
    const res = await t.call('POST', '/auth/signup', { body: JSON.stringify({ email: 'a@example.com', authKey: fakeKey('a'), pad: 'x'.repeat(65 * 1024) }) });
    expect(res.status).toBe(413);
    expect(await json(res)).toEqual({ error: 'too_large' });
  });

  test('rejects an oversized declared content length', async () => {
    const res = await t.call('POST', '/auth/login', { body: '{}', headers: { 'content-length': String(70 * 1024) } });
    expect(res.status).toBe(413);
  });

  test('accepts a body just under the limit', async () => {
    const res = await t.call('POST', '/auth/login', { body: JSON.stringify({ email: 'a@example.com', authKey: fakeKey('a'), pad: 'x'.repeat(60 * 1024) }) });
    expect(res.status).toBe(401);
  });

  test('answers unknown routes with a JSON 404 when signed in', async () => {
    const u = await t.signup(fresh('nf'));
    const res = await t.call('GET', '/nothing-here', { cookie: u.cookie });
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: 'not_found' });
  });
});

describe('authentication required', () => {
  const routes: Array<[string, string, unknown?]> = [
    ['GET', '/me'],
    ['PUT', '/settings', {}],
    ['POST', '/auth/password', {}],
    ['POST', '/auth/recovery-code', {}],
    ['GET', '/export'],
    ['DELETE', '/account', {}],
    ['GET', `/days?from=${today()}&to=${today()}`],
    ['PUT', '/entries', {}],
    ['POST', '/track/start', {}],
    ['POST', '/track/stop', {}],
    ['POST', '/categories', {}],
    ['PATCH', '/categories/1', {}],
    ['DELETE', '/categories/1', {}],
    ['PUT', '/categories/order', { ids: [] }],
    ['POST', '/push/subscribe', {}],
    ['POST', '/push/unsubscribe', {}],
    ['GET', '/notice'],
  ];

  test.each(routes)('%s %s returns 401 without a cookie', async (method, path, body) => {
    const res = await t.call(method, path, { body });
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: 'signed_out' });
  });

  test('a garbage cookie is refused', async () => {
    for (const cookie of ['__Host-fifteen=garbage', '__Host-fifteen=', `__Host-fifteen=${'A'.repeat(43)}`, `__Host-fifteen=${'A'.repeat(200)}`]) {
      expect((await t.call('GET', '/me', { cookie })).status).toBe(401);
    }
  });

  test('a cookie under the wrong name is ignored', async () => {
    const u = await t.signup(fresh('name'));
    const token = u.cookie.split('=')[1];
    expect((await t.call('GET', '/me', { cookie: `fifteen=${token}` })).status).toBe(401);
  });

  test('a token with one character changed is refused', async () => {
    const u = await t.signup(fresh('forge'));
    const token = u.cookie.split('=')[1];
    const forged = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    expect((await t.call('GET', '/me', { cookie: `__Host-fifteen=${forged}` })).status).toBe(401);
  });

  test('an expired session is refused', async () => {
    const u = await t.signup(fresh('exp'));
    expect((await t.call('GET', '/me', { cookie: u.cookie })).status).toBe(200);
    await t.env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?').bind(Math.floor(Date.now() / 1000) - 10, await userId(t, u.email)).run();
    expect((await t.call('GET', '/me', { cookie: u.cookie })).status).toBe(401);
  });

  test('a session in its second half is renewed and the cookie refreshed', async () => {
    const u = await t.signup(fresh('renew'));
    const id = await userId(t, u.email);
    const soon = Math.floor(Date.now() / 1000) + 3600;
    await t.env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?').bind(soon, id).run();
    const res = await t.call('GET', '/me', { cookie: u.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/^__Host-fifteen=/);
    const row = await t.env.DB.prepare('SELECT expires_at FROM sessions WHERE user_id = ?').bind(id).first<{ expires_at: number }>();
    expect(row!.expires_at).toBeGreaterThan(soon + 86400);
  });

  test('a deleted user session row stops working immediately', async () => {
    const u = await t.signup(fresh('gone'));
    await t.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(await userId(t, u.email)).run();
    expect((await t.call('GET', '/me', { cookie: u.cookie })).status).toBe(401);
  });
});

describe('injection-shaped input', () => {
  const evil = [`'); DROP TABLE users;--`, `' OR '1'='1`, `"; DELETE FROM entries; --`, `Robert'); DROP TABLE categories;--`];

  test('strings in the email are rejected or stored verbatim, and no table is harmed', async () => {
    const before = await rowCounts();
    for (const s of evil) {
      const res = await t.call('POST', '/auth/signup', { body: { email: `${s}@example.com`, authKey: fakeKey('sql'), tz: 'UTC' } });
      expect([201, 400]).toContain(res.status);
    }
    const res = await t.call('POST', '/auth/signup', { body: { email: `x'or'1'='1@example.com`, authKey: fakeKey('sql'), tz: 'UTC' } });
    expect(res.status).toBe(201);
    expect((await json(res)).me.email).toBe(`x'or'1'='1@example.com`);
    const after = await rowCounts();
    expect(after.users).toBe(before.users + 1);
    expect(await countRows(t, 'SELECT COUNT(*) AS n FROM users')).toBe(after.users);
  });

  test('a login with an injection-shaped email does not match other accounts', async () => {
    const u = await t.signup(fresh('victim'));
    const res = await login(t, `x'or'1'='1@example.com`, u.authKey);
    expect(res.status).toBe(401);
  });

  test('a tag with SQL in it is stored as plain text', async () => {
    const u = await t.signup(fresh('tag'));
    const me = await getMe(t, u.cookie);
    const before = await rowCounts();
    const tag = `'); DROP TABLE entries;--`;
    const res = await t.call('PUT', '/entries', { cookie: u.cookie, body: { day: today(), items: [{ start: 0, dur: 5, cat: me.categories[0].id, tag }] } });
    expect(res.status).toBe(200);
    expect((await json(res)).entries[0].tag).toBe(tag);
    const after = await rowCounts();
    expect(after.entries).toBe(before.entries + 1);
    expect(after.users).toBe(before.users);
  });

  test('a category name with SQL in it is stored as plain text', async () => {
    const u = await t.signup(fresh('catsql'));
    const res = await t.call('POST', '/categories', { cookie: u.cookie, body: { name: `x'; DROP TABLE users;--`, color: 'blue', kind: 'focus' } });
    expect(res.status).toBe(201);
    expect((await json(res)).name).toBe(`x'; DROP TABLE users;--`);
    expect(await countRows(t, 'SELECT COUNT(*) AS n FROM users')).toBeGreaterThan(0);
  });

  test('a day with SQL in it is rejected', async () => {
    const u = await t.signup(fresh('daysql'));
    const before = await rowCounts();
    for (const d of [`${today()}' OR '1'='1`, `2024-01-01'; DROP TABLE entries;--`]) {
      const res = await t.call('PUT', '/entries', { cookie: u.cookie, body: { day: d, items: [{ start: 0, dur: 5, cat: null }] } });
      expect(res.status).toBe(400);
    }
    expect(await rowCounts()).toEqual(before);
  });

  test('query parameters with SQL in them are rejected', async () => {
    const u = await t.signup(fresh('qsql'));
    const q = encodeURIComponent(`${today()}' OR '1'='1`);
    expect((await t.call('GET', `/days?from=${q}&to=${today()}`, { cookie: u.cookie })).status).toBe(400);
    expect((await t.call('GET', `/days?from=${today()}&to=${q}`, { cookie: u.cookie })).status).toBe(400);
  });

  test('a category id with SQL in it is rejected', async () => {
    const u = await t.signup(fresh('idsql'));
    const path = encodeURIComponent('1 OR 1=1');
    expect((await t.call('PATCH', `/categories/${path}`, { cookie: u.cookie, body: { name: 'x' } })).status).toBe(400);
    expect((await t.call('DELETE', `/categories/${path}`, { cookie: u.cookie })).status).toBe(400);
  });
});

describe('isolation between users', () => {
  test('using another user category in an entry fails and writes nothing', async () => {
    const a = await t.signup(fresh('isoA'));
    const b = await t.signup(fresh('isoB'));
    const meB = await getMe(t, b.cookie);
    const before = await rowCounts();
    const res = await t.call('PUT', '/entries', { cookie: a.cookie, body: { day: today(), items: [{ start: 540, dur: 30, cat: meB.categories[0].id, tag: null }] } });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'bad_category' });
    expect(await rowCounts()).toEqual(before);
  });

  test('another user cannot rename or archive a category', async () => {
    const a = await t.signup(fresh('patA'));
    const b = await t.signup(fresh('patB'));
    const target = (await getMe(t, b.cookie)).categories[0];
    const res = await t.call('PATCH', `/categories/${target.id}`, { cookie: a.cookie, body: { name: 'Hijacked', archived: true } });
    expect(res.status).toBe(404);
    expect((await getMe(t, b.cookie)).categories[0]).toEqual(target);
  });

  test('another user cannot delete a category', async () => {
    const a = await t.signup(fresh('delA'));
    const b = await t.signup(fresh('delB'));
    const meB = await getMe(t, b.cookie);
    await t.call('DELETE', `/categories/${meB.categories[1].id}`, { cookie: a.cookie });
    expect((await getMe(t, b.cookie)).categories).toEqual(meB.categories);
  });

  test('another user cannot archive a used category by deleting it', async () => {
    const a = await t.signup(fresh('arcA'));
    const b = await t.signup(fresh('arcB'));
    const meB = await getMe(t, b.cookie);
    await t.call('PUT', '/entries', { cookie: b.cookie, body: { day: today(), items: [{ start: 540, dur: 30, cat: meB.categories[0].id, tag: null }] } });
    await t.call('DELETE', `/categories/${meB.categories[0].id}`, { cookie: a.cookie });
    expect((await getMe(t, b.cookie)).categories[0].archived).toBe(false);
  });

  test('reordering with another user ids does not touch their positions', async () => {
    const a = await t.signup(fresh('ordA'));
    const b = await t.signup(fresh('ordB'));
    const meB = await getMe(t, b.cookie);
    const ids = meB.categories.map((c: { id: number }) => c.id).reverse();
    expect((await t.call('PUT', '/categories/order', { cookie: a.cookie, body: { ids } })).status).toBe(200);
    expect((await getMe(t, b.cookie)).categories.map((c: { id: number }) => c.id)).toEqual(meB.categories.map((c: { id: number }) => c.id));
  });

  test('entries written on the same day stay separate, in reads, erases and exports', async () => {
    const a = await t.signup(fresh('entA'));
    const b = await t.signup(fresh('entB'));
    const meA = await getMe(t, a.cookie);
    const meB = await getMe(t, b.cookie);
    await t.call('PUT', '/entries', { cookie: a.cookie, body: { day: today(), items: [{ start: 600, dur: 30, cat: meA.categories[0].id, tag: 'a-tag' }] } });
    await t.call('PUT', '/entries', { cookie: b.cookie, body: { day: today(), items: [{ start: 600, dur: 30, cat: meB.categories[0].id, tag: 'b-tag' }] } });
    await t.call('PUT', '/entries', { cookie: a.cookie, body: { day: today(), items: [{ start: 600, dur: 30, cat: null }] } });

    const daysA = await json(await t.call('GET', `/days?from=${today()}&to=${today()}`, { cookie: a.cookie }));
    const daysB = await json(await t.call('GET', `/days?from=${today()}&to=${today()}`, { cookie: b.cookie }));
    expect(daysA.entries).toEqual([]);
    expect(daysB.entries).toEqual([{ day: today(), start: 600, dur: 30, cat: meB.categories[0].id, tag: 'b-tag' }]);
  });

  test('windows are per user', async () => {
    const a = await t.signup(fresh('winA'));
    const b = await t.signup(fresh('winB'));
    await t.call('POST', '/track/start', { cookie: a.cookie, body: { day: today(), start: 540, end: 600, until: Math.floor(Date.now() / 1000) + 3600 } });
    const days = await json(await t.call('GET', `/days?from=${today()}&to=${today()}`, { cookie: b.cookie }));
    expect(days.windows).toEqual([]);
    await t.call('POST', '/track/stop', { cookie: b.cookie, body: { day: today(), end: 0 } });
    const own = await json(await t.call('GET', `/days?from=${today()}&to=${today()}`, { cookie: a.cookie }));
    expect(own.windows).toHaveLength(1);
  });

  test('push subscriptions are per user', async () => {
    t.env.VAPID_PUBLIC_KEY = 'fake-public';
    t.env.VAPID_PRIVATE_KEY = 'fake-private';
    const a = await t.signup(fresh('pushA'));
    const b = await t.signup(fresh('pushB'));
    await t.call('POST', '/push/subscribe', { cookie: a.cookie, body: { endpoint: 'https://fcm.googleapis.com/fcm/send/iso-a' } });
    await t.call('POST', '/push/unsubscribe', { cookie: b.cookie, body: {} });
    expect((await getMe(t, a.cookie)).pushEnabled).toBe(true);
    expect((await getMe(t, b.cookie)).pushEnabled).toBe(false);
  });
});

describe('rate limiting and bot checks', () => {
  test.each([
    ['/auth/signup', { email: 'rl@example.com', authKey: fakeKey('rl'), tz: 'UTC' }],
    ['/auth/login', { email: 'rl@example.com', authKey: fakeKey('rl') }],
    ['/auth/recover', { email: 'rl@example.com', recoveryCode: 'AAAAA-AAAAA-AAAAA-AAAAA', authKey: fakeKey('rl') }],
  ])('the auth limiter blocks %s', async (path, body) => {
    t.env.AUTH_LIMITER = blocked;
    const res = await t.call('POST', path, { body });
    expect(res.status).toBe(429);
    expect(await json(res)).toEqual({ error: 'slow_down' });
  });

  test('the auth limiter also guards password confirmation endpoints', async () => {
    const u = await t.signup(fresh('rlpw'));
    t.env.AUTH_LIMITER = blocked;
    for (const [method, path, body] of [
      ['POST', '/auth/password', { currentKey: u.authKey, newKey: fakeKey('n') }],
      ['POST', '/auth/recovery-code', { authKey: u.authKey }],
      ['DELETE', '/account', { authKey: u.authKey }],
    ] as const) {
      expect((await t.call(method, path, { cookie: u.cookie, body })).status).toBe(429);
    }
    t.env.AUTH_LIMITER = undefined;
    expect(await countRows(t, 'SELECT COUNT(*) AS n FROM users WHERE email = ?', u.email)).toBe(1);
  });

  test('the api limiter blocks every route', async () => {
    const u = await t.signup(fresh('rlapi'));
    t.env.API_LIMITER = blocked;
    expect((await t.call('GET', '/config')).status).toBe(429);
    expect((await t.call('GET', '/me', { cookie: u.cookie })).status).toBe(429);
  });

  test('a limiter that allows the request lets it through', async () => {
    t.env.AUTH_LIMITER = { limit: async () => ({ success: true }) };
    t.env.API_LIMITER = { limit: async () => ({ success: true }) };
    expect((await t.call('GET', '/config')).status).toBe(200);
    expect((await t.call('POST', '/auth/signup', { body: { email: fresh('ok'), authKey: fakeKey('ok'), tz: 'UTC' } })).status).toBe(201);
  });

  test.each([
    ['/auth/signup', () => ({ email: fresh('hp'), authKey: fakeKey('hp'), tz: 'UTC' })],
    ['/auth/login', () => ({ email: 'hp@example.com', authKey: fakeKey('hp') })],
    ['/auth/recover', () => ({ email: 'hp@example.com', recoveryCode: 'AAAAA-AAAAA-AAAAA-AAAAA', authKey: fakeKey('hp') })],
  ])('a filled honeypot is rejected on %s', async (path, make) => {
    const before = await rowCounts();
    const res = await t.call('POST', path, { body: { ...make(), website: 'https://spam.example' } });
    expect(res.status).toBe(400);
    expect(await rowCounts()).toEqual(before);
  });

  test('an empty honeypot is fine', async () => {
    const res = await t.call('POST', '/auth/signup', { body: { email: fresh('hp'), authKey: fakeKey('hp'), tz: 'UTC', website: '' } });
    expect(res.status).toBe(201);
  });

  test('turnstile is enforced on signup, login and recover when both keys are set', async () => {
    t.env.TURNSTILE_SECRET = 'fake-secret';
    t.env.TURNSTILE_SITE_KEY = 'fake-site-key';
    const before = await rowCounts();
    for (const [path, body] of [
      ['/auth/signup', { email: fresh('ts'), authKey: fakeKey('ts'), tz: 'UTC' }],
      ['/auth/login', { email: 'ts@example.com', authKey: fakeKey('ts') }],
      ['/auth/recover', { email: 'ts@example.com', recoveryCode: 'AAAAA-AAAAA-AAAAA-AAAAA', authKey: fakeKey('ts') }],
    ] as const) {
      const res = await t.call('POST', path, { body });
      expect(res.status).toBe(400);
      expect(await json(res)).toEqual({ error: 'challenge_failed' });
    }
    expect((await t.call('POST', '/auth/login', { body: { email: 'ts@example.com', authKey: fakeKey('ts'), turnstile: '' } })).status).toBe(400);
    expect((await t.call('POST', '/auth/login', { body: { email: 'ts@example.com', authKey: fakeKey('ts'), turnstile: 5 } })).status).toBe(400);
    expect(await rowCounts()).toEqual(before);
  });

  test('turnstile accepts a token the verifier approves and refuses one it does not', async () => {
    t.env.TURNSTILE_SECRET = 'fake-secret';
    t.env.TURNSTILE_SITE_KEY = 'fake-site-key';
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ success: true })).mockResolvedValueOnce(Response.json({ success: false }));
    const ok = await t.call('POST', '/auth/signup', { body: { email: fresh('ts'), authKey: fakeKey('ts'), tz: 'UTC', turnstile: 'fake-token' } });
    expect(ok.status).toBe(201);
    const no = await t.call('POST', '/auth/signup', { body: { email: fresh('ts'), authKey: fakeKey('ts'), tz: 'UTC', turnstile: 'fake-token' } });
    expect(no.status).toBe(400);
    expect(await json(no)).toEqual({ error: 'challenge_failed' });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test('turnstile is not enforced when only one key is set', async () => {
    t.env.TURNSTILE_SECRET = 'fake-secret';
    t.env.TURNSTILE_SITE_KEY = '';
    expect((await t.call('POST', '/auth/signup', { body: { email: fresh('ts'), authKey: fakeKey('ts'), tz: 'UTC' } })).status).toBe(201);
    t.env.TURNSTILE_SECRET = undefined;
    t.env.TURNSTILE_SITE_KEY = 'fake-site-key';
    expect((await t.call('POST', '/auth/signup', { body: { email: fresh('ts'), authKey: fakeKey('ts'), tz: 'UTC' } })).status).toBe(201);
  });

  test('the public config exposes the site key only when turnstile is on', async () => {
    expect(await json(await t.call('GET', '/config'))).toEqual({ turnstileSiteKey: '', vapidPublicKey: '' });
    t.env.TURNSTILE_SECRET = 'fake-secret';
    t.env.TURNSTILE_SITE_KEY = 'fake-site-key';
    t.env.VAPID_PUBLIC_KEY = 'fake-public';
    t.env.VAPID_PRIVATE_KEY = 'fake-private';
    expect(await json(await t.call('GET', '/config'))).toEqual({ turnstileSiteKey: 'fake-site-key', vapidPublicKey: 'fake-public' });
  });
});

describe('push endpoints', () => {
  const sub = (cookie: string, endpoint: unknown) => t.call('POST', '/push/subscribe', { cookie, body: { endpoint } });

  test('subscribing is refused while push is not configured', async () => {
    const u = await t.signup(fresh('np'));
    const res = await sub(u.cookie, 'https://fcm.googleapis.com/fcm/send/abc');
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'push_unavailable' });
  });

  test('accepts real push service hosts once configured', async () => {
    t.env.VAPID_PUBLIC_KEY = 'fake-public';
    t.env.VAPID_PRIVATE_KEY = 'fake-private';
    const u = await t.signup(fresh('push'));
    for (const e of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/abc',
      'https://wns2-par02p.notify.windows.com/w/abc',
    ]) {
      expect((await sub(u.cookie, e)).status).toBe(200);
    }
    expect((await getMe(t, u.cookie)).pushEnabled).toBe(true);
  });

  test.each([
    'https://evil.example/x',
    'https://fcm.googleapis.com.evil.example/x',
    'https://evilfcm.googleapis.com.example/x',
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    'https://user@fcm.googleapis.com/fcm/send/abc',
    'https://evil.example/?https://fcm.googleapis.com/',
    'not a url',
    '',
  ])('rejects the endpoint %j', async (endpoint) => {
    t.env.VAPID_PUBLIC_KEY = 'fake-public';
    t.env.VAPID_PRIVATE_KEY = 'fake-private';
    const u = await t.signup(fresh('badep'));
    const res = await sub(u.cookie, endpoint);
    expect(res.status).toBe(400);
    expect(await countRows(t, 'SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?', await userId(t, u.email))).toBe(0);
  });

  test('rejects an endpoint that is not a string or is too long', async () => {
    t.env.VAPID_PUBLIC_KEY = 'fake-public';
    t.env.VAPID_PRIVATE_KEY = 'fake-private';
    const u = await t.signup(fresh('badep2'));
    expect((await sub(u.cookie, 12)).status).toBe(400);
    expect((await sub(u.cookie, { a: 1 })).status).toBe(400);
    expect((await sub(u.cookie, `https://fcm.googleapis.com/${'a'.repeat(1001)}`)).status).toBe(400);
  });

  test('caps the number of subscriptions per user at five', async () => {
    t.env.VAPID_PUBLIC_KEY = 'fake-public';
    t.env.VAPID_PRIVATE_KEY = 'fake-private';
    const u = await t.signup(fresh('cap'));
    for (let i = 0; i < 5; i++) expect((await sub(u.cookie, `https://fcm.googleapis.com/fcm/send/cap${i}`)).status).toBe(200);
    const res = await sub(u.cookie, 'https://fcm.googleapis.com/fcm/send/cap5');
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'too_many' });
    expect((await sub(u.cookie, 'https://fcm.googleapis.com/fcm/send/cap0')).status).toBe(200);
  });

  test('unsubscribing removes one endpoint or all of them', async () => {
    t.env.VAPID_PUBLIC_KEY = 'fake-public';
    t.env.VAPID_PRIVATE_KEY = 'fake-private';
    const u = await t.signup(fresh('unsub'));
    const id = await userId(t, u.email);
    await sub(u.cookie, 'https://fcm.googleapis.com/fcm/send/u1');
    await sub(u.cookie, 'https://fcm.googleapis.com/fcm/send/u2');
    await t.call('POST', '/push/unsubscribe', { cookie: u.cookie, body: { endpoint: 'https://fcm.googleapis.com/fcm/send/u1' } });
    expect(await countRows(t, 'SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?', id)).toBe(1);
    await t.call('POST', '/push/unsubscribe', { cookie: u.cookie, body: {} });
    expect(await countRows(t, 'SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?', id)).toBe(0);
  });

  test('the notice endpoint says there is nothing to show by default', async () => {
    const u = await t.signup(fresh('notice'));
    expect(await json(await t.call('GET', '/notice', { cookie: u.cookie }))).toEqual({ type: 'none' });
  });
});

describe('response headers and secrets', () => {
  test('API responses are not cacheable and carry hardening headers', async () => {
    const u = await t.signup(fresh('hdr'));
    for (const res of [await t.call('GET', '/config'), await t.call('GET', '/me', { cookie: u.cookie }), await t.call('GET', '/me'), await t.call('POST', '/auth/login', { body: '{}' })]) {
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    }
  });

  test('no response ever contains the stored hashes or salt', async () => {
    const email = fresh('leak');
    const signup = await t.call('POST', '/auth/signup', { body: { email, authKey: fakeKey('leak'), tz: 'UTC' } });
    const cookie = cookieOf(signup);
    const bodies = [await signup.text()];
    bodies.push(await (await login(t, email, fakeKey('leak'))).text());
    bodies.push(await (await t.call('GET', '/me', { cookie })).text());
    bodies.push(await (await t.call('GET', '/export', { cookie })).text());
    bodies.push(await (await t.call('POST', '/auth/recovery-code', { cookie, body: { authKey: fakeKey('leak') } })).text());

    const row = await t.env.DB.prepare('SELECT pw_hash, pw_salt, recovery_hash FROM users WHERE email = ?').bind(email).first<Record<string, string>>();
    const secrets = Object.values(row!);
    expect(secrets.every((s) => s.length > 10)).toBe(true);
    for (const body of bodies) {
      for (const s of secrets) expect(body).not.toContain(s);
      expect(body).not.toMatch(/pw_hash|pw_salt|recovery_hash|failed_logins|locked_until/);
      expect(body).not.toContain(fakeKey('leak'));
    }
  });

  test('the stored hash is not the auth key and the salt differs per user', async () => {
    const a = await t.signup(fresh('saltA'));
    const b = await t.signup(fresh('saltB'));
    const rows = await t.env.DB.prepare('SELECT email, pw_hash, pw_salt FROM users WHERE email IN (?, ?)').bind(a.email, b.email).all<{ pw_hash: string; pw_salt: string }>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results[0].pw_salt).not.toBe(rows.results[1].pw_salt);
    expect(rows.results[0].pw_hash).not.toBe(rows.results[1].pw_hash);
    for (const r of rows.results) {
      expect(r.pw_hash).not.toBe(a.authKey);
      expect(r.pw_hash).not.toBe(b.authKey);
    }
  });

  test('the recovery code is only stored hashed', async () => {
    const u = await t.signup(fresh('rcstore'));
    const row = await t.env.DB.prepare('SELECT recovery_hash FROM users WHERE email = ?').bind(u.email).first<{ recovery_hash: string }>();
    expect(row!.recovery_hash).not.toContain(u.recoveryCode.replace(/-/g, ''));
    expect(row!.recovery_hash).not.toBe(u.recoveryCode);
  });
});

describe('input limits', () => {
  test('strips control characters from tags', async () => {
    const u = await t.signup(fresh('ctl'));
    const me = await getMe(t, u.cookie);
    const res = await t.call('PUT', '/entries', { cookie: u.cookie, body: { day: today(), items: [{ start: 0, dur: 5, cat: me.categories[0].id, tag: `  a\u0000b\u0007\nc d\u007fe  \t f ` }] } });
    expect(res.status).toBe(200);
    expect((await json(res)).entries[0].tag).toBe('a b c d e f');
  });

  test('strips control characters from category names', async () => {
    const u = await t.signup(fresh('ctlname'));
    const res = await t.call('POST', '/categories', { cookie: u.cookie, body: { name: `Re\u0000ading\n\tlist`, color: 'teal', kind: 'neutral' } });
    expect(res.status).toBe(201);
    expect((await json(res)).name).toBe('Re ading list');
  });

  test('a name made only of control characters is rejected', async () => {
    const u = await t.signup(fresh('ctlempty'));
    const res = await t.call('POST', '/categories', { cookie: u.cookie, body: { name: '\u0000\n\t ', color: 'teal', kind: 'neutral' } });
    expect(res.status).toBe(400);
  });

  test('a tag of only control characters is stored as no tag', async () => {
    const u = await t.signup(fresh('ctltag'));
    const me = await getMe(t, u.cookie);
    const res = await t.call('PUT', '/entries', { cookie: u.cookie, body: { day: today(), items: [{ start: 0, dur: 5, cat: me.categories[0].id, tag: '\n\t' }] } });
    expect((await json(res)).entries[0].tag).toBeNull();
  });

  test('accepts a tag of 40 characters and rejects 41', async () => {
    const u = await t.signup(fresh('taglen'));
    const me = await getMe(t, u.cookie);
    const put = (tag: string) => t.call('PUT', '/entries', { cookie: u.cookie, body: { day: today(), items: [{ start: 0, dur: 5, cat: me.categories[0].id, tag }] } });
    expect((await put('x'.repeat(40))).status).toBe(200);
    expect((await put('x'.repeat(41))).status).toBe(400);
  });

  test('accepts a category name of 28 characters and rejects 29', async () => {
    const u = await t.signup(fresh('namelen'));
    const make = (name: string) => t.call('POST', '/categories', { cookie: u.cookie, body: { name, color: 'blue', kind: 'focus' } });
    expect((await make('n'.repeat(28))).status).toBe(201);
    expect((await make('n'.repeat(29))).status).toBe(400);
  });

  test('enforces the cap of 40 categories', async () => {
    const u = await t.signup(fresh('cap'));
    for (let i = 0; i < 34; i++) {
      const res = await t.call('POST', '/categories', { cookie: u.cookie, body: { name: `extra ${i}`, color: 'blue', kind: 'neutral' } });
      expect(res.status).toBe(201);
    }
    const res = await t.call('POST', '/categories', { cookie: u.cookie, body: { name: 'one too many', color: 'blue', kind: 'neutral' } });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'too_many' });
    expect((await getMe(t, u.cookie)).categories).toHaveLength(40);
  });
});
