export interface Limiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  AUTH_LIMITER?: Limiter;
  API_LIMITER?: Limiter;
  /** Public. Turnstile is only enforced when both the site key and the secret are present. */
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET?: string;
  /** Public half of the web push key pair; the private half is a secret. */
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY?: string;
}
