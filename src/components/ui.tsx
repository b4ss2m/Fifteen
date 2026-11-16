import { useEffect, useRef, type ReactNode } from 'react';
import { applyTheme, useTheme, type Theme } from '../lib/theme';

const PATHS = {
  thread: 'M12 3v4M12 11v2M12 17v4M8.5 7h7M9.5 15h5',
  report: 'M5 20V11M12 20V4M19 20v-6',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  plus: 'M12 5v14M5 12h14',
  left: 'm14.5 6-6 6 6 6',
  right: 'm9.5 6 6 6-6 6',
  down: 'm6 9.5 6 6 6-6',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  close: 'M6 6l12 12M18 6 6 18',
  play: 'M8 5.5v13l10.5-6.5L8 5.5Z',
  stop: 'M7 7h10v10H7z',
  tag: 'M4 12.6V5a1 1 0 0 1 1-1h7.6a1 1 0 0 1 .7.3l6.4 6.4a1 1 0 0 1 0 1.4l-7.6 7.6a1 1 0 0 1-1.4 0l-6.4-6.4a1 1 0 0 1-.3-.7ZM8.5 8.5h.01',
  bell: 'M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15l1.5-2ZM10 21h4',
  up: 'm6 14.5 6-6 6 6',
  lock: 'M7 10.5V8a5 5 0 0 1 10 0v2.5M5.5 10.5h13v9h-13z',
  download: 'M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 20h14',
  logout: 'M14 5H6v14h8M10.5 12H20M16.5 8.5 20 12l-3.5 3.5',
  trash: 'M5 7h14M9.5 7V4.5h5V7M7 7l.8 12.5h8.4L17 7',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  moon: 'M20 14.2A8 8 0 0 1 9.8 4 8 8 0 1 0 20 14.2Z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <span className="logo">
      <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
        <rect width="512" height="512" rx="128" fill="var(--ink)" />
        <rect x="232" y="96" width="48" height="112" rx="24" fill="#f59549" />
        <rect x="232" y="224" width="48" height="64" rx="24" fill="var(--paper)" />
        <circle cx="256" cy="322" r="10" fill="var(--paper)" opacity=".55" />
        <circle cx="256" cy="358" r="10" fill="var(--paper)" opacity=".55" />
        <rect x="232" y="384" width="48" height="40" rx="20" fill="#f06351" />
      </svg>
      <span>Fifteen</span>
    </span>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange(next: boolean): void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />;
}

/** The light/dark switch. Pass `onChange` where the choice should also be saved to an account. */
export function ThemeToggle({ onChange }: { onChange?(theme: Theme): void }) {
  const theme = useTheme();
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="icon-btn theme-toggle"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => {
        applyTheme(next);
        onChange?.(next);
      }}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}

interface SheetProps {
  open: boolean;
  onClose(): void;
  label: string;
  children: ReactNode;
}

/** A bottom sheet on phones, a centred dialog on wider screens. */
export function Sheet({ open, onClose, label, children }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();

    // On phones the keyboard covers the bottom of the screen without resizing the page.
    // Fitting the backdrop to the visible area keeps the sheet sitting on top of the keyboard.
    const vv = window.visualViewport;
    const fit = () => {
      if (!vv || !wrap.current) return;
      wrap.current.style.height = `${vv.height}px`;
      wrap.current.style.top = `${vv.offsetTop}px`;
    };
    fit();
    vv?.addEventListener('resize', fit);
    vv?.addEventListener('scroll', fit);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      vv?.removeEventListener('resize', fit);
      vv?.removeEventListener('scroll', fit);
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="sheet-wrap" ref={wrap} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={ref}>
        <span className="sheet-grip" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
