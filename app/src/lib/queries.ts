// Centralized React Query keys + queries.
import { supabase } from './supabase';

// Timeout wrapper for Supabase queries — empêche les fetches qui hang
// (ISP lent, edge réseau bizarre, Supabase Realtime down) de bloquer
// le dashboard indéfiniment. Reject = TanStack Query treat as error.
// On laisse retry: 1 du QueryClient gérer un retry rapide.
function withQueryTimeout<T>(p: PromiseLike<T>, ms = 10000, label = 'query'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`[Aurel] ${label} timed out after ${ms}ms (slow network?)`)),
      ms,
    );
    Promise.resolve(p).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
import type {
  Lesson, LessonProgress, BonusResource, ActivationCode,
  Profile, ProgressSummary, AdminStats,
  LessonNote, Certificate, CertificateResult, Feedback, EmailLog,
  AdminAuditLog, AdvancedAnalytics,
} from './types';

// SHERLOCK R14 — H10 : profile shape côté admin inclut revoked_at + reason
// (champs DB pas exposés sur le type Profile public). Type local pour les
// 2 RPCs admin students concernées.
export interface AdminStudentRow extends Profile {
  revoked_at: string | null;
  revoked_reason: string | null;
}

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
  // Phase 3
  lessonNote: (uid: string, lessonId: string) => ['lesson_notes', uid, lessonId] as const,
  certificate: (uid: string) => ['certificate', uid] as const,
  feedback: (uid: string) => ['feedback', uid] as const,
  adminAnalytics: ['admin', 'analytics'] as const,
  adminFeedback: ['admin', 'feedback'] as const,
  adminEmails: ['admin', 'emails'] as const,
  adminAudit: ['admin', 'audit'] as const,
};

// ── Lessons ────────────────────────────────────────────────────
export async function fetchLessons(): Promise<Lesson[]> {
  const { data, error } = await withQueryTimeout(
    supabase.from('lessons').select('*').order('lesson_number', { ascending: true }),
    10000,
    'fetchLessons',
  );
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
  const { data, error } = await withQueryTimeout(
    supabase.from('bonus_resources').select('*').order('order_index', { ascending: true }),
    10000,
    'fetchBonus',
  );
  if (error) throw error;
  return data as BonusResource[];
}

// ── Progress ───────────────────────────────────────────────────
export async function fetchUserProgress(userId: string): Promise<LessonProgress[]> {
  const { data, error } = await withQueryTimeout(
    supabase.from('lesson_progress').select('*').eq('user_id', userId),
    10000,
    'fetchUserProgress',
  );
  if (error) throw error;
  return data as LessonProgress[];
}

export async function fetchProgressSummary(): Promise<ProgressSummary | null> {
  const { data, error } = await withQueryTimeout(
    supabase.rpc('get_user_progress_summary'),
    10000,
    'fetchProgressSummary',
  );
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

// SHERLOCK R14 — H10 : option `includeRevoked` pour permettre à AdminStudents
// d'afficher (ou pas) les comptes révoqués. Par défaut FALSE : on ne pollue
// pas la vue par défaut avec des comptes morts. Quand ON, on récupère
// aussi revoked_at + revoked_reason pour afficher un badge "Révoqué".
export async function fetchAllStudents(
  opts: { includeRevoked?: boolean } = {},
): Promise<AdminStudentRow[]> {
  let q = supabase
    .from('profiles')
    .select('*')
    .eq('is_admin', false)
    .order('created_at', { ascending: false });
  if (!opts.includeRevoked) q = q.is('revoked_at', null);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AdminStudentRow[];
}

// SHERLOCK R14 — H9 : RPC admin_revoke_user(uuid, text). Signature dans
// migration 016 (sherlock_r3_backend) + 009 (soft_delete). Retourne
// { ok, error?, already_revoked? }. Idempotent : 2e appel retourne
// ALREADY_REVOKED sans rollback.
export async function rpcAdminRevokeUser(userId: string, reason: string)
: Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('admin_revoke_user', {
    p_user_id: userId,
    p_reason: reason,
  });
  if (error) throw error;
  return data as { ok: true } | { ok: false; error: string };
}

// SHERLOCK R14 — H9 : call edge function admin-purge-user (GDPR Art. 17).
// La function fait : RPC SQL admin_purge_user + auth.admin.deleteUser via
// service_role. Le caller doit être admin authentifié — la function vérifie
// auth.uid() côté SQL.
export async function callAdminPurgeUser(userId: string, reason?: string)
: Promise<{ ok: true; anon_email: string } | { ok: false; error: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) return { ok: false, error: 'NOT_AUTHENTICATED' };
  const url = `${(import.meta as { env: Record<string, string> }).env.VITE_SUPABASE_URL}/functions/v1/admin-purge-user`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'apikey': (import.meta as { env: Record<string, string> }).env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ user_id: userId, reason: reason ?? null }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body?.ok) {
    return { ok: false, error: body?.error || `HTTP ${r.status}` };
  }
  return body;
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

// ============================================================================
// Phase 3 — queries
// ============================================================================

// ── Lesson notes ───────────────────────────────────────────────
export async function fetchLessonNote(userId: string, lessonId: string): Promise<LessonNote | null> {
  const { data, error } = await supabase
    .from('lesson_notes')
    .select('*')
    .eq('user_id', userId)
    .eq('lesson_id', lessonId)
    .maybeSingle();
  if (error) throw error;
  return data as LessonNote | null;
}

export async function upsertLessonNote(userId: string, lessonId: string, content: string) {
  const { error } = await supabase
    .from('lesson_notes')
    .upsert(
      { user_id: userId, lesson_id: lessonId, content, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,lesson_id' }
    );
  if (error) throw error;
}

// ── Certificate ────────────────────────────────────────────────
export async function fetchCertificate(userId: string): Promise<Certificate | null> {
  const { data, error } = await supabase
    .from('certificates')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as Certificate | null;
}

// Alias for backward compat
export const fetchUserCertificate = fetchCertificate;

export async function rpcCheckAndIssueCertificate(): Promise<CertificateResult> {
  const { data, error } = await supabase.rpc('check_and_issue_certificate');
  if (error) throw error;
  return data as CertificateResult;
}

// ── Feedback ───────────────────────────────────────────────────
export async function fetchOwnFeedback(userId: string): Promise<Feedback | null> {
  const { data, error } = await supabase
    .from('feedback')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as Feedback | null;
}

export async function submitFeedback(args: {
  userId: string;
  rating: number;
  testimonial: string | null;
  wouldRecommend: boolean;
  isPublic: boolean;
}) {
  const { error } = await supabase.from('feedback').insert({
    user_id: args.userId,
    rating: args.rating,
    testimonial: args.testimonial,
    would_recommend: args.wouldRecommend,
    is_public: args.isPublic,
    is_approved: false,
  });
  if (error) throw error;
}

// ── Admin: feedback moderation ─────────────────────────────────
export async function fetchAdminFeedback(): Promise<(Feedback & { profile?: Pick<Profile, 'first_name' | 'last_name' | 'email'> })[]> {
  const { data, error } = await supabase
    .from('feedback')
    .select('*, profile:profiles(first_name, last_name, email)')
    .order('submitted_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as never;
}

export async function adminToggleFeedbackApproved(id: string, isApproved: boolean) {
  const { error } = await supabase.from('feedback').update({ is_approved: isApproved }).eq('id', id);
  if (error) throw error;
  await logAdminAction('feedback_updated', 'feedback', id, { is_approved: isApproved });
}

// ── Admin: analytics ───────────────────────────────────────────
export async function fetchAdvancedAnalytics(): Promise<AdvancedAnalytics | null> {
  const { data, error } = await supabase.rpc('admin_get_advanced_analytics');
  if (error) throw error;
  if (!data || (data as { ok: boolean }).ok === false) return null;
  return data as AdvancedAnalytics;
}

// ── Admin: emails ──────────────────────────────────────────────
export async function fetchEmailLogs(filters: { status?: string; emailType?: string; limit?: number } = {}): Promise<EmailLog[]> {
  let q = supabase.from('email_logs').select('*').order('sent_at', { ascending: false });
  if (filters.status)    q = q.eq('status', filters.status);
  if (filters.emailType) q = q.eq('email_type', filters.emailType);
  q = q.limit(filters.limit ?? 200);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as EmailLog[];
}

// ── Admin: audit ───────────────────────────────────────────────
export async function fetchAuditLogs(filters: { actionType?: string; limit?: number } = {}): Promise<AdminAuditLog[]> {
  let q = supabase.from('admin_audit_logs').select('*').order('created_at', { ascending: false });
  if (filters.actionType) q = q.eq('action_type', filters.actionType);
  q = q.limit(filters.limit ?? 200);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AdminAuditLog[];
}

export async function logAdminAction(
  actionType: string,
  targetType: string | null = null,
  targetId: string | null = null,
  metadata: Record<string, unknown> | null = null
) {
  const { error } = await supabase.rpc('log_admin_action', {
    p_action_type: actionType,
    p_target_type: targetType,
    p_target_id: targetId,
    p_metadata: metadata,
  });
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[Aurel] logAdminAction failed', error);
  }
}
