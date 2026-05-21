import { useState } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ArrowLeft, Clock, CheckCircle2 } from 'lucide-react';
import { fetchLessons, fetchLessonByNumber, fetchUserProgress, queryKeys } from '@/lib/queries';
import { useAuth } from '@/hooks/useAuth';
import { VideoPlayer } from '@/components/features/VideoPlayer';
import { LessonNotes } from '@/components/features/LessonNotes';
import { Spinner } from '@/components/ui/Spinner';
import { formatDuration, cn } from '@/lib/utils';

const TABS = ['Objectifs', 'Contenu', 'Notes'] as const;

export function StudentLessonDetail() {
  const { lessonNumber } = useParams<{ lessonNumber: string }>();
  const n = Number(lessonNumber);
  const { user } = useAuth();
  const uid = user?.id ?? '';
  const [tab, setTab] = useState<typeof TABS[number]>('Objectifs');

  // SHERLOCK R13 — B4: validate lesson number BEFORE firing queries.
  // Garde-fou contre `/lecons/abc`, `/lecons/-1`, `/lecons/9999` etc.
  const lessonValid = Number.isInteger(n) && n >= 1 && n <= 100;

  const lessonQ  = useQuery({ queryKey: queryKeys.lesson(n),       queryFn: () => fetchLessonByNumber(n), enabled: lessonValid });
  const lessonsQ = useQuery({ queryKey: queryKeys.lessons,         queryFn: fetchLessons });
  const progQ    = useQuery({ queryKey: queryKeys.progress(uid),   queryFn: () => fetchUserProgress(uid), enabled: !!uid });

  // SHERLOCK R13 — B4: out-of-range / non-integer lesson number → /lecons.
  if (!lessonValid) return <Navigate to="/lecons" replace />;

  if (lessonQ.isLoading || lessonsQ.isLoading) return <Spinner label="Chargement..." />;
  const lesson = lessonQ.data;
  if (!lesson) return <div className="card-padded">Leçon introuvable.</div>;

  const lessons = lessonsQ.data ?? [];
  const progress = (progQ.data ?? []).find((p) => p.lesson_id === lesson.id);
  const initialPos = progress?.last_position_seconds ?? 0;
  const completed = progress?.completed ?? false;

  const prev = lessons.find((l) => l.lesson_number === n - 1);
  const next = lessons.find((l) => l.lesson_number === n + 1);

  return (
    <div>
      <Link to="/lecons" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-aurel-ink">
        <ArrowLeft className="h-4 w-4" /> Toutes les leçons
      </Link>

      <header className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="badge badge-orange">{lesson.phase}</span>
          <span className="text-xs font-mono text-slate-400">Leçon {String(lesson.lesson_number).padStart(2, '0')}</span>
          {completed && <span className="badge badge-green"><CheckCircle2 className="h-3.5 w-3.5" /> Terminé</span>}
        </div>
        <h1 className="text-2xl font-bold text-aurel-ink md:text-3xl">{lesson.title}</h1>
        <p className="mt-1 flex items-center gap-3 text-sm text-slate-600">
          <span>{lesson.subtitle}</span>
          <span className="text-slate-300">·</span>
          <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {formatDuration(lesson.duration_minutes)}</span>
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <VideoPlayer lesson={lesson} initialPosition={initialPos} />
        </div>

        <aside className="card lg:col-span-2">
          <div className="flex border-b border-slate-200">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'flex-1 px-4 py-3 text-sm font-medium transition',
                  tab === t ? 'border-b-2 border-aurel-orange text-aurel-orange-dark' : 'text-slate-500 hover:text-aurel-ink'
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="p-5 text-sm">
            {tab === 'Objectifs' && (
              <div>
                <p className="mb-2 font-semibold text-aurel-ink">À la fin de cette leçon, tu sauras :</p>
                <ul className="ml-5 list-disc space-y-1 text-slate-600">
                  <li>{lesson.subtitle}</li>
                  <li>Maîtriser le vocabulaire spécifique de cette section</li>
                  <li>Appliquer en situation réelle de Pflegeheim</li>
                  <li>Te préparer à l'entretien Anerkennung</li>
                </ul>
              </div>
            )}
            {tab === 'Contenu' && (
              <div className="text-slate-600">
                <p className="mb-2 font-semibold text-aurel-ink">Module : {lesson.module_parent}</p>
                <p>Le détail des chapitres sera affiché ici quand le timecoding des vidéos sera importé.</p>
              </div>
            )}
            {tab === 'Notes' && <LessonNotes lessonId={lesson.id} />}
          </div>
        </aside>
      </div>

      <nav className="mt-8 flex items-center justify-between gap-3">
        {prev ? (
          <Link to={`/lecons/${prev.lesson_number}`} className="btn-outline flex-1 md:flex-none">
            <ChevronLeft className="h-4 w-4" /> Leçon {prev.lesson_number}
          </Link>
        ) : <span />}
        {next ? (
          <Link to={`/lecons/${next.lesson_number}`} className="btn-primary flex-1 md:flex-none">
            Leçon {next.lesson_number} <ChevronRight className="h-4 w-4" />
          </Link>
        ) : <span className="text-sm font-medium text-aurel-teal">Dernière leçon ✨</span>}
      </nav>
    </div>
  );
}
