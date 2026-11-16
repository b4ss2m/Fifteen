// Fifteen service worker: shows check-in notifications. It caches nothing.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const ICON = '/icons/icon-192.png';

async function onPush() {
  // Pushes arrive empty. What to show is fetched from our own API with the session cookie.
  let notice = { type: 'none' };
  try {
    const res = await fetch('/api/notice', { credentials: 'same-origin' });
    if (res.ok) notice = await res.json();
  } catch {
    // Offline or signed out: fall through to the generic prompt.
  }

  if (notice.type === 'report') {
    return self.registration.showNotification('Your daily report is ready', {
      body: 'See how today really went.',
      tag: 'report',
      icon: ICON,
      data: { url: `/app/report?day=${notice.day}` },
    });
  }
  if (notice.type === 'pulse') {
    const max = self.Notification && Notification.maxActions ? Notification.maxActions : 0;
    return self.registration.showNotification('What did you just do?', {
      body: notice.label,
      tag: 'pulse',
      renotify: true,
      icon: ICON,
      data: { url: `/app?log=${notice.day}:${notice.start}:${notice.dur}`, day: notice.day, start: notice.start, dur: notice.dur },
      actions: (notice.actions || []).slice(0, max).map((a) => ({ action: `cat:${a.id}`, title: a.name })),
    });
  }
  return self.registration.showNotification('What did you just do?', {
    body: 'Open Fifteen to log the last stretch.',
    tag: 'pulse',
    icon: ICON,
    data: { url: '/app' },
  });
}

self.addEventListener('push', (event) => event.waitUntil(onPush()));

async function openApp(url) {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of all) {
    if (new URL(client.url).origin === self.location.origin) {
      await client.focus();
      client.postMessage({ type: 'open', url });
      return;
    }
  }
  await self.clients.openWindow(url);
}

async function logFromNotification(data, cat) {
  const res = await fetch('/api/entries', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day: data.day, items: [{ start: data.start, dur: data.dur, cat, tag: null }] }),
  });
  if (!res.ok) return openApp(data.url);
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of all) client.postMessage({ type: 'refresh' });
}

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || { url: '/app' };
  event.notification.close();
  if (event.action && event.action.startsWith('cat:') && data.day) {
    event.waitUntil(logFromNotification(data, Number(event.action.slice(4))));
  } else {
    event.waitUntil(openApp(data.url || '/app'));
  }
});
