import { dayAdd } from '../shared/time';
import type { TestApp } from './helpers';

export const today = () => new Date().toISOString().slice(0, 10);
export const daysFromToday = (n: number) => dayAdd(today(), n);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const json = async (res: Response): Promise<any> => res.json();

export async function getMe(t: TestApp, cookie: string) {
  const res = await t.call('GET', '/me', { cookie });
  return json(res);
}

export async function userId(t: TestApp, email: string): Promise<string> {
  const row = await t.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  if (!row) throw new Error(`no user ${email}`);
  return row.id;
}

export async function countRows(t: TestApp, sql: string, ...binds: unknown[]): Promise<number> {
  const row = await t.env.DB.prepare(sql).bind(...binds).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function login(t: TestApp, email: string, authKey: string) {
  return t.call('POST', '/auth/login', { body: { email, authKey } });
}

export const TABLES = ['users', 'sessions', 'categories', 'entries', 'windows', 'push_subs'] as const;
