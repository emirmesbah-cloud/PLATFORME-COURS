import { forwardRef, useState, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Password input avec toggle "œil" pour afficher/masquer.
 *
 * - forwardRef pour compat react-hook-form ({...register('password')} style)
 * - aria-pressed sur le toggle pour SR users
 * - aria-label dynamique (Afficher/Cacher)
 * - bouton type=button (évite submit form au click)
 * - **Tabbable (no tabIndex={-1})** — Sherlock R5 fix : avant, les users
 *   keyboard-only ne pouvaient pas activer le toggle. WCAG 2.1.1 violation.
 * - leftIcon est rendu dans un wrapper position:absolute géré par le composant
 *   (caller passe un ReactNode "nu" — pas besoin de positioning classes).
 *
 * Usage :
 *   <PasswordInput id="pwd" autoComplete="new-password" className="input pl-10"
 *     placeholder="..." {...register('password')}
 *     leftIcon={<Lock className="h-4 w-4" />} />
 */

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Icône optionnelle à gauche (juste l'icône, pas de positioning — c'est nous). */
  leftIcon?: ReactNode;
  showLabel?: string;
  hideLabel?: string;
};

export const PasswordInput = forwardRef<HTMLInputElement, Props>(
  function PasswordInput(
    { leftIcon, className, showLabel = 'Afficher le mot de passe', hideLabel = 'Cacher le mot de passe', ...rest },
    ref,
  ) {
    const [show, setShow] = useState(false);

    return (
      <div className="relative">
        {leftIcon && (
          // SHERLOCK R5 fix : on owne le positioning du leftIcon. Caller
          // passe juste l'icône ; on garantit qu'elle ne casse pas le layout.
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          >
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          type={show ? 'text' : 'password'}
          // pr-10 garantit que le toggle n'overlap pas le texte saisi sur
          // les passwords longs. cn() respecte la dernière classe (Tailwind
          // avec twMerge dans cn → pr-10 wins même si className contient pr-X).
          className={cn(className, 'pr-10')}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          aria-label={show ? hideLabel : showLabel}
          aria-pressed={show}
          // Tabbable (default tabIndex). Keyboard users CAN reach the toggle.
          // Trade-off : tab order is Pwd → Toggle → Submit. Standard pattern,
          // users expect it. Replaces R4's tabIndex={-1} which was inaccessible.
          className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center rounded p-1 text-slate-400 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aurel-orange"
        >
          {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    );
  },
);
