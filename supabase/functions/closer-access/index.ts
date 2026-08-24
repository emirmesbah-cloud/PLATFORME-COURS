// ============================================================================
// Aurel Academy — Edge Function : POST /functions/v1/closer-access
//
// Sends a mailbox-verified invitation to a PRE-APPROVED closer. The caller can
// no longer choose a password for an allowlisted address: possession of the
// email inbox is required before Supabase establishes a session.
//
// verify_jwt = false (public) — the visitor has no account yet. Responses are
// deliberately identical for unknown, existing and invited addresses to avoid
// enumerating the staff list.
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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: true, message: 'CHECK_EMAIL' });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Only pre-approved active staff can receive an invitation. Unknown and
  // already-linked addresses get the exact same public response.
  const { data: staff } = await admin
    .from('staff_members')
    .select('first_name, last_name, whatsapp, is_active, permissions, auth_user_id')
    .ilike('email', email)
    .maybeSingle();
  if (!staff || staff.is_active !== true) {
    return json({ ok: true, message: 'CHECK_EMAIL' });
  }

  if (staff.auth_user_id) return json({ ok: true, message: 'CHECK_EMAIL' });

  // A profile may already be linked even if an older staff row missed the id.
  const { data: existing } = await admin.from('profiles').select('id').ilike('email', email).maybeSingle();
  if (existing) {
    await admin.from('staff_members').update({ auth_user_id: existing.id, updated_at: new Date().toISOString() }).ilike('email', email);
    return json({ ok: true, message: 'CHECK_EMAIL' });
  }

  // Supabase sends the invitation itself. The session is established only
  // after the closer clicks the signed, expiring link received in their inbox.
  const { data: created, error: createErr } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: 'https://app.aurel-academy.com/',
    data: {
      first_name: staff.first_name ?? '',
      last_name: (staff.last_name as string) ?? '',
      whatsapp: (staff.whatsapp as string) ?? '',
    },
  });
  if (createErr || !created?.user) {
    const duplicate = String(createErr?.message ?? '').toLowerCase().includes('already');
    if (!duplicate) {
      await reportError(createErr ?? new Error('inviteUserByEmail returned no user'), { function: 'closer-access', extra: { step: 'invite' } });
    }
    return json({ ok: true, message: 'CHECK_EMAIL' });
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
    return json({ ok: true, message: 'CHECK_EMAIL' });
  }

  return json({ ok: true, message: 'CHECK_EMAIL' });
});
