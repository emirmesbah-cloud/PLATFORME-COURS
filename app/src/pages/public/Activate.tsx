import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { AurelLogo } from '@/components/features/AurelLogo';
import { ActivationCodeForm, type CodeFormValues } from '@/components/features/ActivationCodeForm';
import { ActivationAccountForm, type AccountFormValues } from '@/components/features/ActivationAccountForm';
import { ActivationSuccess } from '@/components/features/ActivationSuccess';
import { normalizeWhatsapp, courseLabel, coursePriceDzd } from '@/lib/utils';
import {
  checkActivationCode, activateAccount, asProgram, activationErrorMessage,
  TERMINAL_CODE_STATES, PROGRAM_COPY, type Program,
} from '@/lib/activation';
import { trackEvent } from '@/lib/pixel';
import type { Tier } from '@/lib/types';

/**
 * ONE activation page for BOTH programs.
 *
 * The core rule: the URL never decides the course — the validated activation
 * code does, server-side. This page:
 *   1. asks for the code (neutral copy — we don't know the program yet)
 *   2. asks the SERVER which program that code unlocks
 *   3. renders the matching account form (Pflege keeps its nursing onboarding;
 *      Immigration is never shown a nursing question)
 *   4. creates the account + enrollment in one server-side transaction
 *   5. sends the student to their own course
 *
 * The `program` value only ever picks which form to draw. The enrollment is
 * re-derived from the code row inside redeem_activation_code, so tampering with
 * the client state changes what you see and not what you get.
 */

/**
 * Fire the Meta Pixel "Purchase" event when a student successfully activates.
 *
 * Aurel sells cash-on-delivery: the student pays in person before receiving a
 * code, so by the time they're on this page they have ALREADY PAID — a real
 * purchase from Meta's perspective, not a lead. Fired once per real activation
 * from each success path. No-op if fbq isn't loaded (ad-blocker, dev).
 */
function fireActivationPurchase(args: { tier: Tier; course: Program; first_name: string }) {
  trackEvent('Purchase', {
    content_name: 'Activation Aurel Academy',
    content_category: courseLabel(args.course),
    tier: args.tier,
    course: args.course,
    first_name: args.first_name,
    value: coursePriceDzd(args.course, args.tier),
    currency: 'DZD',
  });
}

type Step = 'code' | 'account' | 'success';

export function ActivatePage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [step, setStep] = useState<Step>('code');
  const [code, setCode] = useState('');
  // Both come from the server, never from parsing the code in the browser.
  const [program, setProgram] = useState<Program | null>(null);
  const [codeTier, setCodeTier] = useState<Tier | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // SHERLOCK R6 fix : double-submit ref guard (sync) for slow 3G.
  const submittingRef = useRef(false);

  // ── Step 1 → 2 : which program does this code unlock? ─────────────────────
  async function onCodeSubmit(values: CodeFormValues) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setCodeError(null);

    try {
      const result = await checkActivationCode(values.code);
      if (!result.ok || !result.program) {
        setCodeError(activationErrorMessage(result.error));
        return;
      }
      setCode(values.code);
      setProgram(result.program);
      setCodeTier(result.tier ?? null);
      setStep('account');
    } catch {
      setCodeError(activationErrorMessage('NETWORK_ERROR'));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  /** Send the student back to step 1 with an explanation. */
  function failBackToCode(error: string | undefined) {
    setCodeError(activationErrorMessage(error));
    setProgram(null);
    setCodeTier(null);
    setStep('code');
  }

  // ── Step 4 : create the account + the enrollment ──────────────────────────
  async function onAccountSubmit(values: AccountFormValues) {
    if (submittingRef.current || !program) return;

    submittingRef.current = true;
    setSubmitting(true);
    const email = values.email.trim().toLowerCase();
    const password = values.password;
    const first_name = values.first_name.trim();
    const whatsapp = normalizeWhatsapp(values.whatsapp.trim());

    /**
     * Auto-recovery: if activate-account already created the account but the
     * response was lost (network drop), a retry returns CODE_ALREADY_USED. We
     * silently sign in with the credentials just entered — and then verify the
     * PROFILE exists, because an auth.users row without a profile means the
     * activation did not really succeed and AuthGuard would loop
     * /dashboard ↔ /activate. (SHERLOCK R3)
     *
     * The course comes from the profile row, i.e. still server-side truth.
     */
    const tryAutoLogin = async (): Promise<Program | null> => {
      const { data: signInData, error: signInErr } =
        await supabase.auth.signInWithPassword({ email, password });
      if (signInErr || !signInData?.session?.user) return null;
      const { data: prof, error: profErr } = await supabase
        .from('profiles')
        .select('id, course_access')
        .eq('id', signInData.session.user.id)
        .maybeSingle();
      if (profErr || !prof) {
        await supabase.auth.signOut().catch(() => {});
        return null;
      }
      return asProgram(prof.course_access) ?? 'pflege';
    };

    /** Shared terminal handling: pixel, then success screen or redirect. */
    const finish = (course: Program, tier: Tier) => {
      fireActivationPurchase({ tier, course, first_name });
      setFirstName(first_name);
      if (PROGRAM_COPY[course].showSuccessScreen) {
        setProgram(course);
        setStep('success');
        return;
      }
      // Pflege keeps its existing behaviour: toast + straight to the dashboard.
      toast.success(`Bienvenue ${first_name} chez Aurel Academy !`, 'Compte activé');
      window.location.replace(PROGRAM_COPY[course].destination);
    };

    try {
      // No course/program is sent — the server reads it off the code row.
      const data = await activateAccount({
        code, email, password,
        first_name,
        last_name: values.last_name.trim(),
        whatsapp,
      });

      if (!data.ok) {
        const recoverable = data.error === 'CODE_ALREADY_USED' || data.error === 'EMAIL_ALREADY_EXISTS';
        const recoveredCourse = recoverable ? await tryAutoLogin() : null;
        if (recoveredCourse) {
          finish(recoveredCourse, codeTier ?? 'autonome');
          return;
        }
        // The code stopped being usable between step 1 and step 4 (revoked,
        // claimed by someone else, put on hold). Step 1 owns the code, so the
        // student goes back there rather than being stuck on a dead form.
        if (data.error && TERMINAL_CODE_STATES.has(data.error)) {
          failBackToCode(data.error);
          return;
        }
        toast.error(activationErrorMessage(data.error), 'Activation impossible');
        // R22 : on EMAIL_ALREADY_EXISTS with auto-login failure, point the
        // student at the login page so they know where to go.
        if (data.error === 'EMAIL_ALREADY_EXISTS') {
          setTimeout(() => navigate('/login', { state: { from: { pathname: '/' } } }), 1500);
        }
        return;
      }

      // SHERLOCK R10 fix — TOTALEMENT non-bloquant.
      // Bug : sur ISP lent, soit `await supabase.auth.setSession()` soit le
      // SIGNED_IN handler interne (qui appelle claim_session RPC) hang 15-30s,
      // bloquant la navigation. User stuck sur "Activation en cours" alors que
      // tout a réussi côté serveur (auth.users + profile créés, code redeemed).
      //
      // Fix : on stocke MANUELLEMENT les tokens dans localStorage au format
      // attendu par supabase-js (clé 'aurel-academy-auth'). useAuth bootstrap
      // les hydratera au prochain render.
      try {
        const sessionPayload = {
          currentSession: {
            access_token:  data.session!.access_token,
            refresh_token: data.session!.refresh_token,
            expires_at:    data.session!.expires_at,
            expires_in:    data.session!.expires_in,
            token_type:    data.session!.token_type ?? 'bearer',
            user: data.user ? {
              id:    data.user.id,
              email: data.user.email ?? email,
              user_metadata: {
                first_name,
                last_name: values.last_name.trim(),
                whatsapp,
              },
            } : undefined,
          },
          expiresAt: data.session!.expires_at,
        };
        localStorage.setItem('aurel-academy-auth', JSON.stringify(sessionPayload));
      } catch (e) {
        console.warn('[Aurel] manual session storage failed:', e);
      }

      // Fire setSession in background — non-blocking
      supabase.auth.setSession({
        access_token:  data.session!.access_token,
        refresh_token: data.session!.refresh_token,
      }).then(() => {}, (e) => console.warn('[Aurel] setSession bg failed (non-blocking):', e?.message ?? e));

      // The activated course is whatever the SERVER says it is. `program` is
      // itself the server's answer from step 1, so the fallback is still
      // server-derived — the code is never parsed in the browser.
      const activatedCourse = asProgram(data.user?.course) ?? program;
      const activatedTier = (data.user?.tier ?? codeTier ?? 'autonome') as Tier;

      // Diplôme algérien is Pflege-only onboarding — never written for an
      // Immigration student. Background, non-blocking.
      if (activatedCourse === 'pflege' && values.diplome_algerien && data.user) {
        supabase
          .from('profiles')
          .update({ diplome_algerien: values.diplome_algerien })
          .eq('id', data.user.id)
          .then(({ error }) => {
            if (error) console.warn('[Aurel] diplome update failed (non-blocking):', error.message);
          }, (e) => console.warn('[Aurel] diplome update threw (non-blocking):', e?.message ?? e));
      }

      // Pre-fill the profile cache : on a slow ISP this lets AuthGuard proceed
      // immediately instead of waiting on the profiles query. Without it, some
      // first-time students were bounced back to /activate (race between
      // session-set and profile-loaded).
      try {
        const nowIso = new Date().toISOString();
        const cachedProfile = {
          userId: data.user!.id,
          profile: {
            id:               data.user!.id,
            email,
            first_name,
            last_name:        values.last_name.trim(),
            whatsapp,
            tier:             activatedTier,
            course_access:    activatedCourse,
            is_admin:         false,
            activated_at:     nowIso,
            diplome_algerien: values.diplome_algerien ?? null,
            created_at:       nowIso,
            last_login_at:    nowIso,
          },
          cachedAt: Date.now(),
        };
        localStorage.setItem('aurel:profile-cache:v1', JSON.stringify(cachedProfile));
      } catch {}

      finish(activatedCourse, activatedTier);
    } catch {
      // Network error: try auto-login as a last resort.
      const recoveredCourse = await tryAutoLogin();
      if (recoveredCourse) {
        finish(recoveredCourse, codeTier ?? 'autonome');
        return;
      }
      toast.error(activationErrorMessage('NETWORK_ERROR'), 'Activation impossible');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex justify-center"><AurelLogo size="lg" /></div>

        <div className="card-padded">
          {step === 'code' && (
            <>
              <ActivationCodeForm
                onSubmit={onCodeSubmit}
                submitting={submitting}
                serverError={codeError}
                defaultCode={code}
              />
              <p className="mt-6 text-center text-sm text-slate-600">
                Pas encore de code ?{' '}
                <a href="https://aurel-academy.com/" className="font-semibold text-aurel-orange hover:underline">
                  Découvrir nos programmes
                </a>
              </p>
            </>
          )}

          {step === 'account' && program && (
            <ActivationAccountForm
              program={program}
              code={code}
              onSubmit={onAccountSubmit}
              onBack={() => { setCodeError(null); setStep('code'); }}
              submitting={submitting}
            />
          )}

          {step === 'success' && program && (
            <ActivationSuccess
              program={program}
              firstName={firstName}
              // Full page load, NOT navigate() — see ActivationSuccess docs.
              onContinue={() => window.location.replace(PROGRAM_COPY[program].destination)}
            />
          )}

          {step !== 'success' && (
            <p className="mt-6 text-center text-sm text-slate-600">
              Déjà un compte ? <Link to="/login" className="font-semibold text-aurel-teal hover:underline">Connexion</Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
