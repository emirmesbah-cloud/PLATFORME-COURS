import { useQuery } from '@tanstack/react-query';
import { Users, Activity, KeyRound, TrendingUp, CheckCircle2, Circle } from 'lucide-react';
import { fetchAdminStats, fetchLessons, fetchBonus, queryKeys } from '@/lib/queries';
import { Spinner } from '@/components/ui/Spinner';

export function AdminDashboard() {
  const statsQ   = useQuery({ queryKey: queryKeys.adminStats, queryFn: fetchAdminStats });
  const lessonsQ = useQuery({ queryKey: queryKeys.lessons,    queryFn: fetchLessons });
  const bonusQ   = useQuery({ queryKey: queryKeys.bonus,      queryFn: fetchBonus });

  if (statsQ.isLoading) return <Spinner label="Chargement des stats..." />;
  if (!statsQ.data) return <div className="card-padded">Stats indisponibles.</div>;
  const data = statsQ.data;

  // Compute checklist state dynamically. Each step is "done" when the
  // corresponding data exists in the DB. The whole section auto-hides once
  // all 4 steps are complete.
  const lessons = lessonsQ.data ?? [];
  const bonus   = bonusQ.data ?? [];

  const lessonsWithVideo  = lessons.filter((l) => !!l.vdocipher_video_id).length;
  const lessonsTotal      = lessons.length;
  const bonusWithFile     = bonus.filter((b) => !!b.file_url).length;
  const bonusTotal        = bonus.length;
  const hasCodes          = data.codes_total > 0;
  const hasStudents       = data.total_students > 0;

  const steps = [
    {
      done: hasCodes,
      label: hasCodes
        ? <>Codes générés ({data.codes_total}) — continue à en créer dans <span className="font-semibold">/admin/codes</span> pour tes nouveaux clients.</>
        : <>Génère des codes dans <span className="font-semibold">/admin/codes</span> et envoie-les par WhatsApp à tes nouveaux clients.</>,
    },
    {
      done: lessonsTotal > 0 && lessonsWithVideo === lessonsTotal,
      label: lessonsTotal === 0
        ? <>Aucune leçon dans la DB.</>
        : lessonsWithVideo === lessonsTotal
        ? <>Toutes les vidéos VDOCipher sont liées ({lessonsWithVideo}/{lessonsTotal}).</>
        : <>{lessonsWithVideo}/{lessonsTotal} leçons ont une vidéo VDOCipher. Complète les autres dans <span className="font-semibold">/admin/lessons</span>.</>,
    },
    {
      done: bonusTotal > 0 && bonusWithFile === bonusTotal,
      label: bonusTotal === 0
        ? <>Aucun bonus dans la DB.</>
        : bonusWithFile === bonusTotal
        ? <>Tous les bonus DOCX sont uploadés ({bonusWithFile}/{bonusTotal}).</>
        : <>{bonusWithFile}/{bonusTotal} bonus uploadés. Upload les restants dans <span className="font-semibold">/admin/bonus</span>.</>,
    },
    {
      done: hasStudents,
      label: hasStudents
        ? <>Tu as déjà des étudiants inscrits ({data.total_students}). Suis leur activité dans <span className="font-semibold">/admin/students</span>.</>
        : <>Aucun étudiant inscrit. Une fois que des codes seront utilisés, ils apparaîtront dans <span className="font-semibold">/admin/students</span>.</>,
    },
  ];

  const allDone = steps.every((s) => s.done);

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

      {/* Dynamic checklist : hides entirely when all 4 steps are done. */}
      {!allDone && (
        <div className="card-padded">
          <h2 className="mb-3 text-lg font-bold text-aurel-ink">Prochaines étapes</h2>
          <ul className="space-y-2 text-sm">
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2">
                {step.done ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                )}
                <span className={step.done ? 'text-slate-400 line-through' : 'text-slate-700'}>
                  {step.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {allDone && (
        <div className="card-padded flex items-center gap-3 border-green-200 bg-green-50 text-sm text-green-800">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          <span>Plateforme entièrement configurée. Tu peux maintenant te concentrer sur l'acquisition et le suivi des étudiants.</span>
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
