import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastVariant = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  title?: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (t: Omit<Toast, 'id'>) => void;
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // SHERLOCK R13 — C4: track each toast's auto-dismiss timer so manual close
  // can cancel it (no late removal after the user already dismissed) and
  // unmount clears all pending timers (no setState-after-unmount).
  const timersRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((handle) => window.clearTimeout(handle));
      timers.clear();
    };
  }, []);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((s) => [...s, { ...t, id }]);
    const handle = window.setTimeout(() => {
      timersRef.current.delete(id);
      setToasts((s) => s.filter((x) => x.id !== id));
    }, 4500);
    timersRef.current.set(id, handle);
  }, []);

  const dismiss = useCallback((id: number) => {
    const handle = timersRef.current.get(id);
    if (handle !== undefined) {
      window.clearTimeout(handle);
      timersRef.current.delete(id);
    }
    setToasts((s) => s.filter((x) => x.id !== id));
  }, []);

  // SHERLOCK FIX : memoize success/error/info pour éviter que les useEffect
  // qui les listent en deps re-fire à chaque render parent. Avant,
  // KickedListener (ex.) attachait/détachait son window listener à chaque
  // render de l'app — un kick event firé pendant le gap était dropped.
  const success = useCallback((message: string, title?: string) => toast({ variant: 'success', message, title }), [toast]);
  const error   = useCallback((message: string, title?: string) => toast({ variant: 'error',   message, title }), [toast]);
  const info    = useCallback((message: string, title?: string) => toast({ variant: 'info',    message, title }), [toast]);

  return (
    <ToastContext.Provider value={{ toast, success, error, info }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 10);
    return () => clearTimeout(t);
  }, []);
  const Icon = toast.variant === 'success' ? CheckCircle2 : toast.variant === 'error' ? AlertCircle : Info;
  const colors = {
    success: 'border-green-200 bg-white text-green-700',
    error:   'border-red-200 bg-white text-red-700',
    info:    'border-aurel-orange-soft bg-white text-aurel-orange-dark',
  }[toast.variant];
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border p-4 shadow-lg transition-all',
        shown ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4',
        colors
      )}
    >
      <Icon className="mt-0.5 h-5 w-5 flex-shrink-0" />
      <div className="flex-1 text-sm">
        {toast.title && <div className="font-semibold text-aurel-ink">{toast.title}</div>}
        <div className="text-slate-700">{toast.message}</div>
      </div>
      {/* SHERLOCK R6 fix : 44×44 touch target + a11y label + drop sticky-hover. */}
      <button
        onClick={onClose}
        type="button"
        aria-label="Fermer"
        className="-m-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded p-2 text-slate-400 active:text-slate-600 focus-visible:text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aurel-orange md:hover:text-slate-600"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
