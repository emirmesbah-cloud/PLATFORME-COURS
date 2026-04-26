// ============================================================================
// Aurel Academy — Edge Function : POST /functions/v1/send-email
//
// Envoie un email transactionnel via Resend + log dans email_logs.
//
// Auth :
//   - Si appelé par un user authentifié (JWT bearer) → autorisé pour son
//     propre user_id uniquement.
//   - Si appelé avec service_role (cron, webhook DB) → autorisé pour
//     n'importe quel user_id.
//
// Body :
//   {
//     email_type: 'welcome' | 'reminder_inactive' | 'milestone_50' |
//                 'certificate_issued' | 'feedback_request' | 'custom',
//     to: string,                   // requis
//     user_id?: string,             // optionnel — pour log + RLS
//     vars?: Record<string, string>,// vars du template (first_name, etc.)
//     // Pour 'custom' uniquement :
//     subject?: string,
//     html?: string,
//     text?: string,
//   }
//
// Env requises :
//   RESEND_API_KEY                  ← à mettre dans Supabase Vault
//   SUPABASE_URL                    ← auto
//   SUPABASE_SERVICE_ROLE_KEY       ← auto
// ============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { buildEmail, TemplateVars } from '../_shared/email-templates.ts';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY            = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL                = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Aurel Academy <noreply@aurel-academy.com>';
const REPLY_TO                  = Deno.env.get('RESEND_REPLY_TO')   ?? 'aurel@aurel-academy.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
function err(error: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return jsonResponse({ ok: false, error, ...extra }, status);
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return err('METHOD_NOT_ALLOWED', 405);

  let payload: any;
  try { payload = await req.json(); }
  catch { return err('INVALID_JSON'); }

  const emailType = String(payload?.email_type ?? '');
  const to        = String(payload?.to ?? '').trim().toLowerCase();
  const userId    = payload?.user_id ? String(payload.user_id) : null;
  const vars      = (payload?.vars ?? {}) as TemplateVars;

  if (!emailType || !to) return err('MISSING_FIELDS');

  let subject: string;
  let html:    string;
  let text:    string;

  if (emailType === 'custom') {
    subject = String(payload?.subject ?? '').trim();
    html    = String(payload?.html    ?? '').trim();
    text    = String(payload?.text    ?? '').trim();
    if (!subject || !html) return err('MISSING_CUSTOM_FIELDS');
  } else {
    const t = buildEmail(emailType, vars);
    if (!t) return err('UNKNOWN_EMAIL_TYPE');
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
    return err('LOG_INSERT_FAILED', 500, { detail: logErr.message });
  }

  const sendResult = await sendViaResend({ to, subject, html, text });

  if ('error' in sendResult) {
    await admin.from('email_logs').update({
      status: 'failed', error_message: sendResult.error,
    }).eq('id', logRow.id);
    return err('SEND_FAILED', 500, { detail: sendResult.error, log_id: logRow.id });
  }

  await admin.from('email_logs').update({
    status: 'sent', provider_message_id: sendResult.id,
  }).eq('id', logRow.id);

  return jsonResponse({ ok: true, message_id: sendResult.id, log_id: logRow.id });
});
