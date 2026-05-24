import { Link } from 'react-router-dom';
import { Play, CheckCircle2, Clock, Lock, Trophy, Sparkles } from 'lucide-react';
import { cn, formatDuration } from '@/lib/utils';
import type { Lesson, LessonProgress, QuizLessonStatus } from '@/lib/types';

/**
 * LessonCard — Linear Tech direction (palette Aurel).
 *
 * Card states :
 *  - locked (sequential lock) : non-cliquable, message d'invitation au quiz précédent
 *  - lesson not published     : opacité réduite, badge "Bientôt"
 *  - first lesson (disclaimer): badge "Commencer ici"
 *  - quiz passed              : badge teal "Quiz validé"
 *
 * Plays well with both the dashboard preview (6 cards) and the full /lecons list.
 */
const PHASE_DOT: Record<string, string> = {
  INTRODUCTION:  '#A1A1AA',
  'MARCHÉ':      '#F97316',
  VOCABULAIRE:   '#0D7377',
  COMMUNICATION: '#F97316',
  DOCUMENTATION: '#0D7377',
  PATIENTS:      '#F97316',
  ENTRETIEN:     '#0D7377',
  ANERKENNUNG:   '#F97316',
  CONCLUSION:    '#16A34A',
};

export function LessonCard({ lesson, progress, quizStatus, locked }: {
  lesson: Lesson;
  progress?: LessonProgress;
  quizStatus?: QuizLessonStatus;
  locked?: boolean;
}) {
  const totalSec = Math.max(1, lesson.duration_minutes * 60);
  const watchedSec = progress?.watched_seconds ?? 0;
  const completed = progress?.completed ?? false;
  const pct = Math.min(100, Math.round((watchedSec / totalSec) * 100));
  const inProgress = !completed && watchedSec > 0;
  const lessonNotPublished = !lesson.is_published || !lesson.vdocipher_video_id;

  const isFirstLesson = lesson.lesson_number === 1;
  const quizPassed = !!(quizStatus?.has_questions && quizStatus.passed);
  const dotColor = PHASE_DOT[lesson.phase] ?? '#A1A1AA';

  // ── LOCKED state ──────────────────────────────────────────
  // Quiz précédent pas validé → on n'expose pas la route, on explique.
  if (locked && !lessonNotPublished) {
    return (
      <div className="group relative card p-5 opacity-70 cursor-not-allowed">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-300" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
              {lesson.phase}
            </span>
          </div>
          <span className="font-mono text-[10px] text-zinc-400">
            #{String(lesson.lesson_number).padStart(2, '0')}
          </span>
        </div>
        <h3 className="mb-1 line-clamp-2 text-[15px] font-semibold text-zinc-500">
          {lesson.title}
        </h3>
        <p className="mb-4 line-clamp-2 text-[13px] text-zinc-400">{lesson.subtitle}</p>
        <div className="flex items-center gap-2 rounded-card-sm bg-zinc-50 px-3 py-2 text-[12px] text-zinc-600">
          <Lock className="h-3.5 w-3.5 flex-none" />
          <span>Termine le quiz précédent pour débloquer.</span>
        </div>
      </div>
    );
  }

  return (
    <Link
      to={`/lecons/${lesson.lesson_number}`}
      className={cn(
        'group relative card p-5 transition-all hover:shadow-card-hover hover:border-zinc-400 hover:-translate-y-0.5',
        isFirstLesson && 'ring-1 ring-aurel-orange/40 border-aurel-orange/60',
        lessonNotPublished && 'opacity-60',
      )}
    >
      {/* Floating badges */}
      {isFirstLesson && (
        <span className="absolute -top-2.5 left-4 inline-flex items-center gap-1 rounded-pill bg-aurel-orange px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-card">
          <Sparkles className="h-3 w-3" /> Commencer ici
        </span>
      )}
      {quizPassed && (
        <span className="absolute -top-2.5 right-4 inline-flex items-center gap-1 rounded-pill bg-aurel-teal px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-card">
          <Trophy className="h-3 w-3" /> Quiz validé
        </span>
      )}

      {/* Header : phase dot + lesson number */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full flex-none" style={{ background: dotColor }} />
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
            {lesson.phase}
          </span>
        </div>
        <span className="font-mono text-[10px] text-zinc-400">
          #{String(lesson.lesson_number).padStart(2, '0')}
        </span>
      </div>

      {/* Title + subtitle */}
      <h3 className="mb-1 line-clamp-2 text-[15px] font-semibold tracking-tight text-zinc-900 group-hover:text-aurel-orange">
        {lesson.title}
      </h3>
      <p className="mb-4 line-clamp-2 text-[13px] text-zinc-500">{lesson.subtitle}</p>

      {/* Meta row */}
      <div className="mb-3 flex flex-wrap items-center gap-3 text-[12px] text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" /> {formatDuration(lesson.duration_minutes)}
        </span>
        {completed && (
          <span className="inline-flex items-center gap-1 text-green-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> Terminé
          </span>
        )}
        {inProgress && (
          <span className="text-aurel-orange-dark font-medium">En cours</span>
        )}
        {lessonNotPublished && (
          <span className="inline-flex items-center gap-1 text-zinc-400">
            <Lock className="h-3.5 w-3.5" /> Bientôt
          </span>
        )}
        {quizStatus?.has_questions && !quizStatus.passed && quizStatus.attempts > 0 && (
          <span className="text-amber-600 font-medium tabular">
            Quiz {quizStatus.best_score}/{quizStatus.total}
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1 overflow-hidden rounded-full bg-zinc-100">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background: completed ? '#16A34A' : 'linear-gradient(90deg, #F97316, #EA580C)',
          }}
        />
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px]">
        <span className="font-mono text-zinc-500 tabular">{pct}%</span>
        <span className="inline-flex items-center gap-1 font-medium text-zinc-900 group-hover:text-aurel-orange">
          <Play className="h-3 w-3 fill-current" />
          {inProgress ? 'Reprendre' : completed ? 'Revoir' : 'Commencer'}
        </span>
      </div>
    </Link>
  );
}
