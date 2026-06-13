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
  QuizQuestion, QuizSubmissionResult, QuizLessonStatus,
  Payment, PaymentMethod, PaymentCurrency, AccountingStats,
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
  // Quiz
  quizQuestions: (lessonId: string) => ['quiz_questions', lessonId] as const,
  quizQuestionsStudent: (lessonId: string) => ['quiz_questions', 'student', lessonId] as const,
  myQuizStatus: (uid: string) => ['quiz_status', uid] as const,
  adminAllQuizQuestions: ['admin', 'quiz_questions'] as const,
  // Accounting
  adminPayments: (filters?: unknown) => ['admin', 'payments', filters] as const,
  adminAccountingStats: ['admin', 'accounting_stats'] as const,
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

// ── VDOCipher OTP signing (edge function) ───────────────────────
// Fetches a one-time-use OTP + playbackInfo from our vdocipher-otp Edge
// Function. The function verifies the user is authenticated, the video
// belongs to a published lesson (anti-OTP-fishing), then mints an OTP
// with a 5-min TTL and per-user watermark via VDOCipher's secret API key.
//
// Response shape : { ok, otp, playbackInfo, lesson_number }
// On any error : throws with the upstream error message for the UI to display.
export interface VdocipherOtpResponse {
  ok: true;
  otp: string;
  playbackInfo: string;
  lesson_number?: number;
}
export async function fetchVdocipherOtp(videoId: string): Promise<VdocipherOtpResponse> {
  const env = (import.meta as { env: Record<string, string> }).env;
  const url = `${env.VITE_SUPABASE_URL}/functions/v1/vdocipher-otp`;

  // Helper to do the actual fetch with whatever access token is current.
  const doFetch = async (accessToken: string) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'apikey': env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ video_id: videoId }),
    });
    const body = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok, body };
  };

  // 1. Grab the current access token.
  let { data: sessionData } = await supabase.auth.getSession();
  let accessToken = sessionData.session?.access_token;

  // 2. If we have no session OR the call returns NOT_AUTHENTICATED, try to
  // refresh the session once before giving up. This covers the case where
  // the stored JWT is expired but the refresh token is still valid — common
  // on phones that haven't been opened in a few hours.
  if (!accessToken) {
    try {
      const refreshed = await supabase.auth.refreshSession();
      accessToken = refreshed.data.session?.access_token;
    } catch { /* fall through */ }
  }
  if (!accessToken) throw new Error('NOT_AUTHENTICATED');

  let resp = await doFetch(accessToken);

  // 3. If the Edge Function says NOT_AUTHENTICATED (e.g. our JWT is fresh
  // locally but server-side it's dead), force a refresh + retry once more.
  if (!resp.ok && (resp.status === 401 || resp.body?.error === 'NOT_AUTHENTICATED')) {
    try {
      const refreshed = await supabase.auth.refreshSession();
      const newToken = refreshed.data.session?.access_token;
      if (newToken) {
        resp = await doFetch(newToken);
      }
    } catch { /* keep the original error */ }
  }

  if (!resp.ok || !resp.body?.ok) {
    const err = resp.body?.error || `HTTP ${resp.status}`;
    throw new Error(`vdocipher-otp: ${err}`);
  }
  return resp.body as VdocipherOtpResponse;
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
  course?: 'pflege' | 'immigration';
}): Promise<{ ok: true; codes: string[]; tier: string; course: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('admin_generate_codes', {
    p_tier: args.tier,
    p_count: args.count,
    p_notes: args.notes ?? null,
    p_course: args.course ?? 'pflege',
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
// Single-course gating : set which course a student can access.
export async function rpcAdminSetCourseAccess(userId: string, course: 'pflege' | 'immigration')
: Promise<{ ok: true; course: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('admin_set_course_access', {
    p_user_id: userId,
    p_course: course,
  });
  if (error) throw error;
  const res = data as { ok: boolean; course?: string; error?: string };
  if (res.ok) {
    await logAdminAction('course_access_set', 'profile', userId, { course });
  }
  return res as { ok: true; course: string } | { ok: false; error: string };
}

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

// ============================================================================
// Quiz (mig 20260524000028 / 029)
// ============================================================================

// ── Student side ───────────────────────────────────────────────
// Fetch the questions for ONE lesson. We DON'T expose correct_index in the
// student-facing shape (it's still on the row from DB — we hide it client-side
// to make accidental UI leaks harder). The real cheat-protection is in the
// `submit_quiz_attempt` RPC, which recomputes the score server-side.
export type QuizQuestionForStudent = Omit<QuizQuestion, 'correct_index' | 'explanation'>;

export async function fetchQuizQuestionsForStudent(lessonId: string): Promise<QuizQuestionForStudent[]> {
  const { data, error } = await withQueryTimeout(
    supabase
      .from('quiz_questions')
      .select('id, lesson_id, position, question_text, option_a, option_b, option_c, option_d, created_at, updated_at')
      .eq('lesson_id', lessonId)
      .order('position', { ascending: true }),
    10000,
    'fetchQuizQuestionsForStudent',
  );
  if (error) throw error;
  return (data ?? []) as QuizQuestionForStudent[];
}

// Server scores it. Pass the answers in the same position-order as the
// questions returned by fetchQuizQuestionsForStudent. Unanswered = -1
// (server treats null/anything-other-than-correct as wrong).
export async function submitQuizAttempt(
  lessonId: string,
  answers: number[],
): Promise<QuizSubmissionResult> {
  const { data, error } = await supabase.rpc('submit_quiz_attempt', {
    p_lesson_id: lessonId,
    p_answers: answers,
  });
  if (error) throw error;
  return data as QuizSubmissionResult;
}

// One round-trip → status of every lesson for the current user.
// Used by Lessons / LessonCard to know what's locked.
export async function fetchMyQuizStatus(): Promise<QuizLessonStatus[]> {
  const { data, error } = await withQueryTimeout(
    supabase.rpc('get_my_quiz_status'),
    10000,
    'fetchMyQuizStatus',
  );
  if (error) throw error;
  if (!data || (data as { ok: boolean }).ok === false) return [];
  return ((data as { lessons: QuizLessonStatus[] }).lessons ?? []);
}

// ── Admin side ─────────────────────────────────────────────────
// Full row including correct_index + explanation, for the admin CRUD page.
export async function adminFetchAllQuizQuestions(): Promise<QuizQuestion[]> {
  const { data, error } = await withQueryTimeout(
    supabase
      .from('quiz_questions')
      .select('*')
      .order('lesson_id', { ascending: true })
      .order('position', { ascending: true }),
    10000,
    'adminFetchAllQuizQuestions',
  );
  if (error) throw error;
  return (data ?? []) as QuizQuestion[];
}

export interface AdminQuestionInput {
  id?: string;
  lesson_id: string;
  position: number;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_index: 0 | 1 | 2 | 3;
  explanation: string | null;
}

export async function adminUpsertQuizQuestion(q: AdminQuestionInput): Promise<QuizQuestion> {
  const payload = {
    lesson_id:     q.lesson_id,
    position:      q.position,
    question_text: q.question_text,
    option_a:      q.option_a,
    option_b:      q.option_b,
    option_c:      q.option_c,
    option_d:      q.option_d,
    correct_index: q.correct_index,
    explanation:   q.explanation,
  };
  const q$ = q.id
    ? supabase.from('quiz_questions').update(payload).eq('id', q.id).select().single()
    : supabase.from('quiz_questions').insert(payload).select().single();
  const { data, error } = await q$;
  if (error) throw error;
  await logAdminAction(q.id ? 'quiz_question_updated' : 'quiz_question_created',
                       'quiz_question', (data as QuizQuestion).id,
                       { lesson_id: q.lesson_id, position: q.position });
  return data as QuizQuestion;
}

export async function adminDeleteQuizQuestion(id: string): Promise<void> {
  const { error } = await supabase.from('quiz_questions').delete().eq('id', id);
  if (error) throw error;
  await logAdminAction('quiz_question_deleted', 'quiz_question', id);
}


// ============================================================================
// Accounting (mig 20260524000030)
// ============================================================================
export interface PaymentFilters {
  status?: 'pending' | 'recorded' | 'cancelled' | null;
  tier?: 'autonome' | 'accompagne' | null;
  method?: PaymentMethod | null;
  // ISO date strings, inclusive on `from`, exclusive on `to` (so use the
  // start of the next day for "until end of day X").
  from?: string | null;
  to?: string | null;
  // Free-text search on student name/email
  search?: string | null;
}

export async function fetchAdminPayments(filters: PaymentFilters = {}): Promise<Payment[]> {
  let q = supabase
    .from('payments')
    .select('*, profile:profiles(first_name, last_name, email), activation_code:activation_codes(code)')
    .order('created_at', { ascending: false });

  if (filters.status) q = q.eq('status', filters.status);
  if (filters.tier)   q = q.eq('tier', filters.tier);
  if (filters.method) q = q.eq('method', filters.method);
  if (filters.from)   q = q.gte('created_at', filters.from);
  if (filters.to)     q = q.lt('created_at', filters.to);

  const { data, error } = await withQueryTimeout(q.limit(2000), 15000, 'fetchAdminPayments');
  if (error) throw error;

  // Free-text search côté client (jointure profiles n'est pas filtrable via
  // .ilike côté supabase-js — petite quantité de rows, OK pour le scope).
  let rows = (data ?? []) as Payment[];
  if (filters.search && filters.search.trim()) {
    const needle = filters.search.trim().toLowerCase();
    rows = rows.filter((p) => {
      const fn = p.profile?.first_name?.toLowerCase() ?? '';
      const ln = p.profile?.last_name?.toLowerCase() ?? '';
      const em = p.profile?.email?.toLowerCase() ?? '';
      const code = p.activation_code?.code?.toLowerCase() ?? '';
      return fn.includes(needle) || ln.includes(needle) || em.includes(needle) || code.includes(needle);
    });
  }
  return rows;
}

export async function fetchAccountingStats(): Promise<AccountingStats | null> {
  const { data, error } = await withQueryTimeout(
    supabase.rpc('admin_get_accounting_stats'),
    10000,
    'fetchAccountingStats',
  );
  if (error) throw error;
  if (!data || (data as { ok: boolean }).ok === false) return null;
  return data as AccountingStats;
}

export async function recordPayment(args: {
  paymentId: string;
  method: PaymentMethod;
  amount: number;
  currency: PaymentCurrency;
  notes?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('admin_record_payment', {
    p_payment_id: args.paymentId,
    p_method:     args.method,
    p_amount:     args.amount,
    p_currency:   args.currency,
    p_notes:      args.notes ?? null,
  });
  if (error) throw error;
  const res = data as { ok: boolean; error?: string };
  if (res.ok) {
    await logAdminAction('payment_recorded', 'payment', args.paymentId, {
      method: args.method, amount: args.amount, currency: args.currency,
    });
  }
  return res;
}

export async function cancelPayment(paymentId: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('admin_cancel_payment', {
    p_payment_id: paymentId,
  });
  if (error) throw error;
  const res = data as { ok: boolean; error?: string };
  if (res.ok) {
    await logAdminAction('payment_cancelled', 'payment', paymentId);
  }
  return res;
}
