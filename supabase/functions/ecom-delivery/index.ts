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
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
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
      throw new EcomError(`ECOM_HTTP_${response.status}`, response.status, data);
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

  let payload: { action?: string; order_id?: string; wilaya_id?: number };
  try { payload = await req.json(); }
  catch { return json({ ok: false, error: 'INVALID_JSON' }, 400); }

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

    const orderId = String(payload.order_id ?? '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
      return json({ ok: false, error: 'INVALID_ORDER_ID' }, 400);
    }
    const { data: order, error: orderError } = await admin
      .from('delivery_orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();
    if (orderError || !order) return json({ ok: false, error: 'ORDER_NOT_FOUND' }, 404);

    if (payload.action === 'sync') {
      // Idempotence on the Aurel side: once a tracking exists we never create
      // a second E-com parcel for the same local order.
      if (order.ecom_tracking) return json({ ok: true, order, already_synced: true });

      await admin.from('delivery_orders').update({ sync_status: 'syncing', last_error: null }).eq('id', orderId);
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
      else parcel.commune = order.commune;
      if (account.stock === true) {
        if (!order.ecom_ref_article) throw new EcomError('ECOM_REF_ARTICLE_REQUIRED', 422);
        parcel.ref_article = order.ecom_ref_article;
      } else {
        parcel.article = order.article;
      }

      const result = await ecom('/colis', { method: 'POST', body: JSON.stringify([parcel]) }) as {
        resultats?: Array<{ ok?: boolean; tracking?: string; id_colis?: number; tarif_si_livrer?: number; erreur?: string }>;
      };
      const line = result.resultats?.[0];
      if (!line?.ok || !line.tracking) {
        throw new EcomError(line?.erreur || 'ECOM_CREATE_FAILED', 422, result);
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
        })
        .eq('id', orderId)
        .select('*')
        .single();
      if (saveError) throw saveError;
      return json({ ok: true, order: saved });
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
      await admin.from('delivery_orders').update({
        sync_status: 'failed',
        last_error: message.slice(0, 500),
        last_synced_at: new Date().toISOString(),
      }).eq('id', payload.order_id);
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
