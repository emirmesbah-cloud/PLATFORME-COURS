// ============================================================================
// Aurel Academy — Plateforme étudiant — Phase 1
// Edge Function : POST /functions/v1/activate-account
//
// Deux actions, une seule page /activate pour les DEUX cours :
//
//   { action: 'check', code }
//     → { ok, program: 'pflege' | 'immigration', tier }
//     Étape 1→2 : le SERVEUR dit quel programme le code débloque, pour que
//     /activate affiche le bon formulaire. Lecture seule : ne crée rien, ne
//     consomme pas le code. Le `program` renvoyé pilote uniquement l'AFFICHAGE.
//
//   { action: 'activate', code, email, password, first_name, last_name, whatsapp }
//     → session  (action par défaut)
//     Étape 4 : activation réelle. Le cours inscrit n'est JAMAIS lu depuis la
//     requête : redeem_activation_code relit `course` sur la ligne du code.
//     Falsifier la réponse de 'check' ne change donc que le formulaire affiché.
//
// Étapes de l'activation :
//   1. Validation basique des champs
//   2. RPC validate_activation_code(code) → vérifie que le code existe, n'est
//      ni utilisé, ni révoqué, ni en attente. Retourne le tier + le cours.
//   3. auth.admin.createUser : crée l'utilisateur (email confirmé)
//   4. auth.admin.signInWithPassword : génère une session (OU retourne
//      { needs_login: true } si tu préfères que le client se signIn lui-même).
//   5. RPC redeem_activation_code (avec le JWT du nouvel user) : crée
//      le profile + marque le code utilisé. Atomique.
//
// Erreurs explicites retournées :
//   États du code  : CODE_INVALID, CODE_ALREADY_USED, CODE_REVOKED, CODE_PENDING
//                    (CODE_UNAVAILABLE = état inattendu, ne devrait pas arriver)
//   Compte / input : EMAIL_ALREADY_EXISTS, EMAIL_INVALID, MISSING_FIELDS,
//                    WEAK_PASSWORD, INVALID_ACTION, PAYLOAD_TOO_LARGE
//   Serveur        : REDEEM_FAILED, INTERNAL_ERROR, TOO_MANY_ATTEMPTS
//
// Déploiement :
//   supabase functions deploy activate-account
//
// Variables d'env requises (auto-injectées par Supabase) :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
// ============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { reportError } from '../_shared/sentry.ts';
import { notifyTelegram } from '../_shared/telegram.ts';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!;

// CORS allowlist (Sherlock fix — was `*`, now restricted to known origins).
// activate-account doit être joignable depuis le SPA Aurel + dev local.
// Toute autre origine reçoit 'https://app.aurel-academy.com' qui forcera
// le navigateur à bloquer la réponse côté client (avec un Origin différent).
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
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary':                         'Origin',
  };
}

// jsonResponse / errorResponse — must include CORS headers from the request
// origin. They're built inside serve() once we know the origin; see below.

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * "AU-X3K7M9" → "AU-X3••••"
 *
 * An activation code is a bearer secret : whoever holds it can claim a paid
 * seat. It must never land intact in a log sink (console, Sentry, Telegram).
 * We keep the prefix + 2 characters so Aurel can still disambiguate which code
 * a support ticket is about, but the masked form cannot be redeemed.
 */
function maskCode(code: string): string {
  if (!code) return '(vide)';
  if (code.length <= 5) return '•'.repeat(code.length);
  return code.slice(0, 5) + '•'.repeat(code.length - 5);
}

// Code states surfaced to the client, straight from the RPC. Anything the RPC
// returns that is NOT in this list is a bug on our side, not a user-facing
// state, so it collapses to CODE_UNAVAILABLE.
const CODE_STATE_ERRORS = new Set([
  'CODE_INVALID',
  'CODE_ALREADY_USED',
  'CODE_REVOKED',
  'CODE_PENDING',
]);

function codeStateError(rpcError: unknown): string {
  const e = typeof rpcError === 'string' ? rpcError : '';
  return CODE_STATE_ERRORS.has(e) ? e : 'CODE_UNAVAILABLE';
}

// Per-IP budget over a rolling 15 min window, shared by BOTH actions.
// Raised from 10 to 20 alongside the two-step flow : one activation now costs
// two requests ('check' + 'activate') instead of one, and Algerian students
// routinely activate from the same carrier-NAT / cyber-café IP. 20 keeps the
// effective number of activations per IP where it was, while 20 probes per
// 15 min remains negligible against a 31^6 (~887M) keyspace.
const MAX_ATTEMPTS_PER_WINDOW = 20;

/**
 * Records the attempt and reports whether the caller is over budget.
 * Fails OPEN on storage errors — a throttle-table outage must never block a
 * student who has already paid.
 */
async function isThrottled(admin: SupabaseClient, req: Request): Promise<boolean> {
  try {
    const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const clientIp = req.headers.get('cf-connecting-ip')?.trim() || forwarded || 'unknown';
    const windowStart = new Date(Date.now() - 15 * 60_000).toISOString();
    const { count, error: countErr } = await admin
      .from('activation_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('ip', clientIp)
      .gte('attempted_at', windowStart);
    if (countErr) throw countErr;
    if ((count ?? 0) >= MAX_ATTEMPTS_PER_WINDOW) return true;
    const { error: insertErr } = await admin
      .from('activation_attempts')
      .insert({ ip: clientIp });
    if (insertErr) throw insertErr;
    return false;
  } catch (throttleErr) {
    console.warn('[activate-account] throttle unavailable; failing open', throttleErr);
    return false;
  }
}

serve(async (req) => {
  // Build CORS headers from the request origin (allowlist enforced in buildCors)
  const origin = req.headers.get('origin');
  const CORS   = buildCors(origin);
  const jsonResponse  = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  const errorResponse = (error: string, status = 400, extra: Record<string, unknown> = {}): Response =>
    jsonResponse({ ok: false, error, ...extra }, status);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')    return errorResponse('METHOD_NOT_ALLOWED', 405);

  // R22 : hard payload size cap. Largest legit payload is ~500 bytes
  // (6 fields + JSON overhead). Anything over 8kB is malicious.
  const contentLengthHeader = req.headers.get('content-length');
  if (contentLengthHeader && Number(contentLengthHeader) > 8192) {
    return errorResponse('PAYLOAD_TOO_LARGE', 413);
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return errorResponse('INVALID_JSON');
  }

  // `action` selects the step of the two-step activation flow :
  //   'check'    → step 1→2 : validate the code and report WHICH program it
  //                unlocks, so /activate can render the matching account form.
  //                Read-only : creates nothing, consumes nothing, and the code
  //                stays redeemable.
  //   'activate' → step 4 : the real activation. Default, so any older client
  //                posting the original payload shape keeps working.
  const action = (payload?.action ?? 'activate').toString();
  if (action !== 'check' && action !== 'activate') {
    return errorResponse('INVALID_ACTION');
  }

  // Codes are generated from an uppercase-only alphabet, so normalising here
  // makes the server robust to a lowercase WhatsApp copy-paste instead of
  // relying on the browser to have done it.
  const code        = (payload?.code        ?? '').toString().trim().toUpperCase();
  const email       = (payload?.email       ?? '').toString().trim().toLowerCase();
  const password    = (payload?.password    ?? '').toString();
  const first_name  = (payload?.first_name  ?? '').toString().trim();
  const last_name   = (payload?.last_name   ?? '').toString().trim();
  const whatsapp    = (payload?.whatsapp    ?? '').toString().trim();

  // Client admin (service_role) pour valider le code et créer le user.
  const admin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Per-IP throttle, applied to BOTH actions so the cheap read-only 'check'
  // step cannot be used to walk the code keyspace any faster than 'activate'
  // could. The backing table is service-role-only.
  if (await isThrottled(admin, req)) return errorResponse('TOO_MANY_ATTEMPTS', 429);

  // ── Step 1→2 : which program does this code unlock? ───────────────────────
  if (action === 'check') {
    if (!code) return errorResponse('MISSING_FIELDS');

    const { data: cData, error: cErr } = await admin.rpc('validate_activation_code', { p_code: code });
    if (cErr) {
      await reportError(cErr, {
        function: 'activate-account',
        extra: { step: 'validate_activation_code', action: 'check', code: maskCode(code) },
      });
      return errorResponse('INTERNAL_ERROR', 500);
    }
    if (!cData?.ok) return errorResponse(codeStateError(cData?.error));

    // Deployment-order guard: validate_activation_code only returns `course`
    // once migration 048 is applied. If this function ships first, fail loudly
    // here instead of handing the client an undefined program — guessing one
    // is how a student ends up enrolled in the wrong course.
    if (cData.course !== 'pflege' && cData.course !== 'immigration') {
      await reportError(new Error('validate_activation_code returned no usable course'), {
        function: 'activate-account',
        extra: { step: 'check', code: maskCode(code), got: cData.course ?? null },
      });
      return errorResponse('INTERNAL_ERROR', 500);
    }

    // `program` is the ONLY thing the client learns, and it comes exclusively
    // from the stored code row. It decides which FORM is rendered — never which
    // course gets enrolled: redeem_activation_code re-reads `course` from that
    // same row at activation time, so tampering with the response changes the
    // form the user sees and nothing else.
    return jsonResponse({ ok: true, program: cData.course, tier: cData.tier });
  }

  // ── Step 4 : full activation ──────────────────────────────────────────────
  if (!code || !email || !password || !first_name || !last_name || !whatsapp) {
    return errorResponse('MISSING_FIELDS');
  }
  if (!isValidEmail(email))  return errorResponse('EMAIL_INVALID');
  if (email.length > 254)    return errorResponse('EMAIL_INVALID');
  if (password.length < 8)   return errorResponse('WEAK_PASSWORD');
  // R22 : password max length 128. Argon hashing of arbitrary-size input is
  // a DoS vector ; legitimate passwords are well under this.
  if (password.length > 128) return errorResponse('WEAK_PASSWORD');
  // R22 : reject implausibly long name/whatsapp fields.
  if (first_name.length > 50 || last_name.length > 50 || whatsapp.length > 20) {
    return errorResponse('MISSING_FIELDS');
  }

  // 1. Validation du code
  const { data: vData, error: vErr } = await admin.rpc('validate_activation_code', { p_code: code });
  if (vErr) {
    await reportError(vErr, {
      function: 'activate-account',
      extra: { step: 'validate_activation_code', code: maskCode(code) },
    });
    return errorResponse('INTERNAL_ERROR', 500);
  }
  // Surface the EXACT state (invalid / used / revoked / pending) instead of
  // collapsing every failure into one opaque message — the activation page
  // shows a different, actionable text per state.
  if (!vData?.ok) return errorResponse(codeStateError(vData?.error));

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
    await reportError(createErr, { function: 'activate-account', extra: { step: 'createUser' } });
    return errorResponse('INTERNAL_ERROR', 500);
  }

  const newUserId = created.user?.id;
  if (!newUserId) return errorResponse('INTERNAL_ERROR', 500);

  // 3. Génère une session pour le user fraîchement créé.
  //    On utilise signInWithPassword (anon client) pour récupérer un access_token
  //    qu'on pourra renvoyer au frontend.
  const anonClient: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // R23 : timeout 20s on signInWithPassword. Without it, a Supabase Auth
  // brownout would hang this function for the full 150s Deno budget, leaving
  // the user on "Activation en cours, ne ferme pas la page…" indefinitely
  // with a created auth.users row but no session token returned. Better to
  // fail fast and trigger the rollback path.
  const signInResult = await Promise.race([
    anonClient.auth.signInWithPassword({ email, password }),
    new Promise<{ data: null; error: { message: string } }>((resolve) =>
      setTimeout(
        () => resolve({ data: null, error: { message: 'signInWithPassword timeout (20s)' } }),
        20_000,
      ),
    ),
  ]);
  const { data: signInData, error: signInErr } = signInResult as {
    data: { session: { access_token: string; refresh_token: string; expires_in: number; expires_at: number; token_type: string } | null } | null;
    error: { message: string } | null;
  };

  if (signInErr || !signInData.session) {
    // Le user est créé mais on n'arrive pas à se logguer : rollback.
    // SHERLOCK R3 fix : on capture le résultat du deleteUser au lieu de
    // .catch(() => {}). Avant, si Supabase retournait 5xx sur deleteUser,
    // l'erreur était silently swallowed → orphan auth.users sans profile,
    // sans code redemption → user locked out, support manuel obligatoire.
    // Maintenant on signale le orphan dans le Telegram → admin sait
    // qu'il faut delete manuellement.
    let deleteOk = true;
    let deleteErr: string | null = null;
    try {
      const dr = await admin.auth.admin.deleteUser(newUserId);
      if (dr.error) { deleteOk = false; deleteErr = dr.error.message; }
    } catch (e) {
      deleteOk = false; deleteErr = e instanceof Error ? e.message : String(e);
    }
    await reportError(signInErr ?? new Error('no session after createUser'), {
      function: 'activate-account',
      user_id: newUserId,
      extra: { step: 'signInWithPassword', delete_ok: deleteOk, delete_err: deleteErr },
    });
    await notifyTelegram(
      `Sign-in FAILED right after createUser. ${deleteOk ? 'Auth user rolled back OK.' : 'ROLLBACK FAILED — orphan auth.users row needs manual cleanup.'}`,
      {
        function: 'activate-account',
        level: 'critical',
        extra: {
          email,
          code: maskCode(code),
          orphan_user_id: deleteOk ? null : newUserId,
          delete_err: deleteErr,
          detail: signInErr?.message ?? 'no session',
        },
      },
    );
    return errorResponse('INTERNAL_ERROR', 500);
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
    // SHERLOCK R3 fix : capture deleteUser result (was silently swallowed).
    let deleteOk = true;
    let deleteErr: string | null = null;
    try {
      const dr = await admin.auth.admin.deleteUser(newUserId);
      if (dr.error) { deleteOk = false; deleteErr = dr.error.message; }
    } catch (e) {
      deleteOk = false; deleteErr = e instanceof Error ? e.message : String(e);
    }
    await reportError(rErr ?? new Error(rData?.error ?? 'REDEEM_FAILED'), {
      function: 'activate-account',
      user_id: newUserId,
      extra: { step: 'redeem_activation_code', rpc_error: rData?.error, delete_ok: deleteOk, delete_err: deleteErr },
    });
    await notifyTelegram(
      `Activation paid but redeem FAILED — manual recovery needed. ${deleteOk ? 'Auth user rolled back OK.' : 'ROLLBACK FAILED — orphan auth.users row.'}`,
      {
        function: 'activate-account',
        level: 'critical',
        extra: {
          email,
          code: maskCode(code),
          orphan_user_id: deleteOk ? null : newUserId,
          rpc_error: rData?.error ?? 'REDEEM_FAILED',
          delete_err: deleteErr,
          detail: rErr?.message ?? '(no detail)',
        },
      },
    );
    return errorResponse('REDEEM_FAILED', 500);
  }

  // SHERLOCK R23 — CRITICAL BUG FIX :
  // Welcome emails NEVER got sent. Audit revealed 0 rows in email_logs despite
  // 5+ students activated. Root cause : Deno terminates background promises
  // the moment the HTTP response returns. The previous `fetch(...).catch()`
  // pattern had no await, so the worker died before the email request fired.
  //
  // Fix : wrap in EdgeRuntime.waitUntil() — explicitly keeps the worker alive
  // until the background promise resolves. Available in Supabase Edge Runtime.
  // Falls back to a regular promise on older runtimes (still fire-and-forget).
  const waitUntil = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil
    ?? ((p: Promise<unknown>) => { p.catch(() => {}); });

  waitUntil(
    fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        email_type: 'welcome',
        to: email,
        user_id: newUserId,
        vars: {
          first_name,
          // Le cours vient de redeem_activation_code (donc du CODE), jamais du
          // payload client. Sans lui, welcomeEmail retombe sur Pflege et un
          // étudiant Immigration reçoit le mauvais email de bienvenue.
          course: rData.course,
          app_url: 'https://app.aurel-academy.com',
        },
      }),
    }).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[Aurel] welcome email dispatch failed (non-blocking):', e?.message ?? e);
    }),
  );

  // Telegram notification : new student inscribed (Aurel admin sees it real-time)
  // Same waitUntil pattern so the worker doesn't get killed before this fires.
  waitUntil(
    notifyTelegram(`Nouvel étudiant inscrit ✅`, {
      function: 'activate-account',
      level: 'info',
      extra: { email, name: `${first_name} ${last_name}`, code: maskCode(code), tier: rData.tier, course: rData.course },
    }).catch(() => {}),
  );

  return jsonResponse({
    ok: true,
    user: {
      id: newUserId,
      email,
      first_name,
      last_name,
      tier: rData.tier,
      course: rData.course,
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
