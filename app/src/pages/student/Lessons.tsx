import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { fetchLessons, fetchUserProgress, queryKeys } from '@/lib/queries';
import { LessonCard } from '@/components/features/LessonCard';

export function StudentLessons() {
  const { user } = useAuth();
  const uid = user?.id ?? '';

  const lessonsQ = useQuery({ queryKey: queryKeys.lessons,         queryFn: fetchLessons });
  const progQ    = useQuery({ queryKey: queryKeys.progress(uid),   queryFn: () => fetchUserProgress(uid), enabled: !!uid });

  // SHERLOCK : auto-escape if skeletons hang. After 8s without data, show a
  // visible "réseau lent" message + manual retry button. Beats the infinite
  // skeleton state when SW cache / network blip stalls the query.
  const [slowNetwork, setSlowNetwork] = useState(false);
  useEffect(() => {
    if (lessonsQ.data && lessonsQ.data.length > 0) {
      setSlowNetwork(false);
      return;
    }
    const t = setTimeout(() => setSlowNetwork(true), 8000);
    return () => clearTimeout(t);
  }, [lessonsQ.data]);

  // SHERLOCK : on ne bloque PLUS le render avec un spinner full-page.
  // Avant : `if (lessonsQ.isLoading) return <Spinner />` masquait toute la
  // page pendant 5-15s sur ISP lent. Maintenant : header + 6 skeleton cards
  // s'affichent immédiatement, les vraies cards remplacent dès que le RPC
  // répond.
  const lessons = lessonsQ.data ?? [];
  const progressByLesson = new Map((progQ.data ?? []).map((p) => [p.lesson_id, p]));

  // Group by phase
  const byPhase = new Map<string, typeof lessons>();
  lessons.forEach((l) => {
    const arr = byPhase.get(l.phase) ?? [];
    arr.push(l);
    byPhase.set(l.phase, arr);
  });

  const isLoading = lessonsQ.isLoading && lessons.length === 0;
  const hasError  = lessonsQ.isError && lessons.length === 0;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-aurel-ink md:text-4xl">
          {lessons.length > 0 ? `Mes ${lessons.length} leçons` : 'Mes leçons'}
        </h1>
        <p className="mt-1 text-slate-600">Programme complet Deutsch für Pflegekräfte.</p>
      </header>

      {(hasError || (slowNetwork && isLoading)) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Connexion lente détectée</p>
          <p className="mt-1">
            Les leçons mettent du temps à charger.
            Réessaie, ou recharge la page complètement (Ctrl+Shift+R).
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => lessonsQ.refetch()}
              className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700"
            >
              Réessayer
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg border border-amber-600 px-4 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100"
            >
              Recharger la page
            </button>
          </div>
        </div>
      )}

      {isLoading && !slowNetwork && (
        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-aurel-orange">Chargement…</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        </section>
      )}

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

function SkeletonCard() {
  return (
    <div className="card animate-pulse">
      <div className="flex items-center justify-between p-4">
        <div className="h-5 w-20 rounded bg-slate-200" />
        <div className="h-4 w-8 rounded bg-slate-200" />
      </div>
      <div className="px-4 pb-4">
        <div className="mb-2 h-5 w-3/4 rounded bg-slate-200" />
        <div className="mb-3 h-4 w-1/2 rounded bg-slate-200" />
        <div className="mb-3 h-3 w-1/3 rounded bg-slate-100" />
        <div className="h-2 w-full rounded-full bg-slate-100" />
        <div className="mt-3 flex items-center justify-between">
          <div className="h-3 w-8 rounded bg-slate-100" />
          <div className="h-3 w-16 rounded bg-slate-100" />
        </div>
      </div>
    </div>
  );
}
