import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Password input avec toggle "œil" pour afficher/masquer.
 * - forwardRef pour compat react-hook-form ({...register('password')} style)
 * - aria-pressed sur le toggle pour SR users
 * - aria-label dynamique (Afficher/Cacher)
 * - bouton type=button (évite submit form au click)
 * - pr-10 (padding-right) pour ne pas que le texte soit caché par l'icône
 *
 * Usage :
 *   <PasswordInput id="pwd" autoComplete="new-password" className="input pl-10"
 *     placeholder="min. 8 caractères" {...register('password')}
 *     leftIcon={<Lock className="..." />} />
 */

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Icône optionnelle à gauche (genre Lock) */
  leftIcon?: React.ReactNode;
  /** Texte du toggle pour SR */
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
        {leftIcon}
        <input
          ref={ref}
          type={show ? 'text' : 'password'}
          className={cn(className, 'pr-10')}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          aria-label={show ? hideLabel : showLabel}
          aria-pressed={show}
          className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center rounded p-1 text-slate-400 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aurel-orange"
          tabIndex={-1}
        >
          {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    );
  },
);
