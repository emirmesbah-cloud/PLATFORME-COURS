import { Link } from 'react-router-dom';
import { Play, CheckCircle2, Clock, Lock, Trophy } from 'lucide-react';
import { cn, formatDuration } from '@/lib/utils';
import type { Lesson, LessonProgress, QuizLessonStatus } from '@/lib/types';
import { ProgressBar } from '@/components/ui/Progress';

const PHASE_COLOR: Record<string, string> = {
  INTRODUCTION:  'badge-slate',
  'MARCHÉ':      'badge-orange',
  VOCABULAIRE:   'badge-teal',
  COMMUNICATION: 'badge-orange',
  DOCUMENTATION: 'badge-teal',
  PATIENTS:      'badge-orange',
  ENTRETIEN:     'badge-teal',
  ANERKENNUNG:   'badge-orange',
  CONCLUSION:    'badge-green',
};

/**
 * LessonCard — carte cliquable d'une leçon dans la liste.
 *
 * Verrouillage : si `locked` est true (calculé par la page parent à partir
 * du quiz_status), on rend un <div> non-cliquable au lieu d'un <Link>.
 * Le student voit alors un message "Termine le quiz de la leçon précédente".
 *
 * Note : `locked` ici ≠ `lessonNotPublished` (= leçon pas encore prête côté
 * admin). On garde les deux notions distinctes pour qu'un admin puisse
 * facilement diagnostiquer.
 */
export function LessonCard({ lesson, progress, quizStatus, locked }: {
  lesson: Lesson;
  progress?: LessonProgress;
  quizStatus?: QuizLessonStatus;
  locked?: boolean;
}) {
  // SHERLOCK R14 — H8 : guard divide-by-zero (cf historique du fichier)
  const totalSec = Math.max(1, lesson.duration_minutes * 60);
  const watchedSec = progress?.watched_seconds ?? 0;
  const completed = progress?.completed ?? false;
  const pct = Math.min(100, Math.round((watchedSec / totalSec) * 100));
  const inProgress = !completed && watchedSec > 0;
  const lessonNotPublished = !lesson.is_published || !lesson.vdocipher_video_id;

  // "Commencer ici" badge sur leçon 1 (disclaimer).
  const isFirstLesson = lesson.lesson_number === 1;

  // Quiz validé visuellement.
  const quizPassed = quizStatus?.has_questions && quizStatus.passed;

  // Verrouillage progressif quiz : on n'expose même pas la route, le student
  // doit valider la précédente d'abord.
  if (locked && !lessonNotPublished) {
    return (
      <div className="card opacity-60 cursor-not-allowed">
        <div className="flex items-center justify-between p-4">
          <span className={cn('badge', PHASE_COLOR[lesson.phase] ?? 'badge-slate')}>
            {lesson.phase}
          </span>
          <span className="text-xs font-mono text-slate-400">#{String(lesson.lesson_number).padStart(2, '0')}</span>
        </div>
        <div className="px-4 pb-4">
          <h3 className="mb-1 line-clamp-2 text-base font-semibold text-slate-500">
            {lesson.title}
          </h3>
          <p className="mb-3 line-clamp-2 text-sm text-slate-400">{lesson.subtitle}</p>
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <Lock className="h-3.5 w-3.5 flex-none" />
            <span>Termine le quiz de la leçon précédente pour débloquer celle-ci.</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Link
      to={`/lecons/${lesson.lesson_number}`}
      className={cn(
        'group relative block card transition hover:border-aurel-orange hover:shadow-md',
        isFirstLesson && 'border-aurel-orange ring-1 ring-aurel-orange/30',
        lessonNotPublished && 'opacity-70'
      )}
    >
      {isFirstLesson && (
        <span className="absolute -top-2 left-3 rounded-full bg-aurel-orange px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-md">
          ⭐ Commencer ici
        </span>
      )}
      {quizPassed && (
        <span className="absolute -top-2 right-3 inline-flex items-center gap-1 rounded-full bg-aurel-teal px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-md">
          <Trophy className="h-3 w-3" /> Quiz validé
        </span>
      )}
      <div className="flex items-center justify-between p-4">
        <span className={cn('badge', PHASE_COLOR[lesson.phase] ?? 'badge-slate')}>
          {lesson.phase}
        </span>
        <span className="text-xs font-mono text-slate-400">#{String(lesson.lesson_number).padStart(2, '0')}</span>
      </div>
      <div className="px-4 pb-4">
        <h3 className="mb-1 line-clamp-2 text-base font-semibold text-aurel-ink group-hover:text-aurel-orange-dark">
          {lesson.title}
        </h3>
        <p className="mb-3 line-clamp-2 text-sm text-slate-500">{lesson.subtitle}</p>

        <div className="mb-3 flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {formatDuration(lesson.duration_minutes)}</span>
          {completed && <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="h-3.5 w-3.5" /> Terminé</span>}
          {inProgress && <span className="text-aurel-orange-dark">En cours</span>}
          {lessonNotPublished && <span className="flex items-center gap-1 text-slate-400"><Lock className="h-3.5 w-3.5" /> Bientôt</span>}
          {quizStatus?.has_questions && !quizStatus.passed && quizStatus.attempts > 0 && (
            <span className="text-amber-600">
              Quiz : {quizStatus.best_score}/{quizStatus.total}
            </span>
          )}
        </div>

        <ProgressBar value={pct} color={completed ? 'green' : 'orange'} />

        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="text-slate-500">{pct}%</span>
          <span className="flex items-center gap-1 font-medium text-aurel-orange-dark group-hover:underline">
            <Play className="h-3.5 w-3.5" /> {inProgress ? 'Reprendre' : completed ? 'Revoir' : 'Commencer'}
          </span>
        </div>
      </div>
    </Link>
  );
}
