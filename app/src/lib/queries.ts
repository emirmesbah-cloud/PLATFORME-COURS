// Centralized React Query keys + queries.
import { supabase } from './supabase';

// Timeout wrapper for Supabase queries — empêche les fetches qui hang
// (ISP lent, edge réseau bizarre, Supabase Realtime down) de bloquer
// le dashboard indéfiniment. Reject = TanStack Query treat as error.
// On laisse retry: 1 du QueryClient gérer un retry rapide.
type AbortablePromiseLike<T> = PromiseLike<T> & {
  abortSignal?: (signal: AbortSignal) => PromiseLike<T>;
};

export function withQueryTimeout<T>(p: AbortablePromiseLike<T>, ms = 10000, label = 'query'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    const request = typeof p.abortSignal === 'function'
      ? p.abortSignal(controller.signal)
      : p;
    const timer = setTimeout(
      () => {
        controller.abort();
        reject(new Error(`[Aurel] ${label} timed out after ${ms}ms (slow network?)`));
      },
      ms,
    );
    Promise.resolve(request).then(
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
  Payment, PaymentMethod, PaymentCurrency, AccountingStats, Course,
  WebinarGroup, WebinarGroupSlug,
  RotationFunnel, RotationLink, RotationState, RotationOverview,
  DeliveryOrder, DeliveryMode, EcomWilaya, EcomCommune, EcomStopdesk,
  EcomOrderHistoryEvent, WebinarLead, WebinarLeadActivity, WebinarLeadStatus,
  StaffMember, WebinarFormSettings, ReadinessSimulatorSettings,
} from './types';

// SHERLOCK R14 — H10 : profile shape côté admin inclut revoked_at + reason
// (champs DB pas exposés sur le type Profile public). Type local pour les
// 2 RPCs admin students concernées.
export interface AdminStudentRow extends Profile {
  revoked_at: string | null;
  revoked_reason: string | null;
  activation_code: string | null;
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
  adminWebinarGroups: ['admin', 'webinar_groups'] as const,
  adminRotation: (funnel: string) => ['admin', 'webinar_rotation', funnel] as const,
  // Quiz
  quizQuestions: (lessonId: string) => ['quiz_questions', lessonId] as const,
  quizQuestionsStudent: (lessonId: string) => ['quiz_questions', 'student', lessonId] as const,
  myQuizStatus: (uid: string) => ['quiz_status', uid] as const,
  adminAllQuizQuestions: ['admin', 'quiz_questions'] as const,
  // Accounting
  adminPayments: (filters?: unknown) => ['admin', 'payments', filters] as const,
  adminAccountingStats: ['admin', 'accounting_stats'] as const,
  // Delivery
  adminDeliveryOrders: ['admin', 'delivery_orders'] as const,
  ecomConnection: ['admin', 'ecom', 'connection'] as const,
  ecomWilayas: ['admin', 'ecom', 'wilayas'] as const,
  ecomCommunes: (wilayaId: number) => ['admin', 'ecom', 'communes', wilayaId] as const,
  ecomStopdesks: (wilayaId: number) => ['admin', 'ecom', 'stopdesks', wilayaId] as const,
  publicEcomWilayas: ['public', 'ecom', 'wilayas'] as const,
  publicEcomCommunes: (wilayaId: number) => ['public', 'ecom', 'communes', wilayaId] as const,
  // Webinar CRM
  adminWebinarLeads: ['admin', 'webinar_leads'] as const,
  adminStaff: ['admin', 'staff'] as const,
  webinarFormSettings: ['webinar_form_settings'] as const,
  readinessSimulatorSettings: ['admin', 'readiness_simulator_settings'] as const,
  adminSalesAnalytics: ['admin', 'sales_analytics'] as const,
  adminCloserPerformance: ['admin', 'closer_performance'] as const,
  adminFunnelOverview: ['admin', 'funnel_overview'] as const,
  adminCodHealth: ['admin', 'cod_health'] as const,
  webinarLead: (leadId: string) => ['admin', 'webinar_lead', leadId] as const,
  webinarLeadHistory: (leadId: string) => ['admin', 'webinar_lead_history', leadId] as const,
  deliveryOrderHistory: (orderId: string) => ['admin', 'delivery_order_history', orderId] as const,
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

export async function fetchBonusForCourse(
  course: 'pflege' | 'immigration',
): Promise<BonusResource[]> {
  const { data, error } = await withQueryTimeout(
    supabase
      .from('bonus_resources')
      .select('*')
      .eq('course', course)
      .order('order_index', { ascending: true }),
    10000,
    'fetchBonusForCourse',
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
// Response shape : { ok, otp, playbackInfo, lesson }
// `lesson` is a debug label only ("pflege-3" / "immigration-<slug>") — the
// function serves both courses, so it is not a lesson number anymore.
// On any error : throws with the upstream error message for the UI to display.
export interface VdocipherOtpResponse {
  ok: true;
  otp: string;
  playbackInfo: string;
  lesson?: string;
}
export async function fetchVdocipherOtp(videoId: string): Promise<VdocipherOtpResponse> {
  const env = (import.meta as { env: Record<string, string> }).env;
  const url = `${env.VITE_SUPABASE_URL}/functions/v1/vdocipher-otp`;

  // Helper to do the actual fetch with whatever access token is current.
  const doFetch = async (accessToken: string) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ video_id: videoId }),
        signal: controller.signal,
      });
      const body = await r.json().catch(() => ({}));
      return { status: r.status, ok: r.ok, body };
    } finally {
      window.clearTimeout(timer);
    }
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
  course?: Course | null;
  isUsed?: boolean | null;
  search?: string;
} = {}): Promise<ActivationCode[]> {
  const pageSize = 1000;
  const rows: ActivationCode[] = [];
  for (let from = 0; ; from += pageSize) {
    let q = supabase.from('activation_codes').select('*').order('created_at', { ascending: false });
    if (filters.tier) q = q.eq('tier', filters.tier);
    if (filters.course) q = q.eq('course', filters.course);
    if (typeof filters.isUsed === 'boolean') q = q.eq('is_used', filters.isUsed);
    if (filters.search) q = q.ilike('code', `%${filters.search}%`);
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as ActivationCode[]));
    if ((data?.length ?? 0) < pageSize) break;
  }
  return rows;
}

// SHERLOCK R14 — H10 : option `includeRevoked` pour permettre à AdminStudents
// d'afficher (ou pas) les comptes révoqués. Par défaut FALSE : on ne pollue
// pas la vue par défaut avec des comptes morts. Quand ON, on récupère
// aussi revoked_at + revoked_reason pour afficher un badge "Révoqué".
export async function fetchAllStudents(
  opts: { includeRevoked?: boolean } = {},
): Promise<AdminStudentRow[]> {
  const pageSize = 1000;
  const profiles: (Profile & { revoked_at: string | null; revoked_reason: string | null })[] = [];
  for (let from = 0; ; from += pageSize) {
    let q = supabase
      .from('profiles')
      .select('*')
      .eq('is_admin', false)
      .eq('staff_role', 'student')
      .order('created_at', { ascending: false });
    if (!opts.includeRevoked) q = q.is('revoked_at', null);
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) throw error;
    profiles.push(...((data ?? []) as typeof profiles));
    if ((data?.length ?? 0) < pageSize) break;
  }
  if (profiles.length === 0) return [];
  const ids = profiles.map((profile) => profile.id);
  const usedCodes: { code: string; used_by_user_id: string | null }[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error: codeError } = await supabase
      .from('activation_codes')
      .select('code, used_by_user_id')
      .in('used_by_user_id', ids.slice(offset, offset + 100));
    if (codeError) throw codeError;
    usedCodes.push(...((data ?? []) as typeof usedCodes));
  }
  const byUser = new Map(usedCodes.map((row) => [row.used_by_user_id as string, row.code]));
  return profiles.map((profile) => ({ ...profile, activation_code: byUser.get(profile.id) ?? null }));
}

export async function fetchStaffMembers(): Promise<StaffMember[]> {
  const { data, error } = await supabase.from('staff_members').select('*').order('created_at');
  if (error) throw error;
  return (data ?? []) as StaffMember[];
}

export async function upsertStaffMember(input: Partial<StaffMember> & { first_name: string; email: string }) {
  const payload = {
    ...(input.id ? { id: input.id } : {}),
    first_name: input.first_name.trim(),
    last_name: (input.last_name ?? '').trim(),
    email: input.email.trim().toLowerCase(),
    whatsapp: input.whatsapp?.trim() || null,
    permissions: input.permissions ?? ['prospects'],
    tasks: input.tasks ?? [],
    is_active: input.is_active ?? true,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('staff_members').upsert(payload);
  if (error) throw error;
}

export async function provisionCloserAccount(email: string, sendAccessEmail = true): Promise<{ created: boolean; email_sent: boolean }> {
  const { data, error } = await supabase.functions.invoke('closer-access', {
    body: { action: 'provision', email: email.trim().toLowerCase(), send_access_email: sendAccessEmail },
  });
  if (error) throw error;
  const result = data as { ok?: boolean; error?: string; created?: boolean; email_sent?: boolean } | null;
  if (!result?.ok) throw new Error(result?.error || 'PROVISION_FAILED');
  return { created: !!result.created, email_sent: !!result.email_sent };
}

export async function notifyCloserPasswordChanged(): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke('closer-access', {
    body: { action: 'password-changed' },
  });
  if (error) throw error;
  const result = data as { ok?: boolean; error?: string; email_sent?: boolean } | null;
  if (!result?.ok) throw new Error(result?.error || 'PASSWORD_NOTIFICATION_FAILED');
  return !!result.email_sent;
}

export async function fetchWebinarFormSettings(publicView = false): Promise<WebinarFormSettings> {
  if (publicView) {
    const env = (import.meta as { env: Record<string, string> }).env;
    const response = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/webinar-lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: env.VITE_SUPABASE_ANON_KEY },
      body: JSON.stringify({ action: 'settings' }),
    });
    const body = await response.json();
    if (!response.ok || !body?.ok) throw new Error(body?.error || 'SETTINGS_UNAVAILABLE');
    return body.settings as WebinarFormSettings;
  }
  const { data, error } = await supabase.from('webinar_form_settings').select('*').eq('id', true).single();
  if (error) throw error;
  return data as WebinarFormSettings;
}

export async function saveWebinarFormSettings(settings: Partial<WebinarFormSettings>) {
  const { error } = await supabase.from('webinar_form_settings').update({
    ...settings,
    updated_at: new Date().toISOString(),
  }).eq('id', true);
  if (error) throw error;
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
    is_public: false,
    publish_consent: args.isPublic,
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
  const { data: feedback, error: readError } = await supabase
    .from('feedback')
    .select('publish_consent')
    .eq('id', id)
    .single();
  if (readError) throw readError;
  const { error } = await supabase
    .from('feedback')
    .update({
      is_approved: isApproved,
      is_public: isApproved && feedback.publish_consent,
    })
    .eq('id', id);
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

// ── Admin: webinar WhatsApp destinations ────────────────────────────────────
export async function fetchWebinarGroups(): Promise<WebinarGroup[]> {
  const { data, error } = await withQueryTimeout(
    supabase
      .from('webinar_groups')
      .select('slug, whatsapp_group_code, updated_at')
      .order('slug', { ascending: true }),
    10000,
    'fetchWebinarGroups',
  );
  if (error) throw error;
  return (data ?? []) as WebinarGroup[];
}

export async function updateWebinarGroup(
  slug: WebinarGroupSlug,
  whatsappGroupCode: string,
): Promise<WebinarGroup> {
  const { data, error } = await supabase
    .from('webinar_groups')
    .update({ whatsapp_group_code: whatsappGroupCode })
    .eq('slug', slug)
    .select('slug, whatsapp_group_code, updated_at')
    .single();
  if (error) throw error;
  return data as WebinarGroup;
}

// ── Admin: WhatsApp group ROTATION (immigration + tiktok) ───────────────────
// Reads go straight to the two RLS-protected tables (admins only); every write
// goes through a SECURITY DEFINER RPC that validates codes and audit-logs.
export async function fetchRotationOverview(
  funnel: RotationFunnel,
): Promise<RotationOverview> {
  const [linksRes, stateRes] = await Promise.all([
    withQueryTimeout(
      supabase
        // SELECT * (not an explicit column list) so the admin card keeps loading
        // even in the window after this code deploys but BEFORE the `label`
        // migration (20260820000061) is applied — a missing column then just
        // reads as undefined instead of failing the whole query.
        .from('webinar_rotation_links')
        .select('*')
        .eq('funnel', funnel)
        .order('position', { ascending: true }),
      10000,
      'fetchRotationLinks',
    ),
    withQueryTimeout(
      supabase
        .from('webinar_rotation_state')
        .select('funnel, current_lot, assign_counter, emergency_code, all_full_alerted, updated_at')
        .eq('funnel', funnel)
        .maybeSingle(),
      10000,
      'fetchRotationState',
    ),
  ]);
  if (linksRes.error) throw linksRes.error;
  if (stateRes.error) throw stateRes.error;
  return {
    links: (linksRes.data ?? []) as RotationLink[],
    state: (stateRes.data ?? null) as RotationState | null,
  };
}

export async function rpcAddRotationLinks(funnel: RotationFunnel, codes: string[]) {
  const { data, error } = await supabase.rpc('add_rotation_links', {
    p_funnel: funnel,
    p_codes: codes,
  });
  if (error) throw error;
  return data as { ok: boolean; added: number; lot: number };
}

export async function rpcStartNewRotationLot(funnel: RotationFunnel, codes: string[]) {
  const { data, error } = await supabase.rpc('start_new_rotation_lot', {
    p_funnel: funnel,
    p_codes: codes,
  });
  if (error) throw error;
  return data as { ok: boolean; lot: number; added: number };
}

export async function rpcSetEmergencyLink(funnel: RotationFunnel, code: string) {
  const { data, error } = await supabase.rpc('set_emergency_link', {
    p_funnel: funnel,
    p_code: code,
  });
  if (error) throw error;
  return data as { ok: boolean; code: string | null };
}

export async function rpcRemoveRotationLink(linkId: string) {
  const { data, error } = await supabase.rpc('remove_rotation_link', {
    p_link_id: linkId,
  });
  if (error) throw error;
  return data as { ok: boolean; deleted?: boolean; retired?: boolean; error?: string };
}

export async function rpcRenameRotationLink(linkId: string, label: string) {
  const { data, error } = await supabase.rpc('rename_rotation_link', {
    p_link_id: linkId,
    p_label: label,
  });
  if (error) throw error;
  return data as { ok: boolean; label: string | null; error?: string };
}

export async function rpcAdjustRotationLink(linkId: string, count: number) {
  const { data, error } = await supabase.rpc('adjust_rotation_link', {
    p_link_id: linkId,
    p_count: count,
  });
  if (error) throw error;
  return data as { ok: boolean; count: number; status: string; error?: string };
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
    supabase.rpc('admin_list_quiz_questions'),
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

export async function adminUpsertQuizQuestion(q: AdminQuestionInput): Promise<void> {
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
    ? supabase.from('quiz_questions').update(payload).eq('id', q.id).select('id').single()
    : supabase.from('quiz_questions').insert(payload).select('id').single();
  const { data, error } = await q$;
  if (error) throw error;
  await logAdminAction(q.id ? 'quiz_question_updated' : 'quiz_question_created',
                       'quiz_question', data.id,
                       { lesson_id: q.lesson_id, position: q.position });
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
  course?: Course | null;
  method?: PaymentMethod | null;
  // ISO date strings, inclusive on `from`, exclusive on `to` (so use the
  // start of the next day for "until end of day X").
  from?: string | null;
  to?: string | null;
  // Free-text search on student name/email
  search?: string | null;
}

export async function fetchAdminPayments(filters: PaymentFilters = {}): Promise<Payment[]> {
  const { data, error } = await withQueryTimeout(
    supabase.rpc('admin_list_payments', {
      p_status: filters.status ?? null,
      p_tier: filters.tier ?? null,
      p_method: filters.method ?? null,
      p_from: filters.from ?? null,
      p_to: filters.to ?? null,
      p_course: filters.course ?? null,
    }),
    15000,
    'fetchAdminPayments',
  );
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

export async function adminCreateLesson(input: Omit<Lesson, 'id' | 'created_at'>) {
  const { error } = await supabase.from('lessons').insert(input);
  if (error) throw error;
}

// ============================================================================
// E-com Delivery order ledger (mig 20260817000050)
// ============================================================================

export interface CreateDeliveryOrderInput {
  customer_name: string;
  mobile_1: string;
  mobile_2?: string | null;
  wilaya_id: number;
  wilaya_name: string;
  commune?: string | null;
  delivery_mode: DeliveryMode;
  stopdesk_code?: string | null;
  address?: string | null;
  course: Course;
  article: string;
  ecom_ref_article?: string | null;
  quantity: number;
  cod_amount: number;
  supplier_notes?: string | null;
  activation_code_id?: string | null;
  webinar_lead_id?: string | null;
}

export async function fetchDeliveryOrders(): Promise<DeliveryOrder[]> {
  const pageSize = 1000;
  const rows: DeliveryOrder[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await withQueryTimeout(
      supabase
        .from('delivery_orders')
        .select('*, activation_code:activation_codes(code)')
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1),
      15000,
      `fetchDeliveryOrders:${from}`,
    );
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as DeliveryOrder[]));
    if ((data?.length ?? 0) < pageSize) break;
  }
  return rows;
}

export async function createDeliveryOrder(input: CreateDeliveryOrderInput): Promise<DeliveryOrder> {
  const { data, error } = await supabase
    .from('delivery_orders')
    .insert({
      ...input,
      mobile_2: input.mobile_2 || null,
      commune: input.delivery_mode === 'domicile' ? input.commune || null : null,
      stopdesk_code: input.delivery_mode === 'stopdesk' ? input.stopdesk_code || null : null,
      address: input.address || null,
      supplier_notes: input.supplier_notes || null,
      ecom_ref_article: input.ecom_ref_article || null,
      activation_code_id: input.activation_code_id || null,
      webinar_lead_id: input.webinar_lead_id || null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as DeliveryOrder;
}

export async function updateDeliveryOrder(orderId: string, input: CreateDeliveryOrderInput): Promise<DeliveryOrder> {
  const { data, error } = await supabase
    .from('delivery_orders')
    .update({
      ...input,
      mobile_2: input.mobile_2 || null,
      commune: input.delivery_mode === 'domicile' ? input.commune || null : null,
      stopdesk_code: input.delivery_mode === 'stopdesk' ? input.stopdesk_code || null : null,
      address: input.address || null,
      supplier_notes: input.supplier_notes || null,
      ecom_ref_article: input.ecom_ref_article || null,
      activation_code_id: input.activation_code_id || null,
      webinar_lead_id: input.webinar_lead_id || null,
      sync_status: 'draft',
      last_error: null,
    })
      .eq('id', orderId)
      .is('ecom_tracking', null)
      .is('deleted_at', null)
      .neq('sync_status', 'syncing')
      .select('*')
    .single();
  if (error) throw error;
  return data as DeliveryOrder;
}

export async function deleteDeliveryOrder(orderId: string): Promise<void> {
  await invokeEcom({ action: 'delete-order', order_id: orderId });
}

type EcomBridgeResponse<T = unknown> = {
  ok: boolean;
  error?: string;
  detail?: unknown;
} & T;

async function invokeEcom<T = unknown>(body: Record<string, unknown>): Promise<EcomBridgeResponse<T>> {
  const { data, error } = await supabase.functions.invoke('ecom-delivery', { body });
  if (error) {
    let message = error.message;
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
    if (context?.json) {
      try {
        const detail = await context.json() as { error?: string };
        if (detail?.error) message = detail.error;
      } catch { /* The response body may already have been consumed. */ }
    }
    throw new Error(message);
  }
  const result = data as EcomBridgeResponse<T>;
  if (!result?.ok) throw new Error(result?.error || 'ECOM_REQUEST_FAILED');
  return result;
}

export async function fetchEcomConnection() {
  return invokeEcom<{
    connected: boolean;
    account_name: string | null;
    stock: boolean;
    webhook_ready: boolean;
  }>({ action: 'connection' });
}

export async function configureEcomWebhook() {
  return invokeEcom<{ webhook_ready: boolean }>({ action: 'configure-webhook' });
}

export async function fetchEcomWilayas(): Promise<EcomWilaya[]> {
  const result = await invokeEcom<{ items: EcomWilaya[] }>({ action: 'wilayas' });
  return result.items;
}

export async function fetchEcomCommunes(wilayaId: number): Promise<EcomCommune[]> {
  const result = await invokeEcom<{ items: EcomCommune[] }>({ action: 'communes', wilaya_id: wilayaId });
  return result.items.filter((item) => item.livrable);
}

export async function fetchEcomStopdesks(wilayaId: number): Promise<EcomStopdesk[]> {
  const result = await invokeEcom<{ items: EcomStopdesk[] }>({ action: 'stopdesks', wilaya_id: wilayaId });
  return result.items;
}

export async function syncDeliveryOrder(orderId: string): Promise<DeliveryOrder> {
  const result = await invokeEcom<{ order: DeliveryOrder }>({ action: 'sync', order_id: orderId });
  return result.order;
}

export async function updateDeliveryOrderDestination(input: {
  orderId: string;
  wilayaId: number;
  commune: string;
  address: string | null;
}): Promise<DeliveryOrder> {
  const result = await invokeEcom<{ order: DeliveryOrder }>({
    action: 'update-destination',
    order_id: input.orderId,
    wilaya_id: input.wilayaId,
    commune: input.commune,
    address: input.address,
  });
  return result.order;
}

export async function refreshDeliveryOrder(orderId: string): Promise<DeliveryOrder> {
  const result = await invokeEcom<{ order: DeliveryOrder }>({ action: 'refresh', order_id: orderId });
  return result.order;
}

export async function fetchReadinessSimulatorSettings(): Promise<ReadinessSimulatorSettings> {
  const { data, error } = await withQueryTimeout(
    supabase
      .from('readiness_simulator_settings')
      .select('id, live_url, updated_at, updated_by')
      .eq('id', true)
      .single(),
    10000,
    'fetchReadinessSimulatorSettings',
  );
  if (error) throw error;
  return data as ReadinessSimulatorSettings;
}

export async function saveReadinessSimulatorLiveUrl(liveUrl: string): Promise<ReadinessSimulatorSettings> {
  const { data, error } = await supabase.rpc('admin_set_readiness_live_url', {
    p_live_url: liveUrl,
  });
  if (error) throw error;
  return data as ReadinessSimulatorSettings;
}

export async function fetchDeliveryOrderHistory(orderId: string): Promise<{ order: DeliveryOrder; history: EcomOrderHistoryEvent[] }> {
  const result = await invokeEcom<{ order: DeliveryOrder; history?: EcomOrderHistoryEvent[] }>({ action: 'refresh', order_id: orderId });
  return { order: result.order, history: Array.isArray(result.history) ? result.history : [] };
}

export async function confirmDeliveryOrder(orderId: string): Promise<DeliveryOrder> {
  const result = await invokeEcom<{ order: DeliveryOrder }>({ action: 'confirm', order_id: orderId });
  return result.order;
}

// ============================================================================
// Webinar prospect CRM (mig 20260817000051)
// ============================================================================

const LEAD_WITH_DELIVERY = '*';

type WebinarDeliveryStatus = {
  webinar_lead_id: string;
  id: string;
  ecom_tracking: string | null;
  ecom_situation: string | null;
};

export async function fetchWebinarLeads(): Promise<WebinarLead[]> {
  const pageSize = 1000;
  const leads: WebinarLead[] = [];
  for (let from = 0; ; from += pageSize) {
    let { data, error } = await withQueryTimeout(
      supabase
        .from('webinar_leads')
        .select(LEAD_WITH_DELIVERY)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1),
      15000,
      `fetchWebinarLeads:${from}`,
    );
    // Zero-downtime schema rollout: if a frontend bundle reaches one browser
    // before the additive soft-delete migration, keep the CRM usable until the
    // migration workflow catches up. Once the column exists, archived rows are
    // always excluded by the primary query above.
    if (error?.code === '42703') {
      const fallback = await withQueryTimeout(
        supabase
          .from('webinar_leads')
          .select(LEAD_WITH_DELIVERY)
          .order('created_at', { ascending: false })
          .range(from, from + pageSize - 1),
        15000,
        `fetchWebinarLeadsLegacy:${from}`,
      );
      data = fallback.data;
      error = fallback.error;
    }
    if (error) throw error;
    leads.push(...((data ?? []) as unknown as WebinarLead[]));
    if ((data?.length ?? 0) < pageSize) break;
  }

  // delivery_orders is deliberately admin-only through RLS.  Closers receive
  // only the three display fields below through a scoped SECURITY DEFINER RPC,
  // then we merge them into the same shape used by the desktop/mobile cards.
  const deliveryStatuses: WebinarDeliveryStatus[] = [];
  let deliveryStatusError: { code?: string } | null = null;
  for (let from = 0; ; from += pageSize) {
    const result = await withQueryTimeout(
      supabase.rpc('staff_get_webinar_delivery_statuses').range(from, from + pageSize - 1),
      15000,
      `fetchWebinarDeliveryStatuses:${from}`,
    );
    if (result.error) {
      deliveryStatusError = result.error;
      break;
    }
    const page = (result.data ?? []) as WebinarDeliveryStatus[];
    deliveryStatuses.push(...page);
    if (page.length < pageSize) break;
  }

  // Keep the admin screen operational during a staggered rollout where the app
  // bundle arrives just before the migration.  Real database errors still fail
  // loudly; only PostgREST's missing-function cache response uses the legacy
  // nested result temporarily.
  if (deliveryStatusError) {
    if (deliveryStatusError.code === 'PGRST202') return leads;
    throw deliveryStatusError;
  }

  const statusByLead = new Map<string, WebinarLead['delivery_orders']>();
  for (const row of deliveryStatuses) {
    statusByLead.set(row.webinar_lead_id, [{
      id: row.id,
      ecom_tracking: row.ecom_tracking,
      ecom_situation: row.ecom_situation,
    }]);
  }

  return leads.map((lead) => ({
    ...lead,
    delivery_orders: statusByLead.get(lead.id) ?? lead.delivery_orders ?? [],
  }));
}

// Assign via the RPC so the closer's user id is resolved + stored (RLS scopes
// closers by id, not by name).
export async function assignWebinarLeadCloser(leadId: string, closerName: string): Promise<void> {
  const { error } = await supabase.rpc('admin_assign_leads_closer', { p_lead_ids: [leadId], p_closer_name: closerName.trim() });
  if (error) throw error;
}

// All closer writes go through a narrow security-definer RPC. RLS itself is
// SELECT-only for closers, so protected fields cannot be changed by crafting a
// direct PostgREST request outside the UI.
export async function updateWebinarLeadStatus(
  leadId: string,
  status: WebinarLeadStatus,
  note?: string | null,
  nextFollowUpAt?: string | null,
  callAttempt?: number | null,
): Promise<void> {
  const { error } = await supabase.rpc('staff_update_webinar_lead', {
    p_lead_id: leadId,
    p_status: status,
    p_note: note?.trim() ? note.trim().slice(0, 2000) : null,
    p_update_note: false,
    p_next_follow_up_at: nextFollowUpAt || null,
    p_call_attempt: callAttempt || null,
  });
  if (error) throw error;
}

// Free-text note about a prospect (separate from call notes). Editable by any
// staff member with prospect access via the RLS policy.
export async function updateWebinarLeadNote(leadId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('staff_update_webinar_lead', {
    p_lead_id: leadId,
    p_status: null,
    p_note: note.trim() ? note.trim().slice(0, 2000) : null,
    p_update_note: true,
    p_next_follow_up_at: null,
    p_call_attempt: null,
  });
  if (error) throw error;
}

export async function fetchWebinarLeadHistory(leadId: string): Promise<WebinarLeadActivity[]> {
  const { data, error } = await withQueryTimeout(
    supabase.rpc('staff_get_webinar_lead_history', { p_lead_id: leadId }),
    15000,
    'fetchWebinarLeadHistory',
  );
  if (error) throw error;
  return Array.isArray(data) ? data as WebinarLeadActivity[] : [];
}

export async function assignWebinarLeadsCloser(leadIds: string[], closerName: string): Promise<void> {
  if (leadIds.length === 0) return;
  const { error } = await supabase.rpc('admin_assign_leads_closer', { p_lead_ids: leadIds, p_closer_name: closerName.trim() });
  if (error) throw error;
}

export async function bulkSetLeadStatus(leadIds: string[], status: WebinarLeadStatus): Promise<number> {
  if (leadIds.length === 0) return 0;
  const { data, error } = await supabase.rpc('admin_bulk_set_lead_status', { p_lead_ids: leadIds, p_status: status });
  if (error) throw error;
  return (data as { updated?: number })?.updated ?? 0;
}

export async function bulkCreateOrders(leadIds: string[]): Promise<{ created: number; skipped: number }> {
  if (leadIds.length === 0) return { created: 0, skipped: 0 };
  const { data, error } = await supabase.rpc('admin_bulk_create_orders', { p_lead_ids: leadIds });
  if (error) throw error;
  const r = data as { created?: number; skipped?: number };
  return { created: r?.created ?? 0, skipped: r?.skipped ?? 0 };
}

export async function fetchWebinarLead(leadId: string): Promise<WebinarLead | null> {
  const { data, error } = await supabase
    .from('webinar_leads')
    .select(LEAD_WITH_DELIVERY)
    .eq('id', leadId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return data as never;
}

export interface WebinarLeadSubmission {
  full_name: string;
  phone: string;
  email: string;
  ready_to_pay: boolean;
  wilaya_id: number;
  wilaya_name: string;
  commune: string;
  address: string;
  website?: string;
  extra_answers?: Record<string, string>;
}

async function invokePublicWebinar<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('webinar-lead', { body });
  if (error) {
    let message = error.message;
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
    if (context?.json) {
      try {
        const detail = await context.json() as { error?: string };
        if (detail.error) message = detail.error;
      } catch { /* response body may already be consumed */ }
    }
    throw new Error(message);
  }
  const result = data as { ok?: boolean; error?: string } & T;
  if (!result?.ok) throw new Error(result?.error || 'SUBMISSION_FAILED');
  return result;
}

export async function fetchPublicEcomWilayas(): Promise<EcomWilaya[]> {
  const result = await invokePublicWebinar<{ items: EcomWilaya[] }>({ action: 'wilayas' });
  return result.items;
}

export async function fetchPublicEcomCommunes(wilayaId: number): Promise<EcomCommune[]> {
  const result = await invokePublicWebinar<{ items: EcomCommune[] }>({ action: 'communes', wilaya_id: wilayaId });
  return result.items;
}

export async function submitWebinarLead(input: WebinarLeadSubmission): Promise<{ already_registered?: boolean; not_eligible?: boolean }> {
  const result = await invokePublicWebinar<{ already_registered?: boolean; duplicate?: boolean; not_eligible?: boolean }>({ ...input });
  return { already_registered: result.already_registered ?? result.duplicate, not_eligible: result.not_eligible };
}

export async function logWebinarCall(input: {
  leadId: string;
  status: WebinarLeadStatus;
  closerName: string;
  note?: string | null;
  nextFollowUpAt?: string | null;
}): Promise<WebinarLead> {
  const { data, error } = await supabase.rpc('admin_log_webinar_call', {
    p_lead_id: input.leadId,
    p_status: input.status,
    p_closer_name: input.closerName,
    p_note: input.note || null,
    p_next_follow_up_at: input.nextFollowUpAt || null,
  });
  if (error) throw error;
  return data as WebinarLead;
}

export async function confirmWebinarPurchase(input: {
  leadId: string;
  closerName: string;
  note?: string | null;
}): Promise<{ ok: true; order_id: string; created: boolean }> {
  const { data, error } = await supabase.rpc('admin_confirm_webinar_purchase', {
    p_lead_id: input.leadId,
    p_closer_name: input.closerName,
    p_note: input.note || null,
  });
  if (error) throw error;
  return data as { ok: true; order_id: string; created: boolean };
}

export async function logWebinarCallWithOrder(input: {
  leadId: string;
  status: WebinarLeadStatus;
  closerName: string;
  note?: string | null;
  nextFollowUpAt?: string | null;
}): Promise<{ ok: true; order_id: string; created: boolean }> {
  const { data, error } = await supabase.rpc('admin_log_webinar_call_with_order', {
    p_lead_id: input.leadId,
    p_status: input.status,
    p_closer_name: input.closerName,
    p_note: input.note || null,
    p_next_follow_up_at: input.nextFollowUpAt || null,
  });
  if (error) throw error;
  return data as { ok: true; order_id: string; created: boolean };
}

export async function deleteWebinarLead(leadId: string): Promise<void> {
  await invokeEcom({ action: 'delete-lead', lead_id: leadId });
}

export async function fetchSalesAnalytics(): Promise<import('./types').SalesAnalytics | null> {
  const { data, error } = await withQueryTimeout(
    supabase.rpc('admin_get_sales_analytics'),
    15000,
    'fetchSalesAnalytics',
  );
  if (error) throw error;
  const result = data as import('./types').SalesAnalytics;
  return result?.ok ? result : null;
}

export async function fetchCloserPerformance(): Promise<import('./types').CloserPerformance | null> {
  const { data, error } = await withQueryTimeout(
    supabase.rpc('admin_get_closer_performance'),
    15000,
    'fetchCloserPerformance',
  );
  if (error) throw error;
  const result = data as import('./types').CloserPerformance;
  return result?.ok ? result : null;
}

export async function fetchFunnelOverview(): Promise<import('./types').FunnelOverview | null> {
  const { data, error } = await withQueryTimeout(
    supabase.rpc('admin_get_funnel_overview'),
    15000,
    'fetchFunnelOverview',
  );
  if (error) throw error;
  const result = data as import('./types').FunnelOverview;
  return result?.ok ? result : null;
}

export async function fetchCodHealth(): Promise<import('./types').CodHealth | null> {
  const { data, error } = await withQueryTimeout(
    supabase.rpc('admin_get_cod_health'),
    15000,
    'fetchCodHealth',
  );
  if (error) throw error;
  const result = data as import('./types').CodHealth;
  return result?.ok ? result : null;
}
