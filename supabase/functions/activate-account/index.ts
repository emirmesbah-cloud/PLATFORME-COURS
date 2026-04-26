// ============================================================================
// Aurel Academy — Plateforme étudiant — Phase 1
// Edge Function : POST /functions/v1/activate-account
//
// Implémente le flow complet d'activation décrit dans le brief :
//   { code, email, password, first_name, last_name, whatsapp } → session
//
// Étapes :
//   1. Validation basique des champs
//   2. RPC validate_activation_code(code) → vérifie que le code existe et
//      n'est pas déjà utilisé. Retourne le tier.
//   3. auth.admin.createUser : crée l'utilisateur (email confirmé)
//   4. auth.admin.signInWithPassword : génère une session (OU retourne
//      { needs_login: true } si tu préfères que le client se signIn lui-même).
//   5. RPC redeem_activation_code (avec le JWT du nouvel user) : crée
//      le profile + marque le code utilisé. Atomique.
//
// Erreurs explicites retournées :
//   CODE_INVALID, CODE_ALREADY_USED, EMAIL_ALREADY_EXISTS, MISSING_FIELDS,
//   WEAK_PASSWORD, REDEEM_FAILED, INTERNAL_ERROR.
//
// Déploiement :
//   supabase functions deploy activate-account
//
// Variables d'env requises (auto-injectées par Supabase) :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
// ============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorResponse(error: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return jsonResponse({ ok: false, error, ...extra }, status);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return errorResponse('METHOD_NOT_ALLOWED', 405);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return errorResponse('INVALID_JSON');
  }

  const code        = (payload?.code        ?? '').toString().trim();
  const email       = (payload?.email       ?? '').toString().trim().toLowerCase();
  const password    = (payload?.password    ?? '').toString();
  const first_name  = (payload?.first_name  ?? '').toString().trim();
  const last_name   = (payload?.last_name   ?? '').toString().trim();
  const whatsapp    = (payload?.whatsapp    ?? '').toString().trim();

  if (!code || !email || !password || !first_name || !last_name || !whatsapp) {
    return errorResponse('MISSING_FIELDS');
  }
  if (!isValidEmail(email))  return errorResponse('EMAIL_INVALID');
  if (password.length < 8)   return errorResponse('WEAK_PASSWORD');

  // Client admin (service_role) pour valider le code et créer le user.
  const admin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Validation du code
  const { data: vData, error: vErr } = await admin.rpc('validate_activation_code', { p_code: code });
  if (vErr)             return errorResponse('INTERNAL_ERROR', 500, { detail: vErr.message });
  if (!vData?.ok)       return errorResponse(vData?.error ?? 'CODE_INVALID');

  // 2. Création du user (email auto-confirmé pour permettre le login direct)
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name, last_name, whatsapp },
  });

  if (createErr) {
    const msg = (createErr.message || '').toLowerCase();
    if (msg.includes('already') || msg.includes('exists') || msg.includes('registered')) {
      return errorResponse('EMAIL_ALREADY_EXISTS');
    }
    return errorResponse('INTERNAL_ERROR', 500, { detail: createErr.message });
  }

  const newUserId = created.user?.id;
  if (!newUserId) return errorResponse('INTERNAL_ERROR', 500, { detail: 'no user id' });

  // 3. Génère une session pour le user fraîchement créé.
  //    On utilise signInWithPassword (anon client) pour récupérer un access_token
  //    qu'on pourra renvoyer au frontend.
  const anonClient: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: signInData, error: signInErr } = await anonClient.auth.signInWithPassword({
    email,
    password,
  });

  if (signInErr || !signInData.session) {
    // Le user est créé mais on n'arrive pas à se logguer : rollback.
    await admin.auth.admin.deleteUser(newUserId).catch(() => {});
    return errorResponse('INTERNAL_ERROR', 500, { detail: signInErr?.message ?? 'no session' });
  }

  // 4. Redeem le code (en tant qu'user authentifié → la RPC vérifie auth.uid())
  const userClient: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${signInData.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rData, error: rErr } = await userClient.rpc('redeem_activation_code', {
    p_code: code,
    p_first_name: first_name,
    p_last_name: last_name,
    p_whatsapp: whatsapp,
  });

  if (rErr || !rData?.ok) {
    // Rollback : on supprime le user qu'on vient de créer.
    await admin.auth.admin.deleteUser(newUserId).catch(() => {});
    return errorResponse(rData?.error ?? 'REDEEM_FAILED', 500, { detail: rErr?.message });
  }

  return jsonResponse({
    ok: true,
    user: {
      id: newUserId,
      email,
      first_name,
      last_name,
      tier: rData.tier,
    },
    session: {
      access_token:  signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
      expires_in:    signInData.session.expires_in,
      expires_at:    signInData.session.expires_at,
      token_type:    signInData.session.token_type,
    },
  });
});
