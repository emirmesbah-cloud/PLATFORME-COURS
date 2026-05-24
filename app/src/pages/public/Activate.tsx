import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, KeyRound } from 'lucide-react';
import { supabase, SUPABASE_URL_PUBLIC } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { AurelLogo } from '@/components/features/AurelLogo';
import { ACTIVATION_CODE_REGEX, WHATSAPP_REGEX, normalizeWhatsapp } from '@/lib/utils';
import { trackEvent } from '@/lib/pixel';

/**
 * Fire the Meta Pixel "Lead" event when a student successfully activates.
 * Called from each of the 3 success paths (recovery / normal / late-login)
 * so we count one Lead per real activation, never duplicated. Wrapped to
 * be a no-op if fbq isn't loaded (ad-blocker, dev).
 */
function fireActivationLead(args: { tier: 'autonome' | 'accompagne'; first_name: string }) {
  trackEvent('Lead', {
    content_name: 'Activation Aurel Academy',
    content_category: 'Pflege',
    tier: args.tier,
    first_name: args.first_name,
    // Currency is required for Meta to register monetary value on Lead.
    // We don't have the real paid amount client-side (paid externally),
    // so we use the tier's reference price as an indicator.
    value: args.tier === 'accompagne' ? 90000 : 45000,
    currency: 'DZD',
  });
}

const schema = z.object({
  // SHERLOCK R14 — H2 : transform uppercase AVANT le regex check. L'input
  // a déjà `autoCapitalize="characters"` + `className="...uppercase..."`
  // côté visuel, mais un copier-coller de WhatsApp ("au-x3k7m9") échappait
  // au CSS uppercase (qui ne change pas la value du DOM, seulement le
  // rendering) et le regex `^(AU|AC)-...$` rejetait silencieusement.
  // Transform + pipe garantit que le state contient toujours UPPERCASE.
  code: z.string().trim().transform((s) => s.toUpperCase()).pipe(
    z.string().regex(ACTIVATION_CODE_REGEX, 'Format attendu : AU-XXXXXX ou AC-XXXXXX (6 caractères)')
  ),
  email: z.string().email('Email invalide'),
  password: z.string().min(8, 'Au moins 8 caractères').max(128, 'Maximum 128 caractères'),
  confirm_password: z.string().min(8).max(128),
  first_name: z.string().min(1, 'Prénom requis').max(50),
  last_name: z.string().min(1, 'Nom requis').max(50),
  whatsapp: z.string().regex(WHATSAPP_REGEX, 'Format : 0555290826 (numéro algérien)'),
  diplome_algerien: z.enum(['DEI', 'DEMA', 'ATS', 'Autre']),
  accept_terms: z.literal(true, { errorMap: () => ({ message: 'Tu dois accepter les conditions' }) }),
}).refine((d) => d.password === d.confirm_password, {
  message: 'Les mots de passe ne correspondent pas',
  path: ['confirm_password'],
});

type FormValues = z.infer<typeof schema>;

const ERR_MSG: Record<string, string> = {
  CODE_INVALID:           'Code d\'activation invalide.',
  CODE_ALREADY_USED:      'Ce code a déjà été utilisé.',
  EMAIL_ALREADY_EXISTS:   'Un compte existe déjà avec cet email — connecte-toi.',
  EMAIL_INVALID:          'Email invalide.',
  WEAK_PASSWORD:          'Mot de passe trop faible (min. 8 caractères).',
  MISSING_FIELDS:         'Champs requis manquants.',
  REDEEM_FAILED:          'Erreur lors de l\'activation. Réessaie ou contacte Aurel.',
};

export function ActivatePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  // SHERLOCK R6 fix : double-submit ref guard (sync) for slow 3G.
  const submittingRef = useRef(false);
  // Sherlock fix : was missing `resolver`, so `errors` stayed empty and all
  // inline {errors.X && ...} messages never rendered. Users only saw a single
  // generic toast on submit. Now per-field validation works.
  const { register, handleSubmit, formState: { errors }, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { diplome_algerien: 'DEI' as const, accept_terms: false as never },
  });

  async function onSubmit(raw: FormValues) {
    if (submittingRef.current) return;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const firstErr = parsed.error.errors[0];
      const fieldName = firstErr.path.join('.');
      toast.error(`${fieldName || 'champ'} : ${firstErr.message}`, 'Formulaire invalide');
      // eslint-disable-next-line no-console
      console.error('[Aurel] Activate validation errors:', parsed.error.errors);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    const email = parsed.data.email.trim().toLowerCase();
    const password = parsed.data.password;

    // Auto-recovery : si activate-account a déjà créé le compte mais que la
    // réponse a été perdue (network drop), retry retournerait CODE_ALREADY_USED.
    // On tente alors un signin silencieux avec les creds que l'user vient de
    // saisir — si ça marche, on vérifie que le profil EXISTE (sinon le user
    // est dans un état orphan : auth.users sans profile → AuthGuard
    // bouclera /dashboard ↔ /activate). SHERLOCK R3 fix : on faisait juste
    // un sign-in successful check, on n'attrapait pas le cas orphan.
    const tryAutoLogin = async (): Promise<boolean> => {
      const { data: signInData, error: signInErr } =
        await supabase.auth.signInWithPassword({ email, password });
      if (signInErr || !signInData?.session?.user) return false;
      // Verify the profile actually exists for this user. If it doesn't,
      // the activation didn't really succeed — the auth.users row is orphan.
      // We sign back out and surface an explicit error so the user knows
      // to contact support instead of looping.
      const { data: prof, error: profErr } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', signInData.session.user.id)
        .maybeSingle();
      if (profErr || !prof) {
        await supabase.auth.signOut().catch(() => {});
        return false;
      }
      return true;
    };

    try {
      const r = await fetch(`${SUPABASE_URL_PUBLIC}/functions/v1/activate-account`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY as string,
        },
        body: JSON.stringify({
          code: parsed.data.code.trim(),
          email,
          password,
          first_name: parsed.data.first_name.trim(),
          last_name: parsed.data.last_name.trim(),
          whatsapp: normalizeWhatsapp(parsed.data.whatsapp.trim()),
        }),
      });
      const data = await r.json();
      if (!data.ok) {
        const recoverable = ['CODE_ALREADY_USED', 'EMAIL_ALREADY_EXISTS'].includes(data.error);
        if (recoverable && await tryAutoLogin()) {
          fireActivationLead({
            tier: parsed.data.code.startsWith('AC-') ? 'accompagne' : 'autonome',
            first_name: parsed.data.first_name.trim(),
          });
          toast.success(`Bienvenue ${parsed.data.first_name} chez Aurel Academy !`, 'Compte activé');
          window.location.replace('/dashboard');
          return;
        }
        const msg = ERR_MSG[data.error] || 'Erreur inconnue. Contacte Aurel.';
        // R22 : on EMAIL_ALREADY_EXISTS with auto-login failure, redirect
        // to /login after toast so the user knows where to go.
        toast.error(msg, 'Activation impossible');
        if (data.error === 'EMAIL_ALREADY_EXISTS') {
          setTimeout(() => navigate('/login', { state: { from: { pathname: '/dashboard' } } }), 1500);
        }
        return;
      }

      // SHERLOCK R10 fix — TOTALEMENT non-bloquant.
      // Bug : sur ISP lent, soit `await supabase.auth.setSession()` soit le
      // SIGNED_IN handler interne (qui appelle claim_session RPC) hang 15-30s,
      // bloquant le navigate vers /dashboard. User stuck sur "Activer mon
      // compte" alors que tout a réussi côté serveur (auth.users + profile
      // créés, code redeemed, welcome email envoyé).
      //
      // Fix : on stocke MANUELLEMENT les tokens dans localStorage au format
      // attendu par supabase-js (clé 'aurel-academy-auth'). useAuth bootstrap
      // les hydratera au prochain render. setSession() est fired in background
      // pour activer les handlers Supabase officiels — mais on navigate AVANT
      // qu'il complete. Le diplôme update suit le même pattern.
      try {
        const sessionPayload = {
          currentSession: {
            access_token:  data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_at:    data.session.expires_at,
            expires_in:    data.session.expires_in,
            token_type:    data.session.token_type ?? 'bearer',
            user: data.user ? {
              id:    data.user.id,
              email: data.user.email ?? email,
              user_metadata: {
                first_name: parsed.data.first_name.trim(),
                last_name:  parsed.data.last_name.trim(),
                whatsapp:   normalizeWhatsapp(parsed.data.whatsapp.trim()),
              },
            } : undefined,
          },
          expiresAt: data.session.expires_at,
        };
        localStorage.setItem('aurel-academy-auth', JSON.stringify(sessionPayload));
      } catch (e) {
        console.warn('[Aurel] manual session storage failed:', e);
      }

      // Fire setSession in background — non-blocking
      supabase.auth.setSession({
        access_token:  data.session.access_token,
        refresh_token: data.session.refresh_token,
      }).then(() => {}, (e) => console.warn('[Aurel] setSession bg failed (non-blocking):', e?.message ?? e));

      // Fire diplôme update in background — non-blocking
      supabase
        .from('profiles')
        .update({ diplome_algerien: parsed.data.diplome_algerien })
        .eq('id', data.user.id)
        .then(({ error }) => {
          if (error) console.warn('[Aurel] diplome update failed (non-blocking):', error.message);
        }, (e) => console.warn('[Aurel] diplome update threw (non-blocking):', e?.message ?? e));

      // Pre-fill profile cache (port from Naim) : sur ISP lent, le cache
      // localStorage permet à AuthGuard de passer immédiatement vers
      // /dashboard sans attendre la query DB sur profiles. Sans ça, des
      // étudiants en première activation pouvaient être bouncés vers
      // /activate (race condition session-set vs profile-loaded).
      try {
        const nowIso = new Date().toISOString();
        const cachedProfile = {
          userId:   data.user.id,
          profile: {
            id:               data.user.id,
            email:            email,
            first_name:       parsed.data.first_name.trim(),
            last_name:        parsed.data.last_name.trim(),
            whatsapp:         normalizeWhatsapp(parsed.data.whatsapp.trim()),
            tier:             data.user.tier,
            is_admin:         false,
            activated_at:     nowIso,
            diplome_algerien: parsed.data.diplome_algerien,
            created_at:       nowIso,
            last_login_at:    nowIso,
          },
          cachedAt: Date.now(),
        };
        localStorage.setItem('aurel:profile-cache:v1', JSON.stringify(cachedProfile));
      } catch {}

      // Meta Pixel — fire Lead BEFORE navigation. Window.location.replace
      // does a hard reload, so any synchronous fbq() call must run first.
      fireActivationLead({
        tier: (data.user?.tier ?? (parsed.data.code.startsWith('AC-') ? 'accompagne' : 'autonome')) as 'autonome' | 'accompagne',
        first_name: parsed.data.first_name.trim(),
      });
      toast.success(`Bienvenue ${parsed.data.first_name} chez Aurel Academy !`, 'Compte activé');
      // SHERLOCK R11 fix : window.location.replace au lieu de navigate().
      // navigate() est un client-side route change qui ne re-bootstrap PAS useAuth.
      // useAuth état React = session: null (car setSession est fire-and-forget en R10).
      // → AuthGuard voit session null → redirect /login → user voit Connexion form
      //   au lieu du dashboard alors que toast disait "Compte activé".
      // window.location.replace force un full reload :
      //   1. App React re-mount
      //   2. useAuth bootstrap lit localStorage (qu'on a écrit manuellement en R10)
      //   3. Session hydrate synchrone, AuthGuard pass, /dashboard render.
      // Timing : ~500ms de white flash, c'est OK pour une activation one-time.
      window.location.replace('/dashboard');
    } catch (e) {
      // Network error: try auto-login as last resort
      if (await tryAutoLogin()) {
        fireActivationLead({
          tier: parsed.data.code.startsWith('AC-') ? 'accompagne' : 'autonome',
          first_name: parsed.data.first_name.trim(),
        });
        toast.success(`Bienvenue ${parsed.data.first_name} chez Aurel Academy !`, 'Compte activé');
        window.location.replace('/dashboard');
        return;
      }
      toast.error('Erreur réseau. Vérifie ta connexion.', 'Activation impossible');
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
          <div className="mb-6 flex items-start gap-3 rounded-lg bg-aurel-orange-soft p-4 text-sm text-aurel-orange-dark">
            <KeyRound className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <div>
              <div className="font-semibold">Active ton compte</div>
              <p>Saisis le code d'activation reçu par WhatsApp après paiement.</p>
            </div>
          </div>

          <h1 className="mb-1 text-2xl font-bold text-aurel-ink">Activation de ton compte</h1>
          <p className="mb-6 text-sm text-slate-600">
            Tu n'as pas encore de code ?{' '}
            <a href="https://aurel-academy.com/pflege/inscription/" className="font-semibold text-aurel-orange hover:underline">
              Découvre le programme
            </a>
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 gap-4 md:grid-cols-2" noValidate>
            <div className="md:col-span-2">
              <label className="label" htmlFor="code">Code d'activation</label>
              <input id="code" placeholder="AU-XXXXXX ou AC-XXXXXX" autoCapitalize="characters" autoCorrect="off" spellCheck={false} className="input font-mono uppercase tracking-widest" {...register('code')} />
              {errors.code && <p className="field-error">{errors.code.message}</p>}
            </div>

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
              <input id="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="input" placeholder="ton@email.com" {...register('email')} />
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

            <div>
              <label className="label" htmlFor="whatsapp">WhatsApp</label>
              <input id="whatsapp" type="tel" inputMode="tel" autoComplete="tel" autoCapitalize="none" className="input" placeholder="0555290826" {...register('whatsapp')} />
              {errors.whatsapp && <p className="field-error">{errors.whatsapp.message}</p>}
            </div>
            <div>
              <label className="label" htmlFor="diplome_algerien">Diplôme algérien</label>
              <select id="diplome_algerien" className="input" {...register('diplome_algerien')}>
                <option value="DEI">DEI (Diplôme d'État Infirmier)</option>
                <option value="DEMA">DEMA</option>
                <option value="ATS">ATS</option>
                <option value="Autre">Autre</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input type="checkbox" className="mt-1" {...register('accept_terms')} />
                <span>
                  J'accepte les{' '}
                  <a href="https://aurel-academy.com/conditions/" className="text-aurel-orange hover:underline" target="_blank" rel="noopener">
                    conditions d'utilisation
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
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Activer mon compte
              </button>
              {/* SHERLOCK R14 — L6 : sub-text rassurant pendant le submit. Sur
                  ISP DZ lent, l'activate-account peut prendre 5-15s — sans
                  feedback, l'user croit que c'est freezé et refresh la page
                  (qui interrompt et leur fait perdre le compte activé). */}
              {submitting && (
                <p className="text-xs text-slate-500 mt-2 text-center">
                  Activation en cours, ne ferme pas la page…
                </p>
              )}
            </div>
          </form>

          <p className="mt-6 text-center text-sm text-slate-600">
            Déjà un compte ? <Link to="/login" className="font-semibold text-aurel-teal hover:underline">Connexion</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
