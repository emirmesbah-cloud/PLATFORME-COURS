// Public receiver for E-com Delivery parcel-status webhooks.
// Security: HMAC-SHA256 over the exact raw body + ±5 minute timestamp window.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { reportError } from '../_shared/sentry.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ECOM_WEBHOOK_SECRET = Deno.env.get('ECOM_WEBHOOK_SECRET') ?? '';
const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

serve(async (req) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

  if (req.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  if (!ECOM_WEBHOOK_SECRET) return json({ ok: false, error: 'WEBHOOK_NOT_CONFIGURED' }, 503);

  const signatureHeader = req.headers.get('x-webhook-signature') ?? '';
  const timestampHeader = req.headers.get('x-webhook-timestamp') ?? '';
  const eventHeader = req.headers.get('x-webhook-id') ?? '';
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) {
    return json({ ok: false, error: 'STALE_OR_INVALID_TIMESTAMP' }, 401);
  }

  const raw = await req.text();
  const supplied = signatureHeader.toLowerCase().replace(/^sha256=/, '');
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(ECOM_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = hex(await crypto.subtle.sign('HMAC', key, encoder.encode(raw)));
  if (!/^[0-9a-f]{64}$/.test(supplied) || !constantTimeEqual(expected, supplied)) {
    return json({ ok: false, error: 'INVALID_SIGNATURE' }, 401);
  }

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(raw); }
  catch { return json({ ok: false, error: 'INVALID_JSON' }, 400); }

  const eventId = String(eventHeader || payload.id || '').slice(0, 200);
  const tracking = String(payload.tracking ?? '').trim().slice(0, 100);
  if (!eventId || !tracking) return json({ ok: false, error: 'INVALID_EVENT' }, 400);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: insertError } = await admin.from('ecom_webhook_events').insert({
    event_id: eventId,
    tracking,
    situation: payload.situation ? String(payload.situation).slice(0, 200) : null,
    payload,
  });
  if (insertError?.code === '23505') return json({ ok: true, duplicate: true });
  if (insertError) {
    await reportError(insertError, { function: 'ecom-webhook', extra: { event_id: eventId, tracking } });
    return json({ ok: false, error: 'EVENT_STORE_FAILED' }, 500);
  }

  const occurredAt = payload.date ? new Date(String(payload.date)) : new Date(timestamp * 1000);
  const safeOccurredAt = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;
  const eventText = `${payload.event ?? ''} ${payload.action ?? ''} ${payload.situation ?? ''} ${payload.etat_logistique ?? ''}`.toLowerCase();
  const deletedFromEcom = payload.deleted === true || /supprim|delete|removed/.test(eventText);
  const { data: updated, error: updateError } = await admin
    .from('delivery_orders')
    .update({
      ecom_situation: deletedFromEcom ? 'Supprimée depuis E-com' : payload.situation ? String(payload.situation).slice(0, 200) : null,
      ecom_logistics_state: payload.etat_logistique ? String(payload.etat_logistique).slice(0, 200) : null,
      last_event_at: safeOccurredAt.toISOString(),
      last_synced_at: new Date().toISOString(),
      last_error: null,
      ...(deletedFromEcom ? {
        deleted_from_ecom_at: safeOccurredAt.toISOString(),
        deleted_from_ecom_event_id: eventId,
      } : {}),
    })
    .eq('ecom_tracking', tracking)
    .select('id, webinar_lead_id');

  if (updateError) {
    await admin.from('ecom_webhook_events').update({ processing_error: updateError.message }).eq('event_id', eventId);
    await reportError(updateError, { function: 'ecom-webhook', extra: { event_id: eventId, tracking } });
    return json({ ok: false, error: 'ORDER_UPDATE_FAILED' }, 500);
  }

  const situationId = Number(payload.id_situation);
  const leadStatus = situationId === 7
    ? 'delivered'
    : [5, 6, 18].includes(situationId)
      ? 'returned'
      : null;
  const leadIds = (updated ?? [])
    .map((order) => order.webinar_lead_id as string | null)
    .filter((id): id is string => Boolean(id));
  if (leadStatus && leadIds.length > 0) {
    const { error: leadError } = await admin
      .from('webinar_leads')
      .update({ status: leadStatus })
      .in('id', leadIds);
    if (leadError) {
      await reportError(leadError, { function: 'ecom-webhook', extra: { event_id: eventId, tracking } });
    } else {
      await admin.from('webinar_lead_activities').insert(leadIds.map((leadId) => ({
        lead_id: leadId,
        activity_type: 'delivery',
        status: leadStatus,
        note: payload.situation ? String(payload.situation).slice(0, 200) : leadStatus,
        metadata: { event_id: eventId, tracking, id_situation: situationId },
      })));
    }
  }

  await admin.from('ecom_webhook_events').update({ processed_at: new Date().toISOString() }).eq('event_id', eventId);
  return json({ ok: true, matched: (updated ?? []).length > 0 });
});
