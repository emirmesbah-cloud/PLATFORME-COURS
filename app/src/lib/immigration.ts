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
import { supabase } from '@/lib/supabase';

// ── DB-backed types (mig 20260611000033) ────────────────────────
export interface ImmigrationLessonStatus {
  lesson_slug: string;
  completed: boolean;
  has_questions: boolean;
  best_score: number;
  total: number;
  passed: boolean;
  attempts: number;
}
export interface ImmigrationQuizQuestionStudent {
  id: string;
  lesson_slug: string;
  position: number;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
}
export interface ImmigrationQuizResult {
  ok: boolean;
  error?: string;
  score?: number;
  total?: number;
  passed?: boolean;
  threshold?: number;
  correct?: number[];
}

// ── Lesson content fetch ─────────────────────────────────────────
const lessonCache = new Map<string, string>();

export async function fetchImmigrationLesson(slug: string): Promise<string> {
  if (lessonCache.has(slug)) return lessonCache.get(slug)!;
  // No force-cache : the in-memory Map + react-query already cache per session.
  // force-cache served stale .md after content updates / redeploys.
  const res = await fetch(`/content/immigration/${slug}.md`);
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

// ── DB-backed status / progress / notes / quiz (mig 033) ────────

/** One round-trip : status of every immigration lesson for the current user. */
export async function fetchImmigrationStatus(): Promise<ImmigrationLessonStatus[]> {
  const { data, error } = await supabase.rpc('get_my_immigration_status');
  if (error) throw error;
  if (!data || (data as { ok: boolean }).ok === false) return [];
  return ((data as { lessons: ImmigrationLessonStatus[] }).lessons ?? []);
}

/** Mark / unmark a lesson completed (persisted in DB, cross-device). */
export async function setImmigrationCompleted(
  lessonSlug: string, moduleSlug: string, completed: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_immigration_lesson_completed', {
    p_lesson_slug: lessonSlug, p_module_slug: moduleSlug, p_completed: completed,
  });
  if (error) throw error;
}

/** Fetch a lesson's quiz questions (without correct answers — server scores). */
export async function fetchImmigrationQuiz(lessonSlug: string): Promise<ImmigrationQuizQuestionStudent[]> {
  const { data, error } = await supabase
    .from('immigration_quiz_questions')
    .select('id, lesson_slug, position, question_text, option_a, option_b, option_c, option_d')
    .eq('lesson_slug', lessonSlug)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ImmigrationQuizQuestionStudent[];
}

/** Submit answers; server computes the score (anti-cheat). */
export async function submitImmigrationQuiz(
  lessonSlug: string, answers: number[],
): Promise<ImmigrationQuizResult> {
  const { data, error } = await supabase.rpc('submit_immigration_quiz_attempt', {
    p_lesson_slug: lessonSlug, p_answers: answers,
  });
  if (error) throw error;
  return data as ImmigrationQuizResult;
}

/** Fetch the student's personal note for a lesson. */
export async function fetchImmigrationNote(lessonSlug: string): Promise<string> {
  const { data, error } = await supabase
    .from('immigration_notes')
    .select('content')
    .eq('lesson_slug', lessonSlug)
    .maybeSingle();
  if (error) throw error;
  return (data?.content as string) ?? '';
}

/** Save the student's personal note for a lesson. */
export async function saveImmigrationNote(lessonSlug: string, content: string): Promise<void> {
  const { error } = await supabase.rpc('upsert_immigration_note', {
    p_lesson_slug: lessonSlug, p_content: content,
  });
  if (error) throw error;
}

// ── Admin : quiz CRUD (immigration_quiz_questions) ──────────────
export interface ImmigrationQuizQuestionAdmin extends ImmigrationQuizQuestionStudent {
  module_slug: string;
  correct_index: 0 | 1 | 2 | 3;
  explanation: string | null;
}
export interface ImmigrationQuestionInput {
  id?: string;
  lesson_slug: string;
  module_slug: string;
  position: number;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_index: 0 | 1 | 2 | 3;
  explanation: string | null;
}

export async function adminFetchAllImmigrationQuestions(): Promise<ImmigrationQuizQuestionAdmin[]> {
  const { data, error } = await supabase
    .from('immigration_quiz_questions')
    .select('*')
    .order('lesson_slug', { ascending: true })
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ImmigrationQuizQuestionAdmin[];
}

export async function adminUpsertImmigrationQuestion(q: ImmigrationQuestionInput): Promise<void> {
  const payload = {
    lesson_slug: q.lesson_slug, module_slug: q.module_slug, position: q.position,
    question_text: q.question_text, option_a: q.option_a, option_b: q.option_b,
    option_c: q.option_c, option_d: q.option_d, correct_index: q.correct_index,
    explanation: q.explanation,
  };
  const op = q.id
    ? supabase.from('immigration_quiz_questions').update(payload).eq('id', q.id)
    : supabase.from('immigration_quiz_questions').insert(payload);
  const { error } = await op;
  if (error) throw error;
}

export async function adminDeleteImmigrationQuestion(id: string): Promise<void> {
  const { error } = await supabase.from('immigration_quiz_questions').delete().eq('id', id);
  if (error) throw error;
}

// ── Progress (localStorage — legacy fallback, kept until full DB wiring) ──
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
