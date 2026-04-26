// Centralized React Query keys + queries.
import { supabase } from './supabase';
import type {
  Lesson, LessonProgress, BonusResource, ActivationCode,
  Profile, ProgressSummary, AdminStats,
} from './types';

export const queryKeys = {
  lessons: ['lessons'] as const,
  lesson: (n: number) => ['lessons', n] as const,
  bonus: ['bonus_resources'] as const,
  progress: (uid: string) => ['lesson_progress', uid] as const,
  progressSummary: (uid: string) => ['progress_summary', uid] as const,
  profile: (uid: string) => ['profile', uid] as const,
  adminStats: ['admin', 'stats'] as const,
  adminCodes: ['admin', 'codes'] as const,
  adminStudents: ['admin', 'students'] as const,
};

// ── Lessons ────────────────────────────────────────────────────
export async function fetchLessons(): Promise<Lesson[]> {
  const { data, error } = await supabase
    .from('lessons')
    .select('*')
    .order('lesson_number', { ascending: true });
  if (error) throw error;
  return data as Lesson[];
}

export async function fetchLessonByNumber(n: number): Promise<Lesson | null> {
  const { data, error } = await supabase
    .from('lessons')
    .select('*')
    .eq('lesson_number', n)
    .maybeSingle();
  if (error) throw error;
  return data as Lesson | null;
}

// ── Bonus ──────────────────────────────────────────────────────
export async function fetchBonus(): Promise<BonusResource[]> {
  const { data, error } = await supabase
    .from('bonus_resources')
    .select('*')
    .order('order_index', { ascending: true });
  if (error) throw error;
  return data as BonusResource[];
}

// ── Progress ───────────────────────────────────────────────────
export async function fetchUserProgress(userId: string): Promise<LessonProgress[]> {
  const { data, error } = await supabase
    .from('lesson_progress')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
  return data as LessonProgress[];
}

export async function fetchProgressSummary(): Promise<ProgressSummary | null> {
  const { data, error } = await supabase.rpc('get_user_progress_summary');
  if (error) throw error;
  if (!data || (data as { ok: boolean }).ok === false) return null;
  return data as ProgressSummary;
}

export async function rpcUpdateLessonProgress(args: {
  lessonId: string;
  watchedSeconds: number;
  positionSeconds: number;
}) {
  const { data, error } = await supabase.rpc('update_lesson_progress', {
    p_lesson_id: args.lessonId,
    p_watched_seconds: args.watchedSeconds,
    p_position_seconds: args.positionSeconds,
  });
  if (error) throw error;
  return data;
}

// ── Bonus download (signed URL + log) ──────────────────────────
export async function getBonusSignedUrl(bonus: BonusResource): Promise<string | null> {
  if (!bonus.file_url) return null; // pas encore uploadé
  const { data, error } = await supabase
    .storage
    .from('bonus-resources')
    .createSignedUrl(bonus.file_url, 3600);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

export async function logBonusDownload(bonusId: string, userId: string) {
  const { error } = await supabase
    .from('bonus_downloads')
    .insert({ bonus_resource_id: bonusId, user_id: userId });
  if (error) throw error;
}

// ── Admin ──────────────────────────────────────────────────────
export async function rpcAdminGenerateCodes(args: {
  tier: 'autonome' | 'accompagne';
  count: number;
  notes?: string;
}): Promise<{ ok: true; codes: string[]; tier: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('admin_generate_codes', {
    p_tier: args.tier,
    p_count: args.count,
    p_notes: args.notes ?? null,
  });
  if (error) throw error;
  return data;
}

export async function fetchAdminStats(): Promise<AdminStats | null> {
  const { data, error } = await supabase.rpc('admin_get_stats');
  if (error) throw error;
  if (!data || (data as { ok: boolean }).ok === false) return null;
  return data as AdminStats;
}

export async function fetchAdminCodes(filters: {
  tier?: 'autonome' | 'accompagne' | null;
  isUsed?: boolean | null;
  search?: string;
} = {}): Promise<ActivationCode[]> {
  let q = supabase.from('activation_codes').select('*').order('created_at', { ascending: false });
  if (filters.tier)   q = q.eq('tier', filters.tier);
  if (typeof filters.isUsed === 'boolean') q = q.eq('is_used', filters.isUsed);
  if (filters.search) q = q.ilike('code', `%${filters.search}%`);
  const { data, error } = await q.limit(500);
  if (error) throw error;
  return data as ActivationCode[];
}

export async function fetchAllStudents(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('is_admin', false)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as Profile[];
}

export async function adminUpdateLesson(
  lessonId: string,
  patch: Partial<Pick<Lesson, 'vdocipher_video_id' | 'is_published'>>
) {
  const { error } = await supabase.from('lessons').update(patch).eq('id', lessonId);
  if (error) throw error;
}

export async function adminUpdateBonus(
  bonusId: string,
  patch: Partial<Pick<BonusResource, 'file_url' | 'is_published'>>
) {
  const { error } = await supabase.from('bonus_resources').update(patch).eq('id', bonusId);
  if (error) throw error;
}
