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
