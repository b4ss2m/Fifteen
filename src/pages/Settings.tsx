import { useState, type FormEvent, type ReactNode } from 'react';
import { CONTACT_EMAIL } from '../../shared/site';
import { fmtMin } from '../../shared/time';
import { COLORS, INTERVALS, LIMITS, type Category, type Kind } from '../../shared/types';
import { Icon, Switch } from '../components/ui';
import { api, deriveKey, messageFor } from '../lib/api';
import { disableNotifications, enableNotifications, isIosBrowserTab, notificationsSupported } from '../lib/pulse';
import { Link, navigate } from '../lib/router';
import { useApp } from '../lib/store';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const KIND_LABEL: Record<Kind, string> = { focus: 'Productive', neutral: 'Neutral', waste: 'Wasted' };
/** Half-hour marks across one day, starting wherever that day starts. */
const halfHoursFrom = (rollover: number) => Array.from({ length: 49 }, (_, i) => rollover + i * 30);

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="set">
      <header>
        <h2>{title}</h2>
        {hint && <p className="muted">{hint}</p>}
      </header>
      <div className="set-body">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-row">
      <div>
        <span className="set-label">{label}</span>
        {hint && <span className="set-hint faint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Categories() {
  const app = useApp();
  const [name, setName] = useState('');
  const [palette, setPalette] = useState<number | null>(null);
  const all = [...app.me.categories].sort((a, b) => a.pos - b.pos);
  const live = all.filter((c) => !c.archived);
  const archived = all.filter((c) => c.archived);

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      app.say(messageFor(err));
    }
  };

  const patch = (c: Category, change: Partial<Pick<Category, 'name' | 'color' | 'kind' | 'archived'>>) =>
    run(async () => {
      const next = await app.backend.patchCategory(c.id, change);
      app.setCategories(app.me.categories.map((x) => (x.id === c.id ? next : x)));
    });

  const move = (index: number, by: number) =>
    run(async () => {
      const order = [...live];
      const [item] = order.splice(index, 1);
      order.splice(index + by, 0, item);
      const next = [...order, ...archived].map((c, pos) => ({ ...c, pos }));
      app.setCategories(next);
      await app.backend.orderCategories(next.map((c) => c.id));
    });

  const remove = (c: Category) =>
    run(async () => {
      const res = await app.backend.deleteCategory(c.id);
      app.setCategories(res.archived ? app.me.categories.map((x) => (x.id === c.id ? { ...x, archived: true } : x)) : app.me.categories.filter((x) => x.id !== c.id));
      app.say(res.archived ? `${c.name} archived. Old entries keep it.` : `${c.name} deleted.`);
    });

  const add = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const color = COLORS.find((col) => !live.some((c) => c.color === col)) ?? COLORS[live.length % COLORS.length];
    void run(async () => {
      const cat = await app.backend.addCategory({ name: trimmed, color, kind: 'focus' });
      app.setCategories([...app.me.categories, cat]);
      setName('');
    });
  };

  return (
    <>
      <ul className="cats">
        {live.map((c, i) => (
          <li key={c.id}>
            <div className="cat-row">
              <button
                type="button"
                className="swatch"
                style={{ ['--c' as string]: `var(--c-${c.color})` }}
                aria-label={`Colour for ${c.name}`}
                aria-expanded={palette === c.id}
                onClick={() => setPalette(palette === c.id ? null : c.id)}
              />
              <input
                className="cat-input"
                defaultValue={c.name}
                maxLength={LIMITS.nameLen}
                aria-label="Category name"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== c.name) void patch(c, { name: v });
                  else e.target.value = c.name;
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              <select className="select select-sm" value={c.kind} aria-label={`What ${c.name} counts as`} onChange={(e) => void patch(c, { kind: e.target.value as Kind })}>
                {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              <span className="cat-tools">
                <button className="icon-btn icon-sm" onClick={() => void move(i, -1)} disabled={i === 0} aria-label={`Move ${c.name} up`}>
                  <Icon name="up" size={16} />
                </button>
                <button className="icon-btn icon-sm" onClick={() => void move(i, 1)} disabled={i === live.length - 1} aria-label={`Move ${c.name} down`}>
                  <Icon name="down" size={16} />
                </button>
                <button className="icon-btn icon-sm" onClick={() => void remove(c)} disabled={live.length <= 1} aria-label={`Remove ${c.name}`}>
                  <Icon name="trash" size={16} />
                </button>
              </span>
            </div>
            {palette === c.id && (
              <div className="palette" role="group" aria-label="Colours">
                {COLORS.map((col) => (
                  <button
                    key={col}
                    type="button"
                    className={`swatch${col === c.color ? ' swatch-on' : ''}`}
                    style={{ ['--c' as string]: `var(--c-${col})` }}
                    aria-label={col}
                    onClick={() => {
                      setPalette(null);
                      void patch(c, { color: col });
                    }}
                  />
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {live.length < LIMITS.categories && (
        <form className="cat-add" onSubmit={add}>
          <input className="input" value={name} maxLength={LIMITS.nameLen} onChange={(e) => setName(e.target.value)} placeholder="New category" aria-label="New category name" />
          <button className="btn btn-ghost" disabled={!name.trim()}>
            Add
          </button>
        </form>
      )}
      <p className="set-foot faint">
        The first four you use most show up on every check-in. Productive time lifts your focus score, wasted time lowers it, neutral time is left out.
      </p>
      {archived.length > 0 && (
        <div className="chips">
          {archived.map((c) => (
            <button key={c.id} className="chip" onClick={() => void patch(c, { archived: false })}>
              Restore {c.name}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function Account() {
  const app = useApp();
  const [open, setOpen] = useState<'password' | 'code' | 'delete' | null>(null);
  const [pw, setPw] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');

  const toggle = (which: typeof open) => {
    setOpen(open === which ? null : which);
    setPw('');
    setNext('');
    setConfirm('');
    setError('');
    setCode('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const key = await deriveKey(app.me.email, pw);
      if (open === 'password') {
        if (next.length < 10) throw new Error('short');
        await api.changePassword(key, await deriveKey(app.me.email, next));
        toggle(null);
        app.say('Password changed. Other devices were signed out.');
      } else if (open === 'code') {
        setCode((await api.newRecoveryCode(key)).recoveryCode);
        setPw('');
      } else if (open === 'delete') {
        await api.deleteAccount(key);
        localStorage.removeItem('fifteen.notify');
        navigate('/?deleted=1');
        location.reload();
      }
    } catch (err) {
      setError(err instanceof Error && err.message === 'short' ? 'Use at least 10 characters for the new password.' : messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await disableNotifications();
    await api.logout().catch(() => {});
    location.assign('/');
  };

  return (
    <>
      <Row label="Signed in as" hint={app.me.email}>
        <button className="btn btn-ghost btn-sm" onClick={() => void logout()}>
          <Icon name="logout" size={16} /> Log out
        </button>
      </Row>
      <Row label="Password" hint="Changing it signs out your other devices.">
        <button className="btn btn-ghost btn-sm" onClick={() => toggle('password')}>
          Change
        </button>
      </Row>
      {open === 'password' && (
        <form className="set-form" onSubmit={submit}>
          <input className="input" type="password" autoComplete="current-password" placeholder="Current password" value={pw} onChange={(e) => setPw(e.target.value)} required />
          <input className="input" type="password" autoComplete="new-password" placeholder="New password, 10 characters or more" value={next} onChange={(e) => setNext(e.target.value)} required />
          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Working…' : 'Change password'}
          </button>
        </form>
      )}
      <Row label="Recovery code" hint="The only way back in if you forget your password. Making a new one retires the old one.">
        <button className="btn btn-ghost btn-sm" onClick={() => toggle('code')}>
          New code
        </button>
      </Row>
      {open === 'code' &&
        (code ? (
          <div className="set-form">
            <p className="code num">{code}</p>
            <p className="muted">Write it down or save it in your password manager. It won’t be shown again.</p>
          </div>
        ) : (
          <form className="set-form" onSubmit={submit}>
            <input className="input" type="password" autoComplete="current-password" placeholder="Your password" value={pw} onChange={(e) => setPw(e.target.value)} required />
            {error && <p className="error">{error}</p>}
            <button className="btn btn-primary" disabled={busy}>
              {busy ? 'Working…' : 'Show a new code'}
            </button>
          </form>
        ))}
      <Row label="Export my data" hint="Everything Fifteen holds about you, as one JSON file.">
        <a className="btn btn-ghost btn-sm" href="/api/export" download>
          <Icon name="download" size={16} /> Download
        </a>
      </Row>
      <Row label="Delete account" hint="Erases your account, log and settings for good.">
        <button className="btn btn-danger btn-sm" onClick={() => toggle('delete')}>
          Delete…
        </button>
      </Row>
      {open === 'delete' && (
        <form className="set-form" onSubmit={submit}>
          <p>
            This removes your account and every entry you’ve logged, straight away. It can’t be undone. Type <strong>DELETE</strong> to confirm.
          </p>
          <input className="input" type="password" autoComplete="current-password" placeholder="Your password" value={pw} onChange={(e) => setPw(e.target.value)} required />
          <input className="input" placeholder="DELETE" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Type DELETE to confirm" />
          {error && <p className="error">{error}</p>}
          <button className="btn btn-danger" disabled={busy || confirm !== 'DELETE'}>
            {busy ? 'Deleting…' : 'Delete my account and data'}
          </button>
        </form>
      )}
    </>
  );
}

function Notifications() {
  const app = useApp();
  const [on, setOn] = useState(() => notificationsSupported() && Notification.permission === 'granted' && localStorage.getItem('fifteen.notify') === '1');
  const [mode, setMode] = useState<'push' | 'local' | null>(app.me.pushEnabled ? 'push' : null);
  const [busy, setBusy] = useState(false);

  const change = async (next: boolean) => {
    if (app.demo) return app.say('Notifications are switched off in the demo.');
    setBusy(true);
    if (next) {
      const key = await api.config().then(
        (c) => c.vapidPublicKey,
        () => '',
      );
      const result = await enableNotifications(key);
      if (result === 'denied') {
        app.say('Notifications are blocked for this site in your browser settings.');
      } else {
        localStorage.setItem('fifteen.notify', '1');
        setOn(true);
        setMode(result);
        app.setMe({ ...app.me, pushEnabled: result === 'push' });
      }
    } else {
      await disableNotifications();
      localStorage.removeItem('fifteen.notify');
      setOn(false);
      setMode(null);
      app.setMe({ ...app.me, pushEnabled: false });
    }
    setBusy(false);
  };

  let hint = 'A notification at every check-in and when your daily report is ready.';
  if (!notificationsSupported()) hint = isIosBrowserTab() ? 'On iPhone, add Fifteen to your Home Screen first (Share → Add to Home Screen), then turn this on.' : 'This browser doesn’t support notifications.';
  else if (on && mode === 'push') hint = 'On. Check-ins reach this device even when Fifteen is closed.';
  else if (on) hint = 'On. Check-ins reach you while Fifteen is open in a tab or installed.';

  return (
    <Row label="Notifications" hint={hint}>
      <span style={busy ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
        <Switch checked={on} onChange={(v) => void change(v)} label="Notifications" />
      </span>
    </Row>
  );
}

export function Settings() {
  const app = useApp();
  const s = app.me.settings;
  const set = app.updateSettings;
  const halfHours = halfHoursFrom(s.rollover);

  // Workday hours and the report time have to stay inside the day when its end moves.
  const setRollover = (rollover: number) => {
    const clamp = (m: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, m));
    const dayStart = clamp(s.dayStart, rollover, rollover + 1380);
    return set({
      rollover,
      dayStart,
      dayEnd: clamp(s.dayEnd, dayStart + 30, rollover + 1440),
      reportAt: clamp(s.reportAt, rollover, rollover + 1410),
    });
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">Settings</p>
          <h1>Make it yours</h1>
        </div>
      </header>

      <Section title="Check-ins">
        <Row label="Ask me every" hint="Shorter is more honest. Longer is less annoying.">
          <select className="select select-sm" value={s.interval} onChange={(e) => void set({ interval: Number(e.target.value) })} aria-label="Check-in interval">
            {INTERVALS.map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
        </Row>
        <Notifications />
        <Row label="Sound" hint="A short two-note chime with each check-in.">
          <Switch checked={s.sound} onChange={(v) => void set({ sound: v })} label="Sound" />
        </Row>
      </Section>

      <Section title="Workday" hint="Track automatically during set hours, so you never have to remember to start the clock.">
        <Row label="Track my workday automatically">
          <Switch checked={s.autoTrack} onChange={(v) => void set({ autoTrack: v })} label="Track my workday automatically" />
        </Row>
        <div className={`set-sub${s.autoTrack ? '' : ' set-off'}`}>
          <div className="daypick" role="group" aria-label="Workdays">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const active = s.workdays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  className={`chip${active ? ' chip-on' : ''}`}
                  aria-pressed={active}
                  onClick={() => void set({ workdays: active ? s.workdays.filter((x) => x !== d) : [...s.workdays, d].sort() })}
                >
                  {DAYS[d]}
                </button>
              );
            })}
          </div>
          <div className="hours">
            <label className="field">
              <span>From</span>
              <select className="select num" value={s.dayStart} onChange={(e) => void set({ dayStart: Number(e.target.value) })}>
                {halfHours.filter((m) => m < s.dayEnd).map((m) => (
                  <option key={m} value={m}>
                    {fmtMin(m)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Until</span>
              <select className="select num" value={s.dayEnd} onChange={(e) => void set({ dayEnd: Number(e.target.value) })}>
                {halfHours.filter((m) => m > s.dayStart).map((m) => (
                  <option key={m} value={m}>
                    {fmtMin(m)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </Section>

      <Section title="Your day" hint="For night owls and late shifts: a day doesn’t have to end at midnight.">
        <Row label="My day ends at" hint="Anything before this time still counts towards the day before. Workday hours can then run past midnight too.">
          <select className="select select-sm num" value={s.rollover} onChange={(e) => void setRollover(Number(e.target.value))} aria-label="When your day ends">
            {Array.from({ length: LIMITS.maxRollover / 30 + 1 }, (_, i) => i * 30).map((m) => (
              <option key={m} value={m}>
                {fmtMin(m)}
                {m === 0 ? ' · midnight' : ''}
              </option>
            ))}
          </select>
        </Row>
      </Section>

      <Section title="Daily report">
        <Row label="Report ready at" hint="When the day’s verdict is final.">
          <select className="select select-sm num" value={s.reportAt} onChange={(e) => void set({ reportAt: Number(e.target.value) })} aria-label="Report time">
            {halfHours.slice(0, -1).map((m) => (
              <option key={m} value={m}>
                {fmtMin(m)}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Hours awake per day" hint="Used for the burn rate: wasted time as a share of your waking day.">
          <select className="select select-sm" value={s.wakingHours} onChange={(e) => void set({ wakingHours: Number(e.target.value) })} aria-label="Waking hours">
            {Array.from({ length: 13 }, (_, i) => i + 8).map((h) => (
              <option key={h} value={h}>
                {h} hours
              </option>
            ))}
          </select>
        </Row>
      </Section>

      <Section title="Categories">
        <Categories />
      </Section>

      <Section title="Appearance">
        <Row label="Theme">
          <div className="seg" role="group" aria-label="Theme">
            {(['light', 'dark'] as const).map((th) => (
              <button key={th} type="button" className={s.theme === th ? 'on' : ''} aria-pressed={s.theme === th} onClick={() => void set({ theme: th })}>
                {th === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </Row>
      </Section>

      <Section title="Account">
        {app.demo ? (
          <Row label="This is the demo" hint="Nothing here is saved or sent anywhere.">
            <Link href="/signup" className="btn btn-primary btn-sm">
              Create an account
            </Link>
          </Row>
        ) : (
          <Account />
        )}
      </Section>

      <p className="set-about faint">
        <Link href="/privacy" className="link">
          Privacy policy
        </Link>
        <Link href="/terms" className="link">
          Terms
        </Link>
        <a className="link" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
      </p>
    </div>
  );
}
