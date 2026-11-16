import { fmtMin } from '../../shared/time';
import { api } from './api';

let audio: AudioContext | null = null;

/** Two soft notes. Browsers only allow sound after the first tap, so this stays quiet until then. */
export function chime() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const ctx = audio;
    const t0 = ctx.currentTime + 0.02;
    [659.25, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const at = t0 + i * 0.16;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.16, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.7);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.75);
    });
  } catch {
    // No audio available; the sheet and vibration still do the job.
  }
}

export function announcePulse(start: number, end: number, sound: boolean, demo: boolean) {
  if (sound) chime();
  // Browsers ignore (and complain about) vibration before the first tap.
  if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.([70, 60, 110]);
  if (demo || !document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (localStorage.getItem('fifteen.notify') !== '1') return;
  void navigator.serviceWorker?.ready.then((reg) =>
    reg.showNotification('What did you just do?', {
      body: `${fmtMin(start)}–${fmtMin(end)}`,
      tag: 'pulse',
      icon: '/icons/icon-192.png',
      data: { url: '/app' },
    }),
  );
}

export const notificationsSupported = () => 'Notification' in window && 'serviceWorker' in navigator;

export const isIosBrowserTab = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches;

export async function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const bin = atob(base64url.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Asks for permission and, when the server has push keys, subscribes this browser so
 * check-ins arrive even with Fifteen closed. Returns what ended up enabled.
 */
export async function enableNotifications(vapidPublicKey: string): Promise<'push' | 'local' | 'denied'> {
  if (!notificationsSupported()) return 'denied';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const reg = await registerWorker();
  if (!reg || !vapidPublicKey || !('pushManager' in reg)) return 'local';
  try {
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublicKey) }));
    await api.pushSubscribe(sub.endpoint);
    return 'push';
  } catch {
    return 'local';
  }
}

export async function disableNotifications(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) {
      await api.pushUnsubscribe(sub.endpoint);
      await sub.unsubscribe();
    } else {
      await api.pushUnsubscribe();
    }
  } catch {
    // Best effort; the server drops dead subscriptions on its own.
  }
}
