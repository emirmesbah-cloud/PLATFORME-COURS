// ============================================================================
// Aurel Academy — Edge Function : GET /functions/v1/health
//
// Healthcheck endpoint qui ping les composants critiques :
//   - Database (SELECT 1 sur lessons)
//   - Storage (list buckets)
//   - Auth (admin.listUsers limit 1)
//
// Retourne :
//   200 + { status: "ok", checks: {...}, timestamp, latency_ms }
//   503 + { status: "degraded" | "down", checks: {...}, errors: [...] }
//
// Utilisé par UptimeRobot / status page / cron monitoring.
//
// Pas d'auth requise (endpoint public, aucune donnée sensible exposée).
// ============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Cache-Control':                'no-cache, no-store, must-revalidate',
};

interface Check {
  ok: boolean;
  latency_ms: number;
  error?: string;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; latency_ms: number; result?: T; error?: string }> {
  const t0 = Date.now();
  try {
    const result = await fn();
    return { ok: true, latency_ms: Date.now() - t0, result };
  } catch (e) {
    return { ok: false, latency_ms: Date.now() - t0, error: String(e instanceof Error ? e.message : e) };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const t_total_start = Date.now();
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Database — peut-on lire la table lessons ? (existence vérifiée)
  const dbCheck = await timed(async () => {
    const { count, error } = await sb.from('lessons').select('*', { count: 'exact', head: true });
    if (error) throw new Error(error.message);
    return { lessons_count: count };
  });

  // 2. Storage — peut-on lister les buckets ?
  const storageCheck = await timed(async () => {
    const { data, error } = await sb.storage.listBuckets();
    if (error) throw new Error(error.message);
    return { buckets: data.map(b => b.name) };
  });

  // 3. Auth — peut-on appeler l'admin API ?
  const authCheck = await timed(async () => {
    const { data, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) throw new Error(error.message);
    return { users_count_first_page: data.users.length };
  });

  const checks = {
    database: { ok: dbCheck.ok, latency_ms: dbCheck.latency_ms, error: dbCheck.error },
    storage:  { ok: storageCheck.ok, latency_ms: storageCheck.latency_ms, error: storageCheck.error },
    auth:     { ok: authCheck.ok, latency_ms: authCheck.latency_ms, error: authCheck.error },
  };

  const allOk = checks.database.ok && checks.storage.ok && checks.auth.ok;
  const anyOk = checks.database.ok || checks.storage.ok || checks.auth.ok;

  const status = allOk ? 'ok' : (anyOk ? 'degraded' : 'down');
  const httpStatus = allOk ? 200 : 503;

  const body = {
    status,
    timestamp: new Date().toISOString(),
    latency_ms: Date.now() - t_total_start,
    checks,
    // Méta pour monitoring tools
    service: 'aurel-academy-platform',
    version: '1.0.0',
  };

  return new Response(JSON.stringify(body, null, 2), {
    status: httpStatus,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
});
