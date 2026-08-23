import { useQuery } from '@tanstack/react-query';
import { Filter, RefreshCw, Wallet, TrendingDown, ArrowDown } from 'lucide-react';
import { fetchFunnelOverview, queryKeys } from '@/lib/queries';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';
import type { FunnelOverview } from '@/lib/types';

function formatDA(value: number): string {
  return `${Math.round(Number(value) || 0).toLocaleString('fr-FR')} DA`;
}
function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

const STAGE_COLOR: Record<string, string> = {
  registered: 'bg-aurel-orange',
  attended: 'bg-aurel-orange',
  called: 'bg-amber-500',
  confirmed: 'bg-aurel-teal',
  shipped: 'bg-aurel-teal',
  delivered: 'bg-green-500',
};

export function AdminFunnelOverview() {
  const q = useQuery({ queryKey: queryKeys.adminFunnelOverview, queryFn: fetchFunnelOverview });
  const d = q.data;

  const stages: { key: keyof FunnelOverview; label: string; hint: string }[] = [
    { key: 'registered', label: 'Inscrits', hint: 'Formulaires reçus' },
    { key: 'attended', label: 'Prêts à payer', hint: 'ont répondu « oui »' },
    { key: 'called', label: 'Appelés', hint: 'Contactés au moins 1 fois' },
    { key: 'confirmed', label: 'Confirmés', hint: 'Devenus une commande' },
    { key: 'shipped', label: 'Expédiés', hint: 'Colis créé chez E-com' },
    { key: 'delivered', label: 'Livrés', hint: 'Livrés & encaissés' },
  ];

  const total = d?.registered ?? 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-aurel-orange">
            <Filter className="h-5 w-5" />
            <span className="text-sm font-semibold uppercase tracking-wide">Vue d'ensemble</span>
          </div>
          <h1 className="text-3xl font-bold text-aurel-ink">Tunnel complet</h1>
          <p className="mt-1 max-w-3xl text-slate-600">
            De l'inscription à la livraison encaissée — repère en un coup d'œil où tu perds des prospects.
          </p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={cn('h-4 w-4', q.isFetching && 'animate-spin')} /> Actualiser
        </button>
      </header>

      {q.isLoading ? <Spinner label="Chargement du tunnel…" />
        : q.isError || !d ? <div className="card-padded text-center text-red-600">Impossible de charger le tunnel. Vérifie que la migration est appliquée, puis réessaie.</div>
        : (
          <>
            {/* Money + quality tiles */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label="Revenu confirmé" value={formatDA(d.cod_confirmed)} icon={Wallet} tone="teal" />
              <Tile label="Revenu livré (encaissé)" value={formatDA(d.cod_delivered)} icon={Wallet} tone="green" />
              <Tile label="Taux de confirmation" value={`${pct(d.confirmed, d.registered)}%`} sub="confirmés / inscrits" tone="teal" />
              <Tile label="Taux de retour" value={`${pct(d.returned, d.confirmed)}%`} sub={`${d.returned} retour(s) / confirmés`} icon={TrendingDown} tone="red" />
            </div>

            {/* Funnel */}
            <section className="card-padded space-y-4">
              <h2 className="text-lg font-bold text-aurel-ink">Étapes du tunnel</h2>
              <div className="space-y-1">
                {stages.map((stage, i) => {
                  const n = Number(d[stage.key] ?? 0);
                  const prev = i === 0 ? n : Number(d[stages[i - 1].key] ?? 0);
                  const pctTotal = pct(n, total);
                  const step = i === 0 ? 100 : pct(n, prev);
                  const dropped = i === 0 ? 0 : Math.max(0, prev - n);
                  return (
                    <div key={stage.key}>
                      {i > 0 && (
                        <div className="flex items-center gap-2 py-1 pl-1 text-xs text-zinc-400">
                          <ArrowDown className="h-3 w-3" />
                          <span className={cn('font-medium', step < 50 ? 'text-red-500' : step < 75 ? 'text-amber-600' : 'text-green-600')}>
                            {step}%
                          </span>
                          <span>passent à l'étape suivante</span>
                          {dropped > 0 && <span className="text-zinc-400">· {dropped} perdu(s)</span>}
                        </div>
                      )}
                      <div className="rounded-lg border border-zinc-100 p-3">
                        <div className="mb-1.5 flex items-baseline justify-between gap-3">
                          <div>
                            <span className="text-sm font-semibold text-zinc-900">{stage.label}</span>
                            <span className="ml-2 text-xs text-zinc-400">{stage.hint}</span>
                          </div>
                          <div className="flex items-baseline gap-2">
                            <span className="text-lg font-bold tabular-nums text-zinc-900">{n.toLocaleString('fr-FR')}</span>
                            <span className="w-12 text-right text-xs tabular-nums text-zinc-500">{pctTotal}%</span>
                          </div>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-100">
                          <div className={cn('h-full rounded-full transition-all', STAGE_COLOR[stage.key])} style={{ width: `${Math.max(pctTotal, n > 0 ? 2 : 0)}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-zinc-400">Les pourcentages à droite sont rapportés au total d'inscrits. Entre deux étapes : le taux de passage (et les prospects perdus).</p>
            </section>
          </>
        )}
    </div>
  );
}

function Tile({ label, value, sub, icon: Icon, tone }: { label: string; value: string; sub?: string; icon?: typeof Wallet; tone: 'teal' | 'green' | 'red' }) {
  const toneClass = tone === 'green' ? 'bg-green-50 text-green-600' : tone === 'red' ? 'bg-red-50 text-red-600' : 'bg-aurel-teal-soft text-aurel-teal-dark';
  return (
    <div className="card-padded">
      {Icon && <div className={cn('mb-2 inline-flex h-9 w-9 items-center justify-center rounded-card-sm', toneClass)}><Icon className="h-5 w-5" /></div>}
      <div className="text-2xl font-bold text-zinc-900">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
      {sub && <div className="mt-0.5 text-[11px] text-zinc-400">{sub}</div>}
    </div>
  );
}
