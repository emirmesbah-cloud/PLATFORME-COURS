import { useId } from 'react';
import { cn } from '@/lib/utils';

// SHERLOCK R14 — H5 : on n'enveloppe plus le <button role="switch"> dans
// un <label>. Bug : un click sur le label propage un nouveau click sur
// son associé focusable → le button fire TWICE → toggle → re-toggle =
// no-op visuel. Très tricky à debug : "je clique sur le Switch publié
// dans AdminLessons mais rien ne change". Maintenant : div wrapper +
// aria-labelledby pour conserver l'accessibilité label-button.
export function Switch({
  checked, onChange, disabled, label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  const labelId = useId();
  return (
    <span className={cn('inline-flex items-center gap-2', disabled && 'cursor-not-allowed opacity-50')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={label ? labelId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          checked ? 'bg-aurel-orange' : 'bg-slate-300'
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5'
          )}
        />
      </button>
      {label && <span id={labelId} className="text-sm text-slate-700">{label}</span>}
    </span>
  );
}
