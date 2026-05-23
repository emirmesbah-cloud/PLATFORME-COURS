import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, LogOut, Mail, Calendar, Award } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { tierLabel, formatDate, WHATSAPP_REGEX, normalizeWhatsapp } from '@/lib/utils';

export function StudentProfile() {
  const { profile, user, refreshProfile, signOut } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [first, setFirst] = useState(profile?.first_name ?? '');
  const [last, setLast] = useState(profile?.last_name ?? '');
  const [whatsapp, setWhatsapp] = useState(profile?.whatsapp ?? '');
  const [diplome, setDiplome] = useState(profile?.diplome_algerien ?? 'DEI');
  const [saving, setSaving] = useState(false);

  // SHERLOCK R14 — H3 : sync form state quand le profile arrive de la DB
  // après le boot. useState n'init qu'au 1er render — si AuthProvider hydrate
  // profile depuis cache/JWT (donc vide ou stub), puis remplace par les
  // vraies données DB 200ms plus tard, les inputs restaient sur l'ancienne
  // valeur. Bug user-visible : "j'ai changé mon nom mais après refresh le
  // form affiche l'ancien et écraserait le bon si je sauve". On re-sync à
  // chaque changement effectif d'identité du profile.
  useEffect(() => {
    setFirst(profile?.first_name ?? '');
    setLast(profile?.last_name ?? '');
    setWhatsapp(profile?.whatsapp ?? '');
    setDiplome(profile?.diplome_algerien ?? 'DEI');
  }, [profile?.id, profile?.first_name, profile?.last_name, profile?.whatsapp, profile?.diplome_algerien]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    // Normalize first so we test the canonical form (handles "+213 555 290 826"
    // with spaces, or stored values that have minor formatting drift).
    const trimmedWa = whatsapp.replace(/\s/g, '').trim();
    if (!WHATSAPP_REGEX.test(trimmedWa)) {
      toast.error('Format WhatsApp : 0555290826 ou +213555290826', 'Numéro invalide');
      return;
    }
    const normalizedWa = normalizeWhatsapp(trimmedWa);
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ first_name: first.trim(), last_name: last.trim(), whatsapp: normalizedWa, diplome_algerien: diplome })
      .eq('id', user.id)
      .select('id')
      .maybeSingle();
    setSaving(false);
    if (error) {
      // SHERLOCK R7 fix : surface the actual error code/message instead
      // of a generic "Réessaie" — helps debug RLS / trigger failures.
      // eslint-disable-next-line no-console
      console.warn('[Aurel] profile save error:', error);
      const msg = error.code === '42501'
        ? 'Permission refusée (RLS). Si tu viens de te connecter, recharge la page.'
        : `Impossible de sauvegarder. ${error.message?.slice(0, 80) || 'Réessaie.'}`;
      toast.error(msg, 'Erreur');
      return;
    }
    await refreshProfile();
    toast.success('Profil mis à jour.');
  }

  async function handlePasswordReset() {
    if (!profile?.email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(profile.email, {
      redirectTo: window.location.origin + '/reset-password',
    });
    if (error) {
      toast.error('Impossible d\'envoyer l\'email.', 'Erreur');
      return;
    }
    toast.success(`Lien envoyé à ${profile.email}.`, 'Email envoyé');
  }

  async function handleSignOut() {
    // signOut() is now optimistic (clears local state synchronously before
    // the server roundtrip), so navigate fires reliably even on slow ISP.
    // SHERLOCK R7 fix : `replace: true` so back-button doesn't render a
    // cached profile view post-logout.
    await signOut();
    navigate('/login', { replace: true });
  }

  if (!profile) return null;

  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-aurel-ink">Mon profil</h1>
      </header>

      {/* Infos lecture seule */}
      <section className="card-padded">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Compte</h2>
        <dl className="space-y-3 text-sm">
          <Row icon={<Mail className="h-4 w-4 text-aurel-teal" />} label="Email" value={profile.email} />
          <Row icon={<Award className="h-4 w-4 text-aurel-orange" />} label="Formule" value={tierLabel(profile.tier)} />
          <Row icon={<Calendar className="h-4 w-4 text-slate-500" />} label="Activé le" value={formatDate(profile.activated_at)} />
        </dl>
      </section>

      {/* Édition */}
      <section className="card-padded">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Infos personnelles</h2>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="label">Prénom</label>
              <input className="input" value={first} onChange={(e) => setFirst(e.target.value)} />
            </div>
            <div>
              <label className="label">Nom</label>
              <input className="input" value={last} onChange={(e) => setLast(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">WhatsApp</label>
            <input className="input" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="0555290826" />
          </div>
          <div>
            <label className="label">Diplôme algérien</label>
            <select className="input" value={diplome ?? ''} onChange={(e) => setDiplome(e.target.value)}>
              <option value="DEI">DEI</option>
              <option value="DEMA">DEMA</option>
              <option value="ATS">ATS</option>
              <option value="Autre">Autre</option>
            </select>
          </div>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Sauvegarder
          </button>
        </form>
      </section>

      {/* Actions sensibles */}
      <section className="card-padded">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Sécurité</h2>
        <div className="flex flex-col gap-3">
          <button onClick={handlePasswordReset} className="btn-outline w-full md:w-auto">
            Changer le mot de passe (lien par email)
          </button>
          <button onClick={handleSignOut} className="btn-danger w-full md:w-auto">
            <LogOut className="h-4 w-4" /> Se déconnecter
          </button>
        </div>
      </section>
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-b-0 last:pb-0">
      <span className="flex items-center gap-2 text-slate-500">{icon} {label}</span>
      <span className="font-semibold text-aurel-ink">{value}</span>
    </div>
  );
}
