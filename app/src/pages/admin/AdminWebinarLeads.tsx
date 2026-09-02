import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, Copy, Eye, ExternalLink, History, ListChecks, Loader2, MessageCircle, Phone, Search, StickyNote, Trash2, Truck, UserCheck, Users, Video } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { DangerConfirmModal } from '@/components/ui/DangerConfirmModal';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/hooks/useAuth';
import { assignWebinarLeadCloser, assignWebinarLeadsCloser, bulkCreateOrders, bulkSetLeadStatus, deleteWebinarLead, fetchStaffMembers, fetchWebinarLeadHistory, fetchWebinarLeads, logWebinarCallWithOrder, queryKeys, updateWebinarLeadStatus } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import type { WebinarLead, WebinarLeadActivity, WebinarLeadStatus } from '@/lib/types';
import { cn, formatDateTime } from '@/lib/utils';

const WORK_STATUS_OPTIONS: { value: WebinarLeadStatus; label: string }[] = [
  { value: 'to_call', label: 'À appeler' }, { value: 'nrp', label: 'NRP — ne répond pas' },
  { value: 'callback', label: 'À rappeler' }, { value: 'not_interested', label: 'Pas intéressé / annulé' },
];
const CLOSER_OPTIONS: { value: WebinarLeadStatus; label: string }[] = [...WORK_STATUS_OPTIONS];
const CLOSER_STATUS_OPTIONS: { value: WebinarLeadStatus; label: string }[] = [...WORK_STATUS_OPTIONS, { value: 'confirmed', label: 'Confirmé' }, { value: 'returned', label: 'Retour / refusé' }];
const ADMIN_STATUS_OPTIONS: { value: WebinarLeadStatus; label: string }[] = [...WORK_STATUS_OPTIONS, { value: 'confirmed', label: 'Confirmé' }, { value: 'in_delivery', label: 'En livraison' }, { value: 'delivered', label: 'Livré (admin uniquement)' }, { value: 'returned', label: 'Retour / refusé' }];
const FILTER_OPTIONS = ADMIN_STATUS_OPTIONS;
const BULK_STATUS_OPTIONS = ADMIN_STATUS_OPTIONS;
const STATUS_LABEL: Record<WebinarLeadStatus, string> = { new: 'À appeler', to_call: 'À appeler', nrp: 'NRP — ne répond pas', callback: 'À rappeler', not_interested: 'Pas intéressé / annulé', confirmed: 'Confirmé', in_delivery: 'En livraison', delivered: 'Livré', returned: 'Retour / refusé' };
const CLOSER_NOTE_REQUIRED = new Set<WebinarLeadStatus>(['to_call', 'nrp', 'callback', 'not_interested', 'returned']);

export function AdminWebinarLeads() {
  const toast = useToast(); const qc = useQueryClient(); const { profile } = useAuth();
  const leadsQ = useQuery({ queryKey: queryKeys.adminWebinarLeads, queryFn: fetchWebinarLeads, refetchInterval: profile?.is_admin ? 5_000 : 15_000, refetchOnWindowFocus: 'always' });
  const staffQ = useQuery({ queryKey: queryKeys.adminStaff, queryFn: fetchStaffMembers, enabled: !!profile?.is_admin });
  const [search, setSearch] = useState(''); const [status, setStatus] = useState<WebinarLeadStatus | 'all'>('all');
  const [selected, setSelected] = useState<WebinarLead | null>(null); const [deleting, setDeleting] = useState<WebinarLead | null>(null);
  const [callStatus, setCallStatus] = useState<WebinarLeadStatus>('nrp');
  const [closer, setCloser] = useState(''); const [note, setNote] = useState(''); const [followUp, setFollowUp] = useState(''); const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState<WebinarLead | null>(null); const [assignedCloser, setAssignedCloser] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set()); const [bulkCloser, setBulkCloser] = useState(''); const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'closer' | 'crm' | 'ecom' | 'live'>('date_desc');
  const [bulkDeleting, setBulkDeleting] = useState(false); const [confirmDeleteMode, setConfirmDeleteMode] = useState<null | 'selected' | 'all'>(null);
  const [bulkStatus, setBulkStatus] = useState<WebinarLeadStatus | ''>(''); const [confirmToCommandes, setConfirmToCommandes] = useState(false);
  const [statusTarget, setStatusTarget] = useState<WebinarLead | null>(null); const [statusDraft, setStatusDraft] = useState<WebinarLeadStatus>('to_call'); const [statusNote, setStatusNote] = useState(''); const [statusFollowUp, setStatusFollowUp] = useState(''); const [statusCallAttempt, setStatusCallAttempt] = useState<number | ''>('');
  const [confirmingCloserStatus, setConfirmingCloserStatus] = useState(false); const [historyTarget, setHistoryTarget] = useState<WebinarLead | null>(null);
  const [contactTarget, setContactTarget] = useState<WebinarLead | null>(null);
  const [closerFilter, setCloserFilter] = useState(''); const [ecomFilter, setEcomFilter] = useState(''); const [readyFilter, setReadyFilter] = useState<'all' | 'yes' | 'no' | 'unknown'>('all');
  const [adminViewCloser, setAdminViewCloser] = useState('');
  const isCloser = !!profile && !profile.is_admin;
  const closerExperience = isCloser || (!!profile?.is_admin && !!adminViewCloser);
  const leads = leadsQ.data ?? [];
  const scopedLeads = useMemo(() => adminViewCloser ? leads.filter((lead) => lead.closer_name === adminViewCloser) : leads, [leads, adminViewCloser]);
  const availableCloserNames = useMemo(() => [...new Set([...activeNames(staffQ.data ?? []), ...leads.map((lead) => lead.closer_name).filter((name): name is string => !!name)])].sort((a, b) => a.localeCompare(b)), [staffQ.data, leads]);
  const availableEcomStatuses = useMemo(() => [...new Set(leads.map((lead) => lead.delivery_orders?.[0]?.ecom_situation).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b)), [leads]);
  const filtered = useMemo(() => { const needle = search.trim().toLowerCase(); const rows = scopedLeads.filter((lead) => {
    if (adminViewCloser && lead.closer_name !== adminViewCloser) return false;
    if (closerFilter === '__unassigned' && lead.closer_name) return false;
    if (closerFilter && closerFilter !== '__unassigned' && lead.closer_name !== closerFilter) return false;
    if (ecomFilter === '__none' && lead.delivery_orders?.[0]?.ecom_situation) return false;
    if (ecomFilter && ecomFilter !== '__none' && (lead.delivery_orders?.[0]?.ecom_situation ?? '') !== ecomFilter) return false;
    if (readyFilter === 'yes' && lead.ready_to_pay !== true) return false;
    if (readyFilter === 'no' && lead.ready_to_pay !== false) return false;
    if (readyFilter === 'unknown' && lead.ready_to_pay != null) return false;
    if (!(status === 'all' || lead.status === status)) return false;
    if (needle && ![lead.full_name, lead.phone_raw, lead.email, lead.wilaya_name, lead.commune].some((value) => value.toLowerCase().includes(needle))) return false;
    return true;
  }); return [...rows].sort((a, b) => { if (sortBy === 'live') { const rank = (v: boolean | null | undefined) => v === true ? 2 : v === false ? 1 : 0; return rank(b.ready_to_pay) - rank(a.ready_to_pay); } if (sortBy === 'closer') return (a.closer_name ?? 'zzzz').localeCompare(b.closer_name ?? 'zzzz'); if (sortBy === 'crm') return a.status.localeCompare(b.status); if (sortBy === 'ecom') return (a.delivery_orders?.[0]?.ecom_situation ?? 'zzzz').localeCompare(b.delivery_orders?.[0]?.ecom_situation ?? 'zzzz'); if (sortBy === 'date_asc') return a.created_at.localeCompare(b.created_at); return b.created_at.localeCompare(a.created_at); }); }, [scopedLeads, search, status, sortBy, adminViewCloser, closerFilter, ecomFilter, readyFilter]);
  const stats = useMemo(() => { const endToday = new Date(); endToday.setHours(23, 59, 59, 999); const endTodayMs = endToday.getTime(); return { total: scopedLeads.length, toCall: scopedLeads.filter((lead) => ['new', 'to_call', 'nrp', 'callback'].includes(lead.status)).length, confirmed: scopedLeads.filter((lead) => ['confirmed', 'in_delivery'].includes(lead.status)).length, delivered: scopedLeads.filter((lead) => lead.status === 'delivered').length, rappels: scopedLeads.filter((lead) => lead.next_follow_up_at && new Date(lead.next_follow_up_at).getTime() <= endTodayMs).length }; }, [scopedLeads]);
  // The registered, still-active closers — the single source for attribution, so
  // a call can only be credited to a real team member (no more free-text typos).
  const activeClosers = useMemo(() => (staffQ.data ?? []).filter((member) => member.is_active).map((member) => `${member.first_name} ${member.last_name}`.trim()).filter(Boolean), [staffQ.data]);
  const historyQ = useQuery({
    queryKey: queryKeys.webinarLeadHistory(historyTarget?.id ?? ''),
    queryFn: () => fetchWebinarLeadHistory(historyTarget!.id),
    enabled: !!historyTarget,
  });

  // Realtime invalidation keeps admin and closer screens aligned immediately.
  // Polling remains as a slow-network fallback.
  useEffect(() => {
    if (!profile?.id) return;
    const refreshLeads = () => { void qc.invalidateQueries({ queryKey: queryKeys.adminWebinarLeads }); };
    const channel = supabase
      .channel(`crm-live-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'webinar_leads' }, refreshLeads)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_orders' }, refreshLeads)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'webinar_lead_activities' }, () => {
        refreshLeads();
        if (historyTarget?.id) void qc.invalidateQueries({ queryKey: queryKeys.webinarLeadHistory(historyTarget.id) });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [historyTarget?.id, profile?.id, qc]);

  function openCall(lead: WebinarLead) {
    setSelected(lead); const current = ['new', 'confirmed', 'delivered', 'returned'].includes(lead.status) ? 'to_call' : lead.status; setCallStatus(current as WebinarLeadStatus);
    const profileName = profile ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() : '';
    // Admin picks the closer from the list (default: whoever is already assigned).
    // A closer logging their own call is credited to themselves, locked.
    setCloser(profile?.is_admin ? (lead.closer_name || '') : profileName);
    setNote(lead.latest_call_note || ''); setFollowUp(lead.next_follow_up_at ? toLocalInput(lead.next_follow_up_at) : '');
  }
  async function saveCall() {
    if (!selected || !closer.trim()) { toast.error('Indique le nom du closer.'); return; }
    if (callStatus === 'callback' && !followUp) { toast.error('Choisis la date du prochain rappel.'); return; }
    setSaving(true); try { await logWebinarCallWithOrder({ leadId: selected.id, status: callStatus, closerName: closer.trim(), note: note.trim() || null, nextFollowUpAt: callStatus === 'callback' && followUp ? new Date(followUp).toISOString() : null }); toast.success('Appel enregistré.'); setSelected(null); await Promise.all([qc.invalidateQueries({ queryKey: queryKeys.adminWebinarLeads }), qc.invalidateQueries({ queryKey: queryKeys.adminSalesAnalytics })]); } catch (error) { toast.error(error instanceof Error ? error.message : 'Enregistrement impossible.'); } finally { setSaving(false); }
  }
  async function approveDelete() {
    if (!deleting) return; setSaving(true);
    try { await deleteWebinarLead(deleting.id); toast.success('Prospect et commande liée supprimés.'); setDeleting(null); await Promise.all([qc.invalidateQueries({ queryKey: queryKeys.adminWebinarLeads }), qc.invalidateQueries({ queryKey: queryKeys.adminDeliveryOrders }), qc.invalidateQueries({ queryKey: queryKeys.adminSalesAnalytics })]); } catch (error) { toast.error(error instanceof Error ? error.message : 'Suppression impossible.', 'Suppression centralisée impossible'); } finally { setSaving(false); }
  }
  async function approveAssignment() { if (!assigning || !assignedCloser) return; setSaving(true); try { await assignWebinarLeadCloser(assigning.id, assignedCloser); toast.success(`${assigning.full_name} attribué à ${assignedCloser}.`); setAssigning(null); setAssignedCloser(''); await qc.invalidateQueries({ queryKey: queryKeys.adminWebinarLeads }); } catch (error) { toast.error(error instanceof Error ? error.message : 'Attribution impossible.'); } finally { setSaving(false); } }
  async function approveBulkAssignment() { if (selectedIds.size === 0 || !bulkCloser) return; setSaving(true); try { await assignWebinarLeadsCloser([...selectedIds], bulkCloser); toast.success(`${selectedIds.size} prospect(s) attribué(s) à ${bulkCloser}.`); setSelectedIds(new Set()); setBulkCloser(''); await qc.invalidateQueries({ queryKey: queryKeys.adminWebinarLeads }); } catch (error) { toast.error(error instanceof Error ? error.message : 'Attribution impossible.'); } finally { setSaving(false); } }
  // Bulk delete goes lead-by-lead (each also removes its linked E-com colis via
  // the edge function), collecting successes/failures like the Commandes page.
  async function runBulkDelete(ids: string[]) {
    if (!ids.length) return;
    setBulkDeleting(true); let success = 0; let failed = 0;
    for (const id of ids) { try { await deleteWebinarLead(id); success += 1; } catch { failed += 1; } }
    setBulkDeleting(false); setConfirmDeleteMode(null); setSelectedIds(new Set());
    toast.success(`${success} prospect(s) supprimé(s)${failed ? ` · ${failed} non supprimé(s)` : ''}.`);
    await Promise.all([qc.invalidateQueries({ queryKey: queryKeys.adminWebinarLeads }), qc.invalidateQueries({ queryKey: queryKeys.adminDeliveryOrders }), qc.invalidateQueries({ queryKey: queryKeys.adminSalesAnalytics })]);
  }
  async function doBulkStatus() {
    if (!bulkStatus || selectedIds.size === 0 || saving) return;
    setSaving(true);
    try {
      const n = await bulkSetLeadStatus([...selectedIds], bulkStatus);
      toast.success(`${n} prospect(s) mis à jour.`, 'Statut modifié');
      setSelectedIds(new Set()); setBulkStatus('');
      await qc.invalidateQueries({ queryKey: queryKeys.adminWebinarLeads });
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Modification impossible.'); }
    finally { setSaving(false); }
  }
  function openStatus(lead: WebinarLead) {
    setStatusTarget(lead);
    const available = closerExperience ? CLOSER_STATUS_OPTIONS : ADMIN_STATUS_OPTIONS;
    const cur = available.some((o) => o.value === lead.status) ? lead.status as WebinarLeadStatus : 'to_call';
    setStatusDraft(cur);
    setStatusNote('');
    setStatusFollowUp(lead.next_follow_up_at ? toLocalInput(lead.next_follow_up_at) : '');
    setStatusCallAttempt('');
  }
  async function saveStatus() {
    if (!statusTarget || saving) return;
    const closerMustExplain = closerExperience && CLOSER_NOTE_REQUIRED.has(statusDraft);
    if (closerMustExplain && !statusNote.trim()) {
      toast.error('Ajoute une note pour expliquer ce statut.');
      return;
    }
    if (statusDraft === 'callback' && !statusFollowUp) {
      toast.error('Choisis la date et l’heure du rappel.');
      return;
    }
    if (closerExperience && statusDraft === 'confirmed') {
      setConfirmingCloserStatus(true);
      return;
    }
    await commitStatus();
  }
  async function commitStatus() {
    if (!statusTarget || saving) return;
    setSaving(true);
    try {
      await updateWebinarLeadStatus(
        statusTarget.id,
        statusDraft,
        statusNote,
        statusDraft === 'callback' ? new Date(statusFollowUp).toISOString() : null,
        statusDraft === 'callback' && statusCallAttempt ? statusCallAttempt : null,
      );
      toast.success('Statut mis à jour.', 'Statut');
      setConfirmingCloserStatus(false);
      setStatusTarget(null);
      setStatusNote('');
      setStatusFollowUp('');
      setStatusCallAttempt('');
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.adminWebinarLeads }),
        qc.invalidateQueries({ queryKey: queryKeys.adminCloserPerformance }),
      ]);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Modification impossible.'); }
    finally { setSaving(false); }
  }
  async function doBulkToCommandes() {
    if (selectedIds.size === 0 || saving) return;
    const chosen = leads.filter((lead) => selectedIds.has(lead.id));
    const unconfirmed = chosen.filter((lead) => lead.status !== 'confirmed');
    if (unconfirmed.length) {
      toast.error(`${unconfirmed.length} prospect(s) ne sont pas encore « Confirmé ».`, 'Commande non créée');
      return;
    }
    setSaving(true);
    try {
      const r = await bulkCreateOrders([...selectedIds]);
      toast.success(`${r.created} commande(s) créée(s)${r.skipped ? ` · ${r.skipped} déjà en commande` : ''}.`, 'Envoyé vers Commandes');
      setConfirmToCommandes(false); setSelectedIds(new Set());
      await Promise.all([qc.invalidateQueries({ queryKey: queryKeys.adminWebinarLeads }), qc.invalidateQueries({ queryKey: queryKeys.adminDeliveryOrders }), qc.invalidateQueries({ queryKey: queryKeys.adminSalesAnalytics })]);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Envoi impossible.'); }
    finally { setSaving(false); }
  }
  async function copyPublicLink() { const url = `${window.location.origin}/inscription-webinar`; try { await navigator.clipboard.writeText(url); toast.success('Lien du formulaire copié.'); } catch { toast.error(`Copie ce lien : ${url}`); } }
  function toggleLead(id: string) { setSelectedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><div className="mb-2 flex items-center gap-2 text-aurel-orange"><Video className="h-5 w-5" /><span className="text-sm font-semibold uppercase tracking-wide">Webinar CRM</span></div><h1 className="text-2xl font-bold text-aurel-ink sm:text-3xl">Prospects & appels</h1><p className="mt-1 text-sm text-slate-600 sm:text-base">Tous les prospects restent visibles, quel que soit leur ancienneté ou leur statut.</p></div><div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap"><button type="button" className="btn-primary" onClick={copyPublicLink}>Copier le lien <Copy className="h-4 w-4" /></button><a className="btn-outline" href="/inscription-webinar" target="_blank" rel="noreferrer">Voir le formulaire <ExternalLink className="h-4 w-4" /></a></div></header>
    {profile?.is_admin && <section className="card-padded flex flex-wrap items-center gap-3 border border-aurel-orange/20 bg-orange-50/40"><Eye className="h-5 w-5 text-aurel-orange" /><div className="min-w-56 flex-1"><div className="font-semibold text-zinc-900">Voir en tant que closer</div><div className="text-xs text-zinc-500">Affiche exactement sa liste et masque les actions réservées aux admins.</div></div><select className="input w-full sm:w-72" value={adminViewCloser} onChange={(e) => { setAdminViewCloser(e.target.value); setCloserFilter(''); setSelectedIds(new Set()); }}><option value="">Vue administrateur complète</option>{availableCloserNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></section>}
    {adminViewCloser && <div className="rounded-lg border border-aurel-orange bg-aurel-orange/10 px-4 py-3 text-sm font-medium text-aurel-orange">Vue closer active : {adminViewCloser}. Les actions admin sont masquées jusqu’au retour à la vue administrateur.</div>}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Kpi icon={Users} label={closerExperience ? 'Mes prospects' : 'Prospects qualifiés'} value={stats.total} color="orange" /><Kpi icon={Phone} label="À appeler / rappeler" value={stats.toCall} color="orange" /><Kpi icon={CalendarClock} label="Rappels dus" value={stats.rappels} color={stats.rappels > 0 ? 'red' : 'orange'} /><Kpi icon={UserCheck} label={closerExperience ? 'Mes ventes livrées' : 'Ventes livrées'} value={stats.delivered} color="green" /></div>
    <section className="card overflow-hidden">
      <div className="border-b border-zinc-200 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <label className="relative min-w-0 sm:col-span-2 lg:col-span-3 xl:col-span-2"><Search className="absolute left-3 top-3.5 h-4 w-4 text-zinc-400 md:top-2.5" /><input className="input pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom, WhatsApp, email, wilaya…" /></label>
          <FilterSelect label="Statut CRM" value={status} onChange={(value) => setStatus(value as WebinarLeadStatus | 'all')}><option value="all">Tous les statuts CRM</option>{FILTER_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</FilterSelect>
          {profile?.is_admin && !adminViewCloser && <FilterSelect label="Closer" value={closerFilter} onChange={setCloserFilter}><option value="">Tous les closers</option><option value="__unassigned">Non attribués</option>{availableCloserNames.map((name) => <option key={name} value={name}>{name}</option>)}</FilterSelect>}
          <FilterSelect label="Statut E-com" value={ecomFilter} onChange={setEcomFilter}><option value="">Tous les statuts E-com</option><option value="__none">Sans commande/statut</option>{availableEcomStatuses.map((value) => <option key={value} value={value}>{value}</option>)}</FilterSelect>
          <FilterSelect label="Prêt à payer" value={readyFilter} onChange={(value) => setReadyFilter(value as typeof readyFilter)}><option value="all">Toutes les réponses</option><option value="yes">Oui</option><option value="no">Non</option><option value="unknown">Non renseigné</option></FilterSelect>
          <FilterSelect label="Trier par" value={sortBy} onChange={(value) => setSortBy(value as typeof sortBy)}><option value="date_desc">Date : plus récent</option><option value="date_asc">Date : plus ancien</option>{profile?.is_admin && <option value="closer">Closer : A → Z</option>}<option value="crm">Statut CRM</option><option value="ecom">Statut E-com</option><option value="live">Prêt à payer</option></FilterSelect>
        </div>
        {profile?.is_admin && !closerExperience && <div className="mt-4 grid grid-cols-1 gap-2 border-t border-zinc-100 pt-4 sm:grid-cols-2 xl:flex xl:flex-wrap"><select className="input w-full xl:w-52" value={bulkCloser} onChange={(e) => setBulkCloser(e.target.value)}><option value="">Attribuer à…</option>{(staffQ.data ?? []).filter((member) => member.is_active).map((member) => { const name = `${member.first_name} ${member.last_name}`.trim(); return <option key={member.id} value={name}>{name}</option>; })}</select><button type="button" className="btn-primary" disabled={saving || selectedIds.size === 0 || !bulkCloser} onClick={approveBulkAssignment}><UserCheck className="h-4 w-4" /> Attribuer ({selectedIds.size})</button><button type="button" className="btn-outline text-red-600" disabled={saving || bulkDeleting || selectedIds.size === 0} onClick={() => setConfirmDeleteMode('selected')}><Trash2 className="h-4 w-4" /> Supprimer les choisis ({selectedIds.size})</button><button type="button" className="btn-outline text-red-600" disabled={saving || bulkDeleting || filtered.length === 0} onClick={() => setConfirmDeleteMode('all')}><Trash2 className="h-4 w-4" /> Tout supprimer ({filtered.length})</button><select className="input w-full xl:w-48" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as WebinarLeadStatus | '')}><option value="">Changer le statut…</option>{BULK_STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><button type="button" className="btn-outline" disabled={saving || !bulkStatus || selectedIds.size === 0} onClick={doBulkStatus}><CheckCircle2 className="h-4 w-4" /> Changer le statut ({selectedIds.size})</button><button type="button" className="btn-primary" disabled={saving || selectedIds.size === 0} onClick={() => setConfirmToCommandes(true)}><Truck className="h-4 w-4" /> Vers Commandes ({selectedIds.size})</button></div>}
      </div>
      <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs text-zinc-600"><strong>{filtered.length}</strong> prospect(s) affiché(s) · Vue : {isCloser ? 'closer' : adminViewCloser ? `Closer ${adminViewCloser}` : 'administrateur'} · CRM : {status === 'all' ? 'tous' : STATUS_LABEL[status]} · Closer : {closerFilter === '__unassigned' ? 'non attribués' : closerFilter || 'tous'} · E-com : {ecomFilter === '__none' ? 'sans statut' : ecomFilter || 'tous'} · Tri : {sortBy.replace('_', ' ')}</div>
      {leadsQ.isLoading ? <Spinner label="Chargement des prospects…" /> : leadsQ.isError ? <div className="p-8 text-center text-red-600">Impossible de charger les prospects.</div> : filtered.length === 0 ? <div className="p-10 text-center text-zinc-500">Aucun prospect pour ces filtres.</div> : <>
        <div className="divide-y divide-zinc-200 md:hidden">
          {filtered.map((lead) => <LeadCard key={lead.id} lead={lead} selected={selectedIds.has(lead.id)} onToggle={() => toggleLead(lead.id)} onContact={() => setContactTarget(lead)} onCall={profile?.is_admin && !closerExperience ? () => openCall(lead) : undefined} onStatus={() => openStatus(lead)} onHistory={() => setHistoryTarget(lead)} onDelete={profile?.is_admin && !closerExperience ? () => setDeleting(lead) : undefined} onAssign={profile?.is_admin && !closerExperience ? () => { setAssigning(lead); setAssignedCloser(lead.closer_name ?? ''); } : undefined} />)}
        </div>
        <div className="mobile-scroll-x hidden md:block"><table className="w-full min-w-[1240px] text-sm"><thead className="bg-zinc-50 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-500"><tr><th className="px-3 py-3"><input type="checkbox" className="h-6 w-6 cursor-pointer rounded border-2 border-zinc-400 accent-aurel-orange" aria-label="Sélectionner tous les prospects affichés" checked={filtered.length > 0 && filtered.every((lead) => selectedIds.has(lead.id))} onChange={(e) => setSelectedIds(e.target.checked ? new Set(filtered.map((lead) => lead.id)) : new Set())} /></th><th className="px-4 py-3">Prospect</th><th className="px-4 py-3">Prêt à payer</th><th className="px-4 py-3">Livraison</th><th className="px-4 py-3">Closer</th><th className="px-4 py-3">Statut CRM</th><th className="px-4 py-3">Statut E-com Delivery</th><th className="px-4 py-3">Dernier suivi</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-zinc-100">{filtered.map((lead) => <LeadRow key={lead.id} lead={lead} selected={selectedIds.has(lead.id)} onToggle={() => toggleLead(lead.id)} onContact={() => setContactTarget(lead)} onCall={profile?.is_admin && !closerExperience ? () => openCall(lead) : undefined} onStatus={() => openStatus(lead)} onHistory={() => setHistoryTarget(lead)} onDelete={profile?.is_admin && !closerExperience ? () => setDeleting(lead) : undefined} onAssign={profile?.is_admin && !closerExperience ? () => { setAssigning(lead); setAssignedCloser(lead.closer_name ?? ''); } : undefined} />)}</tbody></table></div>
      </>}
    </section>
    <Modal open={!!selected} onClose={() => !saving && setSelected(null)} title="Suivi du prospect" maxWidth="max-w-2xl">{selected && <div className="space-y-5"><div className="rounded-card-sm bg-zinc-50 p-4"><div className="font-bold text-zinc-950">{selected.full_name}</div><div className="mt-1 text-sm text-zinc-600">{selected.phone_raw} · {selected.email}</div><div className="mt-1 text-xs text-zinc-500"><MapPinText lead={selected} /></div></div><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Field label="Closer *">{profile?.is_admin ? <select className="input" value={closer} onChange={(e) => setCloser(e.target.value)}><option value="">Choisir un closer</option>{activeClosers.map((name) => <option key={name} value={name}>{name}</option>)}{closer && !activeClosers.includes(closer) && <option value={closer}>{closer} (hors liste)</option>}</select> : <input className="input" value={closer} readOnly title="Attribué automatiquement à toi" />}</Field><Field label="Résultat de l'appel *"><select className="input" value={callStatus} onChange={(e) => setCallStatus(e.target.value as WebinarLeadStatus)}>{CLOSER_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>{callStatus === 'callback' && <Field label="Prochain rappel *"><input className="input" type="datetime-local" value={followUp} onChange={(e) => setFollowUp(e.target.value)} /></Field>}</div><Field label="Notes de l'appel"><textarea className="input min-h-28 resize-y" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></Field><div className="flex flex-wrap justify-between gap-2"><a className="btn-outline" href={whatsappUrl(selected.phone_normalized)} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" /> WhatsApp</a><div className="flex gap-2"><button type="button" className="btn-outline" disabled={saving} onClick={() => setSelected(null)}>Annuler</button><button type="button" className="btn-primary" disabled={saving} onClick={saveCall}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Enregistrer</button></div></div></div>}</Modal>
    <Modal open={!!deleting} onClose={() => !saving && setDeleting(null)} title="Supprimer ce prospect ?" maxWidth="max-w-md"><p className="text-zinc-700">Cette action supprimera définitivement <strong>{deleting?.full_name}</strong>.</p><p className="mt-2 text-sm text-zinc-500">Si une commande est liée, son colis sera d’abord supprimé chez E-com, puis la commande et le prospect seront retirés d’Aurel. Si E-com refuse, aucune donnée Aurel ne sera supprimée.</p><div className="mt-6 flex justify-end gap-2"><button className="btn-outline" disabled={saving} onClick={() => setDeleting(null)}>Non</button><button className="btn-primary bg-red-600 hover:bg-red-700" disabled={saving} onClick={approveDelete}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Oui, tout supprimer</button></div></Modal>
    <Modal open={!!assigning} onClose={() => !saving && setAssigning(null)} title="Attribuer le prospect" maxWidth="max-w-md"><p className="mb-4 text-sm text-zinc-600">Choisis le closer responsable de <strong>{assigning?.full_name}</strong>.</p><select className="input" value={assignedCloser} onChange={(e) => setAssignedCloser(e.target.value)}><option value="">Choisir un closer</option>{(staffQ.data ?? []).filter((member) => member.is_active).map((member) => { const name = `${member.first_name} ${member.last_name}`.trim(); return <option key={member.id} value={name}>{name}</option>; })}</select><div className="mt-6 flex justify-end gap-2"><button className="btn-outline" disabled={saving} onClick={() => setAssigning(null)}>Annuler</button><button className="btn-primary" disabled={saving || !assignedCloser} onClick={approveAssignment}>Confirmer l’attribution</button></div></Modal>
    <Modal open={confirmDeleteMode === 'selected'} onClose={() => !bulkDeleting && setConfirmDeleteMode(null)} title="Supprimer les prospects choisis ?" maxWidth="max-w-md"><p className="text-zinc-700">Supprimer définitivement <strong>{selectedIds.size}</strong> prospect(s) sélectionné(s) ?</p><p className="mt-2 text-sm text-zinc-500">Les commandes liées et leurs colis E-com seront aussi supprimés. Si E-com refuse un colis, ce prospect-là restera intact.</p><div className="mt-6 flex justify-end gap-2"><button className="btn-outline" disabled={bulkDeleting} onClick={() => setConfirmDeleteMode(null)}>Non</button><button className="btn-primary bg-red-600 hover:bg-red-700" disabled={bulkDeleting} onClick={() => runBulkDelete([...selectedIds])}>{bulkDeleting && <Loader2 className="h-4 w-4 animate-spin" />} Oui, supprimer</button></div></Modal>
    <DangerConfirmModal open={confirmDeleteMode === 'all'} onClose={() => setConfirmDeleteMode(null)} onConfirm={() => runBulkDelete(filtered.map((lead) => lead.id))} busy={bulkDeleting} count={filtered.length} title="Tout supprimer (liste filtrée) ?" description={<span>Supprime <strong>tous les {filtered.length} prospects actuellement affichés</strong> (selon la recherche / le filtre en cours), ainsi que leurs commandes et colis E-com liés.</span>} confirmLabel="Tout supprimer" />
    <Modal open={!!statusTarget} onClose={() => !saving && setStatusTarget(null)} title="Changer le statut" maxWidth="max-w-md">{statusTarget && <div className="space-y-4"><div className="rounded-card-sm bg-zinc-50 p-3 text-sm"><span className="font-semibold text-zinc-900">{statusTarget.full_name}</span> · <span className="text-zinc-500">{statusTarget.phone_raw}</span></div><label className="block"><span className="label">Nouveau statut</span><select className="input" value={statusDraft} onChange={(e) => { const next = e.target.value as WebinarLeadStatus; setStatusDraft(next); if (next !== 'callback') { setStatusFollowUp(''); setStatusCallAttempt(''); } }}>{(closerExperience ? CLOSER_STATUS_OPTIONS : ADMIN_STATUS_OPTIONS).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{statusDraft === 'callback' && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="block"><span className="label">Date et heure du rappel *</span><input className="input" type="datetime-local" value={statusFollowUp} onChange={(e) => setStatusFollowUp(e.target.value)} /></label>{closerExperience && <label className="block"><span className="label">Numéro d’appel (optionnel)</span><select className="input" value={statusCallAttempt} onChange={(e) => setStatusCallAttempt(e.target.value ? Number(e.target.value) : '')}><option value="">Non précisé</option><option value="1">1er appel</option><option value="2">2e appel</option><option value="3">3e appel</option><option value="4">4e appel</option><option value="5">5e appel</option></select></label>}</div>}<label className="block"><span className="label">Note du changement {closerExperience && CLOSER_NOTE_REQUIRED.has(statusDraft) ? '*' : '(optionnelle)'}</span><textarea className="input min-h-24 resize-y" maxLength={2000} value={statusNote} onChange={(e) => setStatusNote(e.target.value)} placeholder={statusDraft === 'confirmed' ? 'Optionnelle pour Confirmé.' : 'Explique la raison. Cette note restera dans l’historique.'} /></label><p className="text-xs text-zinc-500">Chaque statut et sa note restent visibles dans l’historique pour le closer et les admins. Seul un admin peut valider « Livré ».</p><div className="flex justify-end gap-2"><button type="button" className="btn-outline" disabled={saving} onClick={() => setStatusTarget(null)}>Annuler</button><button type="button" className="btn-primary" disabled={saving} onClick={saveStatus}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />} Enregistrer</button></div></div>}</Modal>
    <Modal open={confirmingCloserStatus} onClose={() => !saving && setConfirmingCloserStatus(false)} title="Confirmer ce prospect ?" maxWidth="max-w-md"><p className="text-zinc-700">Es-tu sûr de vouloir passer <strong>{statusTarget?.full_name}</strong> au statut « Confirmé » ?</p><p className="mt-2 text-sm text-zinc-500">Oui enregistre immédiatement la confirmation et sa note éventuelle. Seul un admin pourra ensuite créer la commande.</p><div className="mt-6 flex justify-end gap-2"><button className="btn-outline" disabled={saving} onClick={() => setConfirmingCloserStatus(false)}>Non</button><button className="btn-primary" disabled={saving} onClick={commitStatus}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Oui, confirmer</button></div></Modal>
    <Modal open={!!historyTarget} onClose={() => setHistoryTarget(null)} title={`Historique${historyTarget ? ` — ${historyTarget.full_name}` : ''}`} maxWidth="max-w-2xl"><LeadHistoryTimeline loading={historyQ.isLoading} error={historyQ.isError} activities={historyQ.data ?? []} /></Modal>
    <Modal open={!!contactTarget} onClose={() => setContactTarget(null)} title={`Appeler${contactTarget ? ` — ${contactTarget.full_name}` : ''}`} maxWidth="max-w-md">{contactTarget && <div className="space-y-4"><p className="text-sm text-zinc-600">Choisis comment contacter ce prospect.</p><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><a className="btn-primary justify-center py-3" href={whatsappUrl(contactTarget.phone_normalized)} target="_blank" rel="noreferrer" onClick={() => setContactTarget(null)}><MessageCircle className="h-5 w-5" /> Appel WhatsApp</a><a className="btn-outline justify-center py-3" href={`tel:${internationalPhone(contactTarget.phone_normalized)}`} onClick={() => setContactTarget(null)}><Phone className="h-5 w-5" /> Appel téléphonique</a></div><p className="text-center text-xs text-zinc-400">{contactTarget.phone_raw}</p></div>}</Modal>
    <Modal open={confirmToCommandes} onClose={() => !saving && setConfirmToCommandes(false)} title="Envoyer vers Commandes ?" maxWidth="max-w-md"><p className="text-zinc-700">Créer une commande pour <strong>{selectedIds.size}</strong> prospect(s) sélectionné(s) ?</p><p className="mt-2 text-sm text-zinc-500">Le statut CRM de chaque prospect restera inchangé. Les prospects qui ont déjà une commande sont ignorés (aucun doublon).</p><div className="mt-6 flex justify-end gap-2"><button className="btn-outline" disabled={saving} onClick={() => setConfirmToCommandes(false)}>Annuler</button><button className="btn-primary" disabled={saving} onClick={doBulkToCommandes}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Oui, créer les commandes</button></div></Modal>
  </div>;
}

function LeadRow({ lead, selected, onToggle, onContact, onCall, onStatus, onHistory, onDelete, onAssign }: { lead: WebinarLead; selected: boolean; onToggle: () => void; onContact: () => void; onCall?: () => void; onStatus: () => void; onHistory: () => void; onDelete?: () => void; onAssign?: () => void }) { const order = lead.delivery_orders?.[0]; return <tr className="align-top hover:bg-zinc-50/70"><td className="px-3 py-3"><input type="checkbox" className="h-6 w-6 cursor-pointer rounded border-2 border-zinc-400 accent-aurel-orange" aria-label={`Sélectionner ${lead.full_name}`} checked={selected} onChange={onToggle} /></td><td className="px-4 py-3"><div className="font-semibold text-zinc-900">{lead.full_name}</div><a className="text-xs text-aurel-teal hover:underline" href={whatsappUrl(lead.phone_normalized)} target="_blank" rel="noreferrer">{lead.phone_raw}</a><div className="text-[11px] text-zinc-400">{lead.email}</div></td><td className="px-4 py-3">{lead.ready_to_pay == null ? <span className="text-xs text-zinc-400" title="Question posée uniquement depuis le nouveau formulaire">—</span> : <span className={cn('badge', lead.ready_to_pay ? 'badge-green' : 'badge-slate')}>{lead.ready_to_pay ? 'Oui' : 'Non'}</span>}</td><td className="px-4 py-3"><MapPinText lead={lead} /></td><td className="px-4 py-3">{lead.closer_name ?? '—'}<div className="text-[10px] text-zinc-400">{lead.call_count} appel(s)</div></td><td className="px-4 py-3"><LeadStatus status={lead.status} /></td><td className="px-4 py-3">{order ? <><span className="badge badge-teal">{order.ecom_situation || (order.ecom_tracking ? 'En préparation' : 'Pas encore envoyée')}</span>{order.ecom_tracking && <div className="mt-1 font-mono text-[10px] text-zinc-500">{order.ecom_tracking}</div>}</> : <span className="text-xs text-zinc-400">Aucune commande</span>}</td><td className="px-4 py-3 text-xs text-zinc-500">{lead.last_call_at ? formatDateTime(lead.last_call_at) : `Inscrit ${formatDateTime(lead.created_at)}`}{lead.next_follow_up_at && <div className="mt-1 text-aurel-orange"><CalendarClock className="mr-1 inline h-3 w-3" />{formatDateTime(lead.next_follow_up_at)}</div>}{lead.latest_call_note && <div className="mt-1 max-w-56 rounded bg-amber-50 px-2 py-1 text-amber-800"><StickyNote className="mr-1 inline h-3 w-3" />{lead.latest_call_note}</div>}</td><td className="px-4 py-3"><div className="flex flex-wrap justify-end gap-1.5">{onAssign && <button type="button" className="btn-outline px-2.5 py-1.5 text-xs" onClick={onAssign}><UserCheck className="h-3.5 w-3.5" /> Attribuer</button>}<button type="button" className="btn-outline px-2.5 py-1.5 text-xs" onClick={onContact}><Phone className="h-3.5 w-3.5" /> Appeler</button>{onCall && <button type="button" className="btn-outline px-2.5 py-1.5 text-xs" onClick={onCall}><Phone className="h-3.5 w-3.5" /> Suivi</button>}<button type="button" className="btn-outline px-2.5 py-1.5 text-xs" onClick={onStatus}><ListChecks className="h-3.5 w-3.5" /> Statut</button><button type="button" className="btn-outline px-2.5 py-1.5 text-xs" onClick={onHistory}><History className="h-3.5 w-3.5" /> Historique</button>{onDelete && <button type="button" aria-label="Supprimer le prospect" className="btn-outline px-2.5 py-1.5 text-red-600" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></button>}</div></td></tr>; }

type LeadActions = { lead: WebinarLead; selected: boolean; onToggle: () => void; onContact: () => void; onCall?: () => void; onStatus: () => void; onHistory: () => void; onDelete?: () => void; onAssign?: () => void };
function LeadCard({ lead, selected, onToggle, onContact, onCall, onStatus, onHistory, onDelete, onAssign }: LeadActions) {
  const order = lead.delivery_orders?.[0];
  return <article className="space-y-3 p-4">
    <div className="flex items-start gap-3">
      <label className="-m-2 inline-flex min-h-[44px] min-w-[44px] flex-none items-center justify-center p-2"><input type="checkbox" className="h-7 w-7 cursor-pointer rounded border-2 border-zinc-400 accent-aurel-orange" aria-label={`Sélectionner ${lead.full_name}`} checked={selected} onChange={onToggle} /></label>
      <div className="min-w-0 flex-1"><div className="break-words font-semibold text-zinc-950">{lead.full_name}</div><a className="mt-0.5 inline-block text-sm font-medium text-aurel-teal" href={whatsappUrl(lead.phone_normalized)} target="_blank" rel="noreferrer">{lead.phone_raw}</a><div className="break-all text-xs text-zinc-500">{lead.email}</div></div>
      <LeadStatus status={lead.status} />
    </div>
    <div className="grid grid-cols-2 gap-3 rounded-lg bg-zinc-50 p-3 text-xs">
      <div><div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Livraison</div><MapPinText lead={lead} /></div>
      <div><div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Closer</div><div className="font-medium text-zinc-800">{lead.closer_name ?? 'Non attribué'}</div><div className="text-zinc-500">{lead.call_count} appel(s)</div></div>
      <div><div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">E-com</div>{order ? <><span className="badge badge-teal">{order.ecom_situation || (order.ecom_tracking ? 'En préparation' : 'Pas envoyée')}</span>{order.ecom_tracking && <div className="mt-1 break-all font-mono text-[10px] text-zinc-500">{order.ecom_tracking}</div>}</> : <span className="text-zinc-500">Aucune commande</span>}</div>
      <div><div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Dernier suivi</div><div className="text-zinc-600">{lead.last_call_at ? formatDateTime(lead.last_call_at) : `Inscrit ${formatDateTime(lead.created_at)}`}</div>{lead.next_follow_up_at && <div className="mt-1 text-aurel-orange"><CalendarClock className="mr-1 inline h-3 w-3" />{formatDateTime(lead.next_follow_up_at)}</div>}</div>
    </div>
    {lead.latest_call_note && <div className="whitespace-pre-wrap break-words rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900"><StickyNote className="mr-1 inline h-3.5 w-3.5" />{lead.latest_call_note}</div>}
    <div className="grid grid-cols-2 gap-2">
      {onAssign && <button type="button" className="btn-outline" onClick={onAssign}><UserCheck className="h-4 w-4" /> Attribuer</button>}
      <button type="button" className="btn-outline" onClick={onContact}><Phone className="h-4 w-4" /> Appeler</button>
      {onCall && <button type="button" className="btn-outline" onClick={onCall}><Phone className="h-4 w-4" /> Suivi</button>}
      <button type="button" className="btn-primary" onClick={onStatus}><ListChecks className="h-4 w-4" /> Statut</button>
      <button type="button" className="btn-outline" onClick={onHistory}><History className="h-4 w-4" /> Historique</button>
      {onDelete && <button type="button" className="btn-outline text-red-600" onClick={onDelete}><Trash2 className="h-4 w-4" /> Supprimer</button>}
    </div>
  </article>;
}

function LeadHistoryTimeline({ loading, error, activities }: { loading: boolean; error: boolean; activities: WebinarLeadActivity[] }) {
  if (loading) return <Spinner label="Chargement de l’historique…" />;
  if (error) return <div className="rounded-card-sm bg-red-50 p-4 text-sm text-red-700">Impossible de charger l’historique.</div>;
  if (!activities.length) return <div className="rounded-card-sm bg-zinc-50 p-6 text-center text-sm text-zinc-500">Aucune action enregistrée pour ce prospect.</div>;
  return <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
    {activities.map((activity) => {
      const metadata = activity.metadata ?? {};
      const attempt = Number(metadata.call_attempt || 0);
      const followUp = typeof metadata.next_follow_up_at === 'string' ? metadata.next_follow_up_at : null;
      const title = activity.status ? STATUS_LABEL[activity.status] : activity.activity_type === 'delivery' ? 'Commande' : 'Mise à jour';
      return <article key={activity.id} className="relative rounded-card-sm border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge badge-orange">{title}</span>
            {activity.status === 'callback' && attempt >= 1 && attempt <= 5 && <span className="badge badge-slate">{attempt === 1 ? '1er' : `${attempt}e`} appel</span>}
            <span className="text-xs font-medium text-zinc-600">{activity.actor_name ?? 'Équipe Aurel'}</span>
          </div>
          <time className="text-xs text-zinc-400">{formatDateTime(activity.created_at)}</time>
        </div>
        {activity.note ? <div className="mt-3 whitespace-pre-wrap rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950"><StickyNote className="mr-1.5 inline h-4 w-4" />{activity.note}</div> : <p className="mt-3 text-xs italic text-zinc-400">Aucune note pour cette action.</p>}
        {followUp && <div className="mt-2 text-xs font-medium text-aurel-orange"><CalendarClock className="mr-1 inline h-3.5 w-3.5" />Rappel prévu : {formatDateTime(followUp)}</div>}
      </article>;
    })}
  </div>;
}
function MapPinText({ lead }: { lead: WebinarLead }) { return <><span className="font-medium text-zinc-700">{lead.wilaya_name}</span> · {lead.commune}<div className="max-w-56 truncate text-[11px] text-zinc-400" title={lead.address}>{lead.address}</div></>; }
function LeadStatus({ status }: { status: WebinarLeadStatus }) { const color = status === 'delivered' ? 'badge-green' : ['confirmed', 'in_delivery'].includes(status) ? 'badge-teal' : ['not_interested', 'returned'].includes(status) ? 'badge-red' : 'badge-orange'; return <span className={cn('badge', color)}>{STATUS_LABEL[status]}</span>; }
function Kpi({ icon: Icon, label, value, color }: { icon: typeof Users; label: string; value: number; color: 'orange' | 'green' | 'red' }) { const tint = color === 'green' ? 'text-green-600' : color === 'red' ? 'text-red-600' : 'text-aurel-orange'; return <div className="kpi"><div className="kpi-label"><Icon className={cn('h-4 w-4', tint)} />{label}</div><div className={cn('kpi-value', color === 'red' && 'text-red-600')}>{value}</div></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label><span className="label">{label}</span>{children}</label>; }
function FilterSelect({ label, value, onChange, children, disabled = false }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode; disabled?: boolean }) { return <label className="min-w-0"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</span><select className="input w-full disabled:opacity-50" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>{children}</select></label>; }
function activeNames(staff: Array<{ first_name: string; last_name: string; is_active: boolean }>) { return staff.filter((member) => member.is_active).map((member) => `${member.first_name} ${member.last_name}`.trim()).filter(Boolean); }
function whatsappUrl(phone: string) { return `https://wa.me/${phone.startsWith('0') ? `213${phone.slice(1)}` : phone}`; }
function internationalPhone(phone: string) { return phone.startsWith('0') ? `+213${phone.slice(1)}` : phone.startsWith('+') ? phone : `+${phone}`; }
function toLocalInput(value: string) { const date = new Date(value); const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000); return local.toISOString().slice(0, 16); }
