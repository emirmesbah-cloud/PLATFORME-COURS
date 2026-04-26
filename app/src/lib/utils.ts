import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(minutes: number): string {
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

export const ACTIVATION_CODE_REGEX = /^(AU|AC)-\d{4}$/;
export const WHATSAPP_REGEX = /^\+213[567]\d{8}$/;
