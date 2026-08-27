import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Mail, Lock, UserRoundCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { AurelLogo } from '@/components/features/AurelLogo';

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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { setError('Entre une adresse email valide.'); return; }
    if (password.length < 8) { setError('Le mot de passe doit faire au moins 8 caractères.'); return; }
    setBusy(true);
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email: em, password });
      if (signInErr) { setError('Email ou mot de passe incorrect.'); return; }
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
              Accès sécurisé aux prospects qui te sont attribués.
            </p>
          </div>
          <div className="mb-5 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-center text-sm text-zinc-600">
            Ton compte est créé uniquement par un administrateur. Utilise l’email et le mot de passe reçus.
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
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundCheck className="h-4 w-4" />}
              Accéder
            </button>
            <button type="button" className="w-full text-center text-sm text-zinc-500 hover:text-aurel-orange" onClick={() => navigate('/forgot-password')}>Mot de passe oublié ?</button>
          </form>
        </div>
        <p className="mt-5 text-center text-xs text-zinc-400">© 2026 Aurel Academy</p>
      </div>
    </main>
  );
}
