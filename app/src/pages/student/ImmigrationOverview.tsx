import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronDown, CheckCircle2, Circle, Play, Download, Layers, Lock, Shield, AlertTriangle, RefreshCw } from 'lucide-react';
import {
  IMMIGRATION_COURSE, IMMIGRATION_SECTIONS, IMMIGRATION_FLAT_LESSONS,
} from '@/data/immigration-structure';
import { fetchImmigrationStatus, getImmigrationModuleAccess, type ImmigrationLessonStatus } from '@/lib/immigration';
import { BonusCard } from '@/components/features/BonusCard';
import { fetchBonusForCourse } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';

/**
 * ImmigrationOverview — course home, DB-backed (immigration_progress + quiz).
 * Progressive lock on the 11 main modules only (module-0…module-10) :
 * a module unlocks when the previous one is fully cleared (each lesson either
 * completed, or — if it has a quiz — passed). Niches + tutos = free access.
 */
export function ImmigrationOverview() {
  const { isAdmin } = useAuth();
  const statusQ = useQuery({
    queryKey: ['immigration-status'],
    queryFn: fetchImmigrationStatus,
    staleTime: 30 * 1000,
  });
  const status = statusQ.data ?? [];
  const bonusQ = useQuery({
    queryKey: ['immigration-bonus'],
    queryFn: () => fetchBonusForCourse('immigration'),
    staleTime: 5 * 60 * 1000,
  });
  const bonuses = bonusQ.data ?? [];
  const bySlug = new Map<string, ImmigrationLessonStatus>(status.map((s) => [s.lesson_slug, s]));

  const [openModules, setOpenModules] = useState<Set<string>>(
    () => new Set([IMMIGRATION_SECTIONS[0]?.modules[0]?.slug].filter(Boolean) as string[]),
  );
  const toggle = (slug: string) =>
    setOpenModules((prev) => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });

  // A lesson is "cleared" = completed OR (has quiz AND passed).
  const isCleared = (slug: string) => {
    const s = bySlug.get(slug);
    if (!s) return false;
    if (s.has_questions) return s.passed;
    return s.completed;
  };
  const isCompleted = (slug: string) => bySlug.get(slug)?.completed === true;

  const completedCount = IMMIGRATION_FLAT_LESSONS.filter((l) => isCompleted(l.slug)).length;
  const total = IMMIGRATION_COURSE.totalLessons;
  const percent = total ? Math.round((completedCount / total) * 100) : 0;

  // module-N locked if previous main module not cleared. Index 0 always open.
  const isModuleLocked = (sectionSlug: string, moduleSlug: string) => {
    if (sectionSlug !== 'modules') return false; // niches + tutos free
    return getImmigrationModuleAccess(moduleSlug, status, isAdmin).locked;
  };

  // Resume target : first non-cleared lesson in an unlocked module.
  const resume =
    IMMIGRATION_FLAT_LESSONS.find((l) => {
      const sec = IMMIGRATION_SECTIONS.find((s) => s.modules.some((m) => m.slug === l.moduleSlug));
      if (sec && isModuleLocked(sec.slug, l.moduleSlug)) return false;
      return !isCleared(l.slug);
    }) ?? IMMIGRATION_FLAT_LESSONS[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-zinc-200 pb-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">
          <span>Aurel Academy</span><span className="mx-2 text-aurel-orange">/</span>
          <span className="text-zinc-900">Immigration en Allemagne</span>
        </div>
      </div>

      {isAdmin && (
        <section className="flex flex-col gap-3 rounded-card border border-aurel-orange/30 bg-aurel-orange-soft p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Shield className="mt-0.5 h-5 w-5 flex-none text-aurel-orange-dark" />
            <div>
              <div className="text-sm font-semibold text-zinc-900">Aperçu administrateur</div>
              <p className="mt-0.5 text-xs text-zinc-600">
                Tous les modules sont déverrouillés. Les vidéos en brouillon restent invisibles aux étudiants.
              </p>
            </div>
          </div>
          <Link to="/admin/immigration-lessons" className="btn-outline flex-none">
            Gérer les vidéos
          </Link>
        </section>
      )}

      {statusQ.isError && (
        <section className="flex flex-col gap-3 rounded-card border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3 text-amber-900">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-none" />
            <div>
              <div className="text-sm font-semibold">Progression temporairement indisponible</div>
              <p className="mt-0.5 text-xs">La connexion a échoué. Tes données ne sont pas perdues.</p>
            </div>
          </div>
          <button onClick={() => statusQ.refetch()} className="btn-outline flex-none">
            <RefreshCw className="h-4 w-4" /> Réessayer
          </button>
        </section>
      )}

      {/* Hero */}
      <section className="card-hero">
        <div className="relative">
          <div className="eyebrow-orange mb-3 inline-flex items-center gap-2 rounded-pill bg-aurel-orange/10 px-3 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-aurel-orange" />
            {total} leçons · 11 modules · 6 tutos · 6 niches métiers
          </div>
          <h1 className="text-display-sm md:text-display tracking-tight text-zinc-950 max-w-3xl">
            Immigration en <span className="text-aurel-orange">Allemagne</span>.
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-zinc-600">
            La méthode complète pour partir vivre et travailler en Allemagne, depuis l'Algérie —
            les vraies routes, le dossier qui passe, le visa, et tes premières semaines sur place.
          </p>

          <div className="mt-6 max-w-md">
            <div className="mb-2 flex items-center justify-between font-mono text-[11px] text-zinc-500">
              <span><b className="text-zinc-900 tabular">{completedCount}</b> / {total} leçons</span>
              <span>{percent}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200">
              <div className="h-full rounded-full" style={{ width: `${percent}%`, background: 'linear-gradient(90deg, #F97316, #EA580C)' }} />
            </div>
          </div>

          {resume && (
            <div className="mt-6">
              <Link to={`/immigration/${resume.moduleSlug}/${resume.slug}`} className="btn-primary btn-lg">
                {completedCount === 0 ? 'Commencer le cours' : 'Reprendre'} <ArrowRight className="h-4 w-4" />
              </Link>
              <p className="mt-2 font-mono text-[11px] text-zinc-500">
                {completedCount === 0 ? 'Première leçon' : 'Prochaine leçon'} : {resume.title}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Sections */}
      {IMMIGRATION_SECTIONS.map((section) => (
        <section key={section.slug} className="space-y-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-aurel-orange" />
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500">{section.title}</h2>
            {section.slug !== 'modules' && (
              <span className="font-mono text-[10px] text-zinc-400">· accès libre</span>
            )}
          </div>

          {section.modules.map((module) => {
            const isOpen = openModules.has(module.slug);
            const locked = isModuleLocked(section.slug, module.slug);
            const done = module.lessons.filter((l) => isCompleted(l.slug)).length;
            const allCleared = module.lessons.every((l) => isCleared(l.slug));
            return (
              <div key={module.slug} className={cn('card overflow-hidden', locked && 'opacity-70')}>
                <button
                  onClick={() => !locked && toggle(module.slug)}
                  disabled={locked}
                  className={cn('flex w-full items-center gap-3 px-5 py-4 text-left transition-colors',
                    locked ? 'cursor-not-allowed' : 'hover:bg-zinc-50')}
                >
                  {locked
                    ? <Lock className="h-4 w-4 flex-none text-zinc-400" />
                    : <ChevronDown className={cn('h-4 w-4 flex-none text-zinc-400 transition-transform', isOpen && 'rotate-180')} />}
                  <span className={cn('flex-1 text-[15px] font-semibold tracking-tight', locked ? 'text-zinc-500' : 'text-zinc-900')}>
                    {prettyModuleTitle(module.title)}
                  </span>
                  <span className={cn('rounded-pill px-2.5 py-0.5 font-mono text-[10px] font-semibold tabular',
                    allCleared ? 'bg-green-50 text-green-700' : 'bg-zinc-100 text-zinc-500')}>
                    {done}/{module.lessons.length}
                  </span>
                </button>

                {locked && (
                  <div className="border-t border-zinc-100 px-5 py-3 text-[12px] text-zinc-500">
                    🔒 Termine le module précédent (valide son quiz) pour débloquer celui-ci.
                  </div>
                )}

                {isOpen && !locked && (
                  <div className="border-t border-zinc-100">
                    {module.lessons.map((lesson) => {
                      const cleared = isCleared(lesson.slug);
                      return (
                        <Link key={lesson.slug} to={`/immigration/${module.slug}/${lesson.slug}`}
                          className="group flex items-center gap-3 border-b border-zinc-50 px-5 py-3 transition-colors last:border-b-0 hover:bg-zinc-50">
                          {cleared
                            ? <CheckCircle2 className="h-4 w-4 flex-none text-aurel-orange" />
                            : <Circle className="h-4 w-4 flex-none text-zinc-300" />}
                          <span className="w-8 flex-none font-mono text-[11px] text-zinc-400">{lesson.id}</span>
                          <span className={cn('flex-1 truncate text-[14px]', cleared ? 'text-zinc-500' : 'text-zinc-800')}>
                            {lesson.title}
                          </span>
                          {lesson.duration && (
                            <span className="hidden flex-none font-mono text-[10px] text-zinc-400 sm:block">{lesson.duration}</span>
                          )}
                          <Play className="h-3.5 w-3.5 flex-none text-zinc-300 group-hover:text-aurel-orange" />
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}

      {/* Bonus */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Download className="h-4 w-4 text-aurel-teal" />
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500">Ressources bonus</h2>
        </div>
        {bonusQ.isError ? (
          <div className="card p-5 text-sm text-red-600">
            Les ressources n'ont pas pu charger. Réessaie dans un instant.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {bonuses.map((bonus) => <BonusCard key={bonus.id} bonus={bonus} />)}
          </div>
        )}
        {!bonusQ.isLoading && !bonusQ.isError && bonuses.length === 0 && (
          <div className="card p-5 text-sm text-zinc-500">
            Les ressources seront disponibles très bientôt.
          </div>
        )}
      </section>
    </div>
  );
}

function prettyModuleTitle(t: string): string {
  return t.replace(/^MODULE\s+(\d+)\s*[—–-]\s*/i, (_, n) => `Module ${n} — `);
}
