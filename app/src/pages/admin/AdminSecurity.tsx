import { useRef, useState } from 'react';
import { Loader2, Lock, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { useToast } from '@/components/ui/Toast';

export function AdminSecurity() {
  const toast = useToast();
  const busyRef = useRef(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    if (password.length < 10) return toast.error('Utilise au moins 10 caractères.');
    if (password !== confirm) return toast.error('Les mots de passe ne correspondent pas.');
    busyRef.current = true;
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword('');
      setConfirm('');
      toast.success('Ton mot de passe a été changé. Tu restes connecté sur cet appareil.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Changement impossible. Réessaie.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return <div className="max-w-2xl space-y-6">
    <header><h1 className="text-3xl font-bold text-aurel-ink">Sécurité du compte</h1><p className="mt-1 text-slate-600">Chaque administrateur change uniquement son propre mot de passe.</p></header>
    <section className="card-padded">
      <div className="mb-5 flex items-start gap-3 rounded-card-sm bg-emerald-50 p-4 text-sm text-emerald-800"><ShieldCheck className="mt-0.5 h-5 w-5 flex-none" /><p>Le changement est effectué directement sur ta session Supabase active. Aucun lien email temporaire n’est nécessaire.</p></div>
      <form onSubmit={submit} className="space-y-4">
        <div><label className="label">Nouveau mot de passe</label><PasswordInput className="input pl-10" leftIcon={<Lock className="h-4 w-4" />} value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} autoComplete="new-password" required /></div>
        <div><label className="label">Confirmer</label><PasswordInput className="input pl-10" leftIcon={<Lock className="h-4 w-4" />} value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={10} autoComplete="new-password" required /></div>
        <button className="btn-primary" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Changer mon mot de passe</button>
      </form>
    </section>
  </div>;
}
