import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Loader2, Mail, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { AurelLogo } from '@/components/features/AurelLogo';

const schema = z.object({
  email: z.string().email('Email invalide'),
  password: z.string().min(8, 'Au moins 8 caractères'),
});
type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  async function onSubmit(values: FormValues) {
    const parse = schema.safeParse(values);
    if (!parse.success) return;
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword(parse.data);
    setSubmitting(false);
    if (error) {
      toast.error('Email ou mot de passe incorrect.', 'Connexion impossible');
      return;
    }
    const dest = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/dashboard';
    navigate(dest, { replace: true });
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
                  className="input pl-10"
                  placeholder="ton@email.com"
                  {...register('email')}
                />
              </div>
              {errors.email && <p className="field-error">{errors.email.message}</p>}
            </div>

            <div>
              <label className="label" htmlFor="password">Mot de passe</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  className="input pl-10"
                  placeholder="••••••••"
                  {...register('password')}
                />
              </div>
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
