import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Mail } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { AurelLogo } from '@/components/features/AurelLogo';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const toast = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/reset-password',
    });
    setSubmitting(false);
    if (error) {
      toast.error('Erreur. Réessaie ou contacte Aurel.', 'Envoi impossible');
      return;
    }
    setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center"><AurelLogo size="lg" /></div>
        <div className="card-padded">
          <h1 className="mb-1 text-2xl font-bold text-aurel-ink">Mot de passe oublié</h1>
          <p className="mb-6 text-sm text-slate-600">
            Saisis ton email. On t'envoie un lien pour réinitialiser ton mot de passe.
          </p>

          {sent ? (
            <div className="rounded-lg bg-green-50 p-4 text-sm text-green-700">
              ✅ Si un compte existe avec cet email, tu vas recevoir un lien dans quelques minutes.
              Vérifie aussi tes spams.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label" htmlFor="email">Email</label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                    className="input pl-10" placeholder="ton@email.com" />
                </div>
              </div>
              <button type="submit" disabled={submitting} className="btn-primary btn-lg btn-block">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Envoyer le lien
              </button>
            </form>
          )}

          <p className="mt-6 text-center text-sm">
            <Link to="/login" className="text-aurel-teal hover:underline">← Retour connexion</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
