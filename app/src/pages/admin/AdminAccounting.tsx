import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Wallet, Download, Search, Check, X, AlertCircle,
  TrendingUp, Calendar, Clock, Banknote,
} from 'lucide-react';
import {
  fetchAdminPayments, fetchAccountingStats, recordPayment, cancelPayment,
  queryKeys,
} from '@/lib/queries';
import type { Course, Payment, PaymentMethod, PaymentCurrency } from '@/lib/types';
import { useToast } from '@/components/ui/Toast';
import { cn, courseLabel } from '@/lib/utils';

// Labels FR pour l'UI. La DB stocke les codes.
const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash:                   'Cash',
  ccp:                    'CCP',
  baridi:                 'Baridi Mob',
  bank_transfer:          'Virement bancaire',
  international_transfer: 'Virement international',
  other:                  'Autre',
};
const METHOD_OPTIONS: PaymentMethod[] = ['cash', 'ccp', 'baridi', 'bank_transfer', 'international_transfer', 'other'];

const TIER_LABELS: Record<string, string> = { autonome: 'Autonome', accompagne: 'Accompagné' };
const STATUS_LABELS: Record<string, string> = { pending: 'En attente', recorded: 'Enregistré', cancelled: 'Annulé' };

const STATUS_BADGE: Record<string, string> = {
  pending:   'badge-orange',
  recorded:  'badge-green',
  cancelled: 'badge-slate',
};

interface UIFilters {
  status: '' | 'pending' | 'recorded' | 'cancelled';
  course: '' | Course;
  tier:   '' | 'autonome' | 'accompagne';
  method: '' | PaymentMethod;
  from:   string; // YYYY-MM-DD
  to:     string;
  search: string;
}

export function AdminAccounting() {
  const qc = useQueryClient();
  const toast = useToast();

  const [filters, setFilters] = useState<UIFilters>({
    status: '', course: '', tier: '', method: '', from: '', to: '', search: '',
  });

  // Transformer filters UI → filters DB. Date `to` doit être exclusive +1j.
  const dbFilters = useMemo(() => ({
    status: filters.status || null,
    course: filters.course || null,
    tier:   filters.tier   || null,
    method: filters.method || null,
    from:   filters.from   ? `${filters.from}T00:00:00.000Z` : null,
    to:     filters.to     ? toExclusiveEndDate(filters.to) : null,
    search: filters.search || null,
  }), [filters]);

  const statsQ = useQuery({
    queryKey: queryKeys.adminAccountingStats,
    queryFn:  fetchAccountingStats,
  });

  const paymentsQ = useQuery({
    queryKey: queryKeys.adminPayments(dbFilters),
    queryFn:  () => fetchAdminPayments(dbFilters),
  });

  const [editing, setEditing] = useState<Payment | null>(null);

  async function handleRecord(args: {
    method: PaymentMethod; amount: number; currency: PaymentCurrency; notes: string;
  }) {
    if (!editing) return;
    try {
      const res = await recordPayment({
        paymentId: editing.id,
        method:    args.method,
        amount:    args.amount,
        currency:  args.currency,
        notes:     args.notes || null,
      });
      if (res.ok) {
        toast.success('Paiement enregistré.');
        qc.invalidateQueries({ queryKey: ['admin', 'payments'] });
        qc.invalidateQueries({ queryKey: queryKeys.adminAccountingStats });
        setEditing(null);
      } else {
        toast.error(res.error || 'Erreur.');
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erreur réseau.');
    }
  }

  async function handleCancel(p: Payment) {
    if (!confirm(`Annuler le paiement de ${p.profile?.first_name ?? '?'} ${p.profile?.last_name ?? ''} ? Cette ligne restera visible en historique avec le statut "annulé".`)) return;
    try {
      const res = await cancelPayment(p.id);
      if (res.ok) {
        toast.success('Paiement annulé.');
        qc.invalidateQueries({ queryKey: ['admin', 'payments'] });
        qc.invalidateQueries({ queryKey: queryKeys.adminAccountingStats });
      } else {
        toast.error(res.error || 'Erreur.');
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erreur réseau.');
    }
  }

  function exportCsv() {
    const rows = paymentsQ.data ?? [];
    if (rows.length === 0) {
      toast.info('Aucun paiement à exporter.');
      return;
    }
    const csv = buildCsv(rows);
    downloadFile(csv, `comptabilite-aurel-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8;');
    toast.success(`${rows.length} ligne(s) exportée(s).`);
  }

  const stats = statsQ.data;
  const rows  = paymentsQ.data ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-aurel-orange">
            <Wallet className="h-5 w-5" />
            <span className="text-sm font-semibold uppercase tracking-wide">Comptabilité</span>
          </div>
          <h1 className="text-3xl font-bold text-aurel-ink">Paiements & revenus</h1>
          <p className="mt-1 text-slate-600">
            Une ligne par activation. Complète avec le montant + la méthode reçue. Exporte en CSV pour ta compta.
          </p>
        </div>
        <button onClick={exportCsv} className="btn-outline">
          <Download className="h-4 w-4" /> Exporter CSV
        </button>
      </header>

      {/* Stats cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Calendar}
          label="Mois en cours"
          dzd={stats?.this_month.dzd ?? 0}
          eur={stats?.this_month.eur ?? 0}
          sub={`${stats?.this_month.count ?? 0} paiement(s)`}
          accent="orange"
        />
        <StatCard
          icon={TrendingUp}
          label="Mois précédent"
          dzd={stats?.last_month.dzd ?? 0}
          eur={stats?.last_month.eur ?? 0}
          sub={`${stats?.last_month.count ?? 0} paiement(s)`}
          accent="teal"
        />
        <StatCard
          icon={Banknote}
          label="Année (YTD)"
          dzd={stats?.ytd.dzd ?? 0}
          eur={stats?.ytd.eur ?? 0}
          sub={`${stats?.ytd.count ?? 0} paiement(s)`}
          accent="orange"
        />
        <PendingCard pending={stats?.pending ?? 0} pendingDzd={stats?.pending_dzd ?? 0} />
      </div>

      {stats && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(['pflege', 'immigration'] as Course[]).map((course) => {
            const courseStats = stats.by_course.find((row) => row.course === course);
            return (
              <div key={course} className="card-padded flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Revenus {courseLabel(course)}
                  </div>
                  <div className="mt-1 text-xl font-bold text-aurel-ink">
                    {formatAmount(courseStats?.dzd ?? 0, 'DZD')}
                  </div>
                  {(courseStats?.eur ?? 0) > 0 && (
                    <div className="text-sm text-slate-500">+ {formatAmount(courseStats?.eur ?? 0, 'EUR')}</div>
                  )}
                </div>
                <div className={cn('badge', course === 'immigration' ? 'badge-teal' : 'badge-orange')}>
                  {courseStats?.count ?? 0} paiement(s)
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(statsQ.isError || paymentsQ.isError) && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Certaines données financières n'ont pas pu charger. Recharge la page avant d'enregistrer un paiement.
        </div>
      )}

      {/* Filtres */}
      <div className="card-padded">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
          <div className="lg:col-span-2">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Recherche</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="input w-full pl-9"
                placeholder="Nom / email / code"
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Cours</label>
            <select className="input w-full" value={filters.course}
              onChange={(e) => setFilters({ ...filters, course: e.target.value as UIFilters['course'] })}>
              <option value="">Tous</option>
              <option value="pflege">Pflege</option>
              <option value="immigration">Immigration</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Statut</label>
            <select className="input w-full" value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value as UIFilters['status'] })}>
              <option value="">Tous</option>
              <option value="pending">En attente</option>
              <option value="recorded">Enregistré</option>
              <option value="cancelled">Annulé</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Tier</label>
            <select className="input w-full" value={filters.tier}
              onChange={(e) => setFilters({ ...filters, tier: e.target.value as UIFilters['tier'] })}>
              <option value="">Tous</option>
              <option value="autonome">Autonome</option>
              <option value="accompagne">Accompagné</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Méthode</label>
            <select className="input w-full" value={filters.method}
              onChange={(e) => setFilters({ ...filters, method: e.target.value as UIFilters['method'] })}>
              <option value="">Toutes</option>
              {METHOD_OPTIONS.map((m) => (
                <option key={m} value={m}>{METHOD_LABELS[m]}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:col-span-1">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Du</label>
              <input type="date" className="input w-full" value={filters.from}
                onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Au</label>
              <input type="date" className="input w-full" value={filters.to}
                onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
            </div>
          </div>
        </div>
      </div>

      {/* Tableau */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Étudiant</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Cours</th>
              <th className="px-4 py-3">Tier</th>
              <th className="px-4 py-3">Méthode</th>
              <th className="px-4 py-3 text-right">Montant</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paymentsQ.isLoading && rows.length === 0 ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 9 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-3 w-3/4 rounded bg-slate-200" /></td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                  Aucun paiement ne correspond à ces filtres.
                </td>
              </tr>
            ) : (
              rows.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(p.created_at).toLocaleDateString('fr-FR')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-aurel-ink">
                      {p.profile?.first_name ?? '—'} {p.profile?.last_name ?? ''}
                    </div>
                    <div className="text-xs text-slate-400">{p.profile?.email ?? '—'}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {p.activation_code?.code ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('badge', p.course === 'immigration' ? 'badge-teal' : 'badge-orange')}>
                      {courseLabel(p.course)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'badge',
                      p.tier === 'accompagne' ? 'badge-teal' : 'badge-orange',
                    )}>
                      {TIER_LABELS[p.tier]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {p.method ? METHOD_LABELS[p.method] : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {p.amount != null && p.currency
                      ? <span className="font-semibold text-aurel-ink">
                          {formatAmount(p.amount, p.currency)}
                        </span>
                      : <span className="text-xs text-slate-400">
                          {formatAmount(p.list_price_dzd, 'DZD')} attendu
                        </span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('badge', STATUS_BADGE[p.status] ?? 'badge-slate')}>
                      {STATUS_LABELS[p.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {p.status !== 'cancelled' && (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditing(p)}
                          className="btn-ghost text-aurel-orange-dark"
                          title={p.status === 'pending' ? 'Compléter' : 'Modifier'}
                        >
                          {p.status === 'pending'
                            ? <><Check className="h-4 w-4" /> Compléter</>
                            : <>Modifier</>}
                        </button>
                        <button
                          onClick={() => handleCancel(p)}
                          className="btn-ghost text-red-500 hover:text-red-700"
                          title="Annuler"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer info */}
      <p className="text-xs text-slate-400">
        {rows.length} paiement(s) affiché(s). Chaque activation de code crée automatiquement
        une ligne "En attente" à compléter. Les paiements annulés restent dans l'historique pour audit.
      </p>

      {/* Modal */}
      {editing && (
        <RecordPaymentModal
          payment={editing}
          onCancel={() => setEditing(null)}
          onSave={handleRecord}
        />
      )}
    </div>
  );
}


// ─── Sub-components ─────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, dzd, eur, sub, accent }: {
  icon: typeof Calendar;
  label: string;
  dzd: number;
  eur: number;
  sub?: string;
  accent: 'orange' | 'teal';
}) {
  const colors = accent === 'orange'
    ? 'bg-aurel-orange-soft text-aurel-orange-dark'
    : 'bg-teal-50 text-aurel-teal';
  return (
    <div className="card-padded">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${colors}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="space-y-0.5">
        <div className="text-2xl font-bold text-aurel-ink">
          {formatAmount(dzd, 'DZD')}
        </div>
        {eur > 0 && (
          <div className="text-sm font-semibold text-slate-500">
            + {formatAmount(eur, 'EUR')}
          </div>
        )}
      </div>
      {sub && <div className="mt-2 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function PendingCard({ pending, pendingDzd }: { pending: number; pendingDzd: number }) {
  return (
    <div className={cn(
      'card-padded',
      pending > 0 && 'border-amber-200 bg-amber-50/40',
    )}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">À compléter</span>
        <div className={cn(
          'flex h-9 w-9 items-center justify-center rounded-lg',
          pending > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400',
        )}>
          <Clock className="h-5 w-5" />
        </div>
      </div>
      <div className="text-3xl font-bold text-aurel-ink">{pending}</div>
      <div className="mt-2 text-xs text-slate-500">
        {pending === 0 ? 'Tout est à jour ✨' : 'paiement(s) en attente'}
      </div>
      {pending > 0 && (
        <div className="mt-1 text-xs font-semibold text-amber-700">
          {formatAmount(pendingDzd, 'DZD')} au tarif catalogue
        </div>
      )}
    </div>
  );
}

function RecordPaymentModal({
  payment, onCancel, onSave,
}: {
  payment: Payment;
  onCancel: () => void;
  onSave: (args: { method: PaymentMethod; amount: number; currency: PaymentCurrency; notes: string }) => void;
}) {
  const [method,   setMethod]   = useState<PaymentMethod>(payment.method ?? 'ccp');
  const [amount,   setAmount]   = useState<string>(
    payment.amount?.toString() ?? payment.list_price_dzd.toString(),
  );
  const [currency, setCurrency] = useState<PaymentCurrency>(payment.currency ?? 'DZD');
  const [notes,    setNotes]    = useState<string>(payment.notes ?? '');

  const numericAmount = parseFloat(amount);
  const valid = !isNaN(numericAmount) && numericAmount >= 0 && method && currency;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
         onClick={onCancel}>
      <div className="w-full max-w-md card p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-aurel-ink">
            {payment.status === 'pending' ? 'Enregistrer le paiement' : 'Modifier le paiement'}
          </h3>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm">
          <div className="font-semibold text-aurel-ink">
            {payment.profile?.first_name} {payment.profile?.last_name}
          </div>
          <div className="text-xs text-slate-500">{payment.profile?.email}</div>
          <div className="mt-1 flex items-center gap-2 text-xs">
            <span className={cn('badge', payment.course === 'immigration' ? 'badge-teal' : 'badge-orange')}>
              {courseLabel(payment.course)}
            </span>
            <span className={cn('badge', payment.tier === 'accompagne' ? 'badge-teal' : 'badge-orange')}>
              {TIER_LABELS[payment.tier]}
            </span>
            {payment.activation_code && (
              <span className="font-mono text-slate-500">{payment.activation_code.code}</span>
            )}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Tarif officiel : <b>{formatAmount(payment.list_price_dzd, 'DZD')}</b>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Méthode reçue
            </label>
            <select className="input w-full" value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {METHOD_OPTIONS.map((m) => (
                <option key={m} value={m}>{METHOD_LABELS[m]}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Montant
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="input w-full"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={`ex : ${payment.list_price_dzd}`}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Devise
              </label>
              <select className="input w-full" value={currency}
                onChange={(e) => setCurrency(e.target.value as PaymentCurrency)}>
                <option value="DZD">DZD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Notes (optionnel)
            </label>
            <textarea
              className="input min-h-[60px] w-full"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ex : reçu via Baridi, ref BR-12345"
            />
          </div>
          {!valid && amount && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
              <AlertCircle className="h-4 w-4 flex-none" />
              <span>Montant invalide.</span>
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button onClick={onCancel} className="btn-outline">Annuler</button>
            <button
              disabled={!valid}
              onClick={() => onSave({ method, amount: numericAmount, currency, notes })}
              className="btn-primary disabled:opacity-50"
            >
              <Check className="h-4 w-4" /> Enregistrer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ─── Helpers ────────────────────────────────────────────────────────────────

function formatAmount(amount: number, currency: PaymentCurrency): string {
  if (currency === 'EUR') {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
  }
  // DZD : Intl prend en charge, mais le symbole varie. On force "DA" pour clarté.
  return `${new Intl.NumberFormat('fr-FR').format(amount)} DA`;
}

function toExclusiveEndDate(yyyymmdd: string): string {
  // L'utilisateur saisit "jusqu'au 25/05/2026" → on veut inclure tout ce jour.
  // → comparer < 2026-05-26T00:00.
  const d = new Date(`${yyyymmdd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

function buildCsv(rows: Payment[]): string {
  // En-têtes en français, séparateur ";" pour ouverture native dans Excel FR.
  const headers = [
    'Date création', 'Date enregistrement', 'Étudiant', 'Email', 'Code',
    'Cours', 'Tier', 'Tarif officiel DZD', 'Méthode', 'Montant', 'Devise', 'Statut', 'Notes',
  ];
  const lines: string[] = [];
  // BOM UTF-8 pour qu'Excel ouvre correctement les accents.
  lines.push('﻿' + headers.join(';'));
  for (const p of rows) {
    const cells = [
      new Date(p.created_at).toLocaleDateString('fr-FR'),
      p.recorded_at ? new Date(p.recorded_at).toLocaleDateString('fr-FR') : '',
      `${p.profile?.first_name ?? ''} ${p.profile?.last_name ?? ''}`.trim(),
      p.profile?.email ?? '',
      p.activation_code?.code ?? '',
      courseLabel(p.course),
      TIER_LABELS[p.tier] ?? p.tier,
      p.list_price_dzd.toString(),
      p.method ? METHOD_LABELS[p.method] : '',
      p.amount != null ? p.amount.toString() : '',
      p.currency ?? '',
      STATUS_LABELS[p.status] ?? p.status,
      (p.notes ?? '').replace(/\r?\n/g, ' '),
    ];
    lines.push(cells.map(csvEscape).join(';'));
  }
  return lines.join('\r\n');
}

function csvEscape(v: string): string {
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
  // Échappe les guillemets, et enrobe la valeur de "" si elle contient ; " ou \n.
  const needs = /[";\r\n]/.test(v);
  const escaped = v.replace(/"/g, '""');
  return needs ? `"${escaped}"` : escaped;
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
