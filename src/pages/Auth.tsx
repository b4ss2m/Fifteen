import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Logo, ThemeToggle } from '../components/ui';
import { api, deriveKey, messageFor, type Bot } from '../lib/api';
import { browserTz } from '../lib/dates';
import { Link, navigate } from '../lib/router';
import { getTheme } from '../lib/theme';

type Mode = 'login' | 'signup' | 'recover';

declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, opts: { sitekey: string; callback(token: string): void; 'expired-callback'(): void; theme: string }): string;
      reset(id?: string): void;
    };
  }
}

/** Shows Cloudflare's bot check when the server has it switched on, and nothing at all otherwise. */
function useTurnstile() {
  const box = useRef<HTMLDivElement>(null);
  const [siteKey, setSiteKey] = useState('');
  const [token, setToken] = useState('');
  const widget = useRef<string | undefined>(undefined);

  useEffect(() => {
    api.config().then(
      (c) => setSiteKey(c.turnstileSiteKey),
      () => {},
    );
  }, []);

  useEffect(() => {
    if (!siteKey) return;
    const mount = () => {
      if (!box.current || !window.turnstile || widget.current) return;
      widget.current = window.turnstile.render(box.current, {
        sitekey: siteKey,
        callback: setToken,
        'expired-callback': () => setToken(''),
        theme: getTheme(),
      });
    };
    if (window.turnstile) return mount();
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = mount;
    document.head.appendChild(script);
  }, [siteKey]);

  return {
    box,
    needed: !!siteKey,
    token,
    reset: () => {
      setToken('');
      window.turnstile?.reset(widget.current);
    },
  };
}

const COPY: Record<Mode, { title: string; sub: string; action: string }> = {
  login: { title: 'Welcome back.', sub: 'Pick up where your day left off.', action: 'Log in' },
  signup: { title: 'Start your audit.', sub: 'An email and a password. That’s the whole form.', action: 'Create account' },
  recover: { title: 'Get back in.', sub: 'Enter the recovery code you saved when you signed up, then choose a new password.', action: 'Reset password' },
};

export function Auth({ mode, onDone }: { mode: Mode; onDone(): void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState('');
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const ts = useTurnstile();
  const copy = COPY[mode];

  useEffect(() => {
    setError('');
  }, [mode]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode !== 'login' && password.length < 10) return setError('Use at least 10 characters for your password.');
    setBusy(true);
    setError('');
    try {
      const key = await deriveKey(email, password);
      const bot: Bot = { website, turnstile: ts.token || undefined };
      if (mode === 'login') {
        await api.login(email, key, bot);
        onDone();
      } else {
        const res = mode === 'signup' ? await api.signup(email, key, browserTz(), bot) : await api.recover(email, code, key, bot);
        setRecovery(res.recoveryCode);
      }
    } catch (err) {
      setError(messageFor(err));
      ts.reset();
    } finally {
      setBusy(false);
    }
  };

  if (recovery) {
    return (
      <div className="auth">
        <div className="auth-wash" aria-hidden="true" />
        <div className="auth-card">
          <Logo />
          <h1>Save your recovery code.</h1>
          <p className="muted">
            This code is your way back in if you ever forget your password. Keep it somewhere safe, like your password manager. It
            won’t be shown again.
          </p>
          <p className="code num">{recovery}</p>
          <button
            type="button"
            className="btn btn-ghost btn-block"
            onClick={() => {
              void navigator.clipboard?.writeText(recovery).then(() => setCopied(true));
            }}
          >
            {copied ? 'Copied' : 'Copy code'}
          </button>
          <label className="check">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            <span>I’ve saved it somewhere safe.</span>
          </label>
          <button className="btn btn-primary btn-block btn-lg" disabled={!saved} onClick={onDone}>
            Open Fifteen
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth">
      <div className="auth-wash" aria-hidden="true" />
      <div className="auth-theme">
        <ThemeToggle />
      </div>
      <form className="auth-card" onSubmit={submit}>
        <Link href="/" aria-label="Fifteen home">
          <Logo />
        </Link>
        <h1>{copy.title}</h1>
        <p className="muted">{copy.sub}</p>

        <label className="field">
          <span>Email</span>
          <input className="input" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode === 'recover' && (
          <label className="field">
            <span>Recovery code</span>
            <input className="input num" autoComplete="off" autoCapitalize="characters" spellCheck={false} required value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXXX-XXXXX-XXXXX-XXXXX" />
          </label>
        )}
        <label className="field">
          <span>{mode === 'recover' ? 'New password' : 'Password'}</span>
          <input
            className="input"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'login' ? 1 : 10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode !== 'login' && <small className="faint">At least 10 characters. It never leaves this device unscrambled.</small>}
        </label>

        {/* Left empty by people, filled in by bots. */}
        <input className="hp" type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} aria-hidden="true" />
        <div ref={ts.box} className={ts.needed ? 'turnstile' : undefined} />

        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary btn-block btn-lg" disabled={busy || (ts.needed && !ts.token)}>
          {busy ? 'One moment…' : copy.action}
        </button>

        {mode === 'signup' && (
          <p className="auth-legal faint">
            By creating an account you agree to the{' '}
            <Link href="/terms" className="link">
              Terms
            </Link>{' '}
            and confirm you’ve read the{' '}
            <Link href="/privacy" className="link">
              Privacy Policy
            </Link>
            . You must be 16 or older.
          </p>
        )}

        <p className="auth-alt muted">
          {mode === 'login' ? (
            <>
              New here?{' '}
              <Link href="/signup" className="link">
                Create an account
              </Link>
              <br />
              <Link href="/recover" className="link">
                Forgot your password?
              </Link>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <Link href="/login" className="link">
                Log in
              </Link>
            </>
          )}
        </p>
        {mode !== 'recover' && (
          <button type="button" className="auth-demo link" onClick={() => navigate('/demo')}>
            Or look around the demo first
          </button>
        )}
      </form>
    </div>
  );
}
