import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'fifteen.theme';
const PAPER: Record<Theme, string> = { light: '#f6f4ee', dark: '#1b1a18' };
const listeners = new Set<() => void>();

/** The theme this browser was last left in. Light unless someone chose otherwise. */
export const getTheme = (): Theme => (localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light');

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(KEY, theme);
  // Keeps the phone's status bar the same colour as the page.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PAPER[theme]);
  listeners.forEach((fn) => fn());
}

export function useTheme(): Theme {
  return useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, getTheme);
}
