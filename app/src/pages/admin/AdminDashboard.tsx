import { useQuery } from '@tanstack/react-query';
import { Users, Activity, KeyRound, TrendingUp } from 'lucide-react';
import { fetchAdminStats, queryKeys } from '@/lib/queries';

export function AdminDashboard() {
  const statsQ = useQuery({ queryKey: queryKeys.adminStats, queryFn: fetchAdminStats });

  // SHERLOCK : on ne bloque PLUS le render avec un spinner full-page.
  // Avant : `if (statsQ.isLoading) return <Spinner />` masquait tout le
  // dashboard pendant 5-15s sur ISP lent. Maintenant : le shell + les
  // 4 stat cards s'affichent immédiatement (avec — en placeholder), et
  // les vrais chiffres remplacent dès que le RPC répond.
  const data = statsQ.data;
  const ph = (val: string | number | null | undefined) =>
    statsQ.isLoading && val === undefined ? '—' : (val ?? '—');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-aurel-ink">Vue globale</h1>
        <p className="mt-1 text-slate-600">Indicateurs clés de la plateforme.</p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Users}
          label="Étudiants inscrits"
          value={ph(data?.total_students)}
          accent="orange"
        />
        <StatCard
          icon={Activity}
          label="Actifs (7 jours)"
          value={ph(data?.active_week)}
          accent="teal"
        />
        <StatCard
          icon={KeyRound}
          label="Codes générés"
          value={data ? `${data.codes_used} / ${data.codes_total}` : '—'}
          sub={data ? `${data.codes_available} disponibles` : undefined}
          accent="orange"
        />
        <StatCard
          icon={TrendingUp}
          label="Complétion moyenne"
          value={data ? `${data.avg_completion}%` : '—'}
          accent="teal"
        />
      </div>

      {statsQ.isError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Les stats n'ont pas pu charger (réseau lent). Recharge la page pour réessayer.
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, accent }: {
  icon: typeof Users; label: string; value: string | number; sub?: string;
  accent: 'orange' | 'teal';
}) {
  const colors = accent === 'orange' ? 'bg-aurel-orange-soft text-aurel-orange-dark' : 'bg-teal-50 text-aurel-teal';
  return (
    <div className="card-padded">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${colors}`}><Icon className="h-5 w-5" /></div>
      </div>
      <div className="text-3xl font-bold text-aurel-ink">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
