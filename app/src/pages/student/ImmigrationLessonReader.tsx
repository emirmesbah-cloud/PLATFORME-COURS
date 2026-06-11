import { useState, useEffect } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, Clock, CheckCircle2, Circle } from 'lucide-react';
import { VideoPlaceholder } from '@/components/features/VideoPlaceholder';
import {
  fetchImmigrationLesson, findLesson, findLessonInModule,
  isLessonCompleted, setLessonCompleted, renderLessonHtml,
} from '@/lib/immigration';
import { cn } from '@/lib/utils';

/**
 * ImmigrationLessonReader — single lesson view.
 * Video placeholder (no video yet) + markdown body + prev/next nav +
 * mark-as-complete (localStorage). Linear Tech direction.
 */
export function ImmigrationLessonReader() {
  const { moduleSlug, lessonSlug } = useParams<{ moduleSlug: string; lessonSlug: string }>();

  // Validate the lesson exists in this module.
  const lessonMeta = moduleSlug && lessonSlug ? findLessonInModule(moduleSlug, lessonSlug) : null;
  const nav = lessonSlug ? findLesson(lessonSlug) : null;

  const [completed, setCompleted] = useState(false);
  useEffect(() => {
    if (lessonSlug) setCompleted(isLessonCompleted(lessonSlug));
  }, [lessonSlug]);

  const contentQ = useQuery({
    queryKey: ['immigration-lesson', lessonSlug],
    queryFn: () => fetchImmigrationLesson(lessonSlug!),
    enabled: !!lessonSlug && !!lessonMeta,
    staleTime: Infinity,
  });

  if (!moduleSlug || !lessonSlug || !lessonMeta || !nav) {
    return <Navigate to="/immigration" replace />;
  }

  function toggleComplete() {
    const next = !completed;
    setCompleted(next);
    setLessonCompleted(lessonSlug!, next);
  }

  const html = contentQ.data ? renderLessonHtml(contentQ.data) : '';

  return (
    <div className="mx-auto max-w-3xl">

      {/* Back */}
      <Link to="/immigration" className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-aurel-orange">
        <ArrowLeft className="h-4 w-4" /> Tous les modules
      </Link>

      {/* Header */}
      <header className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-zinc-500">
          <span className="rounded-pill bg-aurel-orange-soft px-2.5 py-0.5 text-aurel-orange-dark font-semibold">
            Leçon {lessonMeta.id}
          </span>
          <span>{nav.lesson.sectionTitle}</span>
          {lessonMeta.duration && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> {lessonMeta.duration}
            </span>
          )}
        </div>
        <h1 className="text-display-sm tracking-tight text-zinc-950">{lessonMeta.title}</h1>
      </header>

      {/* Video (placeholder until filmed) */}
      <div className="mb-6">
        <VideoPlaceholder title={lessonMeta.title} />
      </div>

      {/* Content */}
      <section className="card p-6 md:p-8">
        <div className="mb-4 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">
          <span className="h-1.5 w-1.5 rounded-full bg-aurel-orange" />
          Contenu de la leçon
        </div>

        {contentQ.isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className={cn('h-4 animate-pulse rounded bg-zinc-100', i % 3 === 0 ? 'w-2/3' : 'w-full')} />
            ))}
          </div>
        ) : contentQ.isError ? (
          <p className="text-sm text-zinc-500">
            Le contenu de cette leçon n'a pas pu être chargé. Recharge la page.
          </p>
        ) : (
          <div className="imm-content" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </section>

      {/* Mark complete */}
      <button
        onClick={toggleComplete}
        className={cn(
          'mt-6 flex w-full items-center justify-center gap-2 rounded-card border py-3.5 text-[14px] font-medium transition-colors',
          completed
            ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
            : 'border-zinc-200 bg-white text-zinc-700 hover:border-aurel-orange hover:text-aurel-orange',
        )}
      >
        {completed
          ? <><CheckCircle2 className="h-4.5 w-4.5" /> Leçon terminée — clique pour annuler</>
          : <><Circle className="h-4.5 w-4.5" /> Marquer cette leçon comme terminée</>}
      </button>

      {/* Prev / Next */}
      <nav className="mt-8 flex items-stretch justify-between gap-3 border-t border-zinc-200 pt-6">
        {nav.prev ? (
          <Link
            to={`/immigration/${nav.prev.moduleSlug}/${nav.prev.slug}`}
            className="group flex flex-1 items-center gap-3 rounded-card border border-zinc-200 p-4 transition-colors hover:border-zinc-400 hover:bg-zinc-50"
          >
            <ChevronLeft className="h-5 w-5 flex-none text-zinc-400 group-hover:text-aurel-orange" />
            <div className="min-w-0 text-left">
              <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">Précédent · {nav.prev.id}</div>
              <div className="truncate text-[13px] font-medium text-zinc-800">{nav.prev.title}</div>
            </div>
          </Link>
        ) : <span className="flex-1" />}

        {nav.next ? (
          <Link
            to={`/immigration/${nav.next.moduleSlug}/${nav.next.slug}`}
            className="group flex flex-1 items-center justify-end gap-3 rounded-card border border-zinc-200 p-4 transition-colors hover:border-zinc-400 hover:bg-zinc-50"
          >
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
