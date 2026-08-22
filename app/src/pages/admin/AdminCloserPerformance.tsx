import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trophy, Phone, UserCheck, Users, Wallet, RefreshCw, Medal } from 'lucide-react';
import { fetchCloserPerformance, queryKeys } from '@/lib/queries';
import { Spinner } from '@/components/ui/Spinner';
import { ProgressBar } from '@/components/ui/Progress';
import { cn } from '@/lib/utils';
import type { CloserPerformanceRow } from '@/lib/types';

function formatDA(value: number): string {
  return `${Math.round(Number(value) || 0).toLocaleString('fr-FR')} DA`;
}

type SortKey = 'cod_delivered' | 'confirmed' | 'confirmation_rate' | 'calls' | 'assigned';
const SORT_LABEL: Record<SortKey, string> = {
  cod_delivered: 'Revenu livré',
  confirmed: 'Ventes confirmées',
  confirmation_rate: 'Taux de confirmation',
  calls: 'Appels passés',
  assigned: 'Prospects attribués',
};

export function AdminCloserPerformance() {
  const perfQ = useQuery({ queryKey: queryKeys.adminCloserPerformance, queryFn: fetchCloserPerformance });
  const [sortBy, setSortBy] = useState<SortKey>('cod_delivered');

  const rows = useMemo(() => {
    const list = [...(perfQ.data?.closers ?? [])];
    return list.sort((a, b) => Number(b[sortBy]) - Number(a[sortBy]));
  }, [perfQ.data, sortBy]);

  const totals = perfQ.data?.totals;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-aurel-orange">
            <Trophy className="h-5 w-5" />
            <span className="text-sm font-semibold uppercase tracking-wide">Équipe closing</span>
          </div>
          <h1 className="text-3xl font-bold text-aurel-ink">Performance des closers</h1>
          <p className="mt-1 max-w-3xl text-slate-600">
            Activité <strong>et</strong> résultats par closer : appels, taux de confirmation, livraisons et revenu réellement encaissé.
          </p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => perfQ.refetch()} disabled={perfQ.isFetching}>
          <RefreshCw className={cn('h-4 w-4', perfQ.isFetching && 'animate-spin')} /> Actualiser
        </button>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi icon={Users} label="Closers actifs" value={String(totals?.closers ?? 0)} color="orange" />
        <Kpi icon={UserCheck} label="Prospects attribués" value={String(totals?.assigned ?? 0)} color="orange" />
        <Kpi icon={Phone} label="Appels passés" value={String(totals?.calls ?? 0)} color="orange" />
        <Kpi icon={Trophy} label="Ventes confirmées" value={String(totals?.confirmed ?? 0)} color="green" />
        <Kpi icon={Wallet} label="Revenu livré" value={formatDA(totals?.cod_delivered ?? 0)} color="green" />
      </div>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 p-4">
          <h2 className="text-lg font-bold text-aurel-ink">Classement</h2>
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            Classer par
            <select className="input w-52" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}>
              {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
                <option key={key} value={key}>{SORT_LABEL[key]}</option>
              ))}
            </select>
          </label>
        </div>

        {perfQ.isLoading ? <Spinner label="Chargement des performances…" />
          : perfQ.isError ? <div className="p-8 text-center text-red-600">Impossible de charger les performances.</div>
          : rows.length === 0 ? <div className="p-10 text-center text-zinc-500">Aucun appel attribué à un closer pour le moment.</div>
          : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-sm">
                <thead className="bg-zinc-50 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Closer</th>
                    <th className="px-4 py-3 text-right">Attribués</th>
                    <th className="px-4 py-3 text-right">Appels</th>
                    <th className="px-4 py-3">Confirmés · taux</th>
                    <th className="px-4 py-3 text-right">Livrés</th>
                    <th className="px-4 py-3 text-right">Retours</th>
                    <th className="px-4 py-3 text-right">Taux livraison</th>
                    <th className="px-4 py-3 text-right">Revenu livré</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {rows.map((row, index) => <PerfRow key={row.closer_name} row={row} rank={index + 1} />)}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </div>
  );
}

function PerfRow({ row, rank }: { row: CloserPerformanceRow; rank: number }) {
  const medal = rank <= 3;
  const medalColor = rank === 1 ? 'text-amber-500' : rank === 2 ? 'text-zinc-400' : 'text-orange-700';
  return (
    <tr className="align-middle hover:bg-zinc-50/70">
      <td className="px-4 py-3">
        {medal ? <Medal className={cn('h-5 w-5', medalColor)} /> : <span className="text-zinc-400">{rank}</span>}
      </td>
      <td className="px-4 py-3 font-semibold text-zinc-900">{row.closer_name}</td>
      <td className="px-4 py-3 text-right tabular-nums text-zinc-700">{row.assigned}</td>
      <td className="px-4 py-3 text-right tabular-nums text-zinc-700">{row.calls}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="w-10 flex-none tabular-nums font-medium text-zinc-900">{row.confirmed}</span>
          <ProgressBar value={row.confirmation_rate} max={100} color="green" className="flex-1 min-w-16" label={`Taux de confirmation ${row.closer_name}`} />
          <span className="w-10 flex-none text-right text-xs tabular-nums text-zinc-500">{row.confirmation_rate}%</span>
        </div>
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-green-700">{row.delivered}</td>
      <td className="px-4 py-3 text-right tabular-nums text-red-600">{row.returned}</td>
      <td className="px-4 py-3 text-right tabular-nums text-zinc-700">{row.delivery_rate}%</td>
      <td className="px-4 py-3 text-right font-semibold tabular-nums text-zinc-900">{formatDA(row.cod_delivered)}</td>
    </tr>
  );
}

function Kpi({ icon: Icon, label, value, color }: { icon: typeof Users; label: string; value: string; color: 'orange' | 'green' }) {
  return (
    <div className="card-padded">
      <div className={cn('mb-2 inline-flex h-9 w-9 items-center justify-center rounded-card-sm', color === 'green' ? 'bg-green-50 text-green-600' : 'bg-aurel-orange-soft text-aurel-orange-dark')}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="text-2xl font-bold text-zinc-900">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  );
}
