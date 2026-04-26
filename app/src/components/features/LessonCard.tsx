import { Link } from 'react-router-dom';
import { Play, CheckCircle2, Clock, Lock } from 'lucide-react';
import { cn, formatDuration } from '@/lib/utils';
import type { Lesson, LessonProgress } from '@/lib/types';
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

export function LessonCard({ lesson, progress }: {
  lesson: Lesson;
  progress?: LessonProgress;
}) {
  const totalSec = lesson.duration_minutes * 60;
  const watchedSec = progress?.watched_seconds ?? 0;
  const completed = progress?.completed ?? false;
  const pct = Math.min(100, Math.round((watchedSec / totalSec) * 100));
  const inProgress = !completed && watchedSec > 0;
  const locked = !lesson.is_published || !lesson.vdocipher_video_id;

  return (
    <Link
      to={`/lecons/${lesson.lesson_number}`}
      className={cn(
        'group block card transition hover:border-aurel-orange hover:shadow-md',
        locked && 'opacity-70'
      )}
    >
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
          {locked && <span className="flex items-center gap-1 text-slate-400"><Lock className="h-3.5 w-3.5" /> Bientôt</span>}
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
