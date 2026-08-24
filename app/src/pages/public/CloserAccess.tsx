import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Mail, Lock, UserRoundCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { AurelLogo } from '@/components/features/AurelLogo';

const ERRORS: Record<string, string> = {
  NOT_A_CLOSER: "Cet email n'est pas enregistré comme closer. Demande à l'administrateur de t'ajouter.",
  ACCOUNT_EXISTS: 'Un compte existe déjà pour cet email — vérifie ton mot de passe.',
  PASSWORD_TOO_SHORT: 'Le mot de passe doit faire au moins 8 caractères.',
  EMAIL_INVALID: 'Entre une adresse email valide.',
  CREATE_FAILED: 'La création du compte a échoué. Réessaie.',
  PROFILE_FAILED: 'La création du compte a échoué. Réessaie.',
};

export function CloserAccessPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const em = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { setError(ERRORS.EMAIL_INVALID); return; }
    if (password.length < 8) { setError(ERRORS.PASSWORD_TOO_SHORT); return; }
    setBusy(true);
    try {
      // 1. Returning closer → just log in.
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email: em, password });
      if (!signInErr) { navigate('/', { replace: true }); return; }

      // 2. First time → create the closer access (gated by the staff allowlist),
      //    then sign in.
      const { data, error: fnErr } = await supabase.functions.invoke('closer-access', { body: { email: em, password } });
      let code = (data as { error?: string } | null)?.error;
      if (fnErr) {
        const ctx = (fnErr as { context?: { json?: () => Promise<unknown> } }).context;
        if (ctx?.json) { try { code = ((await ctx.json()) as { error?: string }).error; } catch { /* body consumed */ } }
      }
      if (code) { setError(ERRORS[code] ?? 'Accès impossible. Réessaie.'); return; }

      const { error: signInErr2 } = await supabase.auth.signInWithPassword({ email: em, password });
      if (signInErr2) { setError('Compte créé — réessaie de te connecter.'); return; }
      navigate('/', { replace: true });
    } catch {
      setError('Une erreur est survenue. Réessaie.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-zinc-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center"><AurelLogo size="lg" /></div>
        <div className="card p-6 md:p-8">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-aurel-teal-soft text-aurel-teal-dark">
              <UserRoundCheck className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-bold text-aurel-ink">Espace Closer</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Connecte-toi pour accéder aux prospects. Première fois ? Utilise l'email fourni par l'administrateur et choisis ton mot de passe.
            </p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <label className="block space-y-1.5">
              <span className="label">Email</span>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
                <input className="input pl-9" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ton@email.com" />
              </div>
            </label>
            <label className="block space-y-1.5">
              <span className="label">Mot de passe</span>
              <PasswordInput className="input pl-9" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Au moins 8 caractères" leftIcon={<Lock className="h-4 w-4" />} />
            </label>
            {error && <div role="alert" className="rounded-card-sm border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
            <button type="submit" className="btn-primary btn-block min-h-[46px]" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundCheck className="h-4 w-4" />} Accéder
            </button>
          </form>
        </div>
        <p className="mt-5 text-center text-xs text-zinc-400">© 2026 Aurel Academy</p>
      </div>
    </main>
  );
}
