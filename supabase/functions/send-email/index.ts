// ============================================================================
// Aurel Academy — Edge Function : POST /functions/v1/send-email
//
// Envoie un email transactionnel via Resend + log dans email_logs.
//
// AUTH (Sherlock fix — was COMPLETELY UNAUTHENTICATED before, any logged-in
// student could phish from noreply@aurel-academy.com via email_type='custom') :
//   Cette function est SERVER-TO-SERVER ONLY. Les seuls appelants légitimes
//   sont :
//     - check-inactive-users (via service_role bearer)
//     - tout futur cron / DB trigger
//   Le frontend N'APPELLE PAS cette function (ne pas l'exposer aux clients).
//
//   Auth acceptée :
//     1. Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>  (exact match)
//     2. x-cron-secret: <CRON_SECRET>                       (exact match)
//   Tout le reste → 401.
//
// CORS : allowlist explicite (au lieu du `*` qui laissait n'importe quel site
// invoquer la function).
//
// Body :
//   {
//     email_type: 'welcome' | 'reminder_inactive' | 'milestone_50' |
//                 'certificate_issued' | 'feedback_request' | 'custom',
//     to: string,                   // requis
//     user_id?: string,             // optionnel — pour log
//     vars?: Record<string, string>,// vars du template (first_name, etc.)
//     // Pour 'custom' uniquement (caller server-side de confiance) :
//     subject?: string,
//     html?: string,
//     text?: string,
//   }
//
// Env requises :
//   RESEND_API_KEY                  ← Supabase Vault
//   SUPABASE_URL                    ← auto
//   SUPABASE_SERVICE_ROLE_KEY       ← auto
//   CRON_SECRET                     ← Supabase Vault (optionnel mais recommandé)
// ============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { buildEmail, TemplateVars } from '../_shared/email-templates.ts';
import { reportError } from '../_shared/sentry.ts';
import { notifyTelegram } from '../_shared/telegram.ts';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY            = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL                = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Aurel Academy <noreply@aurel-academy.com>';
const REPLY_TO                  = Deno.env.get('RESEND_REPLY_TO')   ?? 'aurel@aurel-academy.com';
const CRON_SECRET               = Deno.env.get('CRON_SECRET') ?? '';

// CORS allowlist. send-email est server-to-server donc en pratique l'Origin
// ne sera jamais set par les callers légitimes (cron pg, edge functions).
// On reste strict sur la liste pour ne pas signaler "ouvert" via OPTIONS
// preflight depuis un site arbitraire.
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
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-cron-secret',
    'Vary':                         'Origin',
    'Cache-Control':                'private, no-cache, no-store, must-revalidate',
  };
}

async function sendViaResend(args: {
  to: string; subject: string; html: string; text: string;
}): Promise<{ id: string } | { error: string }> {
  if (!RESEND_API_KEY) {
    return { error: 'RESEND_API_KEY not configured' };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [args.to],
      reply_to: REPLY_TO,
      subject: args.subject,
      html: args.html,
      text: args.text,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    return { error: `Resend ${res.status}: ${txt}` };
  }
  const data = await res.json();
  return { id: data.id };
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

  // SHERLOCK FIX — Auth strict server-to-server only.
  // Avant : aucune vérif → un user authentifié pouvait sender via custom html.
  // Maintenant : exact-match service_role bearer OU cron secret.
  // Pas de fallback sur user JWT (le frontend n'appelle pas cette function).
  const auth         = req.headers.get('authorization') || '';
  const cronHeader   = req.headers.get('x-cron-secret') || '';
  const isServiceRole = auth === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  const isCron        = !!CRON_SECRET && cronHeader === CRON_SECRET;
  if (!isServiceRole && !isCron) {
    return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
  }

  let payload: any;
  try { payload = await req.json(); }
  catch { return json({ ok: false, error: 'INVALID_JSON' }, 400); }

  const emailType = String(payload?.email_type ?? '');
  const to        = String(payload?.to ?? '').trim().toLowerCase();
  const userId    = payload?.user_id ? String(payload.user_id) : null;
  const vars      = (payload?.vars ?? {}) as TemplateVars;

  if (!emailType || !to) return json({ ok: false, error: 'MISSING_FIELDS' }, 400);

  // Basic email shape check — défense en profondeur même si l'auth caller
  // est de confiance, on évite les payloads pourris (header injection via \n).
  if (to.includes('\n') || to.includes('\r') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return json({ ok: false, error: 'INVALID_EMAIL' }, 400);
  }

  let subject: string;
  let html:    string;
  let text:    string;

  if (emailType === 'custom') {
    subject = String(payload?.subject ?? '').trim();
    html    = String(payload?.html    ?? '').trim();
    text    = String(payload?.text    ?? '').trim();
    if (!subject || !html) return json({ ok: false, error: 'MISSING_CUSTOM_FIELDS' }, 400);
    // Header-injection guard sur subject (les newlines dans un Subject:
    // permettent d'injecter de nouveaux headers RFC822).
    if (subject.includes('\n') || subject.includes('\r')) {
      return json({ ok: false, error: 'INVALID_SUBJECT' }, 400);
    }
  } else {
    const t = buildEmail(emailType, vars);
    if (!t) return json({ ok: false, error: 'UNKNOWN_EMAIL_TYPE' }, 400);
    subject = t.subject;
    html    = t.html;
    text    = t.text;
  }

  // Service-role client for logging (bypasses RLS)
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Insert pending log entry
  const { data: logRow, error: logErr } = await admin.from('email_logs').insert({
    user_id:        userId,
    email_type:     emailType,
    recipient_email: to,
    subject,
    status:         'pending',
  }).select('id').single();

  if (logErr) {
    await reportError(logErr, { function: 'send-email', user_id: userId ?? undefined, extra: { step: 'log_insert', email_type: emailType } });
    return json({ ok: false, error: 'LOG_INSERT_FAILED', detail: logErr.message }, 500);
  }

  const sendResult = await sendViaResend({ to, subject, html, text });

  if ('error' in sendResult) {
    await admin.from('email_logs').update({
      status: 'failed', error_message: sendResult.error,
    }).eq('id', logRow.id);
    await reportError(new Error(sendResult.error), {
      function: 'send-email',
      user_id: userId ?? undefined,
      level: 'warning',
      extra: { step: 'resend_send', email_type: emailType, log_id: logRow.id },
    });
    // Detect mass failure: 3+ failed emails in last 15 minutes => Telegram alert.
    // Avoids spam on a single transient Resend hiccup but catches real outages
    // (Resend down, DNS pété, API key rotated, etc.)
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { count: recentFails } = await admin
      .from('email_logs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed')
      .gt('sent_at', fifteenMinAgo);
    if ((recentFails ?? 0) >= 3) {
      await notifyTelegram(
        `Resend send FAILED — ${recentFails} email failures in the last 15min. Possible Resend outage or DNS issue.`,
        {
          function: 'send-email',
          level: 'critical',
          extra: {
            recent_failures: recentFails,
            last_error: sendResult.error,
            email_type: emailType,
          },
        },
      );
    }
    return json({ ok: false, error: 'SEND_FAILED', detail: sendResult.error, log_id: logRow.id }, 500);
  }

  await admin.from('email_logs').update({
    status: 'sent', provider_message_id: sendResult.id,
  }).eq('id', logRow.id);

  return json({ ok: true, message_id: sendResult.id, log_id: logRow.id });
});
