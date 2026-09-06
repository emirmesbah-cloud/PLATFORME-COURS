import type { WebinarLead, WebinarLeadActivity, WebinarLeadStatus } from './types';

export function leadStatusColor(status: WebinarLeadStatus): string {
  if (status === 'new' || status === 'to_call') return 'bg-blue-100 text-blue-800';
  if (status === 'callback') return 'bg-violet-100 text-violet-800';
  if (status === 'delivered') return 'badge-green';
  if (status === 'confirmed' || status === 'in_delivery') return 'badge-teal';
  if (status === 'not_interested' || status === 'returned') return 'badge-red';
  return 'badge-orange';
}

export function compareRegistrationDate(
  a: Pick<WebinarLead, 'id' | 'created_at'>, b: Pick<WebinarLead, 'id' | 'created_at'>,
  direction: 'date_asc' | 'date_desc',
): number {
  const first = Date.parse(a.created_at), second = Date.parse(b.created_at);
  // Missing/invalid imported dates stay at the end in either direction.
  if (!Number.isFinite(first)) return Number.isFinite(second) ? 1 : a.id.localeCompare(b.id);
  if (!Number.isFinite(second)) return -1;
  const difference = direction === 'date_asc' ? first - second : second - first;
  return difference || a.id.localeCompare(b.id);
}

const registrationDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Algiers', year: 'numeric', month: '2-digit', day: '2-digit',
});

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function matchesRegistrationDateRange(createdAt: string, from: string, to: string): boolean {
  if (!from && !to) return true;
  if ((from && !validCalendarDate(from)) || (to && !validCalendarDate(to)) || (from && to && from > to)) return false;
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return false;
  const parts = registrationDayFormatter.formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  const day = `${part('year')}-${part('month')}-${part('day')}`;
  // Both endpoints include the entire calendar day in the business timezone.
  return (!from || day >= from) && (!to || day <= to);
}

export function formatRegistrationDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Date non enregistrée';
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Africa/Algiers', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
}

export function adminActivityTitle(activity: WebinarLeadActivity): string {
  if (activity.activity_type === 'assignment') {
    if (!activity.metadata.closer_id && !activity.metadata.closer_name) return 'Attribution retirée';
    return activity.metadata.previous_closer_id || activity.metadata.previous_closer_name ? 'Réattribution du prospect' : 'Attribution au closer';
  }
  if (activity.activity_type === 'contact') return activity.metadata.channel === 'whatsapp' ? 'WhatsApp ouvert' : 'Lien téléphonique ouvert';
  if (activity.activity_type === 'submitted') return 'Inscription du prospect';
  if (activity.activity_type === 'note') return 'Note du prospect modifiée';
  if (activity.activity_type === 'delivery') {
    if (activity.metadata.action === 'order_created') return 'Passage en commande';
    if (activity.metadata.action === 'order_linked') return 'Commande liée au prospect';
    return 'Événement commande';
  }
  if (activity.status === 'confirmed') return activity.activity_type === 'call' ? 'Prospect confirmé · suivi enregistré' : 'Prospect confirmé';
  if (activity.status === 'delivered') return 'Livraison validée';
  return activity.activity_type === 'call' ? 'Suivi d’appel enregistré' : 'Statut CRM enregistré';
}

export function formatAuditDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Date non enregistrée';
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Africa/Algiers', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(date);
}
