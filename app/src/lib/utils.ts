import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(minutes: number): string {
  // SHERLOCK R14 — L1 : guard valeurs négatives / NaN. Sans ça, un seed
  // foireux avec duration_minutes=-5 affichait "-5 min" dans le UI dashboard.
  if (!Number.isFinite(minutes) || minutes < 0) return '—';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

export function formatSeconds(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  const min = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  if (min < 60) return `${min}min ${sec}s`;
  const h = Math.floor(min / 60);
  return `${h}h${String(min % 60).padStart(2, '0')}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function tierLabel(tier: string): string {
  if (tier === 'autonome')   return 'Autonome';
  if (tier === 'accompagne') return 'Accompagné';
  return tier;
}

export function tierPrice(tier: string): string {
  if (tier === 'autonome')   return '12 900 DA';
  if (tier === 'accompagne') return '42 800 DA';
  return '—';
}

export function initials(firstName?: string | null, lastName?: string | null): string {
  const a = (firstName || '').trim();
  const b = (lastName || '').trim();
  return ((a[0] || '') + (b[0] || '')).toUpperCase() || '?';
}

// SHERLOCK R3 fix : on accepte les 2 formats pendant la transition.
//   - Legacy 4-digit  : AU-1234 / AC-5678 (générés avant mig 017)
//   - New 6-char alphanum (no I/L/O/0/1) : AU-X3K7M9 / AC-PQR2T8
// Une fois tous les codes legacy redeem'és, on pourra durcir à 6-char only.
export const ACTIVATION_CODE_REGEX = /^(AU|AC)-(?:\d{4}|[A-HJ-NP-Z2-9]{6})$/;

// WhatsApp : accepte 2 formats côté input:
//  1. Format algérien local : "0555290826" (commence par 0, 10 chiffres total)
//  2. Format international : "+213555290826"
// Côté DB on stocke TOUJOURS en international (+213...).
export const WHATSAPP_REGEX_LOCAL_DZ = /^0[567]\d{8}$/;
export const WHATSAPP_REGEX_INTL     = /^\+213[567]\d{8}$/;
// SHERLOCK FIX : on enveloppe avec ^...$ pour ANCRER le regex composé.
// Avant, le slice(1,-1) retirait les anchors des deux sous-regex et les
// concaténait — résultat : `WHATSAPP_REGEX.test()` matchait n'importe
// quelle string CONTENANT un numéro algérien (ex : "<script>0555290826"
// passait la validation).
export const WHATSAPP_REGEX = new RegExp(
  `^(?:(?:${WHATSAPP_REGEX_LOCAL_DZ.source.slice(1, -1)})|(?:${WHATSAPP_REGEX_INTL.source.slice(1, -1)}))$`,
);

/**
 * "0555290826" → "+213555290826"
 * "+213555290826" → "+213555290826" (no-op)
 */
export function normalizeWhatsapp(raw: string): string {
  const trimmed = raw.replace(/\s/g, '');
  if (WHATSAPP_REGEX_LOCAL_DZ.test(trimmed)) {
    return '+213' + trimmed.slice(1);
  }
  return trimmed;
}
