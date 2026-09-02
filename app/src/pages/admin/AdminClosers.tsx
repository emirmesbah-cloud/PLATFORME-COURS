import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, UserRoundCheck } from 'lucide-react';
import { fetchStaffMembers, provisionCloserAccount, queryKeys, upsertStaffMember } from '@/lib/queries';
import { useToast } from '@/components/ui/Toast';

const EMPTY = { first_name: '', last_name: '', email: '', whatsapp: '', permissions: ['prospects'], tasks: [] as string[], is_active: true };
const ACCESS_OPTIONS = [
  { value: 'prospects', label: 'Prospects' },
  { value: 'formulaire', label: 'Formulaire' },
  { value: 'commandes', label: 'Commandes' },
  { value: 'codes', label: 'Codes' },
];

export function AdminClosers() {
  const toast = useToast();
  const qc = useQueryClient();
  const staffQ = useQuery({ queryKey: queryKeys.adminStaff, queryFn: fetchStaffMembers });
  const [draft, setDraft] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(input: typeof EMPTY & { id?: string }) {
    if (!input.first_name.trim() || !input.email.trim()) return toast.error('Nom et email obligatoires.');
    if (!input.permissions.length) return toast.error('Attribue au moins un accès.');
    if (!window.confirm(`Confirmer les accès de ${input.first_name} : ${input.permissions.join(', ')} ?`)) return;
    setSaving(true);
    try {
      await upsertStaffMember(input);
      const account = await provisionCloserAccount(input.email, !input.id);
      await qc.invalidateQueries({ queryKey: queryKeys.adminStaff });
      setDraft(EMPTY);
      setEditingId(null);
      if (account.created && account.email_sent) {
        toast.success('Closer créé. Son lien personnel pour choisir le mot de passe a été envoyé.');
      } else if (account.created) {
        toast.info('Compte créé, mais l’email de bienvenue n’a pas pu être confirmé. Vérifie la section Emails.');
      } else {
        toast.success(account.email_sent ? 'Closer enregistré. Un nouveau lien d’accès personnel a été envoyé.' : 'Closer enregistré avec les accès sélectionnés.');
      }
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Enregistrement impossible.'); }
    finally { setSaving(false); }
  }

  // Deactivate (soft) rather than hard-delete: a closer's name may already be
  // attached to past prospects/calls, so we keep the record and just flip
  // is_active. Inactive closers disappear from every attribution dropdown but
  // their history stays intact. Reactivate brings them back.
  async function toggleActive(member: { id: string; first_name: string; last_name: string; email: string; whatsapp?: string | null; permissions: string[]; tasks: string[]; is_active: boolean }) {
    const next = !member.is_active;
    if (!window.confirm(`${next ? 'Réactiver' : 'Désactiver'} ${member.first_name} ?`)) return;
    setSaving(true);
    try {
      await upsertStaffMember({
        id: member.id, first_name: member.first_name, last_name: member.last_name,
        email: member.email, whatsapp: member.whatsapp ?? undefined,
        permissions: member.permissions, tasks: member.tasks, is_active: next,
      });
      await qc.invalidateQueries({ queryKey: queryKeys.adminStaff });
      toast.success(next ? 'Closer réactivé.' : 'Closer désactivé — retiré des attributions.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Action impossible.'); }
    finally { setSaving(false); }
  }

  return <div className="space-y-6">
    <header><h1 className="text-3xl font-bold text-aurel-ink">Closers & accès</h1><p className="mt-1 text-slate-600">Attribue précisément les sections accessibles à chaque closer.</p></header>
    <section className="card-padded">
      <h2 className="mb-4 flex items-center gap-2 font-bold"><Plus className="h-5 w-5 text-aurel-orange" /> Ajouter un closer</h2>
      <div className="grid gap-3 md:grid-cols-2"><input className="input" placeholder="Prénom" value={draft.first_name} onChange={(e) => setDraft({ ...draft, first_name: e.target.value })} /><input className="input" placeholder="Nom" value={draft.last_name} onChange={(e) => setDraft({ ...draft, last_name: e.target.value })} /><input className="input" type="email" placeholder="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /><input className="input" placeholder="WhatsApp" value={draft.whatsapp} onChange={(e) => setDraft({ ...draft, whatsapp: e.target.value })} /></div>
      <div className="mt-4"><div className="label">Accès et tâches</div><div className="flex flex-wrap gap-2">{ACCESS_OPTIONS.map((option) => { const active = draft.permissions.includes(option.value); return <button key={option.value} type="button" onClick={() => setDraft({ ...draft, permissions: active ? draft.permissions.filter((value) => value !== option.value) : [...draft.permissions, option.value], tasks: active ? draft.tasks.filter((value) => value !== option.value) : [...new Set([...draft.tasks, option.value])] })} className={active ? 'btn-primary' : 'btn-outline'}>{option.label}</button>; })}</div></div>
      <div className="mt-4 flex gap-2"><button className="btn-primary" disabled={saving} onClick={() => save({ ...draft, ...(editingId ? { id: editingId } : {}) })}><Save className="h-4 w-4" /> {editingId ? 'Enregistrer les modifications' : 'Enregistrer avec confirmation'}</button>{editingId && <button className="btn-outline" onClick={() => { setEditingId(null); setDraft(EMPTY); }}>Annuler</button>}</div>
    </section>
    <section className="card overflow-hidden"><div className="border-b p-4 font-bold">Équipe actuelle</div><div className="divide-y">{(staffQ.data ?? []).map((member) => <div key={member.id} className={`grid gap-3 p-4 md:grid-cols-[1fr_1fr_220px_250px] md:items-center${member.is_active ? '' : ' opacity-60'}`}><div><div className="font-semibold">{member.first_name} {member.last_name}{!member.is_active && <span className="badge badge-slate ml-2 align-middle">Inactif</span>}</div><div className="text-xs text-slate-500">{member.whatsapp || 'WhatsApp à compléter'}</div></div><div className="text-sm">{member.email}</div><div className="flex flex-wrap gap-1">{member.permissions.map((permission) => <span key={permission} className="badge badge-orange">{ACCESS_OPTIONS.find((item) => item.value === permission)?.label ?? permission}</span>)}</div><div className="flex flex-wrap items-center gap-2 text-xs text-slate-500"><span className="flex items-center gap-1"><UserRoundCheck className="h-4 w-4" /> {member.auth_user_id ? 'Compte lié' : 'En attente'}</span><button className="btn-outline px-2 py-1 text-xs" onClick={() => { setEditingId(member.id); setDraft({ first_name: member.first_name, last_name: member.last_name, email: member.email, whatsapp: member.whatsapp ?? '', permissions: member.permissions ?? ['prospects'], tasks: member.tasks ?? [], is_active: member.is_active }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Modifier</button><button className="btn-outline px-2 py-1 text-xs" disabled={saving} onClick={() => toggleActive(member)}>{member.is_active ? 'Désactiver' : 'Réactiver'}</button></div></div>)}</div></section>
  </div>;
}
