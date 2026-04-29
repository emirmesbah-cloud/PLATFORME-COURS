// ============================================================================
// Aurel Academy — Edge Function : GET /functions/v1/telegram-test
//
// Endpoint de validation Telegram. Protégé par CRON_SECRET.
// Envoie un message de test sur le bot configuré.
//
// Usage :
//   curl "https://<ref>.supabase.co/functions/v1/telegram-test?secret=<CRON_SECRET>"
// ============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { notifyTelegram } from '../_shared/telegram.ts';

const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

serve(async (req) => {
  const url    = new URL(req.url);
  const secret = req.headers.get('x-cron-secret') ?? url.searchParams.get('secret') ?? '';
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const tokenPresent  = !!Deno.env.get('TELEGRAM_BOT_TOKEN');
  const chatPresent   = !!Deno.env.get('TELEGRAM_CHAT_ID');
  const tag = url.searchParams.get('tag') ?? 'launch-validation';

  await notifyTelegram(
    `Aurel Telegram canary fired (tag=${tag}). If you see this on your phone, alerting works end-to-end.`,
    {
      function: 'telegram-test',
      level: 'info',
      extra: {
        tag,
        triggered_at: new Date().toISOString(),
        from: 'edge-function',
      },
    },
  );

  return new Response(JSON.stringify({
    ok: true,
    bot_token_configured: tokenPresent,
    chat_id_configured:   chatPresent,
    message: 'Telegram message dispatched. Check your phone.',
    tag,
  }), { headers: { 'Content-Type': 'application/json' } });
});
