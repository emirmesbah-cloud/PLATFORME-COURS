import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, CheckCircle2, Circle, Play, Download, FileText, Layers } from 'lucide-react';
import {
  IMMIGRATION_COURSE,
  IMMIGRATION_SECTIONS,
  IMMIGRATION_BONUS,
  IMMIGRATION_FLAT_LESSONS,
} from '@/data/immigration-structure';
import { isLessonCompleted, getCompletedCount, getModuleProgress } from '@/lib/immigration';
import { cn } from '@/lib/utils';

/**
 * ImmigrationOverview — course home for the Immigration course.
 * Sections → modules (accordion) → lessons. Progress from localStorage.
 * Linear Tech direction, orange Aurel accent.
 */
export function ImmigrationOverview() {
  // Re-render when progress changes (mark complete from a lesson, etc.)
  const [, force] = useState(0);
  useEffect(() => {
    const h = () => force((n) => n + 1);
    window.addEventListener('immigration-progress-changed', h);
    return () => window.removeEventListener('immigration-progress-changed', h);
  }, []);

  // Which module accordions are open. Default : first module of first section.
  const [openModules, setOpenModules] = useState<Set<string>>(
    () => new Set([IMMIGRATION_SECTIONS[0]?.modules[0]?.slug].filter(Boolean) as string[]),
  );
  const toggle = (slug: string) =>
    setOpenModules((prev) => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });

  const completed = getCompletedCount();
  const total = IMMIGRATION_COURSE.totalLessons;
  const percent = total ? Math.round((completed / total) * 100) : 0;

  // Resume target : first non-completed lesson, else first lesson.
  const resume = useMemo(() => {
    return IMMIGRATION_FLAT_LESSONS.find((l) => !isLessonCompleted(l.slug)) ?? IMMIGRATION_FLAT_LESSONS[0];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completed]);

  return (
    <div className="space-y-6">

      {/* Breadcrumb */}
      <div className="flex items-center justify-between border-b border-zinc-200 pb-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">
          <span>Aurel Academy</span>
          <span className="mx-2 text-aurel-orange">/</span>
          <span className="text-zinc-900">Immigration en Allemagne</span>
        </div>
      </div>

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

          {/* Progress */}
          <div className="mt-6 max-w-md">
            <div className="mb-2 flex items-center justify-between font-mono text-[11px] text-zinc-500">
              <span><b className="text-zinc-900 tabular">{completed}</b> / {total} leçons</span>
              <span>{percent}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200">
              <div className="h-full rounded-full" style={{ width: `${percent}%`, background: 'linear-gradient(90deg, #F97316, #EA580C)' }} />
            </div>
          </div>

          {resume && (
            <div className="mt-6">
              <Link to={`/immigration/${resume.moduleSlug}/${resume.slug}`} className="btn-primary btn-lg">
                {completed === 0 ? 'Commencer le cours' : 'Reprendre'} <ArrowRight className="h-4 w-4" />
              </Link>
              <p className="mt-2 font-mono text-[11px] text-zinc-500">
                {completed === 0 ? 'Première leçon' : 'Prochaine leçon'} : {resume.title}
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
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
              {section.title}
            </h2>
          </div>

          {section.modules.map((module) => {
            const isOpen = openModules.has(module.slug);
            const prog = getModuleProgress(module.slug);
            const moduleComplete = prog.total > 0 && prog.done === prog.total;
            return (
              <div key={module.slug} className="card overflow-hidden">
                {/* Module header (accordion trigger) */}
                <button
                  onClick={() => toggle(module.slug)}
                  className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-zinc-50"
                >
                  <ChevronDown className={cn('h-4 w-4 flex-none text-zinc-400 transition-transform', isOpen && 'rotate-180')} />
                  <span className="flex-1 text-[15px] font-semibold tracking-tight text-zinc-900">
                    {prettyModuleTitle(module.title)}
                  </span>
                  <span className={cn(
                    'rounded-pill px-2.5 py-0.5 font-mono text-[10px] font-semibold tabular',
                    moduleComplete ? 'bg-green-50 text-green-700' : 'bg-zinc-100 text-zinc-500',
                  )}>
                    {prog.done}/{prog.total}
                  </span>
                </button>

                {/* Lessons */}
                {isOpen && (
                  <div className="border-t border-zinc-100">
                    {module.lessons.map((lesson) => {
                      const done = isLessonCompleted(lesson.slug);
                      return (
                        <Link
                          key={lesson.slug}
                          to={`/immigration/${module.slug}/${lesson.slug}`}
                          className="flex items-center gap-3 px-5 py-3 border-b border-zinc-50 last:border-b-0 transition-colors hover:bg-zinc-50 group"
                        >
                          {done
                            ? <CheckCircle2 className="h-4 w-4 flex-none text-aurel-orange" />
                            : <Circle className="h-4 w-4 flex-none text-zinc-300" />}
                          <span className="font-mono text-[11px] text-zinc-400 w-8 flex-none">{lesson.id}</span>
                          <span className={cn(
                            'flex-1 text-[14px] truncate',
                            done ? 'text-zinc-500' : 'text-zinc-800',
                          )}>
                            {lesson.title}
                          </span>
                          {lesson.duration && (
                            <span className="font-mono text-[10px] text-zinc-400 flex-none hidden sm:block">
                              {lesson.duration}
                            </span>
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
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
            Ressources bonus
          </h2>
        </div>
        <div className="card divide-y divide-zinc-100">
          {IMMIGRATION_BONUS.map((b) => (
            <a
              key={b.slug}
              href={`/content/immigration/bonus/${b.file}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-zinc-50 group"
            >
              <div className="grid h-9 w-9 flex-none place-items-center rounded-card-sm bg-aurel-teal-soft text-aurel-teal">
                <FileText className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-medium text-zinc-900 truncate">{b.title}</div>
                <div className="text-[12px] text-zinc-500 truncate">{b.desc}</div>
              </div>
              <Download className="h-4 w-4 flex-none text-zinc-300 group-hover:text-aurel-teal" />
            </a>
          ))}
        </div>
        <p className="font-mono text-[10px] text-zinc-400">
          Les fichiers bonus seront ajoutés au lancement du cours.
        </p>
      </section>

    </div>
  );
}

// Module titles come ALL CAPS from the source PDF — soften for display.
function prettyModuleTitle(t: string): string {
  // "MODULE 0 — LA VÉRITÉ..." → keep "Module 0 —" + Title Case the rest lightly
  return t
    .replace(/^MODULE\s+(\d+)\s*[—–-]\s*/i, (_, n) => `Module ${n} — `)
    .replace(/\bLA\b|\bLE\b|\bLES\b|\bDE\b|\bDU\b|\bEN\b|\bET\b/g, (w) => w.toLowerCase());
}
