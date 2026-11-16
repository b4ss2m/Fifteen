const enc = new TextEncoder();

export function b64u(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64u(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const randomToken = (bytes = 32) => b64u(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256(s: string): Promise<string> {
  return b64u(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

/**
 * The browser stretches the password (PBKDF2, 600k rounds) and sends only the derived key.
 * We hash that key again with a per-user salt, so neither the password nor anything that
 * can be replayed at login is ever stored. The heavy work stays off the Worker's CPU budget.
 */
const SERVER_ROUNDS = 10_000;

export async function hashAuthKey(authKey: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', unb64u(authKey), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unb64u(salt), iterations: SERVER_ROUNDS },
    key,
    256,
  );
  return b64u(bits);
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A recovery code like `K7QMX-2B9TD-R4HWN-8PZ3C`, roughly 98 bits. */
export function newRecoveryCode(): string {
  const out: string[] = [];
  while (out.length < 20) {
    // Rejection sampling keeps the letters uniformly distributed.
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < 240 && out.length < 20) out.push(CODE_ALPHABET[b % 30]);
    }
  }
  return out.join('').replace(/(.{5})(?=.)/g, '$1-');
}

export const normalizeRecoveryCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
