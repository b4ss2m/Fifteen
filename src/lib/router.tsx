import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

window.addEventListener('popstate', emit);

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === location.pathname + location.search) return;
  if (opts.replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  emit();
  if (!opts.replace) window.scrollTo(0, 0);
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

export function useSearch(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, () => location.search);
  return new URLSearchParams(search);
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (href.startsWith('http') || href.startsWith('#')) return;
    e.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handle} {...rest} />;
}
