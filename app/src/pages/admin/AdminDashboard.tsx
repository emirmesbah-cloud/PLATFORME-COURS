import { useQuery } from '@tanstack/react-query';
import { Users, Activity, KeyRound, TrendingUp } from 'lucide-react';
import { fetchAdminStats, queryKeys } from '@/lib/queries';
import { Spinner } from '@/components/ui/Spinner';

export function AdminDashboard() {
  const { data, isLoading } = useQuery({ queryKey: queryKeys.adminStats, queryFn: fetchAdminStats });

  if (isLoading) return <Spinner label="Chargement des stats..." />;
  if (!data) return <div className="card-padded">Stats indisponibles.</div>;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-aurel-ink">Vue globale</h1>
        <p className="mt-1 text-slate-600">Indicateurs clés de la plateforme.</p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Users}     label="Étudiants inscrits" value={data.total_students} accent="orange" />
        <StatCard icon={Activity}  label="Actifs (7 jours)"   value={data.active_week}    accent="teal" />
        <StatCard
          icon={KeyRound}
          label="Codes générés"
          value={`${data.codes_used} / ${data.codes_total}`}
          sub={`${data.codes_available} disponibles`}
          accent="orange"
        />
        <StatCard
          icon={TrendingUp}
          label="Complétion moyenne"
          value={`${data.avg_completion}%`}
          accent="teal"
        />
      </div>

      <div className="card-padded">
        <h2 className="mb-3 text-lg font-bold text-aurel-ink">Prochaines étapes</h2>
        <ul className="ml-5 list-disc space-y-1 text-sm text-slate-600">
          <li>Génère des codes dans <span className="font-semibold">/admin/codes</span> et envoie-les par WhatsApp à tes nouveaux clients.</li>
          <li>Renseigne les <span className="font-semibold">vdocipher_video_id</span> dans <span className="font-semibold">/admin/lessons</span> au fur et à mesure que tu enregistres.</li>
          <li>Upload les fichiers DOCX bonus dans <span className="font-semibold">/admin/bonus</span> pour qu'ils soient téléchargeables par les étudiants.</li>
          <li>Suis ton activité : étudiants connectés, leçons en cours, codes utilisés.</li>
        </ul>
      </div>
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
