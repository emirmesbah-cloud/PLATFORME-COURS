import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { TrendingUp, Clock, BookOpen, Gift, ArrowRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  fetchLessons, fetchBonus, fetchUserProgress, fetchProgressSummary, queryKeys,
} from '@/lib/queries';
import { LessonCard } from '@/components/features/LessonCard';
import { BonusCard } from '@/components/features/BonusCard';
import { ProgressBar } from '@/components/ui/Progress';
import { tierLabel, formatSeconds, formatDuration } from '@/lib/utils';

export function StudentDashboard() {
  const { user, profile } = useAuth();
  const uid = user?.id ?? '';

  const lessonsQ  = useQuery({ queryKey: queryKeys.lessons,            queryFn: fetchLessons });
  const bonusQ    = useQuery({ queryKey: queryKeys.bonus,              queryFn: fetchBonus });
  const progQ     = useQuery({ queryKey: queryKeys.progress(uid),      queryFn: () => fetchUserProgress(uid), enabled: !!uid });
  const summaryQ  = useQuery({ queryKey: queryKeys.progressSummary(uid), queryFn: fetchProgressSummary,         enabled: !!uid });

  // SLOW-ISP HARDENING : on ne bloque le render QUE pendant un fetch initial.
  // Si fetchLessons OU fetchBonus erreur (timeout 10s), on render quand même
  // avec un état vide + un message de retry. Avant : spinner infini "Chargement
  // de ton espace..." sur ISP lent → user croit que l'app est cassée.
  // SHERLOCK : on ne bloque PLUS le render avec un spinner full-page.
  // Avant : "Chargement de ton espace..." prenait la page entière pour 5-15s
  // sur ISP lent, le user pensait que l'app était cassée. Maintenant : le
  // dashboard render immédiatement avec ses sections, chaque section gère
  // son propre état loading via la donnée vide.
  const hasError = lessonsQ.isError || bonusQ.isError;

  const lessons = lessonsQ.data ?? [];
  const bonus   = bonusQ.data ?? [];
  const progressByLesson = new Map((progQ.data ?? []).map((p) => [p.lesson_id, p]));

  const summary = summaryQ.data;
  const lastLessonNumber = summary?.last_lesson_watched ?? null;
  const lastLesson = lastLessonNumber ? lessons.find((l) => l.lesson_number === lastLessonNumber) : null;

  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wider text-aurel-orange">
          Tier : {profile && tierLabel(profile.tier)}
        </p>
        <h1 className="mt-1 text-3xl font-bold text-aurel-ink md:text-4xl">
          Bienvenue, <span className="font-serif italic text-aurel-orange-dark">{profile?.first_name}</span>
        </h1>
        <p className="mt-1 text-slate-600">Continue ton apprentissage là où tu t'es arrêté·e.</p>
      </header>

      {/* Banner d'erreur réseau — affiché si une query critique a timeout/échoué */}
      {hasError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-3">
            <span className="text-xl leading-none">⚠️</span>
            <div className="flex-1">
              <p className="font-semibold">Connexion lente détectée</p>
              <p className="mt-1 text-amber-800">
                On n'a pas pu charger toutes tes données (réseau lent ou instable).
                L'app reste utilisable, mais certaines infos peuvent manquer.
              </p>
              <button
                onClick={() => { lessonsQ.refetch(); bonusQ.refetch(); progQ.refetch(); summaryQ.refetch(); }}
                className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700"
              >
                Réessayer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Progression globale */}
      <section className="card-padded">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-aurel-ink">Ta progression</h2>
            <p className="text-sm text-slate-500">Vers ta certification Pflege</p>
          </div>
          <div className="flex items-center gap-2 text-3xl font-bold text-aurel-orange">
            {summary?.percentage_complete ?? 0}<span className="text-base text-slate-400">%</span>
          </div>
        </div>
        <ProgressBar value={summary?.percentage_complete ?? 0} color="orange" className="h-3" />
        <div className="mt-4 grid grid-cols-1 gap-4 text-sm md:grid-cols-3">
          <Stat icon={BookOpen} label="Leçons terminées" value={`${summary?.completed_lessons ?? 0} / ${summary?.total_lessons ?? lessons.length}`} />
          <Stat icon={Clock}    label="Temps de cours visionné" value={formatSeconds(summary?.total_watched_seconds ?? 0)} />
          <Stat icon={TrendingUp} label="Bonus disponibles" value={`${bonus.filter(b => b.is_published).length} / ${bonus.length || 7}`} />
        </div>
      </section>

      {/* Reprendre où tu t'es arrêté */}
      {lastLesson && (
        <section className="card overflow-hidden">
          <div className="flex flex-col items-start gap-4 p-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-aurel-teal">Continue où tu t'es arrêté·e</p>
              <h3 className="text-xl font-bold text-aurel-ink">Leçon {lastLesson.lesson_number} · {lastLesson.title}</h3>
              <p className="mt-1 text-sm text-slate-500">{lastLesson.subtitle} · {formatDuration(lastLesson.duration_minutes)}</p>
            </div>
            <Link to={`/lecons/${lastLesson.lesson_number}`} className="btn-primary btn-lg">
              Reprendre <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      )}

      {/* SHERLOCK R14 — L2 : count dynamique au lieu de "18" hardcoded.
          Quand on publishera la leçon 19 ou qu'on dépubliera une leçon
          temporairement, le header reflète la réalité. */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-aurel-ink">Tes {lessons.length} leçons</h2>
          <Link to="/lecons" className="text-sm font-medium text-aurel-teal hover:underline">Tout voir →</Link>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lessons.slice(0, 6).map((l) => (
            <LessonCard key={l.id} lesson={l} progress={progressByLesson.get(l.id)} />
          ))}
        </div>
      </section>

      {/* 7 bonus */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Gift className="h-5 w-5 text-aurel-orange" />
          <h2 className="text-xl font-bold text-aurel-ink">Tes 7 ressources bonus</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {bonus.map((b) => <BonusCard key={b.id} bonus={b} />)}
        </div>
      </section>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-4">
      <Icon className="h-5 w-5 text-aurel-orange" />
      <div>
        <div className="text-xs text-slate-500">{label}</div>
        <div className="font-bold text-aurel-ink">{value}</div>
      </div>
    </div>
  );
}
