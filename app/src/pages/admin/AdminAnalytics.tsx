import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Cell,
} from 'recharts';
import { TrendingUp, Users, Clock, CheckCircle2, Star, Activity } from 'lucide-react';
import { fetchAdvancedAnalytics, queryKeys } from '@/lib/queries';
import { Spinner } from '@/components/ui/Spinner';
import { initials, formatSeconds, tierLabel } from '@/lib/utils';

const ORANGE = '#F97316';
const TEAL   = '#0D7377';
const GREEN  = '#10B981';
const SLATE  = '#94A3B8';

export function AdminAnalytics() {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.adminAnalytics,
    queryFn: fetchAdvancedAnalytics,
  });

  if (isLoading) return <Spinner label="Calcul des analytics..." />;
  if (error || !data) return <div className="card-padded">Stats indisponibles.</div>;

  // Aggregate acquisition by day across tiers for line chart
  const acquisitionByDay = aggByDay(data.acquisition ?? []);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-aurel-ink">Analytics avancées</h1>
        <p className="mt-1 text-slate-600">Vue détaillée de l'engagement, du funnel et de la satisfaction.</p>
      </header>

      {/* SECTION 1 — Engagement KPIs */}
      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-aurel-orange">Engagement</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPI icon={Users}       label="Activation rate" value={`${data.engagement.activation_rate ?? 0}%`} sub={`${data.engagement.codes_used}/${data.engagement.total_codes} codes`} />
          <KPI icon={CheckCircle2} label="Taux de complétion" value={`${data.engagement.completion_rate ?? 0}%`} sub="étudiants ayant fini" />
          <KPI icon={Clock}       label="Temps moyen jusqu'à complétion" value={`${data.engagement.avg_completion_days ?? 0} jours`} />
          <KPI icon={Activity}    label="Actifs (30 jours)" value={data.engagement.active_last_30d.toString()} />
        </div>
      </section>

      {/* SECTION 2 — Acquisition (line chart) */}
      <section className="card-padded">
        <h2 className="mb-1 text-lg font-bold text-aurel-ink">Inscriptions (30 derniers jours)</h2>
        <p className="mb-4 text-xs text-slate-500">Nouveaux comptes activés par jour, split par formule.</p>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={acquisitionByDay}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="day" stroke={SLATE} fontSize={11} />
            <YAxis stroke={SLATE} fontSize={11} allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="autonome"   stroke={ORANGE} strokeWidth={2} name="Autonome" dot={{ r: 3 }} />
            <Line type="monotone" dataKey="accompagne" stroke={TEAL}   strokeWidth={2} name="Accompagné" dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* SECTION 3 — Daily watched minutes */}
      <section className="card-padded">
        <h2 className="mb-1 text-lg font-bold text-aurel-ink">Minutes visionnées par jour</h2>
        <p className="mb-4 text-xs text-slate-500">Total cumulé d'études quotidiennes (toutes leçons confondues).</p>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data.daily_minutes ?? []}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="day" stroke={SLATE} fontSize={11} />
            <YAxis stroke={SLATE} fontSize={11} />
            <Tooltip />
            <Area type="monotone" dataKey="minutes" stroke={ORANGE} fill={ORANGE} fillOpacity={0.2} />
          </AreaChart>
        </ResponsiveContainer>
      </section>

      {/* SECTION 4 — Funnel par leçon */}
      <section className="card-padded">
        <h2 className="mb-1 text-lg font-bold text-aurel-ink">Funnel de complétion par leçon</h2>
        <p className="mb-4 text-xs text-slate-500">Nombre d'étudiants ayant commencé vs terminé chaque leçon — identifie les abandons.</p>
        <ResponsiveContainer width="100%" height={Math.max(280, ((data.funnel?.length ?? 0) * 22))}>
          <BarChart data={data.funnel ?? []} layout="vertical" margin={{ left: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis type="number" stroke={SLATE} fontSize={11} allowDecimals={false} />
            <YAxis type="category" dataKey="lesson_number" stroke={SLATE} fontSize={11} width={40}
              tickFormatter={(n) => `Leçon ${n}`} />
            <Tooltip />
            <Legend />
            <Bar dataKey="started"   name="Commencée" fill={SLATE} />
            <Bar dataKey="completed" name="Terminée"  fill={ORANGE} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* SECTION 5 — Feedback */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card-padded">
          <h2 className="mb-1 text-lg font-bold text-aurel-ink">Distribution des notes</h2>
          <p className="mb-4 text-xs text-slate-500">Avis approuvés uniquement.</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.feedback_dist ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="rating" stroke={SLATE} fontSize={11} tickFormatter={(r) => `${r}★`} />
              <YAxis stroke={SLATE} fontSize={11} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="n" name="Avis">
                {(data.feedback_dist ?? []).map((d, i) => (
                  <Cell key={i} fill={d.rating >= 4 ? GREEN : d.rating >= 3 ? ORANGE : '#EF4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card-padded">
          <div className="mb-1 flex items-center gap-2">
            <Star className="h-5 w-5 text-aurel-orange" />
            <h2 className="text-lg font-bold text-aurel-ink">Net Promoter Score</h2>
          </div>
          <p className="mb-4 text-xs text-slate-500">% d'étudiants qui recommandent Aurel Academy.</p>
          <div className="flex h-[200px] flex-col items-center justify-center gap-2">
            <div className="text-6xl font-bold text-aurel-orange">{data.nps.percent ?? 0}%</div>
            <p className="text-sm text-slate-500">{data.nps.recommend} sur {data.nps.total} avis</p>
          </div>
        </div>
      </section>

      {/* SECTION 6 — Top performers */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="border-b border-slate-200 p-5">
            <div className="flex items-center gap-2 text-aurel-orange">
              <TrendingUp className="h-5 w-5" />
              <span className="text-xs font-bold uppercase tracking-wide">Top 10 engagés</span>
            </div>
            <h2 className="mt-1 text-lg font-bold text-aurel-ink">Plus de minutes visionnées</h2>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {(data.top_engaged ?? []).map((s, i) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="w-10 px-4 py-3 font-mono text-xs text-slate-400">#{i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-aurel-teal text-xs font-bold text-white">
                        {initials(s.first_name, s.last_name)}
                      </div>
                      <div>
                        <div className="font-semibold text-aurel-ink">{s.first_name} {s.last_name}</div>
                        <div className="text-xs text-slate-400">{tierLabel(s.tier)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-aurel-orange">
                    {formatSeconds(s.total_seconds || 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(data.top_engaged ?? []).length === 0 && <div className="p-5 text-center text-slate-400 text-sm">Aucun étudiant pour l'instant.</div>}
        </div>

        <div className="card overflow-hidden">
          <div className="border-b border-slate-200 p-5">
            <div className="flex items-center gap-2 text-aurel-teal">
              <Clock className="h-5 w-5" />
              <span className="text-xs font-bold uppercase tracking-wide">Top 10 rapides</span>
            </div>
            <h2 className="mt-1 text-lg font-bold text-aurel-ink">Complétion la plus rapide</h2>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {(data.top_fast ?? []).map((s, i) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="w-10 px-4 py-3 font-mono text-xs text-slate-400">#{i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-aurel-teal text-xs font-bold text-white">
                        {initials(s.first_name, s.last_name)}
                      </div>
                      <div>
                        <div className="font-semibold text-aurel-ink">{s.first_name} {s.last_name}</div>
                        <div className="text-xs text-slate-400">{tierLabel(s.tier)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-aurel-teal">
                    {(s.days_to_complete || 0).toFixed(0)} jours
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(data.top_fast ?? []).length === 0 && <div className="p-5 text-center text-slate-400 text-sm">Aucun étudiant n'a encore complété.</div>}
        </div>
      </section>
    </div>
  );
}

function KPI({ icon: Icon, label, value, sub }: {
  icon: typeof Users; label: string; value: string; sub?: string;
}) {
  return (
    <div className="card-padded">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <Icon className="h-5 w-5 text-aurel-orange" />
      </div>
      <div className="text-2xl font-bold text-aurel-ink">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

// Aggregate {day, tier, count} → {day, autonome, accompagne}
function aggByDay(rows: { day: string; tier: string; new_students: number }[]) {
  const m = new Map<string, { day: string; autonome: number; accompagne: number }>();
  rows.forEach((r) => {
    const k = r.day;
    const cur = m.get(k) ?? { day: k, autonome: 0, accompagne: 0 };
    if (r.tier === 'autonome')   cur.autonome += r.new_students;
    if (r.tier === 'accompagne') cur.accompagne += r.new_students;
    m.set(k, cur);
  });
  return Array.from(m.values()).sort((a, b) => a.day.localeCompare(b.day));
}
