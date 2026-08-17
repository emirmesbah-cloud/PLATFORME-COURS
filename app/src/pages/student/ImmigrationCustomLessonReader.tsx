import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Clock, Shield } from 'lucide-react';
import { fetchCustomImmigrationLessons } from '@/lib/immigration';
import { ImmigrationVideoPlayer } from '@/components/features/ImmigrationVideoPlayer';
import { VideoPlaceholder } from '@/components/features/VideoPlaceholder';
import { ImmigrationNotes } from '@/components/features/ImmigrationNotes';
import { useAuth } from '@/hooks/useAuth';

export function ImmigrationCustomLessonReader() {
  const { lessonSlug } = useParams<{ lessonSlug: string }>();
  const { isAdmin } = useAuth();
  const lessonsQ = useQuery({ queryKey: ['immigration-custom-lessons', isAdmin], queryFn: () => fetchCustomImmigrationLessons(isAdmin) });
  if (lessonsQ.isLoading) return <div className="card-padded">Chargement…</div>;
  const lesson = lessonsQ.data?.find((row) => row.lesson_slug === lessonSlug);
  if (!lesson) return <Navigate to="/immigration" replace />;
  const playable = !!lesson.vdocipher_video_id && (lesson.is_published || isAdmin);
  return <div className="mx-auto max-w-3xl"><Link to="/immigration" className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-aurel-orange"><ArrowLeft className="h-4 w-4" /> Tous les modules</Link><header className="mb-6"><div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-zinc-500"><span className="rounded-pill bg-aurel-orange-soft px-2.5 py-0.5 font-semibold text-aurel-orange-dark">Leçon {lesson.lesson_number_label}</span>{lesson.duration_label && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {lesson.duration_label}</span>}</div><h1 className="text-display-sm tracking-tight text-zinc-950">{lesson.title}</h1></header>{isAdmin && !lesson.is_published && <div className="mb-3 flex items-center gap-2 rounded-card-sm border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><Shield className="h-4 w-4" /> Aperçu admin — brouillon invisible aux étudiants.</div>}<div className="mb-6">{playable ? <ImmigrationVideoPlayer videoId={lesson.vdocipher_video_id!} title={lesson.title ?? 'Nouvelle leçon'} /> : <VideoPlaceholder title={lesson.title ?? 'Nouvelle leçon'} />}</div><ImmigrationNotes lessonSlug={lesson.lesson_slug} /></div>;
}
