import { useEffect, useRef, ReactNode } from 'react';

interface Props {
  onClose: () => void;
  children: ReactNode;
  label: string;
  wide?: boolean;
  testId?: string;
}

/**
 * Accessible modal dialog: role/aria-modal for screen readers, focus moved in
 * on open and restored on close, focus trapped within, Escape and
 * backdrop-click to dismiss.
 */
export default function Modal({ onClose, children, label, wide, testId }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // focus the first focusable control, else the panel itself
    const focusables = () => Array.from(
      panel?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? [],
    );
    (focusables()[0] ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      returnFocus.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={panelRef}
        className={`modal${wide ? ' modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        data-testid={testId}
      >
        {children}
      </div>
    </div>
  );
}
