// Public post-webinar registration endpoint. Inserts are service-role-only;
// the browser never receives database write access.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { reportError } from '../_shared/sentry.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
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

function clean(value: unknown, max: number) {
  return String(value ?? '').normalize('NFKC').trim().slice(0, max);
}

function normalizePhone(value: unknown) {
  let phone = clean(value, 30).replace(/[^0-9+]/g, '');
  if (phone.startsWith('+213')) phone = `0${phone.slice(4)}`;
  else if (phone.startsWith('00213')) phone = `0${phone.slice(5)}`;
  else if (phone.startsWith('213')) phone = `0${phone.slice(3)}`;
  return phone.replace(/\D/g, '');
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  const headers = cors(req.headers.get('origin'));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return json({ ok: false, error: 'INVALID_JSON' }, 400); }

  // Honeypot. Bots see a success response, but nothing is stored.
  if (clean(payload.website, 200)) return json({ ok: true });

  const fullName = clean(payload.full_name, 100);
  const phoneRaw = clean(payload.phone, 30);
  const phoneNormalized = normalizePhone(payload.phone);
  const email = clean(payload.email, 254).toLowerCase();
  const attendedLive = payload.attended_live === true;
  const wilayaId = Number(payload.wilaya_id);
  const wilayaName = clean(payload.wilaya_name, 80);
  const commune = clean(payload.commune, 100);
  const address = clean(payload.address, 200);

  if (fullName.length < 2) return json({ ok: false, error: 'NAME_REQUIRED' }, 422);
  if (!/^0[5-7]\d{8}$/.test(phoneNormalized)) return json({ ok: false, error: 'PHONE_INVALID' }, 422);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'EMAIL_INVALID' }, 422);
  if (!Number.isInteger(wilayaId) || wilayaId < 1 || wilayaId > 69 || !wilayaName) {
    return json({ ok: false, error: 'WILAYA_INVALID' }, 422);
  }
  if (!commune || !address) return json({ ok: false, error: 'ADDRESS_REQUIRED' }, 422);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('cf-connecting-ip')
      || 'unknown';
    const keyHash = await sha256(`${SUPABASE_SERVICE_ROLE_KEY.slice(-24)}:${forwarded}`);
    const now = new Date();
    const { data: rate } = await admin
      .from('webinar_lead_rate_limits')
      .select('window_started_at, request_count')
      .eq('key_hash', keyHash)
      .maybeSingle();
    const windowStart = rate?.window_started_at ? new Date(rate.window_started_at) : null;
    const withinWindow = !!windowStart && now.getTime() - windowStart.getTime() < 60 * 60 * 1000;
    if (withinWindow && Number(rate?.request_count ?? 0) >= 10) {
      return json({ ok: false, error: 'RATE_LIMITED' }, 429);
    }
    await admin.from('webinar_lead_rate_limits').upsert({
      key_hash: keyHash,
      window_started_at: withinWindow ? windowStart!.toISOString() : now.toISOString(),
      request_count: withinWindow ? Number(rate?.request_count ?? 0) + 1 : 1,
      updated_at: now.toISOString(),
    });

    // A double-click or network retry must not create duplicate call records.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await admin
      .from('webinar_leads')
      .select('id')
      .eq('phone_normalized', phoneNormalized)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return json({ ok: true, already_registered: true });

    const { error } = await admin.from('webinar_leads').insert({
      full_name: fullName,
      phone_raw: phoneRaw,
      phone_normalized: phoneNormalized,
      email,
      attended_live: attendedLive,
      wilaya_id: wilayaId,
      wilaya_name: wilayaName,
      commune,
      address,
      status: attendedLive ? 'to_call' : 'new',
      source: 'youtube_live',
      campaign: 'post_webinar',
    });
    if (error) throw error;
    return json({ ok: true });
  } catch (error) {
    await reportError(error, { function: 'webinar-lead' });
    return json({ ok: false, error: 'SUBMISSION_FAILED' }, 500);
  }
});
