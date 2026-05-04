// ============================================================================
// Aurel Academy — Edge Function : POST /functions/v1/admin-purge-user
//
// GDPR Art. 17 right-to-erasure — full hard-delete combo :
//   1. Calls SQL RPC `admin_purge_user(uuid, reason)` (anonymizes profile,
//      deletes lesson_notes, scrubs feedback + email_logs, audit row).
//   2. Then calls `supabase.auth.admin.deleteUser(uuid)` via service_role
//      to hard-delete auth.users (email, password hash, refresh tokens).
//
// Avant ce edge function, la SQL RPC retournait un `warning` disant que
// le caller devait hard-delete séparément — mais aucune UI ne le faisait.
// Résultat : les users "purgés" pouvaient encore se logger (sur un profile
// `[deleted]`). Maintenant : un seul appel admin-only fait les deux.
//
// Auth :
//   - Caller doit être un admin authentifié (Bearer JWT). On vérifie
//     côté SQL via is_admin(auth.uid()) qui inclut le check revoked_at.
//   - L'admin-action est auditée par la RPC SQL.
//
// Body : { user_id: UUID, reason?: string }
// Returns : { ok: true, anon_email, auth_deleted: true } on success
// ============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { reportError } from '../_shared/sentry.ts';
import { notifyTelegram } from '../_shared/telegram.ts';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!;

const ALLOWED_ORIGINS = new Set<string>([
  'https://app.aurel-academy.com',
  'https://aurel-academy.com',
  'http://localhost:5173',
  'http://localhost:4173',
]);

function buildCors(origin: string | null): Record<string, string> {
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://app.aurel-academy.com';
  return {
    'Access-Control-Allow-Origin':  allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Vary':                         'Origin',
  };
}

serve(async (req) => {
  const origin = req.headers.get('origin');
  const CORS   = buildCors(origin);
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status, headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')    return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);

  // Auth : caller's JWT must be admin (the SQL RPC double-checks).
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
  }

  let payload: { user_id?: string; reason?: string };
  try { payload = await req.json(); }
  catch { return json({ ok: false, error: 'INVALID_JSON' }, 400); }

  const targetId = String(payload?.user_id ?? '').trim();
  const reason   = payload?.reason ? String(payload.reason).slice(0, 500) : null;

  if (!targetId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId)) {
    return json({ ok: false, error: 'INVALID_USER_ID' }, 400);
  }

  // Step 1 : call the SQL RPC AS the admin (forwards their JWT). The RPC
  // checks is_admin(auth.uid()) so service_role bypass via SQL is impossible.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rpcRes, error: rpcErr } = await userClient.rpc('admin_purge_user', {
    p_user_id: targetId,
    p_reason: reason,
  });

  if (rpcErr || !rpcRes?.ok) {
    await reportError(rpcErr ?? new Error(rpcRes?.error ?? 'PURGE_RPC_FAILED'), {
      function: 'admin-purge-user',
      extra: { step: 'sql_rpc', target: targetId, rpc_error: rpcRes?.error },
    });
    return json({ ok: false, error: rpcRes?.error ?? 'PURGE_RPC_FAILED', detail: rpcErr?.message }, rpcRes?.error === 'FORBIDDEN' || rpcRes?.error === 'NOT_AUTHENTICATED' ? 403 : 500);
  }

  // Step 2 : hard-delete auth.users via service_role admin API.
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let authDeleted = true;
  let authErr: string | null = null;
  try {
    const r = await admin.auth.admin.deleteUser(targetId);
    if (r.error) { authDeleted = false; authErr = r.error.message; }
  } catch (e) {
    authDeleted = false;
    authErr = e instanceof Error ? e.message : String(e);
  }

  if (!authDeleted) {
    await reportError(new Error(authErr ?? 'auth.deleteUser failed'), {
      function: 'admin-purge-user',
      level: 'critical',
      extra: { step: 'auth_delete', target: targetId, anon_email: rpcRes.anon_email },
    });
    // CRITICAL : profile data was already anonymized but auth.users still
    // exists. Telegram alert so admin knows there's an orphan to clean up.
    await notifyTelegram(
      `admin-purge-user partial : profile anonymized but auth.users delete FAILED. Manual cleanup needed for user ${targetId}.`,
      {
        function: 'admin-purge-user',
        level: 'critical',
        extra: { target: targetId, auth_err: authErr, anon_email: rpcRes.anon_email },
      },
    );
    return json({
      ok: false,
      error: 'AUTH_DELETE_FAILED',
      profile_anonymized: true,
      auth_deleted: false,
      anon_email: rpcRes.anon_email,
      detail: authErr,
    }, 500);
  }

  return json({
    ok: true,
    anon_email: rpcRes.anon_email,
    profile_anonymized: true,
    auth_deleted: true,
  });
});
