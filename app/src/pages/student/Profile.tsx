import { useState } from 'react';
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

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!WHATSAPP_REGEX.test(whatsapp.trim())) {
      toast.error('Format WhatsApp : 0555290826', 'Numéro invalide');
      return;
    }
    const normalizedWa = normalizeWhatsapp(whatsapp.trim());
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ first_name: first.trim(), last_name: last.trim(), whatsapp: normalizedWa, diplome_algerien: diplome })
      .eq('id', user.id);
    setSaving(false);
    if (error) {
      toast.error('Impossible de sauvegarder. Réessaie.', 'Erreur');
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
    await signOut();
    navigate('/login');
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
