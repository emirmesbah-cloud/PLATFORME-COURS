// Public post-webinar registration endpoint. Inserts are service-role-only;
// the browser never receives database write access.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { reportError } from '../_shared/sentry.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ECOM_API_KEY = Deno.env.get('ECOM_API_KEY') ?? '';
const ECOM_API_TOKEN = Deno.env.get('ECOM_API_TOKEN') ?? '';
const ECOM_BASE_URL = 'https://ecom-dz.com/api_v2';
const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000;
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

type CatalogAdmin = ReturnType<typeof createClient>;

async function fetchEcomCatalog(path: string) {
  if (!ECOM_API_KEY || !ECOM_API_TOKEN) throw new Error('ECOM_NOT_CONFIGURED');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${ECOM_BASE_URL}${path}`, {
      signal: controller.signal,
      headers: {
        'X-API-Key': ECOM_API_KEY,
        'X-API-Token': ECOM_API_TOKEN,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) throw new Error(`ECOM_CATALOG_${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('ECOM_CATALOG_INVALID');
    return data as Record<string, unknown>[];
  } finally {
    clearTimeout(timeout);
  }
}

async function getCatalog(admin: CatalogAdmin, kind: 'wilayas' | 'communes', wilayaId?: number) {
  const cacheKey = kind === 'wilayas' ? 'wilayas' : `communes:${wilayaId}`;
  const { data: cached } = await admin
    .from('ecom_location_cache')
    .select('payload, updated_at')
    .eq('cache_key', cacheKey)
    .maybeSingle();
  if (cached?.updated_at
    && Date.now() - new Date(cached.updated_at).getTime() < CATALOG_TTL_MS
    && Array.isArray(cached.payload)) {
    return cached.payload as Record<string, unknown>[];
  }

  const raw = await fetchEcomCatalog(kind === 'wilayas' ? '/wilayas' : `/communes?id_wilaya=${wilayaId}`);
  const payload = kind === 'wilayas'
    ? raw.map((item) => ({
      id: Number(item.id),
      libelle: clean(item.libelle, 80),
      domicile: item.domicile === true,
      stopdesk: item.stopdesk === true,
    })).filter((item) => Number.isInteger(item.id) && item.id > 0 && item.libelle && item.domicile)
    : raw.map((item) => ({
      id: Number(item.id),
      id_wilaya: Number(item.id_wilaya),
      commune: clean(item.commune, 100),
      code_postal: item.code_postal == null ? null : Number(item.code_postal),
      livrable: item.livrable === true,
    })).filter((item) => Number.isInteger(item.id) && item.commune && item.livrable);

  const { error: cacheError } = await admin.from('ecom_location_cache').upsert({
    cache_key: cacheKey,
    kind,
    payload,
    updated_at: new Date().toISOString(),
  });
  if (cacheError) throw cacheError;
  return payload;
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

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const action = clean(payload.action, 30);
  try {
    if (action === 'wilayas') {
      return json({ ok: true, items: await getCatalog(admin, 'wilayas') });
    }
    if (action === 'communes') {
      const id = Number(payload.wilaya_id);
      if (!Number.isInteger(id) || id < 1 || id > 69) return json({ ok: false, error: 'WILAYA_INVALID' }, 422);
      return json({ ok: true, items: await getCatalog(admin, 'communes', id) });
    }
  } catch (error) {
    await reportError(error, { function: 'webinar-lead-catalog', extra: { action } });
    return json({ ok: false, error: 'CATALOG_UNAVAILABLE' }, 503);
  }

  const fullName = clean(payload.full_name, 100);
  const phoneRaw = clean(payload.phone, 30);
  const phoneNormalized = normalizePhone(payload.phone);
  const email = clean(payload.email, 254).toLowerCase();
  const attendedLive = payload.attended_live === true;
  const wilayaId = Number(payload.wilaya_id);
  const commune = clean(payload.commune, 100);
  const address = clean(payload.address, 200);

  if (fullName.length < 2) return json({ ok: false, error: 'NAME_REQUIRED' }, 422);
  if (!/^0[5-7]\d{8}$/.test(phoneNormalized)) return json({ ok: false, error: 'PHONE_INVALID' }, 422);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'EMAIL_INVALID' }, 422);
  if (!Number.isInteger(wilayaId) || wilayaId < 1 || wilayaId > 69) {
    return json({ ok: false, error: 'WILAYA_INVALID' }, 422);
  }
  if (!commune || !address) return json({ ok: false, error: 'ADDRESS_REQUIRED' }, 422);

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

    const wilayas = await getCatalog(admin, 'wilayas');
    const selectedWilaya = wilayas.find((item) => Number(item.id) === wilayaId);
    if (!selectedWilaya) return json({ ok: false, error: 'WILAYA_INVALID' }, 422);
    const communes = await getCatalog(admin, 'communes', wilayaId);
    const selectedCommune = communes.find((item) => String(item.commune) === commune && item.livrable === true);
    if (!selectedCommune) return json({ ok: false, error: 'COMMUNE_INVALID' }, 422);

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
      wilaya_name: String(selectedWilaya.libelle),
      commune: String(selectedCommune.commune),
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
