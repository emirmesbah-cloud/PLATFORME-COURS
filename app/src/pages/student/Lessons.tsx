import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { fetchLessons, fetchUserProgress, queryKeys } from '@/lib/queries';
import { LessonCard } from '@/components/features/LessonCard';
import { Spinner } from '@/components/ui/Spinner';

export function StudentLessons() {
  const { user } = useAuth();
  const uid = user?.id ?? '';

  const lessonsQ = useQuery({ queryKey: queryKeys.lessons,         queryFn: fetchLessons });
  const progQ    = useQuery({ queryKey: queryKeys.progress(uid),   queryFn: () => fetchUserProgress(uid), enabled: !!uid });

  if (lessonsQ.isLoading) return <Spinner label="Chargement des leçons..." />;
  const lessons = lessonsQ.data ?? [];
  const progressByLesson = new Map((progQ.data ?? []).map((p) => [p.lesson_id, p]));

  // Group by phase
  const byPhase = new Map<string, typeof lessons>();
  lessons.forEach((l) => {
    const arr = byPhase.get(l.phase) ?? [];
    arr.push(l);
    byPhase.set(l.phase, arr);
  });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-aurel-ink md:text-4xl">Mes {lessons.length} leçons</h1>
        <p className="mt-1 text-slate-600">Programme complet Deutsch für Pflegekräfte.</p>
      </header>

      {[...byPhase.entries()].map(([phase, items]) => (
        <section key={phase}>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-aurel-orange">{phase}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((l) => (
              <LessonCard key={l.id} lesson={l} progress={progressByLesson.get(l.id)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
