import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const FOCUSABLE_SELECTOR =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, object, embed, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function Modal({
  open, onClose, title, children, maxWidth = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  maxWidth?: string;
}) {
  // SHERLOCK R13 — B10: focus trap + body scroll lock.
  // - Escape closes
  // - Tab / Shift+Tab cycles focus within the modal
  // - <body> scroll is frozen while open (restored on close/unmount)
  // - Initial focus jumps inside the modal so SR users land in the dialog
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  // Callers commonly pass an inline closure. Keep the latest callback in a
  // ref so typing inside a controlled input does not tear down/recreate the
  // focus trap on every render (which previously stole focus after 1 letter).
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;

    // Save the element that had focus so we can restore it on close.
    lastFocusedRef.current = document.activeElement as HTMLElement | null;

    // Body scroll lock — preserve the previous inline value so we don't
    // clobber a higher-level lock (e.g. a sheet/drawer wrapping this modal).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the dialog on open.
    requestAnimationFrame(() => {
      const dlg = dialogRef.current;
      if (!dlg) return;
      const first = dlg.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? dlg).focus();
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const dlg = dialogRef.current;
      if (!dlg) return;
      const items = Array.from(dlg.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
      if (items.length === 0) {
        e.preventDefault();
        dlg.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !dlg.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      // Restore focus to whatever opened the modal.
      const prev = lastFocusedRef.current;
      if (prev && typeof prev.focus === 'function') {
        try { prev.focus(); } catch { /* element gone */ }
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn('relative w-full rounded-xl bg-white shadow-2xl animate-slide-up outline-none', maxWidth)}
      >
        <div className="flex items-start justify-between border-b border-slate-100 p-5">
          <h3 className="text-lg font-bold text-aurel-ink">{title}</h3>
          {/* SHERLOCK R14 — M13 : type="button" pour éviter que ce close button
              soit interprété comme submit dans un parent <form> (Modal est
              utilisé dans plusieurs forms admin — sans type explicite, un
              click sur la X submit le form silencieusement). */}
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
