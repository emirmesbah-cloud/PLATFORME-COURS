// DB types (1:1 mapping with Phase 1 schema)

export type Tier = 'autonome' | 'accompagne';

export interface Profile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  whatsapp: string;
  tier: Tier;
  activated_at: string;
  diplome_algerien: string | null;
  created_at: string;
  last_login_at: string | null;
  is_admin: boolean;
  // Disclaimer gate (migration 20260520000027) — both NULL until user opens
  // /disclaimer (started_at) and completes the wall-clock + consent flow
  // (acknowledged_at). Admins auto-acked at migration time.
  disclaimer_started_at: string | null;
  disclaimer_acknowledged_at: string | null;
}

export interface Lesson {
  id: string;
  lesson_number: number;
  title: string;
  subtitle: string;
  duration_minutes: number;
  vdocipher_video_id: string | null;
  module_parent: string;
  phase: string;
  order_index: number;
  is_published: boolean;
  created_at: string;
}

export interface LessonProgress {
  id: string;
  user_id: string;
  lesson_id: string;
  watched_seconds: number;
  completed: boolean;
  completed_at: string | null;
  last_position_seconds: number;
  updated_at: string;
}

export interface BonusResource {
  id: string;
  name: string;
  description: string;
  file_url: string | null;
  file_type: string;
  order_index: number;
  is_published: boolean;
  created_at: string;
}

export interface ActivationCode {
  id: string;
  code: string;
  tier: Tier;
  is_used: boolean;
  used_by_user_id: string | null;
  used_at: string | null;
  created_at: string;
  created_by: string | null;
  notes: string | null;
}

export interface ProgressSummary {
  ok: true;
  total_lessons: number;
  completed_lessons: number;
  percentage_complete: number;
  total_watched_seconds: number;
  last_lesson_watched: number | null;
}

export interface AdminStats {
  ok: true;
  total_students: number;
  active_week: number;
  codes_total: number;
  codes_used: number;
  codes_available: number;
  avg_completion: number;
}

// ── Phase 3 ────────────────────────────────────────────────────

export interface LessonNote {
  id: string;
  user_id: string;
  lesson_id: string;
  content: string;
  updated_at: string;
}

export interface Certificate {
  id: string;
  user_id: string;
  certificate_number: string;
  issued_at: string;
  pdf_url: string | null;
  full_name_on_certificate: string;
  course_completion_date: string;
}

export interface CertificateResult {
  ok: boolean;
  created?: boolean;
  certificate_id?: string;
  certificate_number?: string;
  error?: string;
  completed?: number;
  total?: number;
  remaining?: number;
}

export interface Feedback {
  id: string;
  user_id: string;
  rating: number;
  testimonial: string | null;
  would_recommend: boolean;
  is_public: boolean;
  is_approved: boolean;
  submitted_at: string;
}

export interface EmailLog {
  id: string;
  user_id: string | null;
  email_type: string;
  recipient_email: string;
  subject: string;
  sent_at: string;
  status: 'sent' | 'failed' | 'pending';
  provider_message_id: string | null;
  error_message: string | null;
}

export interface AdminAuditLog {
  id: string;
  admin_user_id: string;
  action_type: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface AdvancedAnalytics {
  ok: true;
  acquisition: { day: string; tier: string; new_students: number }[] | null;
  engagement: {
    total_codes: number;
    codes_used: number;
    activation_rate: number;
    completion_rate: number;
    avg_completion_days: number;
    active_last_30d: number;
  };
  daily_minutes: { day: string; minutes: number }[] | null;
  funnel: { lesson_number: number; title: string; started: number; completed: number }[] | null;
  feedback_dist: { rating: number; n: number }[] | null;
  nps: { total: number; recommend: number; percent: number };
  top_engaged: {
    id: string; first_name: string; last_name: string; email: string; tier: string; total_seconds: number;
  }[] | null;
  top_fast: {
    id: string; first_name: string; last_name: string; email: string; tier: string; days_to_complete: number;
  }[] | null;
}
