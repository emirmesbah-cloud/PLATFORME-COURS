// ============================================================================
// Aurel Academy — Edge Function : POST /functions/v1/closer-access
//
// Lets a PRE-APPROVED closer create their own login (email + password) once.
// Gated by the staff_members list: the email must already be an ACTIVE closer
// the admin added in the dashboard, and must not already have an account. This
// is the only way to self-register — everyone else is rejected.
//
// verify_jwt = false (public) — the visitor has no account yet. Protection is
// the staff_members allowlist + the "one account only" guard, not a JWT.
//
// After success the browser signs in with the same password (supabase-js) and
// lands on the Prospects section (RootRedirect routes closers there).
// ============================================================================

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

serve(async (req) => {
  const headers = cors(req.headers.get('origin'));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return json({ ok: false, error: 'INVALID_JSON' }, 400); }

  const email = String(payload?.email ?? '').trim().toLowerCase();
  const password = String(payload?.password ?? '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'EMAIL_INVALID' }, 422);
  if (password.length < 8) return json({ ok: false, error: 'PASSWORD_TOO_SHORT' }, 422);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Must be a pre-approved, active closer.
  const { data: staff } = await admin
    .from('staff_members')
    .select('first_name, last_name, whatsapp, is_active, permissions')
    .ilike('email', email)
    .maybeSingle();
  if (!staff || staff.is_active !== true) {
    return json({ ok: false, error: 'NOT_A_CLOSER' }, 403);
  }

  // 2. One account only — if it already exists, they must log in instead.
  const { data: existing } = await admin.from('profiles').select('id').ilike('email', email).maybeSingle();
  if (existing) return json({ ok: false, error: 'ACCOUNT_EXISTS' }, 409);

  // 3. Create the auth user (email pre-confirmed — no email step for staff).
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      first_name: staff.first_name ?? '',
      last_name: (staff.last_name as string) ?? '',
      whatsapp: (staff.whatsapp as string) ?? '',
    },
  });
  if (createErr || !created?.user) {
    // A duplicate here means an auth user exists without a profile row.
    if (String(createErr?.message ?? '').toLowerCase().includes('already')) {
      return json({ ok: false, error: 'ACCOUNT_EXISTS' }, 409);
    }
    await reportError(createErr ?? new Error('createUser returned no user'), { function: 'closer-access', extra: { step: 'createUser' } });
    return json({ ok: false, error: 'CREATE_FAILED' }, 500);
  }
  const uid = created.user.id;

  // 4. Create the profile. The staff_members → profile trigger (mig 060/055)
  //    flips staff_role to 'closer' + copies the permissions on insert.
  const { error: profErr } = await admin.from('profiles').insert({
    id: uid,
    email,
    first_name: staff.first_name ?? '',
    last_name: (staff.last_name as string) ?? '',
    whatsapp: (staff.whatsapp as string) ?? '',
    tier: 'accompagne',
  });
  if (profErr) {
    // Roll back the orphan auth user so a retry can succeed.
    await admin.auth.admin.deleteUser(uid).catch(() => {});
    await reportError(profErr, { function: 'closer-access', extra: { step: 'profile_insert' } });
    return json({ ok: false, error: 'PROFILE_FAILED' }, 500);
  }

  return json({ ok: true });
});
