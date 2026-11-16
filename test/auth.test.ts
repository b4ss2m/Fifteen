import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { cookieOf, createTestApp, fakeKey, type TestApp } from './helpers';
import { countRows, getMe, json, login, today, userId } from './util';

let t: TestApp;
let n = 0;
const fresh = (label: string) => `${label.toLowerCase()}${++n}@example.com`;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('session probe', () => {
  test('answers 200 with null when signed out and with the account when signed in', async () => {
    const out = await t.call('GET', '/session');
    expect(out.status).toBe(200);
    expect(await out.json()).toEqual({ me: null });
    const u = await t.signup(fresh('probe'));
    const body = (await (await t.call('GET', '/session', { cookie: u.cookie })).json()) as { me: { email: string } };
    expect(body.me.email).toBe(u.email);
    expect(JSON.stringify(body)).not.toMatch(/pw_|hash|salt/);
  });
});

describe('signup', () => {
  test('creates the account with six default categories', async () => {
    const res = await t.call('POST', '/auth/signup', { body: { email: fresh('a'), authKey: fakeKey('a'), tz: 'Asia/Tokyo' } });
    expect(res.status).toBe(201);
    const data = await json(res);
    expect(data.me.categories.map((c: { name: string }) => c.name)).toEqual(['Deep Work', 'Admin', 'Health', 'Wasted', 'Personal', 'Sleep']);
    expect(data.me.categories.map((c: { pos: number }) => c.pos)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(data.me.categories.every((c: { archived: boolean }) => c.archived === false)).toBe(true);
  });

  test('saves the time zone from the browser in settings', async () => {
    const res = await t.call('POST', '/auth/signup', { body: { email: fresh('tz'), authKey: fakeKey('tz'), tz: 'America/New_York' } });
    expect((await json(res)).me.settings.tz).toBe('America/New_York');
  });

  test('falls back to UTC for an unknown time zone', async () => {
    const res = await t.call('POST', '/auth/signup', { body: { email: fresh('tz'), authKey: fakeKey('tz'), tz: 'Mars/Olympus' } });
    expect(res.status).toBe(201);
    expect((await json(res)).me.settings.tz).toBe('UTC');
  });

  test('returns a recovery code in the documented format', async () => {
    const res = await t.call('POST', '/auth/signup', { body: { email: fresh('rc'), authKey: fakeKey('rc'), tz: 'UTC' } });
    expect((await json(res)).recoveryCode).toMatch(/^[2-9A-Z]{5}(-[2-9A-Z]{5}){3}$/);
  });

  test('normalises the email to lower case and trims it', async () => {
    const email = fresh('case');
    const res = await t.call('POST', '/auth/signup', { body: { email: `  ${email.toUpperCase()} `, authKey: fakeKey('case'), tz: 'UTC' } });
    expect(res.status).toBe(201);
    expect((await json(res)).me.email).toBe(email);
    expect((await login(t, email, fakeKey('case'))).status).toBe(200);
  });

  test('rejects a duplicate email, even in another case', async () => {
    const u = await t.signup(fresh('dup'));
    const res = await t.call('POST', '/auth/signup', { body: { email: u.email.toUpperCase(), authKey: fakeKey('other'), tz: 'UTC' } });
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ error: 'email_taken' });
  });

  test.each(['', 'nope', 'a@b', 'a b@example.com', 'x@y.z', 'a@@example.com'])('rejects the bad email %j', async (bad) => {
    const res = await t.call('POST', '/auth/signup', { body: { email: bad, authKey: fakeKey('x'), tz: 'UTC' } });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'bad_email' });
  });

  test('rejects a non-string email', async () => {
    const res = await t.call('POST', '/auth/signup', { body: { email: 42, authKey: fakeKey('x'), tz: 'UTC' } });
    expect(res.status).toBe(400);
  });

  test.each([
    ['too short', 'abc'],
    ['42 chars', 'A'.repeat(42)],
    ['44 chars', 'A'.repeat(44)],
    ['bad alphabet', `${'A'.repeat(42)}+`],
    ['padding', `${'A'.repeat(42)}=`],
  ])('rejects an auth key that is %s', async (_label, key) => {
    const res = await t.call('POST', '/auth/signup', { body: { email: fresh('k'), authKey: key, tz: 'UTC' } });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'bad_input' });
  });

  test('rejects a missing auth key', async () => {
    const res = await t.call('POST', '/auth/signup', { body: { email: fresh('k'), tz: 'UTC' } });
    expect(res.status).toBe(400);
  });

  test('signs the new user in', async () => {
    const u = await t.signup(fresh('in'));
    const me = await getMe(t, u.cookie);
    expect(me.email).toBe(u.email);
    expect(me.trackUntil).toBeNull();
    expect(me.pushEnabled).toBe(false);
  });
});

describe('login', () => {
  test('accepts the right key and sets a session cookie', async () => {
    const u = await t.signup(fresh('login'));
    const res = await login(t, u.email, u.authKey);
    expect(res.status).toBe(200);
    expect((await json(res)).me.email).toBe(u.email);
    const cookie = cookieOf(res);
    expect((await t.call('GET', '/me', { cookie })).status).toBe(200);
  });

  test('refuses a wrong key', async () => {
    const u = await t.signup(fresh('wrong'));
    const res = await login(t, u.email, fakeKey('nope'));
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: 'bad_credentials' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  test('gives the same answer for an unknown email and a wrong key', async () => {
    const u = await t.signup(fresh('same'));
    const wrong = await login(t, u.email, fakeKey('nope'));
    const unknown = await login(t, fresh('ghost'), fakeKey('nope'));
    expect(unknown.status).toBe(wrong.status);
    expect(await json(unknown)).toEqual(await json(wrong));
  });

  test('is not case sensitive about the email', async () => {
    const u = await t.signup(fresh('mixed'));
    expect((await login(t, u.email.toUpperCase(), u.authKey)).status).toBe(200);
  });

  test('rejects a malformed auth key before checking credentials', async () => {
    const u = await t.signup(fresh('mal'));
    expect((await login(t, u.email, 'short')).status).toBe(400);
  });

  test('locks the account after 8 wrong keys and refuses even the right one', async () => {
    const u = await t.signup(fresh('lock'));
    for (let i = 0; i < 8; i++) {
      expect((await login(t, u.email, fakeKey(`bad${i}`))).status).toBe(401);
    }
    const locked = await login(t, u.email, fakeKey('bad-again'));
    expect(locked.status).toBe(429);
    expect(await json(locked)).toEqual({ error: 'locked' });
    const right = await login(t, u.email, u.authKey);
    expect(right.status).toBe(429);
    expect(right.headers.get('set-cookie')).toBeNull();
  });

  test('lets the user in again once the lock has expired', async () => {
    const u = await t.signup(fresh('unlock'));
    for (let i = 0; i < 8; i++) await login(t, u.email, fakeKey(`bad${i}`));
    expect((await login(t, u.email, u.authKey)).status).toBe(429);
    await t.env.DB.prepare('UPDATE users SET locked_until = ? WHERE email = ?').bind(Math.floor(Date.now() / 1000) - 1, u.email).run();
    expect((await login(t, u.email, u.authKey)).status).toBe(200);
  });

  test('a successful login resets the failure counter', async () => {
    const u = await t.signup(fresh('reset'));
    for (let i = 0; i < 7; i++) await login(t, u.email, fakeKey(`bad${i}`));
    expect((await login(t, u.email, u.authKey)).status).toBe(200);
    for (let i = 0; i < 7; i++) expect((await login(t, u.email, fakeKey(`worse${i}`))).status).toBe(401);
    expect((await login(t, u.email, u.authKey)).status).toBe(200);
  });
});

describe('logout', () => {
  test('invalidates the cookie and clears it', async () => {
    const u = await t.signup(fresh('out'));
    const res = await t.call('POST', '/auth/logout', { cookie: u.cookie, body: {} });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
    expect((await t.call('GET', '/me', { cookie: u.cookie })).status).toBe(401);
  });

  test('only ends the session it was called with', async () => {
    const u = await t.signup(fresh('two'));
    const other = cookieOf(await login(t, u.email, u.authKey));
    await t.call('POST', '/auth/logout', { cookie: u.cookie, body: {} });
    expect((await t.call('GET', '/me', { cookie: other })).status).toBe(200);
  });

  test('works without a cookie', async () => {
    expect((await t.call('POST', '/auth/logout', { body: {} })).status).toBe(200);
  });
});

describe('recovery', () => {
  test('sets a new password, issues a new code and kills the old state', async () => {
    const u = await t.signup(fresh('rec'));
    const second = cookieOf(await login(t, u.email, u.authKey));
    const newKey = fakeKey('brand-new');
    const res = await t.call('POST', '/auth/recover', { body: { email: u.email, recoveryCode: u.recoveryCode, authKey: newKey } });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.recoveryCode).toMatch(/^[2-9A-Z]{5}(-[2-9A-Z]{5}){3}$/);
    expect(data.recoveryCode).not.toBe(u.recoveryCode);
    const fresh1 = cookieOf(res);

    expect((await t.call('GET', '/me', { cookie: u.cookie })).status).toBe(401);
    expect((await t.call('GET', '/me', { cookie: second })).status).toBe(401);
    expect((await t.call('GET', '/me', { cookie: fresh1 })).status).toBe(200);

    expect((await login(t, u.email, u.authKey)).status).toBe(401);
    expect((await login(t, u.email, newKey)).status).toBe(200);

    const reuse = await t.call('POST', '/auth/recover', { body: { email: u.email, recoveryCode: u.recoveryCode, authKey: fakeKey('again') } });
    expect(reuse.status).toBe(401);

    const again = await t.call('POST', '/auth/recover', { body: { email: u.email, recoveryCode: data.recoveryCode, authKey: fakeKey('again') } });
    expect(again.status).toBe(200);
  });

  test('accepts the code in lower case and without dashes', async () => {
    const u = await t.signup(fresh('norm'));
    const code = u.recoveryCode.replace(/-/g, '').toLowerCase();
    const res = await t.call('POST', '/auth/recover', { body: { email: u.email, recoveryCode: code, authKey: fakeKey('n') } });
    expect(res.status).toBe(200);
  });

  test('refuses a wrong code', async () => {
    const u = await t.signup(fresh('badrec'));
    const res = await t.call('POST', '/auth/recover', { body: { email: u.email, recoveryCode: 'AAAAA-AAAAA-AAAAA-AAAAA', authKey: fakeKey('n') } });
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: 'bad_credentials' });
    expect((await login(t, u.email, u.authKey)).status).toBe(200);
  });

  test('gives the same answer for an unknown email', async () => {
    const res = await t.call('POST', '/auth/recover', { body: { email: fresh('ghost'), recoveryCode: 'AAAAA-AAAAA-AAAAA-AAAAA', authKey: fakeKey('n') } });
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: 'bad_credentials' });
  });

  test('locks the account after repeated wrong codes', async () => {
    const u = await t.signup(fresh('reclock'));
    for (let i = 0; i < 8; i++) {
      await t.call('POST', '/auth/recover', { body: { email: u.email, recoveryCode: 'AAAAA-AAAAA-AAAAA-AAAAA', authKey: fakeKey('n') } });
    }
    const res = await t.call('POST', '/auth/recover', { body: { email: u.email, recoveryCode: u.recoveryCode, authKey: fakeKey('n') } });
    expect(res.status).toBe(429);
  });
});

describe('password change', () => {
  test('keeps the current session and ends the others', async () => {
    const u = await t.signup(fresh('pw'));
    const other = cookieOf(await login(t, u.email, u.authKey));
    const newKey = fakeKey('changed');
    const res = await t.call('POST', '/auth/password', { cookie: u.cookie, body: { currentKey: u.authKey, newKey } });
    expect(res.status).toBe(200);
    expect((await t.call('GET', '/me', { cookie: u.cookie })).status).toBe(200);
    expect((await t.call('GET', '/me', { cookie: other })).status).toBe(401);
    expect((await login(t, u.email, u.authKey)).status).toBe(401);
    expect((await login(t, u.email, newKey)).status).toBe(200);
  });

  test('requires the current password', async () => {
    const u = await t.signup(fresh('pwbad'));
    const res = await t.call('POST', '/auth/password', { cookie: u.cookie, body: { currentKey: fakeKey('wrong'), newKey: fakeKey('x') } });
    expect(res.status).toBe(401);
    expect((await login(t, u.email, u.authKey)).status).toBe(200);
  });

  test('rejects a malformed new key and leaves the password alone', async () => {
    const u = await t.signup(fresh('pwmal'));
    const res = await t.call('POST', '/auth/password', { cookie: u.cookie, body: { currentKey: u.authKey, newKey: 'short' } });
    expect(res.status).toBe(400);
    expect((await login(t, u.email, u.authKey)).status).toBe(200);
  });

  test('counts wrong current keys towards the lockout', async () => {
    const u = await t.signup(fresh('pwlock'));
    for (let i = 0; i < 8; i++) {
      await t.call('POST', '/auth/password', { cookie: u.cookie, body: { currentKey: fakeKey(`w${i}`), newKey: fakeKey('x') } });
    }
    const res = await t.call('POST', '/auth/password', { cookie: u.cookie, body: { currentKey: u.authKey, newKey: fakeKey('x') } });
    expect(res.status).toBe(429);
  });
});

describe('recovery code regeneration', () => {
  test('issues a new code and retires the old one', async () => {
    const u = await t.signup(fresh('regen'));
    const res = await t.call('POST', '/auth/recovery-code', { cookie: u.cookie, body: { authKey: u.authKey } });
    expect(res.status).toBe(200);
    const { recoveryCode } = await json(res);
    expect(recoveryCode).toMatch(/^[2-9A-Z]{5}(-[2-9A-Z]{5}){3}$/);
    expect(recoveryCode).not.toBe(u.recoveryCode);
    const old = await t.call('POST', '/auth/recover', { body: { email: u.email, recoveryCode: u.recoveryCode, authKey: fakeKey('n') } });
    expect(old.status).toBe(401);
    const fresh2 = await t.call('POST', '/auth/recover', { body: { email: u.email, recoveryCode, authKey: fakeKey('n') } });
    expect(fresh2.status).toBe(200);
  });

  test('requires the password', async () => {
    const u = await t.signup(fresh('regenbad'));
    const res = await t.call('POST', '/auth/recovery-code', { cookie: u.cookie, body: { authKey: fakeKey('wrong') } });
    expect(res.status).toBe(401);
    const missing = await t.call('POST', '/auth/recovery-code', { cookie: u.cookie, body: {} });
    expect(missing.status).toBe(400);
    const ok = await t.call('POST', '/auth/recover', { body: { email: u.email, recoveryCode: u.recoveryCode, authKey: fakeKey('n') } });
    expect(ok.status).toBe(200);
  });
});

describe('account deletion', () => {
  async function populate(email: string, tag: string) {
    const u = await t.signup(email);
    const me = await getMe(t, u.cookie);
    await t.call('PUT', '/entries', { cookie: u.cookie, body: { day: today(), items: [{ start: 540, dur: 30, cat: me.categories[0].id, tag }] } });
    await t.call('POST', '/track/start', { cookie: u.cookie, body: { day: today(), start: 540, end: 600, until: Math.floor(Date.now() / 1000) + 3600 } });
    const id = await userId(t, email);
    await t.env.DB.prepare('INSERT INTO push_subs (endpoint, user_id, origin, created_at) VALUES (?, ?, ?, ?)')
      .bind(`https://fcm.googleapis.com/fcm/send/${tag}`, id, 'https://fifteen.test', 1)
      .run();
    return { ...u, id };
  }

  const rowsFor = async (id: string) => ({
    users: await countRows(t, 'SELECT COUNT(*) AS n FROM users WHERE id = ?', id),
    sessions: await countRows(t, 'SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', id),
    categories: await countRows(t, 'SELECT COUNT(*) AS n FROM categories WHERE user_id = ?', id),
    entries: await countRows(t, 'SELECT COUNT(*) AS n FROM entries WHERE user_id = ?', id),
    windows: await countRows(t, 'SELECT COUNT(*) AS n FROM windows WHERE user_id = ?', id),
    push_subs: await countRows(t, 'SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?', id),
  });

  test('removes every row of the user and nothing of anyone else', async () => {
    const a = await populate(fresh('delA'), 'alpha');
    const b = await populate(fresh('delB'), 'beta');
    const bBefore = await rowsFor(b.id);
    expect(await rowsFor(a.id)).toEqual({ users: 1, sessions: 1, categories: 6, entries: 1, windows: 1, push_subs: 1 });

    const res = await t.call('DELETE', '/account', { cookie: a.cookie, body: { authKey: a.authKey } });
    expect(res.status).toBe(200);

    expect(await rowsFor(a.id)).toEqual({ users: 0, sessions: 0, categories: 0, entries: 0, windows: 0, push_subs: 0 });
    expect(await rowsFor(b.id)).toEqual(bBefore);
    expect((await t.call('GET', '/me', { cookie: a.cookie })).status).toBe(401);
    expect((await login(t, a.email, a.authKey)).status).toBe(401);
    expect((await t.call('GET', '/me', { cookie: b.cookie })).status).toBe(200);
  });

  test('requires the password', async () => {
    const a = await populate(fresh('delpw'), 'gamma');
    const res = await t.call('DELETE', '/account', { cookie: a.cookie, body: { authKey: fakeKey('wrong') } });
    expect(res.status).toBe(401);
    expect(await rowsFor(a.id)).toMatchObject({ users: 1, entries: 1 });
    expect((await t.call('DELETE', '/account', { cookie: a.cookie, body: {} })).status).toBe(400);
    expect(await rowsFor(a.id)).toMatchObject({ users: 1, entries: 1 });
  });

  test('frees the email for a new signup', async () => {
    const a = await t.signup(fresh('delre'));
    await t.call('DELETE', '/account', { cookie: a.cookie, body: { authKey: a.authKey } });
    const res = await t.call('POST', '/auth/signup', { body: { email: a.email, authKey: fakeKey('again'), tz: 'UTC' } });
    expect(res.status).toBe(201);
  });
});

describe('export', () => {
  test('contains the user own data and nobody else', async () => {
    const a = await t.signup(fresh('expA'));
    const b = await t.signup(fresh('expB'));
    const meA = await getMe(t, a.cookie);
    const meB = await getMe(t, b.cookie);
    await t.call('PUT', '/entries', { cookie: a.cookie, body: { day: today(), items: [{ start: 600, dur: 45, cat: meA.categories[0].id, tag: 'mine-only' }] } });
    await t.call('PUT', '/entries', { cookie: b.cookie, body: { day: today(), items: [{ start: 600, dur: 45, cat: meB.categories[0].id, tag: 'theirs-only' }] } });

    const res = await t.call('GET', '/export', { cookie: a.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="fifteen-export-\d{4}-\d{2}-\d{2}\.json"$/);
    const raw = await res.text();
    const data = JSON.parse(raw);
    expect(data.account.email).toBe(a.email);
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0]).toMatchObject({ day: today(), start: 600, dur: 45, tag: 'mine-only' });
    expect(data.categories).toHaveLength(6);
    expect(data.settings.tz).toBe('Europe/Berlin');
    expect(raw).not.toContain('theirs-only');
    expect(raw).not.toContain(b.email);
    expect(data.categories.map((c: { id: number }) => c.id)).toEqual(meA.categories.map((c: { id: number }) => c.id));
  });

  test('includes tracking windows', async () => {
    const a = await t.signup(fresh('expW'));
    await t.call('POST', '/track/start', { cookie: a.cookie, body: { day: today(), start: 540, end: 600, until: Math.floor(Date.now() / 1000) + 3600 } });
    const data = await json(await t.call('GET', '/export', { cookie: a.cookie }));
    expect(data.trackingSessions).toEqual([{ day: today(), start: 540, end: 600 }]);
  });
});

describe('session cookie', () => {
  test('is HttpOnly, Secure, SameSite=Lax, Path=/ and host-prefixed', async () => {
    const res = await t.call('POST', '/auth/signup', { body: { email: fresh('ck'), authKey: fakeKey('ck'), tz: 'UTC' } });
    const header = res.headers.get('set-cookie') ?? '';
    expect(header.startsWith('__Host-fifteen=')).toBe(true);
    expect(header).toMatch(/;\s*HttpOnly/i);
    expect(header).toMatch(/;\s*Secure/i);
    expect(header).toMatch(/;\s*SameSite=Lax/i);
    expect(header).toMatch(/;\s*Path=\//i);
    expect(header).not.toMatch(/Domain=/i);
    expect(header).toMatch(/Max-Age=2592000/);
  });

  test('carries a token that is not the stored session id', async () => {
    const u = await t.signup(fresh('tok'));
    const token = u.cookie.split('=')[1];
    expect(token).toHaveLength(43);
    const row = await t.env.DB.prepare('SELECT id FROM sessions WHERE id = ?').bind(token).first();
    expect(row).toBeNull();
  });

  test('is issued on login as well', async () => {
    const u = await t.signup(fresh('ck2'));
    const res = await login(t, u.email, u.authKey);
    expect(res.headers.get('set-cookie')).toMatch(/^__Host-fifteen=.*HttpOnly.*Secure.*SameSite=Lax/is);
  });
});
