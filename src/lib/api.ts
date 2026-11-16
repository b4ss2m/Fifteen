import type { Category, DaysResponse, Entry, Me, PublicConfig, Settings, TrackWindow } from '../../shared/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

const MESSAGES: Record<string, string> = {
  bad_credentials: 'That email and password don’t match.',
  locked: 'Too many attempts. Try again in 15 minutes.',
  slow_down: 'Too many requests. Give it a minute.',
  email_taken: 'There’s already an account with that email.',
  bad_email: 'That doesn’t look like an email address.',
  challenge_failed: 'The bot check didn’t pass. Please try again.',
  signed_out: 'You’ve been signed out. Log in again.',
  push_unavailable: 'Background notifications aren’t available on this server.',
  too_many: 'You’ve hit the limit for that.',
  offline: 'Can’t reach Fifteen. Check your connection.',
};

export const messageFor = (err: unknown) =>
  err instanceof ApiError ? (MESSAGES[err.code] ?? 'Something went wrong. Please try again.') : 'Something went wrong. Please try again.';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'server');
  return data as T;
}

/**
 * Turns the password into the key that is sent to the server. The password itself never
 * leaves this device. 600,000 rounds of PBKDF2 keeps guessing expensive even if the
 * database were ever stolen.
 */
export async function deriveKey(email: string, password: string): Promise<string> {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`fifteen/v1/${email.trim().toLowerCase()}`), iterations: 600_000 },
    material,
    256,
  );
  let s = '';
  for (const b of new Uint8Array(bits)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface Bot {
  turnstile?: string;
  website?: string;
}

export interface EntryInput {
  start: number;
  dur: number;
  cat: number | null;
  tag: string | null;
}

export const api = {
  config: () => request<PublicConfig>('GET', '/config'),
  session: () => request<{ me: Me | null }>('GET', '/session'),
  signup: (email: string, authKey: string, tz: string, bot: Bot) =>
    request<{ recoveryCode: string; me: Me }>('POST', '/auth/signup', { email, authKey, tz, ...bot }),
  login: (email: string, authKey: string, bot: Bot) => request<{ me: Me }>('POST', '/auth/login', { email, authKey, ...bot }),
  recover: (email: string, recoveryCode: string, authKey: string, bot: Bot) =>
    request<{ recoveryCode: string; me: Me }>('POST', '/auth/recover', { email, recoveryCode, authKey, ...bot }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout', {}),
  changePassword: (currentKey: string, newKey: string) => request<{ ok: true }>('POST', '/auth/password', { currentKey, newKey }),
  newRecoveryCode: (authKey: string) => request<{ recoveryCode: string }>('POST', '/auth/recovery-code', { authKey }),
  deleteAccount: (authKey: string) => request<{ ok: true }>('DELETE', '/account', { authKey }),

  days: (from: string, to: string) => request<DaysResponse>('GET', `/days?from=${from}&to=${to}`),
  putEntries: (day: string, items: EntryInput[]) => request<{ entries: Entry[] }>('PUT', '/entries', { day, items }),
  saveSettings: (s: Settings) => request<Settings>('PUT', '/settings', s),
  startTrack: (day: string, start: number, end: number, until: number) =>
    request<{ trackUntil: number; window: TrackWindow }>('POST', '/track/start', { day, start, end, until }),
  stopTrack: (day: string, end: number) => request<{ windows: TrackWindow[] }>('POST', '/track/stop', { day, end }),

  addCategory: (c: Pick<Category, 'name' | 'color' | 'kind'>) => request<Category>('POST', '/categories', c),
  patchCategory: (id: number, patch: Partial<Pick<Category, 'name' | 'color' | 'kind' | 'archived'>>) =>
    request<Category>('PATCH', `/categories/${id}`, patch),
  deleteCategory: (id: number) => request<{ archived: boolean }>('DELETE', `/categories/${id}`),
  orderCategories: (ids: number[]) => request<{ ok: true }>('PUT', '/categories/order', { ids }),

  pushSubscribe: (endpoint: string) => request<{ ok: true }>('POST', '/push/subscribe', { endpoint }),
  pushUnsubscribe: (endpoint?: string) => request<{ ok: true }>('POST', '/push/unsubscribe', { endpoint }),
};
