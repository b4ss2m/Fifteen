import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Me } from '../shared/types';
import { Shell } from './components/Shell';
import { api } from './lib/api';
import { demoBackend, seedDemo } from './lib/demo';
import { registerWorker } from './lib/pulse';
import { navigate, usePath } from './lib/router';
import { apiBackend, AppProvider, useApp } from './lib/store';
import { Auth } from './pages/Auth';
import { Landing } from './pages/Landing';
import { Privacy, Terms } from './pages/Legal';
import { Report } from './pages/Report';
import { Settings } from './pages/Settings';
import { Today } from './pages/Today';
import './styles/base.css';
import './styles/app.css';
import './styles/landing.css';

function Screens() {
  const app = useApp();
  const sub = usePath().slice(app.base.length).replace(/\/$/, '');

  // The service worker tells open tabs when something was logged from a notification.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'refresh') app.refresh();
      if (e.data?.type === 'open' && typeof e.data.url === 'string') navigate(e.data.url);
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, [app]);

  return <Shell>{sub === '/report' ? <Report /> : sub === '/settings' ? <Settings /> : <Today />}</Shell>;
}

function Demo() {
  const seed = useMemo(seedDemo, []);
  const backend = useMemo(() => demoBackend(seed), [seed]);
  return (
    <AppProvider backend={backend} initial={seed.me} demo>
      <Screens />
    </AppProvider>
  );
}

type Session = { state: 'loading' } | { state: 'out' } | { state: 'in'; me: Me };

function Root() {
  const path = usePath();
  const [session, setSession] = useState<Session>({ state: 'loading' });

  const check = useCallback(() => {
    api.session().then(
      ({ me }) => setSession(me ? { state: 'in', me } : { state: 'out' }),
      () => setSession({ state: 'out' }),
    );
  }, []);

  useEffect(check, [check]);
  useEffect(() => {
    if (session.state === 'in') void registerWorker();
  }, [session.state]);

  const isApp = path === '/app' || path.startsWith('/app/');
  const isAuth = path === '/login' || path === '/signup' || path === '/recover';
  const signedIn = session.state === 'in';

  useEffect(() => {
    if (session.state === 'loading') return;
    if (isApp && !signedIn) navigate('/login', { replace: true });
    if (isAuth && signedIn) navigate('/app', { replace: true });
  }, [session.state, isApp, isAuth, signedIn]);

  useEffect(() => {
    if (!isApp && !path.startsWith('/demo')) document.documentElement.dataset.theme = 'light';
  }, [isApp, path]);

  if (path === '/privacy') return <Privacy />;
  if (path === '/terms') return <Terms />;
  if (path === '/demo' || path.startsWith('/demo/')) return <Demo />;

  if (isApp) {
    if (session.state !== 'in') return <div className="boot" aria-busy="true" />;
    return (
      <AppProvider backend={apiBackend} initial={session.me} onSignedOut={() => setSession({ state: 'out' })}>
        <Screens />
      </AppProvider>
    );
  }
  if (isAuth) {
    return (
      <Auth
        mode={path.slice(1) as 'login' | 'signup' | 'recover'}
        onDone={() => {
          setSession({ state: 'loading' });
          check();
          navigate('/app', { replace: true });
        }}
      />
    );
  }
  return <Landing signedIn={signedIn} />;
}

document.documentElement.dataset.theme = localStorage.getItem('fifteen.theme') === 'dark' ? 'dark' : 'light';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
