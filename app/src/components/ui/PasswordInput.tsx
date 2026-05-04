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
          // pr-12 (48px) reserves space for the 44×44 toggle button at
          // right-1. cn() uses twMerge → pr-12 wins over any pr-* in className.
          className={cn(className, 'pr-12')}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          aria-label={show ? hideLabel : showLabel}
          aria-pressed={show}
          // SHERLOCK R6 fix : touch target 44×44 px (Apple HIG / WCAG 2.5.5).
          // Was p-1 + h-4 w-4 = ~24×24 px → easy mis-tap on mobile.
          // Now p-3 with same icon = 40×40, plus min-w/h-[44px] guarantee.
          //
          // R6 fix : drop hover-only :hover state for active:/focus-visible:
          // — on mobile, :hover sticks until next tap elsewhere ("phantom
          // hover" bug). active: + focus-visible: cover keyboard + touch.
          className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded p-3 text-slate-400 active:text-slate-700 focus-visible:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aurel-orange md:hover:text-slate-700"
        >
          {show ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
        </button>
      </div>
    );
  },
);
