import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PackageCheck, Truck, Undo2, Wallet, RefreshCw, AlertTriangle, Clock3 } from 'lucide-react';
import { fetchCodHealth, queryKeys } from '@/lib/queries';
import { Spinner } from '@/components/ui/Spinner';
import { ProgressBar } from '@/components/ui/Progress';
import { cn } from '@/lib/utils';
import type { CodWilayaRow } from '@/lib/types';

function formatDA(value: number): string {
  return `${Math.round(Number(value) || 0).toLocaleString('fr-FR')} DA`;
}

type SortKey = 'returned' | 'return_rate' | 'orders' | 'cod_delivered' | 'delivery_rate';
const SORT_LABEL: Record<SortKey, string> = {
  returned: 'Retours (nombre)',
  return_rate: 'Taux de retour',
  orders: 'Commandes',
  cod_delivered: 'Encaissé',
  delivery_rate: 'Taux de livraison',
};

// A wilaya's return rate only matters once it has enough shipped volume — flag
// the ones eating margin.
function isProblem(row: CodWilayaRow): boolean {
  return row.shipped >= 5 && row.return_rate >= 25;
}

export function AdminCodHealth() {
  const q = useQuery({ queryKey: queryKeys.adminCodHealth, queryFn: fetchCodHealth });
  const [sortBy, setSortBy] = useState<SortKey>('returned');

  const rows = useMemo(() => {
    const list = [...(q.data?.by_wilaya ?? [])];
    return list.sort((a, b) => Number(b[sortBy]) - Number(a[sortBy]));
  }, [q.data, sortBy]);

  const t = q.data?.totals;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-aurel-orange">
            <Truck className="h-5 w-5" />
            <span className="text-sm font-semibold uppercase tracking-wide">Livraison COD</span>
          </div>
          <h1 className="text-3xl font-bold text-aurel-ink">Santé COD & retours</h1>
          <p className="mt-1 max-w-3xl text-slate-600">
            Livraisons, retours et argent encaissé — avec le détail par wilaya pour repérer les zones qui rongent la marge.
          </p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={cn('h-4 w-4', q.isFetching && 'animate-spin')} /> Actualiser
        </button>
      </header>

      {q.isLoading ? <Spinner label="Chargement…" />
        : q.isError || !t ? <div className="card-padded text-center text-red-600">Impossible de charger la santé COD. Vérifie que la migration est appliquée, puis réessaie.</div>
        : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile icon={Truck} label="Expédiées" value={String(t.shipped)} sub={`${t.orders} commande(s) au total`} tone="teal" />
              <Tile icon={PackageCheck} label="Livrées" value={`${t.delivered}`} sub={`Taux de livraison ${t.delivery_rate}%`} tone="green" />
              <Tile icon={Undo2} label="Retours / refus" value={`${t.returned}`} sub={`Taux de retour ${t.return_rate}%`} tone="red" />
              <Tile icon={Clock3} label="En transit" value={`${t.in_transit}`} sub="Ni livrées ni retournées" tone="amber" />
              <Tile icon={Wallet} label="Encaissé (livré)" value={formatDA(t.cod_delivered)} tone="green" />
              <Tile icon={Wallet} label="Confirmé (total)" value={formatDA(t.cod_confirmed)} tone="teal" />
              <Tile icon={AlertTriangle} label="Perdu (retours)" value={formatDA(t.cod_returned)} tone="red" />
              <Tile icon={AlertTriangle} label="Taux de retour" value={`${t.return_rate}%`} sub={t.return_rate >= 25 ? 'Élevé — à surveiller' : 'Sous contrôle'} tone={t.return_rate >= 25 ? 'red' : 'green'} />
            </div>

            <section className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 p-4">
                <h2 className="text-lg font-bold text-aurel-ink">Par wilaya</h2>
                <label className="flex items-center gap-2 text-sm text-zinc-600">
                  Classer par
                  <select className="input w-52" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}>
                    {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
                  </select>
                </label>
              </div>

              {rows.length === 0 ? <div className="p-10 text-center text-zinc-500">Aucune commande pour le moment.</div>
                : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-sm">
                      <thead className="bg-zinc-50 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        <tr>
                          <th className="px-4 py-3">Wilaya</th>
                          <th className="px-4 py-3 text-right">Commandes</th>
                          <th className="px-4 py-3 text-right">Expédiées</th>
                          <th className="px-4 py-3 text-right">Livrées</th>
                          <th className="px-4 py-3 text-right">Retours</th>
                          <th className="px-4 py-3">Taux de livraison</th>
                          <th className="px-4 py-3">Taux de retour</th>
                          <th className="px-4 py-3 text-right">Encaissé</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {rows.map((row) => (
                          <tr key={row.wilaya_id} className={cn('align-middle hover:bg-zinc-50/70', isProblem(row) && 'bg-red-50/40')}>
                            <td className="px-4 py-3 font-semibold text-zinc-900">
                              <span className="text-xs text-zinc-400">{row.wilaya_id}.</span> {row.wilaya_name}
                              {isProblem(row) && <span className="badge badge-red ml-2 align-middle">Retours élevés</span>}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-zinc-700">{row.orders}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-zinc-700">{row.shipped}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-green-700">{row.delivered}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-red-600">{row.returned}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <ProgressBar value={row.delivery_rate} max={100} color="green" className="flex-1 min-w-16" label={`Taux de livraison ${row.wilaya_name}`} />
                                <span className="w-10 flex-none text-right text-xs tabular-nums text-zinc-500">{row.delivery_rate}%</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="h-2 flex-1 min-w-16 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-red-500" style={{ width: `${Math.min(100, row.return_rate)}%` }} /></div>
                                <span className={cn('w-10 flex-none text-right text-xs tabular-nums', row.return_rate >= 25 ? 'font-semibold text-red-600' : 'text-zinc-500')}>{row.return_rate}%</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right font-semibold tabular-nums text-zinc-900">{formatDA(row.cod_delivered)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </section>
            <p className="text-xs text-zinc-400">Taux de livraison / retour = livrées ou retournées ÷ expédiées. Une wilaya est signalée « Retours élevés » à partir de 5 colis expédiés et 25% de retour.</p>
          </>
        )}
    </div>
  );
}

function Tile({ icon: Icon, label, value, sub, tone }: { icon: typeof Truck; label: string; value: string; sub?: string; tone: 'teal' | 'green' | 'red' | 'amber' }) {
  const toneClass = tone === 'green' ? 'bg-green-50 text-green-600'
    : tone === 'red' ? 'bg-red-50 text-red-600'
    : tone === 'amber' ? 'bg-amber-50 text-amber-600'
    : 'bg-aurel-teal-soft text-aurel-teal-dark';
  return (
    <div className="card-padded">
      <div className={cn('mb-2 inline-flex h-9 w-9 items-center justify-center rounded-card-sm', toneClass)}><Icon className="h-5 w-5" /></div>
      <div className="text-2xl font-bold text-zinc-900">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
      {sub && <div className="mt-0.5 text-[11px] text-zinc-400">{sub}</div>}
    </div>
  );
}
