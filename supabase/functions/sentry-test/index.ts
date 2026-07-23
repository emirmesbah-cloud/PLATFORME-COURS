// ============================================================================
// Aurel Academy — Edge Function : GET /functions/v1/sentry-test
//
// Endpoint de validation Sentry. Protégé par CRON_SECRET pour pas qu'on se
// fasse spammer. Renvoie un event d'erreur synthétique à Sentry et confirme.
//
// Usage :
//   curl "https://<ref>.supabase.co/functions/v1/sentry-test?secret=<CRON_SECRET>"
//
// À supprimer ou laisser comme canary après le launch.
// ============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { reportError } from '../_shared/sentry.ts';
import { timingSafeEqual } from '../_shared/security.ts';

const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

serve(async (req) => {
  const url    = new URL(req.url);
  const secret = req.headers.get('x-cron-secret') ?? url.searchParams.get('secret') ?? '';
  if (!CRON_SECRET || !timingSafeEqual(secret, CRON_SECRET)) {
    return new Response(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const dsn       = Deno.env.get('SENTRY_DSN') ?? '';
  const dsnPresent = !!dsn;

  const tag = url.searchParams.get('tag') ?? 'sentry-canary';
  const e = new Error(`Aurel Sentry canary @ ${new Date().toISOString()} — tag=${tag}`);

  await reportError(e, {
    function: 'sentry-test',
    level: 'warning',
    tags: { canary: 'true', tag },
    extra: { triggered_at: new Date().toISOString() },
  });

  return new Response(JSON.stringify({
    ok: true,
    dsn_configured: dsnPresent,
    message: 'Synthetic error sent to Sentry. Check your dashboard.',
    tag,
  }), { headers: { 'Content-Type': 'application/json' } });
});
