/**
 * Immigration course helpers.
 *
 * - Lesson structure is static (src/data/immigration-structure.ts) — lookups below.
 * - Status / progress / quiz / notes are DB-backed (mig 20260611000033) via RPCs.
 * - Video media (VDOCipher id + publish flag) is per-lesson (mig 035).
 */
import {
  IMMIGRATION_SECTIONS,
  IMMIGRATION_FLAT_LESSONS,
  type ImmigrationLesson,
} from '@/data/immigration-structure';
import { supabase } from '@/lib/supabase';
import { withQueryTimeout } from '@/lib/queries';

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

export interface ImmigrationModuleAccess {
  locked: boolean;
  previousModuleSlug: string | null;
  previousModuleTitle: string | null;
}

/**
 * Apply the same progressive-module rule everywhere a lesson can be opened.
 * Main module 0 is always open; niches and tutorials are intentionally free.
 * Admins bypass progression so they can preview and manage the whole course.
 */
export function getImmigrationModuleAccess(
  moduleSlug: string,
  status: ImmigrationLessonStatus[],
  isAdmin: boolean,
): ImmigrationModuleAccess {
  if (isAdmin) {
    return { locked: false, previousModuleSlug: null, previousModuleTitle: null };
  }

  const mainModules = IMMIGRATION_SECTIONS.find((section) => section.slug === 'modules')?.modules ?? [];
  const moduleIndex = mainModules.findIndex((module) => module.slug === moduleSlug);
  if (moduleIndex <= 0) {
    return { locked: false, previousModuleSlug: null, previousModuleTitle: null };
  }

  const previousModule = mainModules[moduleIndex - 1];
  const bySlug = new Map(status.map((lessonStatus) => [lessonStatus.lesson_slug, lessonStatus]));
  const previousCleared = previousModule.lessons.every((lesson) => {
    const lessonStatus = bySlug.get(lesson.slug);
    if (!lessonStatus) return false;
    return lessonStatus.has_questions ? lessonStatus.passed : lessonStatus.completed;
  });

  return {
    locked: !previousCleared,
    previousModuleSlug: previousModule.slug,
    previousModuleTitle: previousModule.title,
  };
}

// ── DB-backed status / progress / notes / quiz (mig 033) ────────

/** One round-trip : status of every immigration lesson for the current user. */
export async function fetchImmigrationStatus(): Promise<ImmigrationLessonStatus[]> {
  const { data, error } = await withQueryTimeout(
    supabase.rpc('get_my_immigration_status'),
    12_000,
    'fetchImmigrationStatus',
  );
  if (error) throw error;
  if (!data) return [];
  const result = data as { ok: boolean; error?: string; lessons?: ImmigrationLessonStatus[] };
  if (result.ok === false) throw new Error(result.error || 'IMMIGRATION_STATUS_FAILED');
  return result.lessons ?? [];
}

/** Mark / unmark a lesson completed (persisted in DB, cross-device). */
export async function setImmigrationCompleted(
  lessonSlug: string, moduleSlug: string, completed: boolean,
): Promise<void> {
  const { data, error } = await withQueryTimeout(
    supabase.rpc('set_immigration_lesson_completed', {
      p_lesson_slug: lessonSlug, p_module_slug: moduleSlug, p_completed: completed,
    }),
    12_000,
    'setImmigrationCompleted',
  );
  if (error) throw error;
  const result = data as { ok?: boolean; error?: string } | null;
  if (!result?.ok) throw new Error(result?.error || 'IMMIGRATION_PROGRESS_FAILED');
}

/** Fetch a lesson's quiz questions (without correct answers — server scores). */
export async function fetchImmigrationQuiz(lessonSlug: string): Promise<ImmigrationQuizQuestionStudent[]> {
  const { data, error } = await withQueryTimeout(
    supabase
      .from('immigration_quiz_questions')
      .select('id, lesson_slug, position, question_text, option_a, option_b, option_c, option_d')
      .eq('lesson_slug', lessonSlug)
      .order('position', { ascending: true }),
    12_000,
    'fetchImmigrationQuiz',
  );
  if (error) throw error;
  return (data ?? []) as ImmigrationQuizQuestionStudent[];
}

/** Submit answers; server computes the score (anti-cheat). */
export async function submitImmigrationQuiz(
  lessonSlug: string, answers: number[],
): Promise<ImmigrationQuizResult> {
  const { data, error } = await withQueryTimeout(
    supabase.rpc('submit_immigration_quiz_attempt', {
      p_lesson_slug: lessonSlug, p_answers: answers,
    }),
    15_000,
    'submitImmigrationQuiz',
  );
  if (error) throw error;
  return data as ImmigrationQuizResult;
}

/** Fetch the student's personal note for a lesson. */
export async function fetchImmigrationNote(lessonSlug: string): Promise<string> {
  const { data, error } = await withQueryTimeout(
    supabase
      .from('immigration_notes')
      .select('content')
      .eq('lesson_slug', lessonSlug)
      .maybeSingle(),
    10_000,
    'fetchImmigrationNote',
  );
  if (error) throw error;
  return (data?.content as string) ?? '';
}

/** Save the student's personal note for a lesson. */
export async function saveImmigrationNote(lessonSlug: string, content: string): Promise<void> {
  const { data, error } = await withQueryTimeout(
    supabase.rpc('upsert_immigration_note', {
      p_lesson_slug: lessonSlug, p_content: content,
    }),
    12_000,
    'saveImmigrationNote',
  );
  if (error) throw error;
  const result = data as { ok?: boolean; error?: string } | null;
  if (!result?.ok) throw new Error(result?.error || 'IMMIGRATION_NOTE_SAVE_FAILED');
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
  const { data, error } = await supabase.rpc('admin_list_immigration_quiz_questions');
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

// ── Lesson media : VDOCipher video id + publish flag (mig 035) ──────────
export interface ImmigrationLessonMedia {
  lesson_slug: string;
  vdocipher_video_id: string | null;
  is_published: boolean;
}

/** Student : video id + publish state for ONE lesson (null row = no video yet). */
export async function fetchImmigrationLessonMedia(lessonSlug: string): Promise<ImmigrationLessonMedia | null> {
  const { data, error } = await withQueryTimeout(
    supabase
      .from('immigration_lessons')
      .select('lesson_slug, vdocipher_video_id, is_published')
      .eq('lesson_slug', lessonSlug)
      .maybeSingle(),
    12_000,
    'fetchImmigrationLessonMedia',
  );
  if (error) throw error;
  return (data as ImmigrationLessonMedia) ?? null;
}

/** Admin : every media row (lessons without a row simply aren't returned). */
export async function adminFetchAllImmigrationLessons(): Promise<ImmigrationLessonMedia[]> {
  const { data, error } = await supabase
    .from('immigration_lessons')
    .select('lesson_slug, vdocipher_video_id, is_published');
  if (error) throw error;
  return (data ?? []) as ImmigrationLessonMedia[];
}

/** Admin : upsert a lesson's video id + publish flag. */
export async function adminSetImmigrationLesson(
  lessonSlug: string, vdocipherVideoId: string | null, isPublished: boolean,
): Promise<void> {
  const { data, error } = await supabase.rpc('admin_set_immigration_lesson', {
    p_lesson_slug: lessonSlug,
    p_vdocipher_video_id: vdocipherVideoId,
    p_is_published: isPublished,
  });
  if (error) throw error;
  const res = data as { ok: boolean; error?: string };
  if (!res?.ok) throw new Error(res?.error || 'Erreur enregistrement.');
}
