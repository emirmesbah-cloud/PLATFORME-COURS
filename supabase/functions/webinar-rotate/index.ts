// ============================================================================
// Aurel Academy — Edge Function : POST /functions/v1/webinar-rotate
//
// PUBLIC WhatsApp group rotation resolver for the immigration + tiktok funnels.
// Called ONLY by the WordPress merci page (public_html/webinar/merci/index.php).
//
// verify_jwt = false (config.toml) : the webinar visitor is anonymous, there is
// no login. Instead the endpoint is gated by a SHARED SECRET header:
//     X-Rotate-Secret: <WEBINAR_ROTATE_SECRET>
// Only the merci page knows it, so nobody can hammer this endpoint to exhaust
// the groups. Missing/incorrect secret → 403.
//
// The merci PHP server forwards the REAL visitor IP as client_ip (it computed
// it from CF-Connecting-IP / X-Forwarded-For / REMOTE_ADDR). Because the request
// is secret-authenticated we trust that value. We hash it here so the raw IP is
// never stored :  ip_hash = SHA-256(`webinar-rotation:${funnel}:${client_ip}`).
//
// All counting / stickiness / round-robin is ATOMIC in the DB : this function
// just relays to the assign_webinar_group RPC (service_role) and, if the RPC
// flags it, fires ONE alert email to Amir (fire-and-forget, never delays the
// redirect).
//
// Env required :
//   SUPABASE_URL                ← auto
//   SUPABASE_SERVICE_ROLE_KEY   ← auto
//   WEBINAR_ROTATE_SECRET       ← Supabase secret (shared with merci/index.php)
//   WEBINAR_ALERT_EMAIL         ← Supabase secret (default amirmesbah510@gmail.com)
// ============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { reportError } from '../_shared/sentry.ts';
import { timingSafeEqual } from '../_shared/security.ts';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBINAR_ROTATE_SECRET     = Deno.env.get('WEBINAR_ROTATE_SECRET') ?? '';
const WEBINAR_ALERT_EMAIL       = Deno.env.get('WEBINAR_ALERT_EMAIL') ?? 'amirmesbah510@gmail.com';

const VALID_FUNNELS = new Set(['immigration', 'tiktok']);
const VALID_MODES   = new Set(['assign', 'preview', 'test']);

// No CORS allowlist needed: the only caller is the WordPress server (no browser
// Origin). We answer server-to-server and never expose internals.
const BASE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: BASE_HEADERS });
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Fire-and-forget alert email via the existing send-email function (custom type,
// service_role bearer). Never awaited on the hot path — the visitor's redirect
// must not wait on Resend.
async function sendAlert(subject: string, bodyText: string): Promise<void> {
  const html =
    `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:15px;color:#111;line-height:1.6">` +
    bodyText.split('\n').map((line) => `<p style="margin:0 0 10px">${line}</p>`).join('') +
    `</div>`;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      email_type: 'custom',
      to: WEBINAR_ALERT_EMAIL,
      subject,
      html,
      text: bodyText,
    }),
  });
  if (!res.ok) {
    await reportError(new Error(`send-email ${res.status}`), {
      function: 'webinar-rotate',
      level: 'warning',
      extra: { step: 'alert_email', status: res.status },
    });
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: BASE_HEADERS });
  if (req.method !== 'POST')    return json({ ok: false }, 405);

  // ── Shared-secret gate (timing-safe) ──────────────────────────────────────
  const provided = req.headers.get('x-rotate-secret') || '';
  if (!WEBINAR_ROTATE_SECRET || !timingSafeEqual(provided, WEBINAR_ROTATE_SECRET)) {
    return json({ ok: false }, 403);
  }

  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return json({ ok: false }, 400); }

  const funnel   = String(payload?.funnel ?? '').trim();
  const clientIp = String(payload?.client_ip ?? '').trim();
  let   mode     = String(payload?.mode ?? 'assign').trim();

  if (!VALID_FUNNELS.has(funnel)) return json({ ok: false }, 400);
  if (!VALID_MODES.has(mode))     mode = 'assign';
  // Without a resolvable IP we cannot stick/round-robin safely → treat as a
  // preview (valid link, no slot burned) rather than corrupt the counts.
  if (!clientIp && mode === 'assign') mode = 'preview';

  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const ipHash = clientIp ? await sha256Hex(`webinar-rotation:${funnel}:${clientIp}`) : 'no-ip';

    const { data, error } = await admin.rpc('assign_webinar_group', {
      p_funnel: funnel,
      p_ip_hash: ipHash,
      p_mode: mode,
    });
    if (error) throw error;

    const result = (data ?? {}) as {
      code: string | null;
      source: string;
      near_full: { position: number; lot: number; count: number } | null;
      all_full: boolean;
    };

    // Alerts are fire-and-forget: the redirect never waits on email.
    const waitUntil = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil
      ?? ((p: Promise<unknown>) => { p.catch(() => {}); });

    if (result.near_full) {
      const nf = result.near_full;
      waitUntil(sendAlert(
        `⚠️ Groupe WhatsApp bientôt plein — ${funnel}`,
        `Le groupe #${nf.position} (lot ${nf.lot}) du funnel « ${funnel} » a atteint ${nf.count} / 1000 membres.\n` +
        `Pense à préparer et activer un nouveau lot de liens WhatsApp bientôt, avant qu'il ne soit complet.\n` +
        `Tu peux le faire depuis le tableau de bord : Admin → Groupes WhatsApp.`,
      ));
    }

    if (result.all_full) {
      waitUntil(sendAlert(
        `🚨 Tous les groupes ${funnel} sont pleins`,
        `Tous les groupes actifs du funnel « ${funnel} » sont pleins (1000 / 1000).\n` +
        `En attendant, les nouveaux inscrits sont envoyés vers le DERNIER groupe (aucun lead n'est perdu).\n` +
        `Ajoute vite un nouveau lot de liens depuis Admin → Groupes WhatsApp pour répartir de nouveau.`,
      ));
    }

    return json({ ok: true, code: result.code, source: result.source });
  } catch (error) {
    await reportError(error, { function: 'webinar-rotate', extra: { funnel, mode } });
    // Never leak internals; PHP falls back to its on-disk last-working cache.
    return json({ ok: false });
  }
});
