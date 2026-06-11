/**
 * Immigration course helpers — UI-only phase (videos not recorded yet).
 *
 * - Lesson bodies are static .md files under /content/immigration/<slug>.md,
 *   fetched on demand (not bundled into JS).
 * - Progress is stored in localStorage for now (no DB churn before launch).
 *   When the course goes live with videos we migrate to lesson_progress.
 */
import {
  IMMIGRATION_SECTIONS,
  IMMIGRATION_FLAT_LESSONS,
  type ImmigrationLesson,
} from '@/data/immigration-structure';

// ── Lesson content fetch ─────────────────────────────────────────
const lessonCache = new Map<string, string>();

export async function fetchImmigrationLesson(slug: string): Promise<string> {
  if (lessonCache.has(slug)) return lessonCache.get(slug)!;
  const res = await fetch(`/content/immigration/${slug}.md`, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`Leçon introuvable (${res.status})`);
  const text = await res.text();
  lessonCache.set(slug, text);
  return text;
}

// ── Lesson lookup helpers ────────────────────────────────────────
export function findLesson(slug: string) {
  const idx = IMMIGRATION_FLAT_LESSONS.findIndex((l) => l.slug === slug);
  if (idx === -1) return null;
  return {
    lesson: IMMIGRATION_FLAT_LESSONS[idx],
    prev: idx > 0 ? IMMIGRATION_FLAT_LESSONS[idx - 1] : null,
    next: idx < IMMIGRATION_FLAT_LESSONS.length - 1 ? IMMIGRATION_FLAT_LESSONS[idx + 1] : null,
    index: idx,
  };
}

export function findLessonInModule(moduleSlug: string, lessonSlug: string): ImmigrationLesson | null {
  for (const s of IMMIGRATION_SECTIONS) {
    for (const m of s.modules) {
      if (m.slug === moduleSlug) {
        return m.lessons.find((l) => l.slug === lessonSlug) ?? null;
      }
    }
  }
  return null;
}

// ── Progress (localStorage) ──────────────────────────────────────
const PROGRESS_KEY = 'aurel.immigration.progress.v1';

type ProgressMap = Record<string, { completed: boolean; at: string }>;

function readProgress(): ProgressMap {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeProgress(p: ProgressMap) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch { /* quota / private mode — non-fatal */ }
}

export function isLessonCompleted(slug: string): boolean {
  return readProgress()[slug]?.completed === true;
}

export function setLessonCompleted(slug: string, completed: boolean) {
  const p = readProgress();
  if (completed) {
    p[slug] = { completed: true, at: new Date().toISOString() };
  } else {
    delete p[slug];
  }
  writeProgress(p);
  // Notify listeners (overview page) within the same tab.
  window.dispatchEvent(new CustomEvent('immigration-progress-changed'));
}

export function getCompletedCount(): number {
  const p = readProgress();
  return Object.values(p).filter((x) => x.completed).length;
}

export function getModuleProgress(moduleSlug: string): { done: number; total: number } {
  const section = IMMIGRATION_SECTIONS.find((s) => s.modules.some((m) => m.slug === moduleSlug));
  const mod = section?.modules.find((m) => m.slug === moduleSlug);
  if (!mod) return { done: 0, total: 0 };
  const p = readProgress();
  const done = mod.lessons.filter((l) => p[l.slug]?.completed).length;
  return { done, total: mod.lessons.length };
}

// ── Lightweight markdown → HTML (no dependency) ──────────────────
// The content is simple : paragraphs + stage-direction lines in [brackets].
// We render :
//   - [À L'ÉCRAN : ...] / [MONTRER : ...] / [PAUSE] → styled note chips
//   - **bold** → <strong>
//   - plain paragraphs → <p>
// All text is HTML-escaped first to prevent injection.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inlineFormat(s: string): string {
  // bold **...**
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // « ... » keep as-is (already nice typography)
  return s;
}

export function renderLessonHtml(md: string): string {
  const blocks = md.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const out: string[] = [];

  for (const raw of blocks) {
    const block = escapeHtml(raw);

    // Stage direction : a paragraph that IS a bracketed directive.
    // e.g. "[À L'ÉCRAN : titre ...]" or "[PAUSE]" or "[MONTRER : ...]"
    const directiveMatch = block.match(/^\[(.+)\]$/s);
    if (directiveMatch) {
      const inner = inlineFormat(directiveMatch[1]);
      out.push(
        `<aside class="imm-direction"><span class="imm-direction-tag">🎬 Production</span> ${inner}</aside>`
      );
      continue;
    }

    // Paragraph that contains inline bracketed directives mixed with text :
    // split out the brackets into chips inline.
    let html = inlineFormat(block);
    html = html.replace(
      /\[([^\]]+)\]/g,
      '<span class="imm-cue">$1</span>'
    );
    // single newlines inside a block → <br>
    html = html.replace(/\n/g, '<br>');
    out.push(`<p>${html}</p>`);
  }

  return out.join('\n');
}
