import { readFileSync, readdirSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { app } from '../worker/index';
import type { Env } from '../worker/env';

export const ORIGIN = 'https://fifteen.test';

export interface TestApp {
  env: Env;
  /** Calls the API. Pass the cookie from `signup()`/`login()` to act as that user. */
  call(method: string, path: string, opts?: { body?: unknown; cookie?: string; headers?: Record<string, string> }): Promise<Response>;
  signup(email?: string): Promise<{ cookie: string; recoveryCode: string; authKey: string; email: string }>;
  close(): Promise<void>;
}

/** Stand-in for the key the browser derives from the password: 32 bytes, base64url. */
export const fakeKey = (seed: string) => Buffer.from(seed.padEnd(32, '.').slice(0, 32)).toString('base64url');

export const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0];

/** A fresh, empty database with the real schema, and the app wired to it. */
export async function createTestApp(overrides: Partial<Env> = {}): Promise<TestApp> {
  const proxy = await getPlatformProxy<Env>({ configPath: 'wrangler.jsonc', persist: false });
  for (const file of readdirSync('migrations').sort()) {
    const sql = readFileSync(`migrations/${file}`, 'utf8').replace(/^\s*--.*$/gm, '');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await proxy.env.DB.prepare(stmt).run();
  }
  // Rate limiters are switched off unless a test asks for them.
  const env = { ...proxy.env, AUTH_LIMITER: undefined, API_LIMITER: undefined, TURNSTILE_SECRET: undefined, ...overrides } as Env;
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

  const call: TestApp['call'] = async (method, path, opts = {}) => {
    const headers: Record<string, string> = { ...opts.headers };
    if (method !== 'GET') headers.origin ??= ORIGIN;
    if (opts.body !== undefined) headers['content-type'] ??= 'application/json';
    if (opts.cookie) headers.cookie = opts.cookie;
    const body = opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    return app.fetch(new Request(`${ORIGIN}/api${path}`, { method, headers, body }), env, ctx);
  };

  let n = 0;
  const signup: TestApp['signup'] = async (email = `user${++n}@example.com`) => {
    const authKey = fakeKey(email);
    const res = await call('POST', '/auth/signup', { body: { email, authKey, tz: 'Europe/Berlin' } });
    if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { recoveryCode: string };
    return { cookie: cookieOf(res), recoveryCode: data.recoveryCode, authKey, email };
  };

  return { env, call, signup, close: () => proxy.dispose() };
}
