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
  if (activity.activity_type === 'assignment_evidence') {
    if (activity.metadata.recovery_kind === 'correlation') return 'Attribution probable · reconstituée';
    if (activity.metadata.recovery_kind === 'interval') return 'Changement observé · période reconstituée';
    return 'Attribution observée dans une sauvegarde';
  }
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

/** Recovered evidence is NOT a native assignment event or a verified actor. */
export function assignmentEvidencePresentation(activity: WebinarLeadActivity) {
  if (activity.activity_type !== 'assignment_evidence') return null;
  const metadata = activity.metadata ?? {};
  const name = (value: unknown, id: unknown) => typeof value === 'string' && value.trim()
    ? value : typeof id === 'string' && id ? 'Closer identifié, nom non enregistré' : 'Non attribué';
  const closer = name(metadata.closer_name, metadata.closer_id);
  const previous = name(metadata.previous_closer_name, metadata.previous_closer_id);
  const validDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const sources: string[] = [];
  if (typeof metadata.backup_file === 'string') sources.push(`Sauvegarde : ${metadata.backup_file}`);
  if (typeof metadata.previous_backup_file === 'string') sources.push(`Sauvegarde précédente : ${metadata.previous_backup_file}`);
  if (validDate(metadata.row_updated_at)) sources.push(`Dernière modification de la ligne : ${formatAuditDate(metadata.row_updated_at)}.`);
  if (validDate(metadata.log_at)) sources.push(`Appel API d’attribution réussi : ${formatAuditDate(metadata.log_at)}.`);
  const run = String(metadata.backup_run_id ?? '');
  const sourceUrl = /^\d+$/.test(run) ? `https://github.com/emirmesbah-cloud/PLATFORME-COURS/actions/runs/${run}` : null;
  let period = 'Précision de la date non disponible';
  let explanation = 'Trace récupérée : elle ne prouve ni une heure exacte d’attribution ni l’identité de son auteur.';
  let assignment = `Closer observé : ${closer}`;
  if (metadata.recovery_kind === 'snapshot' && validDate(activity.created_at)) {
    period = `Sauvegarde du ${formatRegistrationDate(activity.created_at)} · heure approximative`;
    explanation = 'État présent dans la sauvegarde. Cette heure correspond au lancement de la sauvegarde, pas à l’attribution du prospect. Des changements intermédiaires peuvent manquer.';
  } else if (metadata.recovery_kind === 'interval' && validDate(metadata.interval_start) && validDate(metadata.interval_end)
    && Date.parse(metadata.interval_start) <= Date.parse(metadata.interval_end)) {
    period = `Entre le ${formatAuditDate(metadata.interval_start)} et le ${formatAuditDate(metadata.interval_end)}`;
    assignment = `États observés : ${previous} → ${closer}`;
    explanation = 'Les deux sauvegardes montrent des états différents. L’heure exacte et le nombre de changements entre ces observations sont inconnus.';
  } else if (metadata.recovery_kind === 'correlation' && validDate(activity.created_at)) {
    period = `Vers le ${formatAuditDate(activity.created_at)} · heure probable, non certifiée`;
    explanation = 'Recoupement entre la dernière modification du prospect et un appel API d’attribution réussi au même instant. Le journal ne contient pas les paramètres du prospect ou du closer : cette attribution reste probable. L’auteur n’est pas prouvé.';
  }
  return { title: adminActivityTitle(activity), period, assignment, explanation, sources, sourceUrl };
}
