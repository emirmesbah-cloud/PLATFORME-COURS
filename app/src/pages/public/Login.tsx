import { useRef, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Mail, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { AurelLogo } from '@/components/features/AurelLogo';

const schema = z.object({
  email: z.string().email('Email invalide'),
  password: z.string().min(8, 'Au moins 8 caractères'),
});
type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  // Sherlock fix : was missing `resolver`, so `errors` stayed empty and the
  // inline {errors.email && ...} messages never rendered.
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });
  const [submitting, setSubmitting] = useState(false);
  // SHERLOCK R6 fix : ref-guard against double-submit on slow 3G.
  // disabled={submitting} commits async; ref is sync — blocks the second
  // tap before React schedules the disable. Mirrors Feedback.tsx pattern.
  const submittingRef = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  async function onSubmit(values: FormValues) {
    if (submittingRef.current) return;
    const parse = schema.safeParse(values);
    if (!parse.success) return;
    submittingRef.current = true;
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword(parse.data);
    if (error) {
      submittingRef.current = false;
      setSubmitting(false);
      toast.error('Email ou mot de passe incorrect.', 'Connexion impossible');
      return;
    }

    submittingRef.current = false;
    setSubmitting(false);

    // SHERLOCK R3 fix : on N'EXÉCUTE PLUS un SELECT is_admin manuel ici.
    // Avant, ce check bypassait le `isAdmin = profileSource === 'db'` gate
    // de useAuth — un admin avec poisoned cache était routé vers /admin
    // dès le sign-in, exposant l'URL admin avant la confirmation DB.
    // Maintenant : on route toujours vers "/" (RootRedirect), qui attend
    // la confirmation DB du profile et tranche admin/student avec le
    // isAdmin gated du context. Single source of truth.
    const fromPath = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
    navigate(fromPath || '/', { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center"><AurelLogo size="lg" /></div>

        <div className="card-padded">
          <h1 className="mb-1 text-2xl font-bold text-aurel-ink">Connexion</h1>
          <p className="mb-6 text-sm text-slate-600">Bienvenue sur ton espace étudiant.</p>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div>
              <label className="label" htmlFor="email">Email</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="input pl-10"
                  placeholder="ton@email.com"
                  {...register('email')}
                />
              </div>
              {errors.email && <p className="field-error">{errors.email.message}</p>}
            </div>

            <div>
              <label className="label" htmlFor="password">Mot de passe</label>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                className="input pl-10"
                placeholder="••••••••"
                leftIcon={<Lock className="h-4 w-4" />}
                {...register('password')}
              />
              {errors.password && <p className="field-error">{errors.password.message}</p>}
            </div>

            <button type="submit" disabled={submitting} className="btn-primary btn-lg btn-block">
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Se connecter
            </button>
          </form>

          <div className="mt-6 flex flex-col items-center gap-2 text-sm">
            <Link to="/forgot-password" className="text-aurel-teal hover:underline">Mot de passe oublié ?</Link>
            <p className="text-slate-600">
              Pas encore de compte ?{' '}
              <Link to="/activate" className="font-semibold text-aurel-orange hover:underline">Active ton code</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
