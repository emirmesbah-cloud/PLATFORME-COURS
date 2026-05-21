// ============================================================================
// Aurel Academy — Edge Function : POST /functions/v1/uptimerobot-webhook
//
// Webhook récepteur pour les alertes UptimeRobot. Forwarde sur notre bot
// Telegram (Aurel Academy Alerts).
//
// Pourquoi : le free tier UptimeRobot ne supporte plus Telegram natif. Webhook
// reste gratuit. On reçoit le payload, on formatte joliment, on push.
//
// Sécurité : on filtre sur ?token=<UPTIMEROBOT_WEBHOOK_TOKEN> (env). Si quelqu'un
// trouve l'URL il peut spammer notre Telegram, donc on protège.
//
// Format payload UptimeRobot (POST x-www-form-urlencoded ou JSON selon config) :
//   monitorURL, monitorFriendlyName, alertType (1=down, 2=up, 3=ssl),
//   alertDetails, alertDuration, sslExpiryDate, etc.
//
// Doc : https://uptimerobot.com/api/
// ============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { notifyTelegram } from '../_shared/telegram.ts';
import { timingSafeEqual } from '../_shared/security.ts';

const WEBHOOK_TOKEN = Deno.env.get('UPTIMEROBOT_WEBHOOK_TOKEN') ?? '';

interface UptimePayload {
  monitorURL?: string;
  monitorFriendlyName?: string;
  alertType?: string;       // 1=down, 2=up, 3=ssl
  alertDetails?: string;
  alertDuration?: string;
  sslExpiryDate?: string;
  monitorAlertContacts?: string;
}

function parseBody(contentType: string, raw: string): UptimePayload {
  if (contentType.includes('application/json')) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  // x-www-form-urlencoded (UptimeRobot default)
  const params = new URLSearchParams(raw);
  const obj: UptimePayload = {};
  for (const [k, v] of params.entries()) {
    (obj as Record<string, string>)[k] = v;
  }
  return obj;
}

serve(async (req) => {
  // Auth: token in query param (UptimeRobot doesn't support custom headers in free tier)
  const url   = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  // SHERLOCK R14 — M3 : timing-safe compare (anti side-channel oracle).
  if (!WEBHOOK_TOKEN || !timingSafeEqual(token, WEBHOOK_TOKEN)) {
    return new Response(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Accept POST + GET (UptimeRobot supports both)
  let payload: UptimePayload = {};
  if (req.method === 'POST') {
    const contentType = req.headers.get('content-type') ?? '';
    const raw = await req.text();
    payload = parseBody(contentType, raw);
  } else if (req.method === 'GET') {
    // GET: all data in query params
    payload = {
      monitorURL:          url.searchParams.get('monitorURL')          ?? '',
      monitorFriendlyName: url.searchParams.get('monitorFriendlyName') ?? '',
      alertType:           url.searchParams.get('alertType')           ?? '',
      alertDetails:        url.searchParams.get('alertDetails')        ?? '',
      alertDuration:       url.searchParams.get('alertDuration')       ?? '',
      sslExpiryDate:       url.searchParams.get('sslExpiryDate')       ?? '',
    };
  } else {
    return new Response(JSON.stringify({ ok: false, error: 'METHOD_NOT_ALLOWED' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  const alertType = String(payload.alertType ?? '');
  const name      = payload.monitorFriendlyName ?? '(unknown monitor)';
  const url2      = payload.monitorURL ?? '';
  const details   = payload.alertDetails ?? '';
  const duration  = payload.alertDuration ?? '';

  let level: 'info' | 'warning' | 'critical' = 'critical';
  let msg: string;

  if (alertType === '1') {
    // DOWN
    level = 'critical';
    msg = `Monitor DOWN — ${name} is not responding.`;
  } else if (alertType === '2') {
    // UP (recovery)
    level = 'info';
    msg   = `Monitor RECOVERED — ${name} is back online${duration ? ` after ${duration}s` : ''}.`;
  } else if (alertType === '3') {
    // SSL
    level = 'warning';
    msg   = `SSL alert — ${name} certificate issue (expires ${payload.sslExpiryDate ?? 'unknown'}).`;
  } else {
    level = 'warning';
    msg   = `UptimeRobot alert (type=${alertType}) — ${name}.`;
  }

  await notifyTelegram(msg, {
    function: 'uptimerobot-webhook',
    level,
    extra: {
      monitor:       name,
      url:           url2,
      alert_type:    alertType,
      details:       details || '(none)',
      duration_s:    duration || '(n/a)',
    },
  });

  return new Response(JSON.stringify({ ok: true, forwarded: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
