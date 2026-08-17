import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, UserRoundCheck } from 'lucide-react';
import { fetchStaffMembers, queryKeys, upsertStaffMember } from '@/lib/queries';
import { useToast } from '@/components/ui/Toast';

const EMPTY = { first_name: '', last_name: '', email: '', whatsapp: '', permissions: ['prospects'], tasks: [] as string[], is_active: true };

export function AdminClosers() {
  const toast = useToast();
  const qc = useQueryClient();
  const staffQ = useQuery({ queryKey: queryKeys.adminStaff, queryFn: fetchStaffMembers });
  const [draft, setDraft] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(input: typeof EMPTY & { id?: string }) {
    if (!input.first_name.trim() || !input.email.trim()) return toast.error('Nom et email obligatoires.');
    if (!window.confirm(`Confirmer l’enregistrement de ${input.first_name} avec accès uniquement à Prospects ?`)) return;
    setSaving(true);
    try {
      await upsertStaffMember({ ...input, permissions: ['prospects'] });
      await qc.invalidateQueries({ queryKey: queryKeys.adminStaff });
      setDraft(EMPTY);
      setEditingId(null);
      toast.success('Closer enregistré. Accès limité à Prospects.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Enregistrement impossible.'); }
    finally { setSaving(false); }
  }

  return <div className="space-y-6">
    <header><h1 className="text-3xl font-bold text-aurel-ink">Closers & accès</h1><p className="mt-1 text-slate-600">Les closers ne voient que la section Prospects. Les autres sections restent bloquées côté interface et base de données.</p></header>
    <section className="card-padded">
      <h2 className="mb-4 flex items-center gap-2 font-bold"><Plus className="h-5 w-5 text-aurel-orange" /> Ajouter un closer</h2>
      <div className="grid gap-3 md:grid-cols-2"><input className="input" placeholder="Prénom" value={draft.first_name} onChange={(e) => setDraft({ ...draft, first_name: e.target.value })} /><input className="input" placeholder="Nom" value={draft.last_name} onChange={(e) => setDraft({ ...draft, last_name: e.target.value })} /><input className="input" type="email" placeholder="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /><input className="input" placeholder="WhatsApp" value={draft.whatsapp} onChange={(e) => setDraft({ ...draft, whatsapp: e.target.value })} /><input className="input md:col-span-2" placeholder="Tâches, séparées par des virgules" value={draft.tasks.join(', ')} onChange={(e) => setDraft({ ...draft, tasks: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })} /></div>
      <div className="mt-4 flex items-center justify-between rounded-card-sm bg-zinc-50 p-3 text-sm"><span>Permission attribuée</span><span className="badge badge-orange">Prospects uniquement</span></div>
      <div className="mt-4 flex gap-2"><button className="btn-primary" disabled={saving} onClick={() => save({ ...draft, ...(editingId ? { id: editingId } : {}) })}><Save className="h-4 w-4" /> {editingId ? 'Enregistrer les modifications' : 'Enregistrer avec confirmation'}</button>{editingId && <button className="btn-outline" onClick={() => { setEditingId(null); setDraft(EMPTY); }}>Annuler</button>}</div>
    </section>
    <section className="card overflow-hidden"><div className="border-b p-4 font-bold">Équipe actuelle</div><div className="divide-y">{(staffQ.data ?? []).map((member) => <div key={member.id} className="grid gap-3 p-4 md:grid-cols-[1fr_1fr_170px_190px] md:items-center"><div><div className="font-semibold">{member.first_name} {member.last_name}</div><div className="text-xs text-slate-500">{member.whatsapp || 'WhatsApp à compléter'}</div><div className="mt-1 text-xs text-slate-500">{member.tasks.length ? `Tâches : ${member.tasks.join(', ')}` : 'Aucune tâche assignée'}</div></div><div className="text-sm">{member.email}</div><span className="badge badge-orange w-fit">Prospects uniquement</span><div className="flex flex-wrap items-center gap-2 text-xs text-slate-500"><span className="flex items-center gap-1"><UserRoundCheck className="h-4 w-4" /> {member.auth_user_id ? 'Compte lié' : 'En attente'}</span><button className="btn-outline px-2 py-1 text-xs" onClick={() => { setEditingId(member.id); setDraft({ first_name: member.first_name, last_name: member.last_name, email: member.email, whatsapp: member.whatsapp ?? '', permissions: ['prospects'], tasks: member.tasks ?? [], is_active: member.is_active }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Modifier</button></div></div>)}</div></section>
  </div>;
}
