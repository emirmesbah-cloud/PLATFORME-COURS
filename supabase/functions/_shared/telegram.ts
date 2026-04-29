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
    lines.push(escapeMd(message));

    if (opts.extra && Object.keys(opts.extra).length > 0) {
      lines.push('');
      lines.push('*Context:*');
      for (const [k, v] of Object.entries(opts.extra)) {
        const val = typeof v === 'string' ? v : JSON.stringify(v);
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
