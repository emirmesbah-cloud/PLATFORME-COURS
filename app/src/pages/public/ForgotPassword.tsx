import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Mail } from 'lucide-react';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { AurelLogo } from '@/components/features/AurelLogo';

const COOLDOWN_KEY = 'aurel:forgot-password-cooldown';
const COOLDOWN_SECONDS = 60;

const emailSchema = z.string().email('Email invalide').max(254);

function readCooldownEndsAt(): number {
  try {
    const raw = localStorage.getItem(COOLDOWN_KEY);
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

function writeCooldownEndsAt(ts: number) {
  try { localStorage.setItem(COOLDOWN_KEY, String(ts)); } catch {}
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const toast = useToast();

  // SHERLOCK FIX : cooldown 60s persisté en localStorage pour empêcher
  // un user de spam reset emails (DoS du quota Resend). Le compte à rebours
  // se met à jour chaque seconde et survit au reload de la page.
  useEffect(() => {
    const tick = () => {
      const ends = readCooldownEndsAt();
      const left = Math.max(0, Math.ceil((ends - Date.now()) / 1000));
      setSecondsLeft(left);
    };
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Cooldown gate
    if (readCooldownEndsAt() > Date.now()) {
      toast.info(`Patience — réessaie dans ${secondsLeft}s.`, 'Trop rapide');
      return;
    }

    // Email validation (Sherlock fix : was just `if (!email) return`,
    // accepted "foo" as a valid email)
    const parsed = emailSchema.safeParse(email.trim().toLowerCase());
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message ?? 'Email invalide', 'Format invalide');
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: window.location.origin + '/reset-password',
    });
    setSubmitting(false);

    // Set cooldown REGARDLESS of error : on ne veut pas révéler si l'email
    // existe ou pas (privacy + anti-enumeration). Le cooldown s'applique
    // dans tous les cas.
    writeCooldownEndsAt(Date.now() + COOLDOWN_SECONDS * 1000);

    if (error) {
      // Log silencieusement, mais affiche le message neutre "si compte existe"
      // pour ne pas leak l'existence de l'email.
      // eslint-disable-next-line no-console
      console.warn('[Aurel] reset-password error', error);
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
                    autoComplete="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    className="input pl-10" placeholder="ton@email.com" />
                </div>
              </div>
              <button
                type="submit"
                disabled={submitting || secondsLeft > 0}
                className="btn-primary btn-lg btn-block"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {secondsLeft > 0 ? `Patiente ${secondsLeft}s…` : 'Envoyer le lien'}
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
