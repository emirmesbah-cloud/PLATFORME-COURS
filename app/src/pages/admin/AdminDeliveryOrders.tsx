import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, CheckCircle2, Clock3, Loader2, PackagePlus,
  RefreshCw, RotateCw, Send, Truck,
} from 'lucide-react';
import {
  configureEcomWebhook, confirmDeliveryOrder, createDeliveryOrder, fetchDeliveryOrders,
  fetchEcomCommunes, fetchEcomConnection, fetchEcomStopdesks,
  fetchEcomWilayas, queryKeys, refreshDeliveryOrder, syncDeliveryOrder,
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
  amount: 38000, notes: '',
};

function friendlyError(error: unknown) {
  const value = error instanceof Error ? error.message : String(error);
  const labels: Record<string, string> = {
    ECOM_NOT_CONFIGURED: "La connexion E-com n'est pas encore configurée côté serveur.",
    ECOM_REF_ARTICLE_REQUIRED: 'Ce compte utilise le stock E-com : ajoute la référence produit.',
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
  const [configuringWebhook, setConfiguringWebhook] = useState(false);

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

  const selectedWilaya = useMemo(
    () => wilayasQ.data?.find((item) => item.id === form.wilayaId),
    [form.wilayaId, wilayasQ.data],
  );

  function resetAndOpen() {
    setForm(initialForm);
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
    if (form.deliveryMode === 'domicile' && !form.commune) return 'Choisis une commune livrable.';
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
      const order = await createDeliveryOrder({
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
        supplier_notes: form.notes.trim() || null,
      });
      if (sendToEcom) {
        try {
          const synced = await syncDeliveryOrder(order.id);
          toast.success(`Tracking ${synced.ecom_tracking} créé. Le colis reste modifiable jusqu’à confirmation.`, 'Envoyé à E-com');
        } catch (error) {
          toast.error(friendlyError(error), 'Commande enregistrée, envoi E-com échoué');
        }
      } else {
        toast.success('Brouillon enregistré. Tu pourras l’envoyer à E-com plus tard.');
      }
      setModalOpen(false);
      await qc.invalidateQueries({ queryKey: queryKeys.adminDeliveryOrders });
    } catch (error) {
      toast.error(friendlyError(error), 'Création impossible');
    } finally {
      setSubmitting(null);
    }
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

  const orders = ordersQ.data ?? [];

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
        <div className="flex items-center justify-between border-b border-zinc-200 p-5">
          <h2 className="text-lg font-bold text-aurel-ink">Commandes ({orders.length})</h2>
          <button type="button" className="btn-ghost" onClick={() => ordersQ.refetch()} disabled={ordersQ.isFetching}>
            <RefreshCw className={cn('h-4 w-4', ordersQ.isFetching && 'animate-spin')} /> Actualiser
          </button>
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
                      <th className="px-4 py-3">Client</th><th className="px-4 py-3">Destination</th>
                      <th className="px-4 py-3">Produit</th><th className="px-4 py-3">À encaisser</th>
                      <th className="px-4 py-3">Tracking</th><th className="px-4 py-3">Statut</th>
                      <th className="px-4 py-3">Créée</th><th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {orders.map((order) => (
                      <tr key={order.id} className="align-top hover:bg-zinc-50/70">
                        <td className="px-4 py-3"><div className="font-semibold text-zinc-900">{order.customer_name}</div><div className="text-xs text-zinc-500">{order.mobile_1}</div></td>
                        <td className="px-4 py-3"><div>{order.wilaya_name}</div><div className="text-xs text-zinc-500">{order.delivery_mode === 'stopdesk' ? `Stopdesk ${order.stopdesk_code}` : order.commune}</div></td>
                        <td className="px-4 py-3"><span className={cn('badge', order.course === 'immigration' ? 'badge-teal' : 'badge-orange')}>{courseLabel(order.course)}</span><div className="mt-1 text-xs text-zinc-500">× {order.quantity}</div></td>
                        <td className="px-4 py-3 font-semibold tabular">{Number(order.cod_amount).toLocaleString('fr-FR')} DA</td>
                        <td className="px-4 py-3 font-mono text-xs">{order.ecom_tracking ?? '—'}<div className="mt-1 font-sans text-[10px] text-zinc-400">{order.external_reference}</div></td>
                        <td className="px-4 py-3"><OrderStatus order={order} /></td>
                        <td className="px-4 py-3 text-xs text-zinc-500">{formatDateTime(order.created_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            {!order.ecom_tracking ? (
                              <button type="button" className="btn-outline px-2.5 py-1.5 text-xs" disabled={busyOrder === order.id} onClick={() => runOrderAction(order, 'sync')}>
                                {busyOrder === order.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Envoyer
                              </button>
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

      <Modal open={modalOpen} onClose={() => !submitting && setModalOpen(false)} title="Nouvelle commande" maxWidth="max-w-3xl">
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
              <Field label="Note livraison"><input className="input" maxLength={255} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Appeler avant, repère…" /></Field>
            </div>
          </div>

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-800">
            « Enregistrer et envoyer » crée le colis chez E-com en <strong>En Préparation</strong>. Tu gardes ensuite un bouton séparé pour le confirmer comme prêt à expédier, car cette confirmation devient irréversible chez E-com.
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn-outline" disabled={!!submitting} onClick={() => submit(false)}>{submitting === 'draft' && <Loader2 className="h-4 w-4 animate-spin" />} Enregistrer brouillon</button>
            <button type="button" className="btn-primary" disabled={!!submitting || !connectionQ.data?.connected} onClick={() => submit(true)}>{submitting === 'sync' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enregistrer et envoyer à E-com</button>
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
