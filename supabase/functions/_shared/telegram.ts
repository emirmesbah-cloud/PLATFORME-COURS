// ============================================================================
// Aurel Academy — Telegram alerting helper pour edge functions Deno
//
// Best-effort : ne throw jamais, swallow toutes les erreurs.
//
// Variables d'env requises (Supabase Vault) :
//   TELEGRAM_BOT_TOKEN — token du bot Aurel Academy Alerts
//   TELEGRAM_CHAT_ID   — chat ID du founder (ou d'un groupe ops)
//
// Usage :
//   import { notifyTelegram } from '../_shared/telegram.ts';
//   await notifyTelegram('🔥 redeem_activation_code failed', {
//     function: 'activate-account',
//     extra: { user_id, code, error: e.message },
//   });
//
// Quand l'utiliser (vs Sentry seul) :
//   - Sentry capture TOUS les errors → email digest, dashboard
//   - Telegram = canal "réveille-moi" → SEULEMENT pour les paths critiques où
//     un échec = perte d'argent ou de réputation immédiate :
//       * activate-account: échec après paiement → user a payé mais pas d'accès
//       * send-email: échec massif Resend → tous les emails bloqués
//       * health: down détecté côté serveur
//   - Le bruit tue le signal. Tag toi-même les events critiques explicitement.
// ============================================================================

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';
const CHAT_ID   = Deno.env.get('TELEGRAM_CHAT_ID')   || '';

interface TelegramOptions {
  function?: string;                  // edge function name
  level?: 'info' | 'warning' | 'critical';
  extra?: Record<string, unknown>;    // contexte ajouté en bullet points
}

// ============================================================================
// PII REDACTION (Sherlock R3 fix)
//
// Les call sites passaient des emails et codes d'activation bruts (`extra: {
// email, code, ... }`). Telegram archive les messages côté serveur ; un leak
// du bot token ou un membre malveillant du chat = leak des codes payants
// + emails étudiants. On masque côté helper pour que tous les call sites
// soient automatiquement couverts (DRY + safe-by-default).
//
// Stratégie :
//  - Keys dans REDACT_KEYS : valeur entièrement masquée → `<redacted>`
//  - Code-shaped (AU-XXXX, AC-XXXX) : masque les chiffres
//  - Email-shaped : conserve domaine, masque local-part
//  - Le reste passe tel quel (incluant les UUIDs, qui ne sont pas PII).
// ============================================================================
const REDACT_KEYS = new Set(['password', 'token', 'access_token', 'refresh_token']);
// SHERLOCK R13 — B6: post-migration 017, codes use the 6-char Crockford-style
// alphabet (no I, L, O, 0, 1) in addition to the legacy 4-digit codes. Cover
// both shapes so redaction doesn't silently leak the new keyspace.
const CODE_RE  = /\b(AU|AC)-(?:\d{4}|[A-HJ-NP-Z2-9]{6})\b/gi;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;

function redactString(s: string): string {
  return s
    .replace(EMAIL_RE, (m) => {
      const at = m.indexOf('@');
      if (at <= 0) return '<email>';
      const local = m.slice(0, at);
      const domain = m.slice(at);
      const head = local.length <= 2 ? local[0] ?? '' : local.slice(0, 2);
      return `${head}***${domain}`;
    })
    .replace(CODE_RE, (m) => `${m.slice(0, 3)}****`);
}

// SHERLOCK R14 — M4 : deep recursive walk pour redact les nested objets.
// Avant : nested object → JSON.stringify puis redactString → on perdait la
// structure ET on ratait les keys sensitives (`password`, `token`) inside
// nested objects parce que REDACT_KEYS s'applique uniquement à la key du
// niveau racine. Maintenant : on walk récursivement, on check REDACT_KEYS
// à CHAQUE niveau (case-insensitive), et on garde la structure intacte
// pour un meilleur diagnostic dans les Telegram alerts.
function deepRedact(val: unknown): unknown {
  if (typeof val === 'string') return redactString(val);
  if (Array.isArray(val)) return val.map(deepRedact);
  if (val && typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      const lk = k.toLowerCase();
      if (REDACT_KEYS.has(lk)) {
        out[k] = '<redacted>';
      } else if (lk === 'code' && typeof v === 'string') {
        out[k] = v.length >= 3 ? `${v.slice(0, 3)}****` : '<code>';
      } else {
        out[k] = deepRedact(v);
      }
    }
    return out;
  }
  return val;
}

function redactValue(key: string, val: unknown): unknown {
  if (REDACT_KEYS.has(key.toLowerCase())) return '<redacted>';
  if (key.toLowerCase() === 'code' && typeof val === 'string') {
    // Show prefix only for codes
    return val.length >= 3 ? `${val.slice(0, 3)}****` : '<code>';
  }
  if (typeof val === 'string') return redactString(val);
  if (val !== null && typeof val === 'object') {
    // SHERLOCK R14 — M4 : deep redact + stringify (vs flat stringify avant)
    return JSON.stringify(deepRedact(val));
  }
  return val;
}

const LEVEL_EMOJI: Record<NonNullable<TelegramOptions['level']>, string> = {
  info:     'ℹ️',
  warning:  '⚠️',
  critical: '🚨',
};

/**
 * Échappe les caractères MarkdownV2 spéciaux pour éviter un parse_mode error.
 * Ref: https://core.telegram.org/bots/api#markdownv2-style
 */
function escapeMd(s: string): string {
  return s.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/**
 * Envoie un message Telegram. Best-effort, ne throw jamais.
 */
export async function notifyTelegram(
  message: string,
  opts: TelegramOptions = {},
): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return; // disabled — config absente

  try {
    const level = opts.level ?? 'critical';
    const emoji = LEVEL_EMOJI[level];

    const lines: string[] = [];
    lines.push(`${emoji} *Aurel Academy* — \`${escapeMd(level.toUpperCase())}\``);
    if (opts.function) {
      lines.push(`Function: \`${escapeMd(opts.function)}\``);
    }
    lines.push('');
    // Redact emails and codes from the free-text message body too — many
    // call sites paste user data into the message.
    lines.push(escapeMd(redactString(message)));

    if (opts.extra && Object.keys(opts.extra).length > 0) {
      lines.push('');
      lines.push('*Context:*');
      for (const [k, v] of Object.entries(opts.extra)) {
        const redacted = redactValue(k, v);
        const val = typeof redacted === 'string' ? redacted : JSON.stringify(redacted);
        // Truncate long values to keep the message under Telegram's 4096 char limit
        const truncated = val.length > 200 ? val.slice(0, 200) + '…' : val;
        lines.push(`• \`${escapeMd(k)}\`: ${escapeMd(truncated)}`);
      }
    }

    lines.push('');
    lines.push(`_${escapeMd(new Date().toISOString())}_`);

    const text = lines.join('\n');

    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3000);

    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });

    clearTimeout(t);
  } catch (e) {
    console.error('[Telegram] notifyTelegram failed:', e instanceof Error ? e.message : e);
  }
}
