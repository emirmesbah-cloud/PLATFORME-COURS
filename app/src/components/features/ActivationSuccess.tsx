import { CheckCircle2, ArrowRight } from 'lucide-react';
import { PROGRAM_COPY, type Program } from '@/lib/activation';

interface Props {
  program: Program;
  firstName: string;
  /**
   * Must do a FULL page load, not a client-side navigate.
   *
   * The session is written straight to localStorage and `setSession()` is
   * fire-and-forget, so useAuth's React state is still empty at this point.
   * A router navigate would hit AuthGuard with session === null and bounce the
   * student to /login right after telling them the account was activated.
   * (SHERLOCK R10 / R11)
   */
  onContinue: () => void;
}

/**
 * Step 5 — explicit success screen with a CTA into the course.
 *
 * Used by Immigration. Pflege keeps its existing behaviour (toast + immediate
 * redirect to /dashboard) so its onboarding is unchanged.
 */
export function ActivationSuccess({ program, firstName, onContinue }: Props) {
  const copy = PROGRAM_COPY[program];

  return (
    <div className="text-center">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
        <CheckCircle2 className="h-8 w-8 text-emerald-600" />
      </div>

      <h1 className="mb-2 text-2xl font-bold text-aurel-ink">
        Bienvenue{firstName ? ` ${firstName}` : ''} !
      </h1>
      <p className="mx-auto mb-8 max-w-md text-sm text-slate-600">{copy.successMessage}</p>

      <button type="button" onClick={onContinue} className="btn-primary btn-lg btn-block">
        {copy.successCta} <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}
