// Aurel Academy — authenticated admin bridge to E-com Delivery API v2.
// Credentials stay in Supabase secrets and are never returned to the browser.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { reportError } from '../_shared/sentry.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ECOM_API_KEY = Deno.env.get('ECOM_API_KEY') ?? '';
const ECOM_API_TOKEN = Deno.env.get('ECOM_API_TOKEN') ?? '';
const ECOM_WEBHOOK_SECRET = Deno.env.get('ECOM_WEBHOOK_SECRET') ?? '';
const ECOM_BASE_URL = 'https://ecom-dz.com/api_v2';

const ALLOWED_ORIGINS = new Set([
  'https://app.aurel-academy.com',
  'http://localhost:5173',
  'http://localhost:4173',
]);

function cors(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://app.aurel-academy.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}

class EcomError extends Error {
  status: number;
  detail: unknown;
  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function ecom(path: string, init: RequestInit = {}) {
  if (!ECOM_API_KEY || !ECOM_API_TOKEN) throw new EcomError('ECOM_NOT_CONFIGURED', 503);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${ECOM_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'X-API-Key': ECOM_API_KEY,
        'X-API-Token': ECOM_API_TOKEN,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const raw = await response.text();
    let data: unknown = null;
    try { data = raw ? JSON.parse(raw) : null; }
    catch { data = raw.slice(0, 500); }
    if (!response.ok) {
      const apiError = data && typeof data === 'object' && 'error' in data
        ? (data as { error?: { message?: unknown; code?: unknown; details?: unknown } }).error
        : null;
      const baseMessage = typeof apiError?.message === 'string'
        ? apiError.message.slice(0, 300)
        : typeof apiError?.code === 'string'
          ? apiError.code.slice(0, 100)
          : `ECOM_HTTP_${response.status}`;
      const detailText = typeof apiError?.details === 'string'
        ? apiError.details
        : apiError?.details
          ? JSON.stringify(apiError.details)
          : '';
      const safeMessage = detailText
        ? `${baseMessage} — ${detailText.slice(0, 300)}`
        : baseMessage;
      throw new EcomError(safeMessage, response.status, data);
    }
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new EcomError('ECOM_TIMEOUT', 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizePhone(value: unknown) {
  const raw = String(value ?? '').replace(/[\s().-]/g, '');
  if (raw.startsWith('+213')) return `0${raw.slice(4)}`;
  if (raw.startsWith('213')) return `0${raw.slice(3)}`;
  return raw;
}

async function resolveDeliverableCommune(wilayaId: number, commune: unknown) {
  if (!Number.isInteger(wilayaId) || wilayaId < 1 || wilayaId > 58) {
    throw new EcomError('ECOM_WILAYA_INVALID', 422);
  }
  const requested = String(commune ?? '').normalize('NFKC').trim();
  const items = await ecom(`/communes?id_wilaya=${wilayaId}`) as Array<{
    commune?: unknown;
    livrable?: unknown;
  }>;
  const match = items.find((item) => item.livrable === true && String(item.commune ?? '').normalize('NFKC').trim() === requested);
  if (!match) throw new EcomError('ECOM_COMMUNE_INVALID', 422);
  return String(match.commune).trim();
}

async function resolveDomicileWilaya(wilayaId: number) {
  const items = await ecom('/wilayas') as Array<{
    id?: unknown;
    libelle?: unknown;
    domicile?: unknown;
  }>;
  const match = items.find((item) => Number(item.id) === wilayaId && item.domicile === true);
  if (!match) throw new EcomError('ECOM_WILAYA_INVALID', 422);
  return String(match.libelle ?? '').trim();
}

function isDeletedParcel(detail: Record<string, unknown>) {
  const status = `${String(detail.situation ?? '')} ${String(detail.etat_logistique ?? '')}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return status.includes('supprim');
}

async function deleteEcomParcel(tracking: string) {
  const path = `/colis/${encodeURIComponent(tracking)}`;
  let detail: Record<string, unknown>;
  try {
    detail = await ecom(path) as Record<string, unknown>;
  } catch (error) {
    // A missing parcel is already deleted on E-com, so local cleanup is safe.
    if (error instanceof EcomError && error.status === 404) {
      return { already_deleted: true };
    }
    throw error;
  }
  if (isDeletedParcel(detail)) return { already_deleted: true };

  // E-com API v2 accepts deletion only while the parcel is still editable.
  await ecom(path, { method: 'DELETE' });
  return { already_deleted: false };
}

async function replayPendingWebhookEvents(
  admin: ReturnType<typeof createClient>,
  orderId: string,
  webinarLeadId: string | null,
  tracking: string,
) {
  const { data: pending, error: pendingError } = await admin
    .from('ecom_webhook_events')
    .select('event_id, payload')
    .eq('tracking', tracking)
    .is('processed_at', null)
    .order('received_at', { ascending: true });
  if (pendingError) throw pendingError;

  let leadStatus: string | null = null;
  if (webinarLeadId) {
    const { data: lead, error: leadError } = await admin
      .from('webinar_leads')
      .select('status')
      .eq('id', webinarLeadId)
      .maybeSingle();
    if (leadError) throw leadError;
    leadStatus = lead?.status ?? null;
  }

  for (const event of pending ?? []) {
    const body = event.payload && typeof event.payload === 'object'
      ? event.payload as Record<string, unknown>
      : {};
    const occurredAt = body.date ? new Date(String(body.date)) : new Date();
    const safeOccurredAt = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;
    const eventText = `${body.event ?? ''} ${body.action ?? ''} ${body.situation ?? ''} ${body.etat_logistique ?? ''}`.toLowerCase();
    const deletedFromEcom = body.deleted === true || /supprim|delete|removed/.test(eventText);
    const { error: orderUpdateError } = await admin.from('delivery_orders').update({
      ecom_situation: deletedFromEcom ? 'Supprimée depuis E-com' : body.situation ? String(body.situation).slice(0, 200) : null,
      ecom_logistics_state: body.etat_logistique ? String(body.etat_logistique).slice(0, 200) : null,
      last_event_at: safeOccurredAt.toISOString(),
      last_synced_at: new Date().toISOString(),
      last_error: null,
      ...(deletedFromEcom ? {
        deleted_from_ecom_at: safeOccurredAt.toISOString(),
        deleted_from_ecom_event_id: event.event_id,
      } : {}),
    }).eq('id', orderId);
    if (orderUpdateError) throw orderUpdateError;

    if (webinarLeadId && leadStatus) {
      const { error: activityError } = await admin.from('webinar_lead_activities').upsert({
        lead_id: webinarLeadId,
        activity_type: 'delivery',
        status: leadStatus,
        note: body.situation ? String(body.situation).slice(0, 200) : 'Mise à jour E-com',
        source_event_id: event.event_id,
        metadata: { event_id: event.event_id, tracking, id_situation: Number(body.id_situation), source: 'ecom_webhook_replay' },
      }, { onConflict: 'source_event_id', ignoreDuplicates: true });
      if (activityError) throw activityError;
    }

    const { error: processedError } = await admin.from('ecom_webhook_events').update({
      processed_at: new Date().toISOString(), processing_error: null,
    }).eq('event_id', event.event_id);
    if (processedError) throw processedError;
  }
}

serve(async (req) => {
  const CORS = cors(req.headers.get('origin'));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);

  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json({ ok: false, error: 'UNAUTHORIZED' }, 401);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = auth.slice('Bearer '.length);
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
  const { data: profile } = await admin
    .from('profiles')
    .select('is_admin, revoked_at')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (!profile?.is_admin || profile.revoked_at) return json({ ok: false, error: 'FORBIDDEN' }, 403);

  let payload: {
    action?: string;
    order_id?: string;
    lead_id?: string;
    wilaya_id?: number;
    commune?: string;
    address?: string | null;
  };
  try { payload = await req.json(); }
  catch { return json({ ok: false, error: 'INVALID_JSON' }, 400); }

  let activeSyncToken: string | null = null;
  let activeSyncTracking: string | null = null;

  try {
    if (payload.action === 'connection') {
      const result = await ecom('/test') as Record<string, unknown>;
      let webhook: { actif?: boolean; url?: string; events?: string[] } = {};
      try {
        webhook = await ecom('/webhook') as typeof webhook;
      } catch {
        // A webhook problem must not hide an otherwise valid API connection.
      }
      const expectedWebhookUrl = `${SUPABASE_URL}/functions/v1/ecom-webhook`;
      return json({
        ok: true,
        connected: true,
        account_name: result.nom_fournisseur ?? null,
        stock: result.stock === true,
        webhook_ready: webhook.actif === true
          && webhook.url === expectedWebhookUrl
          && (webhook.events ?? []).includes('*'),
      });
    }

    if (payload.action === 'configure-webhook') {
      if (!ECOM_WEBHOOK_SECRET) throw new EcomError('WEBHOOK_NOT_CONFIGURED', 503);
      const webhookUrl = `${SUPABASE_URL}/functions/v1/ecom-webhook`;
      const result = await ecom('/webhook', {
        method: 'PUT',
        body: JSON.stringify({
          url: webhookUrl,
          secret: ECOM_WEBHOOK_SECRET,
          events: ['*'],
          active: true,
        }),
      }) as { actif?: boolean; url?: string; events?: string[] };
      return json({
        ok: true,
        webhook_ready: result.actif === true && result.url === webhookUrl,
      });
    }

    if (payload.action === 'wilayas') {
      return json({ ok: true, items: await ecom('/wilayas') });
    }
    if (payload.action === 'communes') {
      const id = Number(payload.wilaya_id);
      if (!Number.isInteger(id) || id < 1 || id > 58) return json({ ok: false, error: 'INVALID_WILAYA' }, 400);
      return json({ ok: true, items: await ecom(`/communes?id_wilaya=${id}`) });
    }
    if (payload.action === 'stopdesks') {
      const id = Number(payload.wilaya_id);
      if (!Number.isInteger(id) || id < 1 || id > 58) return json({ ok: false, error: 'INVALID_WILAYA' }, 400);
      return json({ ok: true, items: await ecom(`/stopdesks?id_wilaya=${id}`) });
    }

    if (payload.action === 'delete-lead') {
      const leadId = String(payload.lead_id ?? '');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadId)) {
        return json({ ok: false, error: 'INVALID_LEAD_ID' }, 400);
      }
      const { data: lead, error: leadError } = await admin
        .from('webinar_leads')
        .select('id')
        .eq('id', leadId)
        .is('deleted_at', null)
        .maybeSingle();
      if (leadError || !lead) return json({ ok: false, error: 'LEAD_NOT_FOUND' }, 404);

      const { data: linkedOrders, error: ordersError } = await admin
        .from('delivery_orders')
        .select('id, ecom_tracking')
        .eq('webinar_lead_id', leadId)
        .is('deleted_at', null);
      if (ordersError) throw ordersError;

      // Do not remove anything locally until every linked E-com parcel has
      // accepted deletion (or is already absent/deleted there).
      for (const linkedOrder of linkedOrders ?? []) {
        if (linkedOrder.ecom_tracking) await deleteEcomParcel(linkedOrder.ecom_tracking);
      }
      if (linkedOrders?.length) {
        const { error: archiveOrdersError } = await admin
          .from('delivery_orders')
          .update({
            deleted_at: new Date().toISOString(),
            deleted_by: userData.user.id,
            deleted_reason: 'Suppression administrateur du prospect',
            sync_lock_token: null,
            sync_started_at: null,
          })
          .eq('webinar_lead_id', leadId)
          .is('deleted_at', null);
        if (archiveOrdersError) throw archiveOrdersError;
      }
      const { error: archiveLeadError } = await admin.from('webinar_leads').update({
        deleted_at: new Date().toISOString(),
        deleted_by: userData.user.id,
        deleted_reason: 'Suppression administrateur',
        updated_at: new Date().toISOString(),
      }).eq('id', leadId).is('deleted_at', null);
      if (archiveLeadError) throw archiveLeadError;
      await admin.from('admin_audit_logs').insert({
        admin_user_id: userData.user.id,
        action_type: 'webinar_lead_archived',
        target_type: 'webinar_lead',
        target_id: leadId,
        metadata: { linked_orders: linkedOrders?.length ?? 0 },
      });
      return json({ ok: true, deleted_orders: linkedOrders?.length ?? 0 });
    }

    const orderId = String(payload.order_id ?? '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
      return json({ ok: false, error: 'INVALID_ORDER_ID' }, 400);
    }
    const { data: order, error: orderError } = await admin
      .from('delivery_orders')
      .select('*')
      .eq('id', orderId)
      .is('deleted_at', null)
      .maybeSingle();
    if (orderError || !order) return json({ ok: false, error: 'ORDER_NOT_FOUND' }, 404);

    if (payload.action === 'delete-order') {
      if (order.ecom_tracking) await deleteEcomParcel(order.ecom_tracking);
      const { error: archiveError } = await admin.from('delivery_orders').update({
        deleted_at: new Date().toISOString(),
        deleted_by: userData.user.id,
        deleted_reason: 'Suppression administrateur',
        sync_lock_token: null,
        sync_started_at: null,
      }).eq('id', orderId).is('deleted_at', null);
      if (archiveError) throw archiveError;
      await admin.from('admin_audit_logs').insert({
        admin_user_id: userData.user.id,
        action_type: 'delivery_order_archived',
        target_type: 'delivery_order',
        target_id: orderId,
        metadata: { deleted_from_ecom: Boolean(order.ecom_tracking), tracking: order.ecom_tracking ?? null },
      });
      return json({ ok: true, deleted_from_ecom: Boolean(order.ecom_tracking) });
    }

    if (payload.action === 'update-destination') {
      if (order.ecom_tracking) return json({ ok: false, error: 'ORDER_ALREADY_SYNCED' }, 409);
      if (order.sync_status === 'syncing') return json({ ok: false, error: 'ECOM_SYNC_IN_PROGRESS' }, 409);
      const wilayaId = Number(payload.wilaya_id);
      const [wilayaName, commune] = await Promise.all([
        resolveDomicileWilaya(wilayaId),
        resolveDeliverableCommune(wilayaId, payload.commune),
      ]);
      const address = String(payload.address ?? '').normalize('NFKC').trim().slice(0, 250) || null;
      const { data: saved, error: saveError } = await admin
        .from('delivery_orders')
        .update({
          wilaya_id: wilayaId,
          wilaya_name: wilayaName,
          commune,
          delivery_mode: 'domicile',
          stopdesk_code: null,
          address,
          sync_status: 'draft',
          last_error: null,
        })
        .eq('id', orderId)
        .is('deleted_at', null)
        .neq('sync_status', 'syncing')
        .select('*')
        .single();
      if (saveError) throw saveError;
      return json({ ok: true, order: saved });
    }

    if (payload.action === 'sync') {
      // Idempotence on the Aurel side: once a tracking exists we never create
      // a second E-com parcel for the same local order.
      if (order.ecom_tracking) return json({ ok: true, order, already_synced: true });

      // Recover a parcel that E-com accepted but whose tracking write was
      // interrupted (network/process crash between the two systems).
      const { data: completedAttempt, error: completedAttemptError } = await admin
        .from('ecom_sync_attempts')
        .select('tracking')
        .eq('order_id', orderId)
        .eq('status', 'succeeded')
        .not('tracking', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (completedAttemptError) throw completedAttemptError;
      if (completedAttempt?.tracking) {
        const { data: recovered, error: recoveryError } = await admin.from('delivery_orders').update({
          sync_status: 'synced', ecom_tracking: completedAttempt.tracking,
          last_error: null, last_synced_at: new Date().toISOString(),
          sync_lock_token: null, sync_started_at: null,
        }).eq('id', orderId).is('deleted_at', null).select('*').single();
        if (recoveryError) throw recoveryError;
        await replayPendingWebhookEvents(admin, orderId, recovered.webinar_lead_id, completedAttempt.tracking);
        const { data: refreshed } = await admin.from('delivery_orders').select('*').eq('id', orderId).single();
        return json({ ok: true, order: refreshed ?? recovered, recovered: true });
      }

      activeSyncToken = crypto.randomUUID();
      const { data: claimed, error: claimError } = await admin.rpc('claim_delivery_order_sync', {
        p_order_id: orderId,
        p_lock_token: activeSyncToken,
      });
      if (claimError) throw claimError;
      if (claimed !== true) {
        const { data: current } = await admin
          .from('delivery_orders')
          .select('*')
          .eq('id', orderId)
          .is('deleted_at', null)
          .maybeSingle();
        if (current?.ecom_tracking) return json({ ok: true, order: current, already_synced: true });
        throw new EcomError('ECOM_SYNC_IN_PROGRESS', 409);
      }

      const account = await ecom('/test') as { stock?: boolean };
      const parcel: Record<string, unknown> = {
        nom_complet: order.customer_name,
        mobile_1: normalizePhone(order.mobile_1),
        mobile_2: normalizePhone(order.mobile_2),
        id_wilaya: order.wilaya_id,
        adresse: order.address ?? '',
        quantite: order.quantity,
        total: Number(order.cod_amount),
        stopdesk: order.delivery_mode === 'stopdesk' ? 1 : 0,
        echange: 0,
        note_fournisseur: order.supplier_notes ?? '',
        id_externe: order.external_reference.slice(0, 20),
        confirmee: 0,
      };
      if (order.delivery_mode === 'stopdesk') parcel.code_stopdesk = order.stopdesk_code;
      else {
        await resolveDomicileWilaya(order.wilaya_id);
        parcel.commune = await resolveDeliverableCommune(order.wilaya_id, order.commune);
      }
      if (account.stock === true) {
        let stockReference = String(order.ecom_ref_article ?? '').trim();
        if (!stockReference) {
          const { data: mapping, error: mappingError } = await admin
            .from('ecom_product_mappings')
            .select('ref_article')
            .eq('course', order.course)
            .maybeSingle();
          if (mappingError) throw mappingError;
          stockReference = String(mapping?.ref_article ?? '').trim();
        }
        if (!stockReference) throw new EcomError('ECOM_REF_ARTICLE_REQUIRED', 422);
        // Persist the resolved reference under the same send lock before the
        // external call. This also handles older drafts or a concurrent mapping save.
        const { data: referencedOrder, error: referenceError } = await admin
          .from('delivery_orders')
          .update({ ecom_ref_article: stockReference })
          .eq('id', orderId)
          .eq('sync_lock_token', activeSyncToken)
          .is('deleted_at', null)
          .select('id')
          .maybeSingle();
        if (referenceError) throw referenceError;
        if (!referencedOrder) throw new EcomError('ECOM_SYNC_CLAIM_LOST', 409);
        parcel.ref_article = stockReference;
      } else {
        parcel.article = order.article;
      }

      await admin.from('ecom_sync_attempts').update({
        status: 'sent', updated_at: new Date().toISOString(),
      }).eq('lock_token', activeSyncToken);
      const result = await ecom('/colis', { method: 'POST', body: JSON.stringify([parcel]) }) as {
        resultats?: Array<{ ok?: boolean; tracking?: string; id_colis?: number; tarif_si_livrer?: number; erreur?: string }>;
      };
      const line = result.resultats?.[0];
      if (!line?.ok || !line.tracking) {
        throw new EcomError(line?.erreur || 'ECOM_CREATE_FAILED', 422, result);
      }
      activeSyncTracking = line.tracking;
      // Record the external success before updating the order. If the process
      // dies immediately afterwards, the next attempt restores this tracking
      // instead of creating a second parcel.
      const { error: attemptSaveError } = await admin.from('ecom_sync_attempts').update({
        status: 'succeeded', tracking: line.tracking, updated_at: new Date().toISOString(),
      }).eq('lock_token', activeSyncToken);
      if (attemptSaveError) {
        await reportError(attemptSaveError, { function: 'ecom-delivery', extra: { step: 'save_external_success', order_id: orderId } });
      }
      const { data: saved, error: saveError } = await admin
        .from('delivery_orders')
        .update({
          sync_status: 'synced',
          ecom_tracking: line.tracking,
          ecom_parcel_id: line.id_colis ?? null,
          ecom_delivery_fee: line.tarif_si_livrer ?? null,
          ecom_situation: 'EnCours',
          ecom_logistics_state: 'En Préparation',
          last_error: null,
          last_synced_at: new Date().toISOString(),
          sync_lock_token: null,
          sync_started_at: null,
        })
        .eq('id', orderId)
        .eq('sync_lock_token', activeSyncToken)
        .is('deleted_at', null)
        .select('*')
        .maybeSingle();
      if (saveError) throw saveError;
      if (!saved) throw new EcomError('ECOM_SYNC_CLAIM_LOST', 409);
      await admin.from('ecom_sync_attempts').update({
        status: 'succeeded', tracking: line.tracking, updated_at: new Date().toISOString(),
      }).eq('lock_token', activeSyncToken);
      await replayPendingWebhookEvents(admin, orderId, saved.webinar_lead_id, line.tracking);
      const { data: refreshed } = await admin.from('delivery_orders').select('*').eq('id', orderId).single();
      activeSyncToken = null;
      activeSyncTracking = null;
      return json({ ok: true, order: refreshed ?? saved });
    }

    if (payload.action === 'refresh') {
      if (!order.ecom_tracking) return json({ ok: false, error: 'ORDER_NOT_SYNCED' }, 409);
      const detail = await ecom(`/colis/${encodeURIComponent(order.ecom_tracking)}`) as Record<string, unknown>;
      const { data: saved, error: saveError } = await admin
        .from('delivery_orders')
        .update({
          ecom_situation: detail.situation ?? order.ecom_situation,
          ecom_logistics_state: detail.etat_logistique ?? order.ecom_logistics_state,
          ecom_collected: detail.encaisser === true,
          ecom_recovered: detail.recouvert === true,
          last_error: null,
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', orderId)
        .select('*')
        .single();
      if (saveError) throw saveError;
      return json({ ok: true, order: saved, history: detail.historique ?? [] });
    }

    if (payload.action === 'confirm') {
      if (!order.ecom_tracking) return json({ ok: false, error: 'ORDER_NOT_SYNCED' }, 409);
      if (order.ecom_confirmed) return json({ ok: true, order, already_confirmed: true });
      const result = await ecom('/colis/confirmer', {
        method: 'POST',
        body: JSON.stringify({ trackings: [order.ecom_tracking] }),
      }) as { resultats?: Array<{ ok?: boolean; erreur?: string }> };
      const line = result.resultats?.[0];
      if (!line?.ok) throw new EcomError(line?.erreur || 'ECOM_CONFIRM_FAILED', 422, result);
      const { data: saved, error: saveError } = await admin
        .from('delivery_orders')
        .update({
          ecom_confirmed: true,
          ecom_situation: 'EnCours',
          ecom_logistics_state: 'En Traitement',
          last_error: null,
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', orderId)
        .select('*')
        .single();
      if (saveError) throw saveError;
      return json({ ok: true, order: saved });
    }

    return json({ ok: false, error: 'UNKNOWN_ACTION' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    const status = error instanceof EcomError ? error.status : 500;
    if (payload.order_id && payload.action === 'sync') {
      if (activeSyncToken && activeSyncTracking) {
        const { data: recovered } = await admin.from('delivery_orders').update({
          sync_status: 'synced', ecom_tracking: activeSyncTracking,
          ecom_situation: 'EnCours', ecom_logistics_state: 'En Préparation',
          last_error: null, last_synced_at: new Date().toISOString(),
          sync_lock_token: null, sync_started_at: null,
        }).eq('id', payload.order_id).eq('sync_lock_token', activeSyncToken).is('deleted_at', null).select('*').maybeSingle();
        await admin.from('ecom_sync_attempts').update({
          status: 'succeeded', tracking: activeSyncTracking, error: null, updated_at: new Date().toISOString(),
        }).eq('lock_token', activeSyncToken);
        if (recovered) {
          await replayPendingWebhookEvents(admin, recovered.id, recovered.webinar_lead_id, activeSyncTracking).catch(() => {});
          return json({ ok: true, order: recovered, recovered: true });
        }
      }
      // Once E-com returned a tracking, never downgrade the attempt to failed:
      // that would allow a retry to create a duplicate. The succeeded ledger
      // remains the recovery source even if the local recovery write also had
      // a transient failure.
      if (!activeSyncTracking) {
        let failedOrder = admin.from('delivery_orders').update({
          sync_status: 'failed',
          last_error: message.slice(0, 500),
          last_synced_at: new Date().toISOString(),
          sync_lock_token: null,
          sync_started_at: null,
        }).eq('id', payload.order_id);
        if (activeSyncToken) failedOrder = failedOrder.eq('sync_lock_token', activeSyncToken);
        await failedOrder;
        if (activeSyncToken) {
          await admin.from('ecom_sync_attempts').update({
            status: 'failed', error: message.slice(0, 500), updated_at: new Date().toISOString(),
          }).eq('lock_token', activeSyncToken);
        }
      }
    }
    if (status >= 500) {
      await reportError(error, { function: 'ecom-delivery', extra: { action: payload.action, order_id: payload.order_id } });
    }
    return json({
      ok: false,
      error: message,
      detail: error instanceof EcomError ? error.detail : undefined,
    }, status >= 400 && status < 600 ? status : 500);
  }
});
