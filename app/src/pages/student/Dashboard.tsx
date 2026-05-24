import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, Award, BookOpen, Clock, GraduationCap, Activity, ChevronRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  fetchLessons, fetchBonus, fetchUserProgress, fetchProgressSummary, fetchMyQuizStatus, queryKeys,
} from '@/lib/queries';
import { formatSeconds, formatDuration, cn } from '@/lib/utils';

/**
 * StudentDashboard — Linear Tech direction (palette Aurel).
 *
 * Layout :
 *   - Hero card (orange-soft gradient) : salutation + reprise immédiate
 *   - KPI strip 4 cards : progression / quiz / temps / bonus
 *   - 2-col grid :
 *       L : "Continue ici" focus card + liste chapitres
 *       R : Dernier quiz (gradient) + progression certificat + activité
 *
 * SLOW-ISP HARDENING :
 *   - Rien ne bloque le render. Sections vides → skeletons inline.
 *   - Erreur réseau → bandeau amber rétractable, page utilisable quand même.
 */
export function StudentDashboard() {
  const { user, profile } = useAuth();
  const uid = user?.id ?? '';

  const lessonsQ  = useQuery({ queryKey: queryKeys.lessons,              queryFn: fetchLessons });
  const bonusQ    = useQuery({ queryKey: queryKeys.bonus,                queryFn: fetchBonus });
  const progQ     = useQuery({ queryKey: queryKeys.progress(uid),        queryFn: () => fetchUserProgress(uid), enabled: !!uid });
  const summaryQ  = useQuery({ queryKey: queryKeys.progressSummary(uid), queryFn: fetchProgressSummary,         enabled: !!uid });
  const quizQ     = useQuery({ queryKey: queryKeys.myQuizStatus(uid),    queryFn: fetchMyQuizStatus,            enabled: !!uid, staleTime: 60 * 1000 });

  const hasError = lessonsQ.isError || bonusQ.isError;

  const lessons = lessonsQ.data ?? [];
  const bonus   = bonusQ.data ?? [];
  const summary = summaryQ.data;
  const quizStatus = quizQ.data ?? [];

  // Compute quiz aggregates
  const quizPassed = quizStatus.filter((q) => q.passed).length;
  const quizTotal  = quizStatus.filter((q) => q.has_questions).length;

  // Last lesson the student watched (resume target).
  const lastLessonNumber = summary?.last_lesson_watched ?? null;
  const lastLesson = lastLessonNumber
    ? lessons.find((l) => l.lesson_number === lastLessonNumber)
    : null;
  // Fallback : if no last_lesson, propose the first published un-completed lesson.
  const fallbackNext = lessons.find((l) =>
    l.is_published && !!l.vdocipher_video_id
    && !(progQ.data ?? []).some((p) => p.lesson_id === l.id && p.completed),
  );
  const continueTarget = lastLesson ?? fallbackNext ?? null;
  const continueProgress = continueTarget
    ? (progQ.data ?? []).find((p) => p.lesson_id === continueTarget.id)
    : null;

  const completedLessons = summary?.completed_lessons ?? 0;
  const totalLessons     = summary?.total_lessons ?? lessons.length;
  const percent          = summary?.percentage_complete ?? 0;

  return (
    <div className="space-y-6">

      {/* Top breadcrumb */}
      <div className="flex items-center justify-between border-b border-zinc-200 pb-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">
          <span>Aurel Academy</span>
          <span className="mx-2 text-aurel-orange">/</span>
          <span>Espace étudiant</span>
          <span className="mx-2 text-aurel-orange">/</span>
          <span className="text-zinc-900">Accueil</span>
        </div>
        <div className="hidden md:block font-mono text-[11px] uppercase tracking-[0.1em] text-zinc-500">
          {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </div>
      </div>

      {/* Banner erreur (rétractable) */}
      {hasError && (
        <div className="rounded-card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-3">
            <span className="text-xl leading-none">⚠️</span>
            <div className="flex-1">
              <p className="font-semibold">Connexion lente détectée</p>
              <p className="mt-1 text-amber-800">
                Tu peux continuer normalement — certaines infos chargent en arrière-plan.
              </p>
              <button
                onClick={() => { lessonsQ.refetch(); bonusQ.refetch(); progQ.refetch(); summaryQ.refetch(); }}
                className="mt-3 rounded-card-sm bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700"
              >
                Réessayer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <section className="card-hero">
        <div className="relative">
          <div className="eyebrow-orange mb-3 inline-flex items-center gap-2 rounded-pill bg-aurel-orange/10 px-3 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-aurel-orange" />
            {continueTarget
              ? `Chapitre ${continueTarget.lesson_number} · En cours`
              : 'Bienvenue'}
          </div>
          <h1 className="text-display-sm md:text-display tracking-tight text-zinc-950 max-w-3xl">
            Bon retour, <span className="text-aurel-orange">{profile?.first_name ?? ''}</span>.
            {continueTarget && (
              <> Tu reprends à <span className="italic font-medium">{continueTarget.title}</span>.</>
            )}
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-zinc-600">
            {continueTarget
              ? `Encore quelques minutes sur cette leçon, puis ${continueTarget.lesson_number < totalLessons ? '5 questions pour valider et débloquer la suite.' : 'le quiz final.'}`
              : 'Démarre ton parcours Pflege — toutes les leçons sont prêtes pour toi.'}
          </p>
          {continueTarget && (
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to={`/lecons/${continueTarget.lesson_number}`} className="btn-primary btn-lg">
                {continueProgress?.watched_seconds && continueProgress.watched_seconds > 0
                  ? 'Reprendre la lecture'
                  : 'Commencer cette leçon'} <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/lecons" className="btn-outline btn-lg">
                Voir toutes les leçons
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* ── KPI STRIP ────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="kpi">
          <div className="kpi-label"><span className="kpi-dot" />Progression</div>
          <div className="kpi-value">
            {completedLessons}<span className="kpi-sub">/{totalLessons}</span>
          </div>
          <div className="kpi-delta">{percent}% du programme</div>
        </div>
        <div className="kpi">
          <div className="kpi-label"><span className="kpi-dot" style={{ background: '#0D7377' }} />Quiz validés</div>
          <div className="kpi-value">
            {quizPassed}<span className="kpi-sub">/{quizTotal || 17}</span>
          </div>
          <div className="kpi-delta">
            {quizTotal > 0
              ? `${Math.round((quizPassed / quizTotal) * 100)}% de réussite`
              : 'En attente du premier quiz'}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label"><span className="kpi-dot" style={{ background: '#16A34A' }} />Temps total</div>
          <div className="kpi-value">{formatSeconds(summary?.total_watched_seconds ?? 0)}</div>
          <div className="kpi-delta">depuis l'inscription</div>
        </div>
        <div className="kpi">
          <div className="kpi-label"><span className="kpi-dot" style={{ background: '#F59E0B' }} />Bonus</div>
          <div className="kpi-value">{bonus.filter((b) => b.is_published && b.file_url).length}<span className="kpi-sub">/{bonus.length || 7}</span></div>
          <div className="kpi-delta"><Link to="/bonus" className="hover:text-aurel-orange">Télécharger →</Link></div>
        </div>
      </section>

      {/* ── 2-COL GRID ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">

        {/* LEFT : continue + chapter list */}
        <div className="space-y-4">

          {/* Continue card */}
          {continueTarget ? (
            <section className="card p-5 md:p-7">
              <div className="mb-5 flex items-center justify-between">
                <div className="eyebrow-orange">◇ Reprendre ici</div>
                <div className="font-mono text-[11px] text-zinc-500">
                  {formatDuration(continueTarget.duration_minutes)} · 5 questions
                </div>
              </div>
              <h2 className="mb-1 text-[22px] md:text-[28px] font-semibold tracking-tight text-zinc-950 leading-[1.15]">
                {continueTarget.title}
              </h2>
              <p className="mb-5 text-zinc-600">{continueTarget.subtitle}</p>

              {/* Progress bar */}
              <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${continueProgress ? Math.min(100, Math.round((continueProgress.watched_seconds / Math.max(1, continueTarget.duration_minutes * 60)) * 100)) : 0}%`,
                    background: 'linear-gradient(90deg, #F97316, #EA580C)',
                  }}
                />
              </div>
              <div className="mb-6 flex items-center justify-between font-mono text-[11px] text-zinc-500">
                <span>
                  <span className="text-zinc-900 font-semibold tabular">
                    {continueProgress
                      ? Math.min(100, Math.round((continueProgress.watched_seconds / Math.max(1, continueTarget.duration_minutes * 60)) * 100))
                      : 0}%
                  </span> regardé
                </span>
                <span>
                  {continueProgress?.completed ? 'Leçon terminée' : 'En cours'}
                </span>
              </div>

              <Link to={`/lecons/${continueTarget.lesson_number}`} className="btn-primary">
                Reprendre la lecture <ArrowRight className="h-4 w-4" />
              </Link>

              {/* Next up indicator */}
              {(() => {
                const next = lessons.find((l) => l.lesson_number === continueTarget.lesson_number + 1);
                if (!next) return null;
                return (
                  <div className="mt-6 flex items-center justify-between border-t border-dashed border-zinc-200 pt-5">
                    <div className="flex items-center gap-3">
                      <div className="grid h-8 w-8 place-items-center rounded-card-sm bg-zinc-100 text-zinc-500">
                        <ChevronRight className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-zinc-900">
                          Ensuite — {next.title}
                        </div>
                        <div className="font-mono text-[11px] text-zinc-500">
                          CHAPITRE {String(next.lesson_number).padStart(2, '0')} · {formatDuration(next.duration_minutes)}
                        </div>
                      </div>
                    </div>
                    <span className="rounded-card-sm bg-zinc-100 px-2.5 py-1 font-mono text-[11px] text-zinc-600">
                      Verrouillé
                    </span>
                  </div>
                );
              })()}
            </section>
          ) : (
            // Empty state — toutes les leçons terminées
            <section className="card p-7 text-center">
              <Award className="mx-auto mb-3 h-10 w-10 text-aurel-orange" />
              <h2 className="text-display-sm tracking-tight">Toutes les leçons terminées !</h2>
              <p className="mt-2 text-zinc-600">Récupère ton certificat dès maintenant.</p>
              <Link to="/certificat" className="btn-primary mt-4 inline-flex">
                Voir mon certificat <ArrowRight className="h-4 w-4" />
              </Link>
            </section>
          )}

          {/* Chapters preview */}
          <section className="card p-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold tracking-tight">Tous les chapitres</h3>
              <Link to="/lecons" className="font-mono text-[11px] uppercase tracking-wider text-zinc-500 hover:text-aurel-orange">
                Voir tout →
              </Link>
            </div>
            <div className="space-y-0">
              {lessons.slice(0, 8).map((l) => {
                const p = (progQ.data ?? []).find((x) => x.lesson_id === l.id);
                const isCurrent = continueTarget?.id === l.id;
                const isDone = p?.completed === true;
                const minutes = formatDuration(l.duration_minutes);
                return (
                  <Link
                    key={l.id}
                    to={`/lecons/${l.lesson_number}`}
                    className={cn(
                      'flex items-center gap-3 rounded-card-sm px-3 py-2.5 -mx-3 transition-colors',
                      isCurrent ? 'bg-zinc-950 text-white' : 'hover:bg-zinc-50',
                    )}
                  >
                    <div className={cn(
                      'grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold flex-none',
                      isDone   ? 'bg-aurel-orange text-white'
                      : isCurrent ? 'bg-white text-zinc-950'
                      : 'border border-zinc-200',
                    )}>
                      {isDone ? '✓' : isCurrent ? '▶' : ''}
                    </div>
                    <span className={cn(
                      'font-mono text-[11px] w-7 flex-none',
                      isCurrent ? 'text-white/50' : 'text-zinc-400',
                    )}>
                      {String(l.lesson_number).padStart(2, '0')}
                    </span>
                    <span className={cn(
                      'flex-1 text-[13px] font-medium truncate',
                      isDone && !isCurrent && 'text-zinc-500 line-through',
                      isCurrent ? 'text-white' : 'text-zinc-900',
                    )}>
                      {l.title}
                    </span>
                    <span className={cn(
                      'rounded-card-sm px-2 py-0.5 font-mono text-[10px] flex-none',
                      isCurrent ? 'bg-white/15 text-white' : 'bg-zinc-100 text-zinc-500',
                    )}>
                      {minutes}
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>

        </div>

        {/* RIGHT : side panel */}
        <aside className="space-y-3">

          {/* Quiz result (dark gradient card) */}
          {quizPassed > 0 && (
            <section className="card-dark">
              <div className="relative">
                <div className="eyebrow text-aurel-orange-soft mb-3 inline-flex items-center gap-2">
                  <Activity className="h-3.5 w-3.5" /> Dernier quiz validé
                </div>
                <div className="text-[40px] font-semibold tracking-tight tabular leading-none">
                  {quizPassed}<span className="text-white/50 text-[24px]">/{quizTotal}</span>
                </div>
                <div className="mt-2 text-[12px] text-white/80">
                  {quizPassed === quizTotal
                    ? 'Tous les quiz validés — bravo.'
                    : `${quizTotal - quizPassed} quiz restant${quizTotal - quizPassed > 1 ? 's' : ''}.`}
                </div>
              </div>
            </section>
          )}

          {/* Certificate progress */}
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[13px] font-semibold tracking-tight flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-aurel-orange" />
                Certificat
              </div>
              <div className="font-mono text-[11px] text-zinc-500">{percent}%</div>
            </div>
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${percent}%`,
                  background: 'linear-gradient(90deg, #F97316, #0D7377)',
                }}
              />
            </div>
            <div className="mb-4 flex items-center justify-between text-[12px] text-zinc-600">
              <span>{completedLessons} / {totalLessons} chapitres</span>
              <span>{totalLessons - completedLessons} restants</span>
            </div>
            <Link
              to="/certificat"
              className="block w-full rounded-card-sm border border-zinc-200 bg-white px-3 py-2 text-center text-[13px] font-medium text-zinc-900 transition-colors hover:bg-zinc-50"
            >
              Voir mon certificat
            </Link>
          </section>

          {/* Bonus quick access */}
          <section className="card p-5">
            <div className="mb-3 text-[13px] font-semibold tracking-tight flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-aurel-teal" />
              Ressources bonus
            </div>
            <p className="mb-3 text-[12px] text-zinc-600">
              Glossaire 150 termes · 2 templates CV · 2 lettres de motivation · Guide Anerkennung · Méthode prospection.
            </p>
            <Link to="/bonus" className="font-mono text-[11px] uppercase tracking-wider text-aurel-teal hover:text-aurel-teal-dark">
              Télécharger les bonus →
            </Link>
          </section>

          {/* Activity (last completed lesson) */}
          {lastLesson && (
            <section className="card p-5">
              <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold tracking-tight">
                <span className="h-1.5 w-1.5 rounded-full bg-aurel-orange dot-pulse" />
                Activité récente
              </div>
              <div className="grid grid-cols-[24px_1fr] gap-2.5 text-[12px] text-zinc-600 leading-snug">
                <div className="grid h-6 w-6 place-items-center rounded-card-sm bg-aurel-orange-soft text-aurel-orange text-[11px]">
                  <Clock className="h-3 w-3" />
                </div>
                <div>
                  Tu as regardé <b className="text-zinc-900">{lastLesson.title}</b>.
                  <div className="mt-0.5 font-mono text-[10px] text-zinc-400 uppercase tracking-wider">
                    leçon {lastLesson.lesson_number}
                  </div>
                </div>
              </div>
            </section>
          )}

        </aside>
      </div>

    </div>
  );
}
