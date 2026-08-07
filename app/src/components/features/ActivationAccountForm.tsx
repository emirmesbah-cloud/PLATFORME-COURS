import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, KeyRound, ArrowLeft } from 'lucide-react';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { WHATSAPP_REGEX } from '@/lib/utils';
import { PROGRAM_COPY, type Program } from '@/lib/activation';

const DIPLOMES = ['DEI', 'DEMA', 'ATS', 'Autre'] as const;

/**
 * Account fields common to BOTH programs. `diplome_algerien` is declared
 * optional here so the inferred type is identical for Pflege and Immigration;
 * whether it is actually required is decided per-program below.
 */
const accountShape = {
  email: z.string().email('Email invalide'),
  password: z.string().min(8, 'Au moins 8 caractères').max(128, 'Maximum 128 caractères'),
  confirm_password: z.string().min(8).max(128),
  first_name: z.string().min(1, 'Prénom requis').max(50),
  last_name: z.string().min(1, 'Nom requis').max(50),
  whatsapp: z.string().regex(WHATSAPP_REGEX, 'Format : 0555290826 (numéro algérien)'),
  diplome_algerien: z.enum(DIPLOMES).optional(),
  accept_terms: z.literal(true, {
    errorMap: () => ({ message: 'Vous devez accepter les conditions' }),
  }),
};

/**
 * Diplôme algérien is a PFLEGE-ONLY onboarding question (nursing diploma). It is
 * not deleted from the app — it stays required for Pflege, exactly as before —
 * it is simply not asked, not rendered and not required for Immigration.
 */
function buildAccountSchema(program: Program) {
  return z.object(accountShape).superRefine((d, ctx) => {
    if (d.password !== d.confirm_password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirm_password'],
        message: 'Les mots de passe ne correspondent pas',
      });
    }
    if (program === 'pflege' && !d.diplome_algerien) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['diplome_algerien'],
        message: 'Diplôme requis',
      });
    }
  });
}

export type AccountFormValues = z.infer<ReturnType<typeof buildAccountSchema>>;

interface Props {
  program: Program;
  /** The already-validated code, shown read-only so the student can confirm it. */
  code: string;
  onSubmit: (values: AccountFormValues) => void;
  onBack: () => void;
  submitting: boolean;
}

export function ActivationAccountForm({ program, code, onSubmit, onBack, submitting }: Props) {
  const copy = PROGRAM_COPY[program];
  const schema = useMemo(() => buildAccountSchema(program), [program]);

  const { register, handleSubmit, formState: { errors }, watch } = useForm<AccountFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      // Pre-selected for Pflege only; Immigration never sends this field.
      diplome_algerien: copy.showPflegeOnboarding ? 'DEI' : undefined,
      accept_terms: false as never,
    },
  });

  return (
    <>
      <div className="mb-6 flex items-start gap-3 rounded-lg bg-aurel-orange-soft p-4 text-sm text-aurel-orange-dark">
        <KeyRound className="mt-0.5 h-5 w-5 flex-shrink-0" />
        <div>
          <div className="font-semibold">{copy.badgeTitle}</div>
          <p>{copy.badgeBody}</p>
        </div>
      </div>

      <h1 className="mb-1 text-2xl font-bold text-aurel-ink">{copy.title}</h1>
      <p className="mb-4 text-sm text-slate-600">{copy.subtitle}</p>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <span className="text-sm text-slate-600">
          Code&nbsp;: <span className="font-mono font-semibold tracking-widest text-aurel-ink">{code}</span>
        </span>
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="inline-flex items-center gap-1 text-sm font-semibold text-aurel-teal hover:underline disabled:opacity-50"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Modifier
        </button>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 gap-4 md:grid-cols-2" noValidate>
        <div>
          <label className="label" htmlFor="first_name">Prénom</label>
          <input id="first_name" autoComplete="given-name" autoCapitalize="words" className="input" {...register('first_name')} />
          {errors.first_name && <p className="field-error">{errors.first_name.message}</p>}
        </div>
        <div>
          <label className="label" htmlFor="last_name">Nom</label>
          <input id="last_name" autoComplete="family-name" autoCapitalize="words" className="input" {...register('last_name')} />
          {errors.last_name && <p className="field-error">{errors.last_name.message}</p>}
        </div>

        <div className="md:col-span-2">
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="input" placeholder="votre@email.com" {...register('email')} />
          {errors.email && <p className="field-error">{errors.email.message}</p>}
        </div>

        <div>
          <label className="label" htmlFor="password">Mot de passe</label>
          <PasswordInput id="password" autoComplete="new-password" className="input" placeholder="min. 8 caractères" {...register('password')} />
          {errors.password && <p className="field-error">{errors.password.message}</p>}
        </div>
        <div>
          <label className="label" htmlFor="confirm_password">Confirmer le mot de passe</label>
          <PasswordInput id="confirm_password" autoComplete="new-password" className="input" {...register('confirm_password')} />
          {errors.confirm_password && <p className="field-error">{errors.confirm_password.message}</p>}
        </div>

        <div className={copy.showPflegeOnboarding ? '' : 'md:col-span-2'}>
          <label className="label" htmlFor="whatsapp">WhatsApp</label>
          <input id="whatsapp" type="tel" inputMode="tel" autoComplete="tel" autoCapitalize="none" className="input" placeholder="0555290826" {...register('whatsapp')} />
          {errors.whatsapp && <p className="field-error">{errors.whatsapp.message}</p>}
        </div>

        {/* Pflege-only onboarding. Not rendered, not sent and not required for
            Immigration — an Immigration student is never asked a nursing question. */}
        {copy.showPflegeOnboarding && (
          <div>
            <label className="label" htmlFor="diplome_algerien">Diplôme algérien</label>
            <select id="diplome_algerien" className="input" {...register('diplome_algerien')}>
              <option value="DEI">DEI (Diplôme d'État Infirmier)</option>
              <option value="DEMA">DEMA</option>
              <option value="ATS">ATS</option>
              <option value="Autre">Autre</option>
            </select>
            {errors.diplome_algerien && <p className="field-error">{errors.diplome_algerien.message}</p>}
          </div>
        )}

        <div className="md:col-span-2">
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-1" {...register('accept_terms')} />
            <span>
              J’accepte les{' '}
              <a href="https://aurel-academy.com/conditions/" className="text-aurel-orange hover:underline" target="_blank" rel="noopener">
                conditions d’utilisation
              </a>{' '}
              et la{' '}
              <a href="https://aurel-academy.com/confidentialite/" className="text-aurel-orange hover:underline" target="_blank" rel="noopener">
                politique de confidentialité
              </a>.
            </span>
          </label>
          {errors.accept_terms && <p className="field-error">{errors.accept_terms.message}</p>}
        </div>

        <div className="md:col-span-2 mt-2">
          <button type="submit" disabled={submitting || !watch('accept_terms')} className="btn-primary btn-lg btn-block">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />} {copy.submitLabel}
          </button>
          {/* SHERLOCK R14 — L6 : reassurance while submitting. On a slow DZ ISP
              activate-account can take 5-15s; with no feedback students think it
              froze and refresh, losing the activation mid-flight. */}
          {submitting && (
            <p className="mt-2 text-center text-xs text-slate-500">
              Activation en cours, ne fermez pas la page…
            </p>
          )}
        </div>
      </form>
    </>
  );
}
