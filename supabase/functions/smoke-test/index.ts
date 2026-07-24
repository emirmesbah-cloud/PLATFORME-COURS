// ============================================================================
// Aurel Academy — Edge Function : POST /functions/v1/smoke-test
//
// Smoke test post-migration : exécute les requêtes critiques avec un user de
// test "smoke-test@aurel-academy.com" pour détecter les bugs RLS / RPC en
// 30 secondes après chaque migration.
//
// Détecte (entre autres) :
//   - "infinite recursion" RLS (comme migration 009 → fix 010)
//   - RLS qui bloque la lecture du propre profile
//   - RPC cassée (admin_get_stats, claim_session, verify_session)
//   - Trigger qui bloque l'écriture
//
// Usage :
//   curl -X POST "<URL>/functions/v1/smoke-test?secret=<CRON_SECRET>"
//
// Si un check échoue → status 500 + détails + Telegram alert.
//
// Setup (à faire une fois) :
//   1. Créer l'user smoke-test@aurel-academy.com via Management API
//   2. Ajouter en env : SMOKE_TEST_EMAIL + SMOKE_TEST_PASSWORD
//   3. Idéalement, créer un profile lié + le marquer is_admin = TRUE
//      (pour tester aussi les routes admin)
// ============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { notifyTelegram } from '../_shared/telegram.ts';
import { timingSafeEqual } from '../_shared/security.ts';

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON   = Deno.env.get('SUPABASE_ANON_KEY')!;
const CRON_SECRET     = Deno.env.get('CRON_SECRET') ?? '';
const SMOKE_EMAIL     = Deno.env.get('SMOKE_TEST_EMAIL')    ?? '';
const SMOKE_PASSWORD  = Deno.env.get('SMOKE_TEST_PASSWORD') ?? '';

interface CheckResult {
  name: string;
  ok: boolean;
  duration_ms: number;
  error?: string;
}

async function timed<T>(name: string, fn: () => Promise<T>): Promise<CheckResult & { data?: T }> {
  const start = Date.now();
  try {
    const data = await fn();
    return { name, ok: true, duration_ms: Date.now() - start, data };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { name, ok: false, duration_ms: Date.now() - start, error };
  }
}

serve(async (req) => {
  const url    = new URL(req.url);
  const secret = req.headers.get('x-cron-secret') ?? url.searchParams.get('secret') ?? '';
  // SHERLOCK R14 — M3 : timing-safe compare.
  if (!CRON_SECRET || !timingSafeEqual(secret, CRON_SECRET)) {
    return new Response(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!SMOKE_EMAIL || !SMOKE_PASSWORD) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'SMOKE_TEST_EMAIL/PASSWORD env vars not configured',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  // 1. Authenticate as smoke-test user
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const auth = await timed('auth.signIn', async () => {
    const { data, error } = await anon.auth.signInWithPassword({
      email: SMOKE_EMAIL, password: SMOKE_PASSWORD,
    });
    if (error) throw error;
    if (!data.session) throw new Error('no session');
    return data.session.access_token;
  });

  if (!auth.ok || !auth.data) {
    await notifyTelegram(
      `Smoke test FAILED at auth — cannot sign in smoke-test user.`,
      { function: 'smoke-test', level: 'critical', extra: { error: auth.error } },
    );
    return new Response(JSON.stringify({
      ok: false, failed_at: 'auth', checks: [auth],
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  // 2. Build authenticated client
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${auth.data}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const checks: CheckResult[] = [auth];

  // CHECK 1 : SELECT own profile (would catch RLS recursion bug)
  checks.push(await timed('select_own_profile', async () => {
    const { data, error } = await userClient
      .from('profiles')
      .select('id, email, is_admin, tier')
      .limit(1);
    if (error) throw new Error(`${error.code}: ${error.message}`);
    if (!data || data.length === 0) throw new Error('no rows returned');
    return data;
  }));

  // CHECK 2 : SELECT public lessons
  checks.push(await timed('select_lessons', async () => {
    const { data, error } = await userClient
      .from('lessons')
      .select('id, lesson_number, title')
      .eq('is_published', true)
      .limit(5);
    if (error) throw new Error(`${error.code}: ${error.message}`);
    if (!data || data.length === 0) throw new Error('no published lessons returned');
    return data;
  }));

  // CHECK 3 : RPC verify_session (auth-scoped RPC)
  checks.push(await timed('rpc_verify_session', async () => {
    const { data, error } = await userClient.rpc('verify_session', {
      p_session_id: '00000000-0000-0000-0000-000000000000',
    });
    if (error) throw new Error(`${error.code}: ${error.message}`);
    return data;
  }));

  // CHECK 4 : RPC admin_get_stats (only if smoke user is admin)
  checks.push(await timed('rpc_admin_get_stats', async () => {
    const { data, error } = await userClient.rpc('admin_get_stats');
    if (error) throw new Error(`${error.code}: ${error.message}`);
    return data;
  }));

  // CHECK 5 : INSERT lesson_progress (test write path with RLS)
  // We do a soft check : if it fails because it already exists, that's OK.
  checks.push(await timed('insert_progress', async () => {
    // Get any lesson id first
    const { data: lessons } = await userClient
      .from('lessons').select('id').limit(1);
    if (!lessons || lessons.length === 0) return { skipped: 'no lessons' };

    // Get user id from JWT (decode roughly via session)
    const { data: { user } } = await anon.auth.getUser(auth.data);
    if (!user?.id) throw new Error('no user from token');

    const { error } = await userClient
      .from('lesson_progress')
      .upsert(
        { user_id: user.id, lesson_id: lessons[0].id, watched_seconds: 1 },
        { onConflict: 'user_id,lesson_id' },
      );
    if (error) throw new Error(`${error.code}: ${error.message}`);
    return 'ok';
  }));

  // Compile report
  const failed = checks.filter(c => !c.ok);
  const all_ok = failed.length === 0;
  const total_ms = checks.reduce((s, c) => s + c.duration_ms, 0);

  // If any failure → critical Telegram alert
  if (!all_ok) {
    await notifyTelegram(
      `Smoke test FAILED — ${failed.length}/${checks.length} checks broken. Migration likely shipped a regression.`,
      {
        function: 'smoke-test',
        level: 'critical',
        extra: {
          failed_checks: failed.map(f => `${f.name}: ${f.error}`).join(' | '),
          total_ms,
        },
      },
    );
  }

  return new Response(JSON.stringify({
    ok: all_ok,
    total_ms,
    checks,
  }, null, 2), {
    status: all_ok ? 200 : 500,
    headers: { 'Content-Type': 'application/json' },
  });
});
