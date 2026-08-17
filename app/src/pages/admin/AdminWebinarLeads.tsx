import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, CheckCircle2, Copy, ExternalLink, Loader2, MessageCircle,
  Phone, Search, ShoppingBag, UserCheck, Users, Video,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/hooks/useAuth';
import { fetchWebinarLeads, logWebinarCall, queryKeys } from '@/lib/queries';
import type { WebinarLead, WebinarLeadStatus } from '@/lib/types';
import { cn, formatDateTime } from '@/lib/utils';

const STATUS_OPTIONS: { value: WebinarLeadStatus; label: string }[] = [
  { value: 'new', label: 'Nouveau — pas encore qualifié' },
  { value: 'to_call', label: 'À appeler' },
  { value: 'nrp', label: 'NRP — ne répond pas' },
  { value: 'callback', label: 'À rappeler' },
  { value: 'not_interested', label: 'Pas intéressé / annulé' },
  { value: 'confirmed', label: 'Vente confirmée' },
  { value: 'in_delivery', label: 'Confirmé / en livraison' },
  { value: 'delivered', label: 'Livré' },
  { value: 'returned', label: 'Retour / refusé' },
];

const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS.map((item) => [item.value, item.label])) as Record<WebinarLeadStatus, string>;

export function AdminWebinarLeads() {
  const toast = useToast();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const leadsQ = useQuery({ queryKey: queryKeys.adminWebinarLeads, queryFn: fetchWebinarLeads });
  const [search, setSearch] = useState('');
  const [attendance, setAttendance] = useState<'yes' | 'no' | 'all'>('yes');
  const [status, setStatus] = useState<WebinarLeadStatus | 'all'>('all');
  const [selected, setSelected] = useState<WebinarLead | null>(null);
  const [callStatus, setCallStatus] = useState<WebinarLeadStatus>('nrp');
  const [closer, setCloser] = useState('');
  const [note, setNote] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [saving, setSaving] = useState(false);

  const leads = leadsQ.data ?? [];
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return leads.filter((lead) => {
      if (attendance === 'yes' && !lead.attended_live) return false;
      if (attendance === 'no' && lead.attended_live) return false;
      if (status !== 'all' && lead.status !== status) return false;
      if (!needle) return true;
      return [lead.full_name, lead.phone_raw, lead.phone_normalized, lead.email, lead.wilaya_name, lead.commune]
        .some((value) => value.toLowerCase().includes(needle));
    });
  }, [attendance, leads, search, status]);

  const stats = useMemo(() => ({
    total: leads.length,
    attended: leads.filter((lead) => lead.attended_live).length,
    toCall: leads.filter((lead) => ['to_call', 'nrp', 'callback'].includes(lead.status)).length,
    confirmed: leads.filter((lead) => ['confirmed', 'in_delivery', 'delivered'].includes(lead.status)).length,
  }), [leads]);

  function openCall(lead: WebinarLead) {
    setSelected(lead);
    setCallStatus(lead.status === 'new' ? 'to_call' : lead.status);
    const profileName = profile ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() : '';
    setCloser(lead.closer_name || profileName);
    setNote(lead.latest_call_note || '');
    setFollowUp(lead.next_follow_up_at ? toLocalInput(lead.next_follow_up_at) : '');
  }

  async function saveCall() {
    if (!selected || !closer.trim()) { toast.error('Indique le nom du closer.'); return; }
    if (callStatus === 'callback' && !followUp) { toast.error('Choisis la date du prochain rappel.'); return; }
    setSaving(true);
    try {
      await logWebinarCall({
        leadId: selected.id,
        status: callStatus,
        closerName: closer.trim(),
        note: note.trim() || null,
        nextFollowUpAt: followUp ? new Date(followUp).toISOString() : null,
      });
      toast.success('Appel et statut enregistrés dans le dossier du prospect.');
      setSelected(null);
      await qc.invalidateQueries({ queryKey: queryKeys.adminWebinarLeads });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  }

  async function copyPublicLink() {
    const url = `${window.location.origin}/inscription-webinar`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Lien du formulaire copié. Tu peux le coller dans le chat YouTube.');
    } catch {
      toast.error(`Copie ce lien : ${url}`);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-aurel-orange"><Video className="h-5 w-5" /><span className="text-sm font-semibold uppercase tracking-wide">Webinar CRM</span></div>
          <h1 className="text-3xl font-bold text-aurel-ink">Prospects & appels</h1>
          <p className="mt-1 text-slate-600">Formulaire, présence, appels, vente et livraison dans un seul dossier.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={copyPublicLink}>
            Copier le lien <Copy className="h-4 w-4" />
          </button>
          <a className="btn-outline" href="/inscription-webinar" target="_blank" rel="noreferrer">
            Voir le formulaire public <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Users} label="Tous les leads" value={stats.total} color="orange" />
        <Kpi icon={Video} label="Ont vu le live" value={stats.attended} color="teal" />
        <Kpi icon={Phone} label="À appeler / rappeler" value={stats.toCall} color="orange" />
        <Kpi icon={UserCheck} label="Ventes confirmées" value={stats.confirmed} color="green" />
      </div>

      <section className="card overflow-hidden">
        <div className="grid gap-3 border-b border-zinc-200 p-4 md:grid-cols-[1fr_190px_220px]">
          <label className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <input className="input pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom, WhatsApp, email, wilaya…" />
          </label>
          <select className="input" value={attendance} onChange={(e) => setAttendance(e.target.value as typeof attendance)}>
            <option value="yes">A vu le webinar</option><option value="no">N'a pas vu le webinar</option><option value="all">Tous les leads</option>
          </select>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as WebinarLeadStatus | 'all')}>
            <option value="all">Tous les statuts</option>{STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>

        {leadsQ.isLoading ? <Spinner label="Chargement des prospects…" />
          : leadsQ.isError ? <div className="p-8 text-center text-red-600">Impossible de charger les prospects.</div>
            : filtered.length === 0 ? <div className="p-10 text-center text-zinc-500">Aucun prospect pour ces filtres.</div>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1060px] text-sm">
                    <thead className="bg-zinc-50 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                      <tr><th className="px-4 py-3">Prospect</th><th className="px-4 py-3">Live</th><th className="px-4 py-3">Livraison</th><th className="px-4 py-3">Closer</th><th className="px-4 py-3">Statut</th><th className="px-4 py-3">Dernier suivi</th><th className="px-4 py-3 text-right">Actions</th></tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {filtered.map((lead) => <LeadRow key={lead.id} lead={lead} onCall={() => openCall(lead)} />)}
                    </tbody>
                  </table>
                </div>
              )}
      </section>

      <Modal open={!!selected} onClose={() => !saving && setSelected(null)} title="Suivi du prospect" maxWidth="max-w-2xl">
        {selected && (
          <div className="space-y-5">
            <div className="rounded-card-sm bg-zinc-50 p-4">
              <div className="font-bold text-zinc-950">{selected.full_name}</div>
              <div className="mt-1 text-sm text-zinc-600">{selected.phone_raw} · {selected.email}</div>
              <div className="mt-1 text-xs text-zinc-500"><MapPinText lead={selected} /></div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Closer *"><input className="input" maxLength={80} value={closer} onChange={(e) => setCloser(e.target.value)} placeholder="Hana, Ryma, Djihan…" /></Field>
              <Field label="Résultat de l'appel *"><select className="input" value={callStatus} onChange={(e) => setCallStatus(e.target.value as WebinarLeadStatus)}>{STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
              {callStatus === 'callback' && <Field label="Prochain rappel *"><input className="input" type="datetime-local" value={followUp} onChange={(e) => setFollowUp(e.target.value)} /></Field>}
            </div>
            <Field label="Notes de l'appel"><textarea className="input min-h-28 resize-y" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Objection, besoin, décision, moment du rappel…" /></Field>
            <div className="flex flex-wrap justify-between gap-2">
              <a className="btn-outline" href={whatsappUrl(selected.phone_normalized)} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" /> WhatsApp</a>
              <div className="flex gap-2">
                <button type="button" className="btn-outline" disabled={saving} onClick={() => setSelected(null)}>Annuler</button>
                <button type="button" className="btn-primary" disabled={saving} onClick={saveCall}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Enregistrer l'appel</button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function LeadRow({ lead, onCall }: { lead: WebinarLead; onCall: () => void }) {
  const order = lead.delivery_orders?.[0];
  return (
    <tr className="align-top hover:bg-zinc-50/70">
      <td className="px-4 py-3"><div className="font-semibold text-zinc-900">{lead.full_name}</div><a className="text-xs text-aurel-teal hover:underline" href={whatsappUrl(lead.phone_normalized)} target="_blank" rel="noreferrer">{lead.phone_raw}</a><div className="text-[11px] text-zinc-400">{lead.email}</div></td>
      <td className="px-4 py-3">{lead.attended_live ? <span className="badge badge-green">Oui</span> : <span className="badge badge-slate">Non</span>}</td>
      <td className="px-4 py-3"><MapPinText lead={lead} /></td>
      <td className="px-4 py-3">{lead.closer_name ?? '—'}<div className="text-[10px] text-zinc-400">{lead.call_count} appel(s)</div></td>
      <td className="px-4 py-3"><LeadStatus status={lead.status} />{order?.ecom_tracking && <div className="mt-1 font-mono text-[10px] text-zinc-500">{order.ecom_tracking}</div>}</td>
      <td className="px-4 py-3 text-xs text-zinc-500">{lead.last_call_at ? formatDateTime(lead.last_call_at) : `Inscrit ${formatDateTime(lead.created_at)}`}{lead.next_follow_up_at && <div className="mt-1 text-aurel-orange"><CalendarClock className="mr-1 inline h-3 w-3" />{formatDateTime(lead.next_follow_up_at)}</div>}<div className="mt-1 max-w-56 line-clamp-2 text-zinc-400">{lead.latest_call_note}</div></td>
      <td className="px-4 py-3"><div className="flex justify-end gap-1.5"><button type="button" className="btn-outline px-2.5 py-1.5 text-xs" onClick={onCall}><Phone className="h-3.5 w-3.5" /> Suivi</button>{!order && ['confirmed', 'in_delivery'].includes(lead.status) && <Link className="btn-primary px-2.5 py-1.5 text-xs" to={`/admin/commandes?lead=${lead.id}`}><ShoppingBag className="h-3.5 w-3.5" /> Commande</Link>}</div></td>
    </tr>
  );
}

function MapPinText({ lead }: { lead: WebinarLead }) {
  return <><span className="font-medium text-zinc-700">{lead.wilaya_name}</span> · {lead.commune}<div className="max-w-56 truncate text-[11px] text-zinc-400" title={lead.address}>{lead.address}</div></>;
}

function LeadStatus({ status }: { status: WebinarLeadStatus }) {
  const color = status === 'delivered' ? 'badge-green' : ['confirmed', 'in_delivery'].includes(status) ? 'badge-teal' : ['not_interested', 'returned'].includes(status) ? 'badge-red' : status === 'new' ? 'badge-slate' : 'badge-orange';
  return <span className={cn('badge', color)}>{STATUS_LABEL[status]}</span>;
}

function Kpi({ icon: Icon, label, value, color }: { icon: typeof Users; label: string; value: number; color: 'orange' | 'teal' | 'green' }) {
  const tint = color === 'teal' ? 'text-aurel-teal' : color === 'green' ? 'text-green-600' : 'text-aurel-orange';
  return <div className="kpi"><div className="kpi-label"><Icon className={cn('h-4 w-4', tint)} />{label}</div><div className="kpi-value">{value}</div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label><span className="label">{label}</span>{children}</label>;
}

function whatsappUrl(phone: string) {
  const normalized = phone.startsWith('0') ? `213${phone.slice(1)}` : phone;
  return `https://wa.me/${normalized}`;
}

function toLocalInput(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
