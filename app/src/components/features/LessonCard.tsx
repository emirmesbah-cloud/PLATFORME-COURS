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
  // SHERLOCK R14 — H8 : guard divide-by-zero. Si duration_minutes=0 (lesson
  // mal seedée OU admin qui clear le champ par accident), `watchedSec/0`
  // produit Infinity → Math.min(100, Math.round(Infinity)) = 100 → la
  // leçon affichée comme 100% sans qu'aucune vidéo n'ait été regardée.
  const totalSec = Math.max(1, lesson.duration_minutes * 60);
  const watchedSec = progress?.watched_seconds ?? 0;
  const completed = progress?.completed ?? false;
  const pct = Math.min(100, Math.round((watchedSec / totalSec) * 100));
  const inProgress = !completed && watchedSec > 0;
  const locked = !lesson.is_published || !lesson.vdocipher_video_id;

  // SHERLOCK : "Commencer ici" badge sur la leçon 1 (= disclaimer obligatoire).
  // Le disclaimer a été reclassé en leçon 1 plutôt qu'un gate séparé (KISS).
  // Le badge attire l'attention pour que les nouveaux students attaquent par
  // le bon endroit. Sur les leçons 2-19 = badge phase normal.
  const isFirstLesson = lesson.lesson_number === 1;

  return (
    <Link
      to={`/lecons/${lesson.lesson_number}`}
      className={cn(
        'group relative block card transition hover:border-aurel-orange hover:shadow-md',
        isFirstLesson && 'border-aurel-orange ring-1 ring-aurel-orange/30',
        locked && 'opacity-70'
      )}
    >
      {isFirstLesson && (
        <span className="absolute -top-2 left-3 rounded-full bg-aurel-orange px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-md">
          ⭐ Commencer ici
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
