import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, CheckCircle2, Clock3, Loader2, PackagePlus,
  Pencil, RefreshCw, RotateCw, Send, Trash2, Truck,
} from 'lucide-react';
import {
  configureEcomWebhook, confirmDeliveryOrder, createDeliveryOrder, fetchDeliveryOrders,
  fetchEcomCommunes, fetchEcomConnection, fetchEcomStopdesks,
  fetchEcomWilayas, fetchWebinarLead, queryKeys, refreshDeliveryOrder, syncDeliveryOrder,
  deleteDeliveryOrder, updateDeliveryOrder, updateDeliveryOrderDestination,
} from '@/lib/queries';
import type { Course, DeliveryMode, DeliveryOrder } from '@/lib/types';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { cn, courseLabel, formatDateTime } from '@/lib/utils';

type OrderForm = {
  customerName: string;
  mobile1: string;
  mobile2: string;
  wilayaId: number;
  commune: string;
  deliveryMode: DeliveryMode;
  stopdeskCode: string;
  address: string;
  course: Course;
  article: string;
  refArticle: string;
  quantity: number;
  amount: number;
  notes: string;
};

const initialForm: OrderForm = {
  customerName: '', mobile1: '', mobile2: '', wilayaId: 0, commune: '',
  deliveryMode: 'domicile', stopdeskCode: '', address: '', course: 'immigration',
  article: 'Programme Aurel Academy — Immigration', refArticle: '', quantity: 1,
  amount: 38000, notes: "Interdiction d'ouvrir le colis",
};

const DELIVERY_NOTE = "Interdiction d'ouvrir le colis";

function friendlyError(error: unknown) {
  const value = error instanceof Error ? error.message : String(error);
  const labels: Record<string, string> = {
    ECOM_NOT_CONFIGURED: "La connexion E-com n'est pas encore configurée côté serveur.",
    ECOM_REF_ARTICLE_REQUIRED: 'Ce compte utilise le stock E-com : ajoute la référence produit.',
    ECOM_WILAYA_INVALID: "Cette wilaya n'est pas disponible pour la livraison à domicile chez E-com.",
    ECOM_COMMUNE_INVALID: 'La commune ne correspond pas à la wilaya ou elle n’est pas livrable chez E-com.',
    ORDER_ALREADY_SYNCED: 'Cette commande possède déjà un tracking et ne peut plus être modifiée ici.',
    ECOM_TIMEOUT: "E-com n'a pas répondu à temps. La commande reste enregistrée : vérifie avant de renvoyer.",
    ORDER_NOT_SYNCED: "Cette commande n'a pas encore de tracking E-com.",
    WEBHOOK_NOT_CONFIGURED: "Le secret de signature E-com n'est pas configuré côté serveur.",
    WEBHOOK_CONFIGURATION_FAILED: "E-com n'a pas confirmé l'activation des mises à jour automatiques.",
  };
  return labels[value] ?? value;
}

export function AdminDeliveryOrders() {
  const toast = useToast();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<OrderForm>(initialForm);
  const [submitting, setSubmitting] = useState<'draft' | 'sync' | null>(null);
  const [busyOrder, setBusyOrder] = useState<string | null>(null);
  const [editingOrder, setEditingOrder] = useState<DeliveryOrder | null>(null);
  const [deletingOrder, setDeletingOrder] = useState<DeliveryOrder | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [configuringWebhook, setConfiguringWebhook] = useState(false);
  const [sourceLeadId, setSourceLeadId] = useState<string | null>(null);
  const [editingDestination, setEditingDestination] = useState<DeliveryOrder | null>(null);
  const [correctionWilayaId, setCorrectionWilayaId] = useState(0);
  const [correctionCommune, setCorrectionCommune] = useState('');
  const [correctionAddress, setCorrectionAddress] = useState('');
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const prefillHandledRef = useRef<string | null>(null);
  const requestedLeadId = searchParams.get('lead') ?? '';

  const ordersQ = useQuery({ queryKey: queryKeys.adminDeliveryOrders, queryFn: fetchDeliveryOrders });
  const connectionQ = useQuery({
    queryKey: queryKeys.ecomConnection,
    queryFn: fetchEcomConnection,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const wilayasQ = useQuery({
    queryKey: queryKeys.ecomWilayas,
    queryFn: fetchEcomWilayas,
    retry: false,
    staleTime: 24 * 60 * 60_000,
  });
  const communesQ = useQuery({
    queryKey: queryKeys.ecomCommunes(form.wilayaId),
    queryFn: () => fetchEcomCommunes(form.wilayaId),
    enabled: modalOpen && form.wilayaId > 0 && form.deliveryMode === 'domicile',
    staleTime: 24 * 60 * 60_000,
  });
  const stopdesksQ = useQuery({
    queryKey: queryKeys.ecomStopdesks(form.wilayaId),
    queryFn: () => fetchEcomStopdesks(form.wilayaId),
    enabled: modalOpen && form.wilayaId > 0 && form.deliveryMode === 'stopdesk',
    staleTime: 24 * 60 * 60_000,
  });
  const correctionCommunesQ = useQuery({
    queryKey: queryKeys.ecomCommunes(correctionWilayaId),
    queryFn: () => fetchEcomCommunes(correctionWilayaId),
    enabled: !!editingDestination && correctionWilayaId > 0,
    staleTime: 24 * 60 * 60_000,
  });
  const leadQ = useQuery({
    queryKey: queryKeys.webinarLead(requestedLeadId),
    queryFn: () => fetchWebinarLead(requestedLeadId),
    enabled: /^[0-9a-f-]{36}$/i.test(requestedLeadId),
  });

  useEffect(() => {
    const lead = leadQ.data;
    if (!lead || prefillHandledRef.current === lead.id) return;
    prefillHandledRef.current = lead.id;
    setSourceLeadId(lead.id);
    setForm({
      ...initialForm,
      customerName: lead.full_name,
      mobile1: lead.phone_normalized,
      wilayaId: lead.wilaya_id,
      commune: lead.commune,
      address: lead.address,
      notes: DELIVERY_NOTE,
    });
    setModalOpen(true);
  }, [leadQ.data]);

  const selectedWilaya = useMemo(
    () => wilayasQ.data?.find((item) => item.id === form.wilayaId),
    [form.wilayaId, wilayasQ.data],
  );

  function resetAndOpen() {
    setForm(initialForm);
    setEditingOrder(null);
    setSourceLeadId(null);
    setSearchParams({}, { replace: true });
    setModalOpen(true);
  }

  function openEdit(order: DeliveryOrder) {
    if (order.ecom_tracking) { toast.error('Une commande déjà envoyée à E-com ne peut plus être modifiée.'); return; }
    setEditingOrder(order); setSourceLeadId(order.webinar_lead_id);
    setForm({ customerName: order.customer_name, mobile1: order.mobile_1, mobile2: order.mobile_2 ?? '', wilayaId: order.wilaya_id, commune: order.commune ?? '', deliveryMode: order.delivery_mode, stopdeskCode: order.stopdesk_code ?? '', address: order.address ?? '', course: order.course, article: order.article, refArticle: order.ecom_ref_article ?? '', quantity: order.quantity, amount: Number(order.cod_amount), notes: DELIVERY_NOTE });
    setModalOpen(true);
  }

  function changeCourse(course: Course) {
    setForm((current) => ({
      ...current,
      course,
      article: course === 'immigration' ? 'Programme Aurel Academy — Immigration' : 'Programme Aurel Academy — Pflege',
      amount: course === 'immigration' ? 38000 : 12900,
    }));
  }

  function validate() {
    if (!form.customerName.trim()) return 'Le nom du client est obligatoire.';
    if (!/^0[5-7]\d{8}$/.test(form.mobile1.replace(/\s/g, ''))) return 'Téléphone attendu : 0555123456.';
    if (!selectedWilaya) return 'Choisis une wilaya.';
    if (form.deliveryMode === 'domicile'
      && !communesQ.data?.some((item) => item.livrable && item.commune === form.commune)) {
      return 'Choisis une commune livrable dans la liste E-com.';
    }
    if (form.deliveryMode === 'stopdesk' && !form.stopdeskCode) return 'Choisis un bureau stopdesk.';
    if (connectionQ.data?.stock && !form.refArticle.trim()) return 'La référence article E-com est obligatoire pour ce compte stock.';
    if (!Number.isFinite(form.amount) || form.amount < 0) return 'Le montant à encaisser est invalide.';
    return null;
  }

  async function submit(sendToEcom: boolean) {
    const invalid = validate();
    if (invalid) { toast.error(invalid, 'Commande incomplète'); return; }
    setSubmitting(sendToEcom ? 'sync' : 'draft');
    try {
      const input = {
        customer_name: form.customerName.trim(),
        mobile_1: form.mobile1.trim(),
        mobile_2: form.mobile2.trim() || null,
        wilaya_id: form.wilayaId,
        wilaya_name: selectedWilaya!.libelle,
        commune: form.deliveryMode === 'domicile' ? form.commune : null,
        delivery_mode: form.deliveryMode,
        stopdesk_code: form.deliveryMode === 'stopdesk' ? form.stopdeskCode : null,
        address: form.address.trim() || null,
        course: form.course,
        article: form.article.trim(),
        ecom_ref_article: form.refArticle.trim() || null,
        quantity: form.quantity,
        cod_amount: form.amount,
        supplier_notes: DELIVERY_NOTE,
        webinar_lead_id: sourceLeadId,
      };
      const order = editingOrder ? await updateDeliveryOrder(editingOrder.id, input) : await createDeliveryOrder(input);
      if (sendToEcom) {
        try {
          const synced = await syncDeliveryOrder(order.id);
          toast.success(`Tracking ${synced.ecom_tracking} créé. Le colis reste modifiable jusqu’à confirmation.`, 'Envoyé à E-com');
        } catch (error) {
          toast.error(friendlyError(error), 'Commande enregistrée, envoi E-com échoué');
        }
      } else {
        toast.success(editingOrder ? 'Commande modifiée.' : 'Brouillon enregistré. Tu pourras l’envoyer à E-com plus tard.');
      }
      setModalOpen(false);
      setEditingOrder(null);
      await qc.invalidateQueries({ queryKey: queryKeys.adminDeliveryOrders });
      await qc.invalidateQueries({ queryKey: queryKeys.adminWebinarLeads });
      setSearchParams({}, { replace: true });
    } catch (error) {
      toast.error(friendlyError(error), 'Création impossible');
    } finally {
      setSubmitting(null);
    }
  }

  async function sendSelected() {
    const ids = Array.from(selectedOrderIds);
    if (!ids.length) return;
    setBulkSending(true); let success = 0; let failed = 0;
    for (const id of ids) {
      try { await syncDeliveryOrder(id); success += 1; } catch { failed += 1; }
    }
    setBulkSending(false); setConfirmingBulk(false); setSelectedOrderIds(new Set());
    toast.success(`${success} commande(s) envoyée(s)${failed ? ` · ${failed} échec(s) à vérifier` : ''}.`);
    await qc.invalidateQueries({ queryKey: queryKeys.adminDeliveryOrders });
  }

  async function approveDeleteOrder() {
    if (!deletingOrder) return;
    setBusyOrder(deletingOrder.id);
    try { await deleteDeliveryOrder(deletingOrder.id); toast.success('Commande supprimée.'); setDeletingOrder(null); await Promise.all([qc.invalidateQueries({ queryKey: queryKeys.adminDeliveryOrders }), qc.invalidateQueries({ queryKey: queryKeys.adminWebinarLeads }), qc.invalidateQueries({ queryKey: queryKeys.adminSalesAnalytics })]); }
    catch (error) { toast.error(friendlyError(error), 'Suppression impossible'); }
    finally { setBusyOrder(null); }
  }

  async function deleteSelected() {
    const ids = Array.from(selectedOrderIds);
    if (!ids.length) return;
    setBulkDeleting(true); let success = 0; let failed = 0;
    for (const id of ids) {
      try { await deleteDeliveryOrder(id); success += 1; } catch { failed += 1; }
    }
    setBulkDeleting(false); setConfirmingBulkDelete(false); setSelectedOrderIds(new Set());
    toast.success(`${success} commande(s) supprimée(s)${failed ? ` · ${failed} non supprimée(s)` : ''}.`);
    await Promise.all([qc.invalidateQueries({ queryKey: queryKeys.adminDeliveryOrders }), qc.invalidateQueries({ queryKey: queryKeys.adminWebinarLeads }), qc.invalidateQueries({ queryKey: queryKeys.adminSalesAnalytics })]);
  }

  async function runOrderAction(order: DeliveryOrder, action: 'sync' | 'refresh' | 'confirm') {
    if (action === 'confirm') {
      const accepted = window.confirm(
        `Confirmer le colis ${order.ecom_tracking} comme « Prêt à expédier » ?\n\nAprès confirmation, E-com ne permet plus de le modifier ni de le supprimer.`,
      );
      if (!accepted) return;
    }
    setBusyOrder(order.id);
    try {
      const updated = action === 'sync'
        ? await syncDeliveryOrder(order.id)
        : action === 'refresh'
          ? await refreshDeliveryOrder(order.id)
          : await confirmDeliveryOrder(order.id);
      toast.success(
        action === 'confirm' ? 'Colis confirmé : prêt à expédier.' : action === 'sync' ? `Tracking ${updated.ecom_tracking} créé.` : 'Statut actualisé.',
      );
      await qc.invalidateQueries({ queryKey: queryKeys.adminDeliveryOrders });
    } catch (error) {
      toast.error(friendlyError(error), 'E-com Delivery');
      await qc.invalidateQueries({ queryKey: queryKeys.adminDeliveryOrders });
    } finally {
      setBusyOrder(null);
    }
  }

  async function activateStatusUpdates() {
    setConfiguringWebhook(true);
    try {
      const result = await configureEcomWebhook();
      if (!result.webhook_ready) throw new Error('WEBHOOK_CONFIGURATION_FAILED');
      toast.success('Les statuts de livraison E-com seront maintenant mis à jour automatiquement.');
      await qc.invalidateQueries({ queryKey: queryKeys.ecomConnection });
    } catch (error) {
      toast.error(friendlyError(error), 'Activation impossible');
    } finally {
      setConfiguringWebhook(false);
    }
  }

  function openDestinationCorrection(order: DeliveryOrder) {
    setEditingDestination(order);
    setCorrectionWilayaId(order.wilaya_id);
    setCorrectionCommune(order.commune ?? '');
    setCorrectionAddress(order.address ?? '');
  }

  async function saveDestinationCorrection() {
    if (!editingDestination) return;
    const validCommune = correctionCommunesQ.data?.some(
      (item) => item.livrable && item.commune === correctionCommune,
    );
    if (!correctionWilayaId || !validCommune) {
      toast.error('Choisis une wilaya et une commune livrable dans les listes E-com.');
      return;
    }
    setSavingCorrection(true);
    try {
      await updateDeliveryOrderDestination({
        orderId: editingDestination.id,
        wilayaId: correctionWilayaId,
        commune: correctionCommune,
        address: correctionAddress.trim() || null,
      });
      toast.success('Destination corrigée. Vérifie-la puis clique sur Envoyer.');
      setEditingDestination(null);
      await qc.invalidateQueries({ queryKey: queryKeys.adminDeliveryOrders });
    } catch (error) {
      toast.error(friendlyError(error), 'Correction impossible');
    } finally {
      setSavingCorrection(false);
    }
  }

  const orders = ordersQ.data ?? [];
  const sendableOrders = orders.filter((order) => !order.ecom_tracking && order.sync_status !== 'syncing');
  const allSendableSelected = sendableOrders.length > 0 && sendableOrders.every((order) => selectedOrderIds.has(order.id));
  function toggleAllSendable() { setSelectedOrderIds(allSendableSelected ? new Set() : new Set(sendableOrders.map((order) => order.id))); }
  function toggleOrder(id: string) { setSelectedOrderIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function editSelected() { const order = orders.find((item) => selectedOrderIds.has(item.id)); if (order && selectedOrderIds.size === 1) openEdit(order); }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-aurel-orange">
            <Truck className="h-5 w-5" />
            <span className="text-sm font-semibold uppercase tracking-wide">Ventes physiques</span>
          </div>
          <h1 className="text-3xl font-bold text-aurel-ink">Commandes & livraison</h1>
          <p className="mt-1 text-slate-600">Saisis une seule fois : Aurel enregistre la vente et crée le colis chez E-com Delivery.</p>
        </div>
        <button type="button" onClick={resetAndOpen} className="btn-primary btn-lg">
          <PackagePlus className="h-4 w-4" /> Nouvelle commande
        </button>
      </header>

      <div className={cn(
        'flex items-start gap-3 rounded-card border p-4 text-sm',
        connectionQ.data?.connected ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-900',
      )}>
        {connectionQ.isLoading ? <Loader2 className="mt-0.5 h-5 w-5 animate-spin" />
          : connectionQ.data?.connected ? <CheckCircle2 className="mt-0.5 h-5 w-5" />
            : <AlertCircle className="mt-0.5 h-5 w-5" />}
        <div>
          <div className="font-semibold">
            {connectionQ.isLoading ? 'Vérification de la connexion E-com…'
              : connectionQ.data?.connected ? `E-com connecté${connectionQ.data.account_name ? ` — ${connectionQ.data.account_name}` : ''}`
                : 'E-com pas encore connecté'}
          </div>
          <p className="mt-0.5 text-xs opacity-80">
            {connectionQ.data?.connected
              ? `Mode ${connectionQ.data.stock ? 'avec stock' : 'sans stock'} · ${connectionQ.data.webhook_ready ? 'Mises à jour automatiques actives.' : 'Mises à jour automatiques à activer.'}`
              : friendlyError(connectionQ.error ?? 'ECOM_NOT_CONFIGURED')}
          </p>
          {connectionQ.data?.connected && !connectionQ.data.webhook_ready && (
            <button type="button" className="btn-outline mt-2 px-3 py-1.5 text-xs" disabled={configuringWebhook} onClick={activateStatusUpdates}>
              {configuringWebhook && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Activer les mises à jour automatiques
            </button>
          )}
        </div>
      </div>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 p-5">
          <h2 className="text-lg font-bold text-aurel-ink">Commandes ({orders.length})</h2>
          <div className="flex flex-wrap gap-2"><button type="button" className="btn-primary" disabled={!selectedOrderIds.size || bulkSending || !connectionQ.data?.connected} onClick={() => setConfirmingBulk(true)}><Send className="h-4 w-4" /> Envoyer ({selectedOrderIds.size})</button><button type="button" className="btn-outline" disabled={selectedOrderIds.size !== 1} onClick={editSelected}><Pencil className="h-4 w-4" /> Modifier</button><button type="button" className="btn-outline text-red-600" disabled={!selectedOrderIds.size || bulkDeleting} onClick={() => setConfirmingBulkDelete(true)}><Trash2 className="h-4 w-4" /> Supprimer ({selectedOrderIds.size})</button><button type="button" className="btn-ghost" onClick={() => ordersQ.refetch()} disabled={ordersQ.isFetching}>
            <RefreshCw className={cn('h-4 w-4', ordersQ.isFetching && 'animate-spin')} /> Actualiser
          </button></div>
        </div>
        {ordersQ.isLoading ? <Spinner label="Chargement des commandes…" />
          : ordersQ.isError ? <div className="p-8 text-center text-red-600">Impossible de charger les commandes.</div>
            : orders.length === 0 ? (
              <div className="p-10 text-center text-slate-500">
                <Truck className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                Aucune commande. La première sera enregistrée ici et envoyée directement à E-com.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-sm">
                  <thead className="bg-zinc-50 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-4 py-3"><input type="checkbox" aria-label="Sélectionner toutes les commandes à envoyer" checked={allSendableSelected} onChange={toggleAllSendable} /></th><th className="px-4 py-3">Client</th><th className="px-4 py-3">Destination</th>
                      <th className="px-4 py-3">Produit</th><th className="px-4 py-3">Note</th><th className="px-4 py-3">À encaisser</th>
                      <th className="px-4 py-3">Tracking</th><th className="px-4 py-3">Statut</th>
                      <th className="px-4 py-3">Créée</th><th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {orders.map((order) => (
                      <tr key={order.id} className="align-top hover:bg-zinc-50/70">
                        <td className="px-4 py-3"><input type="checkbox" aria-label={`Sélectionner ${order.customer_name}`} disabled={!!order.ecom_tracking || order.sync_status === 'syncing'} checked={selectedOrderIds.has(order.id)} onChange={() => toggleOrder(order.id)} /></td>
                        <td className="px-4 py-3"><div className="font-semibold text-zinc-900">{order.customer_name}</div><div className="text-xs text-zinc-500">{order.mobile_1}</div></td>
                        <td className="px-4 py-3"><div>{order.wilaya_name}</div><div className="text-xs text-zinc-500">{order.delivery_mode === 'stopdesk' ? `Stopdesk ${order.stopdesk_code}` : order.commune}</div></td>
                        <td className="px-4 py-3"><span className={cn('badge', order.course === 'immigration' ? 'badge-teal' : 'badge-orange')}>{courseLabel(order.course)}</span><div className="mt-1 text-xs text-zinc-500">× {order.quantity}</div></td>
                        <td className="px-4 py-3 text-xs font-semibold text-zinc-700">{DELIVERY_NOTE}</td>
                        <td className="px-4 py-3 font-semibold tabular">{Number(order.cod_amount).toLocaleString('fr-FR')} DA</td>
                        <td className="px-4 py-3 font-mono text-xs">{order.ecom_tracking ?? '—'}<div className="mt-1 font-sans text-[10px] text-zinc-400">{order.external_reference}</div></td>
                        <td className="px-4 py-3"><OrderStatus order={order} /></td>
                        <td className="px-4 py-3 text-xs text-zinc-500">{formatDateTime(order.created_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            {!order.ecom_tracking ? (
                              <>
                                <button type="button" className="btn-outline px-2.5 py-1.5 text-xs" disabled={busyOrder === order.id} onClick={() => openEdit(order)}><Pencil className="h-3.5 w-3.5" /> Modifier</button>
                                <button type="button" aria-label="Supprimer la commande" className="btn-outline px-2.5 py-1.5 text-red-600" disabled={busyOrder === order.id} onClick={() => setDeletingOrder(order)}><Trash2 className="h-3.5 w-3.5" /></button>
                                <button type="button" className="btn-outline px-2.5 py-1.5 text-xs" disabled={busyOrder === order.id} onClick={() => runOrderAction(order, 'sync')}>
                                  {busyOrder === order.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Envoyer
                                </button>
                              </>
                            ) : (
                              <>
                                <button type="button" aria-label="Actualiser le statut" title="Actualiser le statut" className="btn-outline px-2.5 py-1.5" disabled={busyOrder === order.id} onClick={() => runOrderAction(order, 'refresh')}>
                                  <RotateCw className={cn('h-3.5 w-3.5', busyOrder === order.id && 'animate-spin')} />
                                </button>
                                {!order.ecom_confirmed && (
                                  <button type="button" className="btn-primary px-2.5 py-1.5 text-xs" disabled={busyOrder === order.id} onClick={() => runOrderAction(order, 'confirm')}>
                                    <CheckCircle2 className="h-3.5 w-3.5" /> Confirmer
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </section>

      <Modal open={modalOpen} onClose={() => !submitting && setModalOpen(false)} title={editingOrder ? 'Modifier la commande' : 'Nouvelle commande'} maxWidth="max-w-3xl">
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nom complet *"><input className="input" maxLength={60} value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} placeholder="Nom du destinataire" /></Field>
            <Field label="Téléphone principal *"><input className="input" inputMode="tel" value={form.mobile1} onChange={(e) => setForm({ ...form, mobile1: e.target.value })} placeholder="0555123456" /></Field>
            <Field label="Deuxième téléphone"><input className="input" inputMode="tel" value={form.mobile2} onChange={(e) => setForm({ ...form, mobile2: e.target.value })} placeholder="Optionnel" /></Field>
            <Field label="Wilaya *">
              <select className="input" value={form.wilayaId} onChange={(e) => setForm({ ...form, wilayaId: Number(e.target.value), commune: '', stopdeskCode: '' })} disabled={wilayasQ.isLoading || !!wilayasQ.error}>
                <option value={0}>{wilayasQ.isLoading ? 'Chargement…' : 'Choisir la wilaya'}</option>
                {(wilayasQ.data ?? []).map((wilaya) => <option key={wilaya.id} value={wilaya.id}>{wilaya.id.toString().padStart(2, '0')} — {wilaya.libelle}</option>)}
              </select>
            </Field>
          </div>

          <div>
            <label className="label">Mode de livraison *</label>
            <div className="grid grid-cols-2 gap-2">
              {(['domicile', 'stopdesk'] as DeliveryMode[]).map((mode) => (
                <button key={mode} type="button" onClick={() => setForm({ ...form, deliveryMode: mode, commune: '', stopdeskCode: '' })}
                  className={cn('rounded-card-sm border px-3 py-2.5 text-sm font-semibold', form.deliveryMode === mode ? 'border-aurel-orange bg-aurel-orange-soft text-aurel-orange-dark' : 'border-zinc-200')}>
                  {mode === 'domicile' ? 'Livraison à domicile' : 'Bureau stopdesk'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {form.deliveryMode === 'domicile' ? (
              <Field label="Commune livrable *">
                <select className="input" value={form.commune} onChange={(e) => setForm({ ...form, commune: e.target.value })} disabled={!form.wilayaId || communesQ.isLoading}>
                  <option value="">{communesQ.isLoading ? 'Chargement…' : 'Choisir la commune'}</option>
                  {(communesQ.data ?? []).map((item) => <option key={item.id} value={item.commune}>{item.commune}</option>)}
                </select>
              </Field>
            ) : (
              <Field label="Bureau stopdesk *">
                <select className="input" value={form.stopdeskCode} onChange={(e) => setForm({ ...form, stopdeskCode: e.target.value })} disabled={!form.wilayaId || stopdesksQ.isLoading}>
                  <option value="">{stopdesksQ.isLoading ? 'Chargement…' : 'Choisir le bureau'}</option>
                  {(stopdesksQ.data ?? []).map((item) => <option key={item.id} value={item.code_stopdesk}>{item.nom_bureau} — {item.commune}</option>)}
                </select>
              </Field>
            )}
            <Field label="Adresse"><input className="input" maxLength={100} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Rue, quartier, repère…" /></Field>
          </div>

          <div className="border-t border-zinc-100 pt-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Programme vendu *">
                <select className="input" value={form.course} onChange={(e) => changeCourse(e.target.value as Course)}>
                  <option value="immigration">Immigration — 38 000 DA</option><option value="pflege">Pflege — 12 900 DA</option>
                </select>
              </Field>
              <Field label="Montant à encaisser (DA) *"><input type="number" min={0} className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} /></Field>
              <Field label="Désignation"><input className="input" maxLength={255} value={form.article} onChange={(e) => setForm({ ...form, article: e.target.value })} /></Field>
              <Field label="Quantité"><input type="number" min={1} className="input" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Math.max(1, Number(e.target.value)) })} /></Field>
              {connectionQ.data?.stock && <Field label="Référence produit E-com *"><input className="input" maxLength={64} value={form.refArticle} onChange={(e) => setForm({ ...form, refArticle: e.target.value })} /></Field>}
              <Field label="Note livraison"><input className="input bg-zinc-50" readOnly value={DELIVERY_NOTE} /></Field>
            </div>
          </div>

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-800">
            « Enregistrer et envoyer » crée le colis chez E-com en <strong>En Préparation</strong>. Tu gardes ensuite un bouton séparé pour le confirmer comme prêt à expédier, car cette confirmation devient irréversible chez E-com.
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn-outline" disabled={!!submitting} onClick={() => submit(false)}>{submitting === 'draft' && <Loader2 className="h-4 w-4 animate-spin" />} {editingOrder ? 'Enregistrer les modifications' : 'Enregistrer brouillon'}</button>
            {!editingOrder && <button type="button" className="btn-primary" disabled={!!submitting || !connectionQ.data?.connected} onClick={() => submit(true)}>{submitting === 'sync' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enregistrer et envoyer à E-com</button>}
          </div>
        </div>
      </Modal>

      <Modal open={confirmingBulk} onClose={() => !bulkSending && setConfirmingBulk(false)} title="Confirmer l'envoi" maxWidth="max-w-md"><p className="text-zinc-700">Cette action est-elle confirmée ?</p><p className="mt-2 text-sm text-zinc-500">{selectedOrderIds.size} commande(s) seront envoyées vers E-com Delivery.</p><div className="mt-6 flex justify-end gap-2"><button className="btn-outline" disabled={bulkSending} onClick={() => setConfirmingBulk(false)}>Non</button><button className="btn-primary" disabled={bulkSending} onClick={sendSelected}>{bulkSending && <Loader2 className="h-4 w-4 animate-spin" />} Oui, envoyer</button></div></Modal>
      <Modal open={confirmingBulkDelete} onClose={() => !bulkDeleting && setConfirmingBulkDelete(false)} title="Supprimer la sélection ?" maxWidth="max-w-md"><p className="text-zinc-700">Supprimer {selectedOrderIds.size} commande(s) brouillon ?</p><p className="mt-2 text-sm text-zinc-500">Cette action est limitée aux commandes qui ne sont pas encore envoyées à E-com.</p><div className="mt-6 flex justify-end gap-2"><button className="btn-outline" disabled={bulkDeleting} onClick={() => setConfirmingBulkDelete(false)}>Non</button><button className="btn-primary bg-red-600 hover:bg-red-700" disabled={bulkDeleting} onClick={deleteSelected}>{bulkDeleting && <Loader2 className="h-4 w-4 animate-spin" />} Oui, supprimer</button></div></Modal>
      <Modal open={!!deletingOrder} onClose={() => !busyOrder && setDeletingOrder(null)} title="Supprimer la commande ?" maxWidth="max-w-md"><p className="text-zinc-700">Supprimer la commande brouillon de <strong>{deletingOrder?.customer_name}</strong> ?</p><p className="mt-2 text-sm text-zinc-500">Une commande déjà envoyée à E-com ne peut pas être supprimée ici.</p><div className="mt-6 flex justify-end gap-2"><button className="btn-outline" disabled={!!busyOrder} onClick={() => setDeletingOrder(null)}>Non</button><button className="btn-primary bg-red-600 hover:bg-red-700" disabled={!!busyOrder} onClick={approveDeleteOrder}>{busyOrder && <Loader2 className="h-4 w-4 animate-spin" />} Oui, supprimer</button></div></Modal>

      <Modal open={!!editingDestination} onClose={() => !savingCorrection && setEditingDestination(null)} title="Corriger la destination" maxWidth="max-w-xl">
        <div className="space-y-5">
          <div className="rounded-card-sm border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Sélectionne les valeurs exactes proposées par E-com. La commande ne sera pas renvoyée automatiquement.
          </div>
          <Field label="Wilaya E-com *">
            <select className="input" value={correctionWilayaId}
              onChange={(e) => { setCorrectionWilayaId(Number(e.target.value)); setCorrectionCommune(''); }}
              disabled={wilayasQ.isLoading}>
              <option value={0}>Choisir la wilaya</option>
              {(wilayasQ.data ?? []).filter((item) => item.domicile).map((wilaya) => (
                <option key={wilaya.id} value={wilaya.id}>{wilaya.id.toString().padStart(2, '0')} — {wilaya.libelle}</option>
              ))}
            </select>
          </Field>
          <Field label="Commune livrable E-com *">
            <select className="input" value={correctionCommune}
              onChange={(e) => setCorrectionCommune(e.target.value)}
              disabled={!correctionWilayaId || correctionCommunesQ.isLoading}>
              <option value="">{correctionCommunesQ.isLoading ? 'Chargement…' : 'Choisir la commune'}</option>
              {(correctionCommunesQ.data ?? []).map((item) => <option key={item.id} value={item.commune}>{item.commune}</option>)}
            </select>
          </Field>
          <Field label="Adresse"><input className="input" maxLength={250} value={correctionAddress} onChange={(e) => setCorrectionAddress(e.target.value)} /></Field>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-outline" disabled={savingCorrection} onClick={() => setEditingDestination(null)}>Annuler</button>
            <button type="button" className="btn-primary" disabled={savingCorrection} onClick={saveDestinationCorrection}>
              {savingCorrection ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Enregistrer la correction
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label><span className="label">{label}</span>{children}</label>;
}

function OrderStatus({ order }: { order: DeliveryOrder }) {
  if (order.sync_status === 'failed') return <div><span className="badge badge-red"><AlertCircle className="h-3 w-3" /> Échec envoi</span><div className="mt-1 max-w-40 text-[10px] text-red-600">{order.last_error}</div></div>;
  if (order.sync_status === 'syncing') return <span className="badge badge-orange"><Loader2 className="h-3 w-3 animate-spin" /> Envoi</span>;
  if (!order.ecom_tracking) return <span className="badge badge-slate"><Clock3 className="h-3 w-3" /> Brouillon</span>;
  return <div><span className={cn('badge', order.ecom_confirmed ? 'badge-green' : 'badge-teal')}>{order.ecom_situation ?? (order.ecom_confirmed ? 'En traitement' : 'En préparation')}</span>{order.ecom_logistics_state && <div className="mt-1 text-[10px] text-zinc-500">{order.ecom_logistics_state}</div>}</div>;
}
