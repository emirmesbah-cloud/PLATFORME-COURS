import { useState } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, Clock, CheckCircle2, Circle, StickyNote, GraduationCap } from 'lucide-react';
import { VideoPlaceholder } from '@/components/features/VideoPlaceholder';
import { ImmigrationQuiz } from '@/components/features/ImmigrationQuiz';
import { ImmigrationNotes } from '@/components/features/ImmigrationNotes';
import { findLesson, findLessonInModule, fetchImmigrationStatus, setImmigrationCompleted } from '@/lib/immigration';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';

type Tab = 'quiz' | 'notes';

/**
 * ImmigrationLessonReader — like Pflege : the student watches the VIDEO,
 * takes NOTES, passes a QUIZ. The teleprompter script is NOT shown (it's the
 * filming reference, not student content). Video shows a placeholder until
 * vdocipherVideoId is filled in (Phase 6).
 */
export function ImmigrationLessonReader() {
  const { moduleSlug, lessonSlug } = useParams<{ moduleSlug: string; lessonSlug: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('notes');
  const [marking, setMarking] = useState(false);

  const lessonMeta = moduleSlug && lessonSlug ? findLessonInModule(moduleSlug, lessonSlug) : null;
  const nav = lessonSlug ? findLesson(lessonSlug) : null;

  // DB status (completed + quiz). One query for the whole course, cached.
  const statusQ = useQuery({
    queryKey: ['immigration-status'],
    queryFn: fetchImmigrationStatus,
    staleTime: 30 * 1000,
  });

  if (!moduleSlug || !lessonSlug || !lessonMeta || !nav) {
    return <Navigate to="/immigration" replace />;
  }

  const status = (statusQ.data ?? []).find((s) => s.lesson_slug === lessonSlug);
  const completed = status?.completed === true;
  const hasQuiz = status?.has_questions === true;
  const quizPassed = status?.passed === true;

  async function toggleComplete() {
    setMarking(true);
    try {
      await setImmigrationCompleted(lessonSlug!, moduleSlug!, !completed);
      qc.invalidateQueries({ queryKey: ['immigration-status'] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erreur réseau.');
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/immigration" className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-aurel-orange">
        <ArrowLeft className="h-4 w-4" /> Tous les modules
      </Link>

      <header className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-zinc-500">
          <span className="rounded-pill bg-aurel-orange-soft px-2.5 py-0.5 font-semibold text-aurel-orange-dark">
            Leçon {lessonMeta.id}
          </span>
          <span>{nav.lesson.sectionTitle}</span>
          {lessonMeta.duration && (
            <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {lessonMeta.duration}</span>
          )}
          {completed && (
            <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle2 className="h-3 w-3" /> Terminé</span>
          )}
        </div>
        <h1 className="text-display-sm tracking-tight text-zinc-950">{lessonMeta.title}</h1>
      </header>

      {/* Video : placeholder until vdocipherVideoId is set (Phase 6). */}
      <div className="mb-6">
        <VideoPlaceholder title={lessonMeta.title} />
      </div>

      {/* Tabs : Notes / Quiz */}
      <div className="mb-4 flex gap-1 border-b border-zinc-200">
        <button
          onClick={() => setTab('notes')}
          className={cn('inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors -mb-px border-b-2',
            tab === 'notes' ? 'border-aurel-orange text-aurel-orange-dark' : 'border-transparent text-zinc-500 hover:text-zinc-900')}
        >
          <StickyNote className="h-4 w-4" /> Notes
        </button>
        {hasQuiz && (
          <button
            onClick={() => setTab('quiz')}
            className={cn('inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors -mb-px border-b-2',
              tab === 'quiz' ? 'border-aurel-orange text-aurel-orange-dark' : 'border-transparent text-zinc-500 hover:text-zinc-900')}
          >
            <GraduationCap className="h-4 w-4" /> Quiz
            {quizPassed && <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
          </button>
        )}
      </div>

      {tab === 'notes' && (
        <section className="card p-6">
          <ImmigrationNotes lessonSlug={lessonSlug} />
        </section>
      )}
      {tab === 'quiz' && hasQuiz && (
        <ImmigrationQuiz lessonSlug={lessonSlug} onPassed={() => qc.invalidateQueries({ queryKey: ['immigration-status'] })} />
      )}

      {/* Mark complete */}
      <button
        onClick={toggleComplete}
        disabled={marking}
        className={cn('mt-6 flex w-full items-center justify-center gap-2 rounded-card border py-3.5 text-[14px] font-medium transition-colors disabled:opacity-60',
          completed ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
                    : 'border-zinc-200 bg-white text-zinc-700 hover:border-aurel-orange hover:text-aurel-orange')}
      >
        {completed
          ? <><CheckCircle2 className="h-4 w-4" /> Leçon terminée — clique pour annuler</>
          : <><Circle className="h-4 w-4" /> Marquer cette leçon comme terminée</>}
      </button>

      {/* Prev / Next */}
      <nav className="mt-8 flex items-stretch justify-between gap-3 border-t border-zinc-200 pt-6">
        {nav.prev ? (
          <Link to={`/immigration/${nav.prev.moduleSlug}/${nav.prev.slug}`}
            className="group flex flex-1 items-center gap-3 rounded-card border border-zinc-200 p-4 transition-colors hover:border-zinc-400 hover:bg-zinc-50">
            <ChevronLeft className="h-5 w-5 flex-none text-zinc-400 group-hover:text-aurel-orange" />
            <div className="min-w-0 text-left">
              <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">Précédent · {nav.prev.id}</div>
              <div className="truncate text-[13px] font-medium text-zinc-800">{nav.prev.title}</div>
            </div>
          </Link>
        ) : <span className="flex-1" />}
        {nav.next ? (
          <Link to={`/immigration/${nav.next.moduleSlug}/${nav.next.slug}`}
            className="group flex flex-1 items-center justify-end gap-3 rounded-card border border-zinc-200 p-4 transition-colors hover:border-zinc-400 hover:bg-zinc-50">
            <div className="min-w-0 text-right">
              <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">Suivant · {nav.next.id}</div>
              <div className="truncate text-[13px] font-medium text-zinc-800">{nav.next.title}</div>
            </div>
            <ChevronRight className="h-5 w-5 flex-none text-zinc-400 group-hover:text-aurel-orange" />
          </Link>
        ) : (
          <span className="flex flex-1 items-center justify-end gap-2 rounded-card border border-zinc-200 p-4 text-[13px] font-medium text-aurel-teal">
            Dernière leçon ✨
          </span>
        )}
      </nav>
    </div>
  );
}
