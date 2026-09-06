// DB types (1:1 mapping with Phase 1 schema)

export type Tier = 'autonome' | 'accompagne';
export type Course = 'pflege' | 'immigration';

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
  // Single-course gating : which course this student bought. Default 'pflege'.
  course_access?: Course;
  staff_role?: 'student' | 'closer' | 'admin';
  staff_permissions?: string[];
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
  course: 'pflege' | 'immigration';
  created_at: string;
}

export interface ActivationCode {
  id: string;
  code: string;
  tier: Tier;
  course: Course;
  is_used: boolean;
  used_by_user_id: string | null;
  used_at: string | null;
  created_at: string;
  created_by: string | null;
  notes: string | null;
  document_reference_number: number | null;
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

export type WebinarGroupSlug = 'immigration' | 'pflege' | 'tiktok';

export interface WebinarGroup {
  slug: WebinarGroupSlug;
  whatsapp_group_code: string;
  updated_at: string;
}

// ── WhatsApp group rotation (mig 20260819000057) — immigration + tiktok only ──
export type RotationFunnel = 'immigration' | 'tiktok';
export type RotationLinkStatus = 'active' | 'full' | 'retired';

export interface RotationLink {
  id: string;
  funnel: RotationFunnel;
  whatsapp_code: string;
  label: string | null;
  lot_number: number;
  position: number;
  status: RotationLinkStatus;
  unique_ip_count: number;
  alerted_990: boolean;
  created_at: string;
  created_by: string | null;
}

export interface RotationState {
  funnel: RotationFunnel;
  current_lot: number;
  assign_counter: number;
  emergency_code: string | null;
  all_full_alerted: boolean;
  updated_at: string;
}

export interface RotationOverview {
  links: RotationLink[];
  state: RotationState | null;
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
  publish_consent: boolean;
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

// ── Quiz (mig 20260524000028) ─────────────────────────────────────
// One row per multiple-choice question. correct_index points to A/B/C/D.
export interface QuizQuestion {
  id: string;
  lesson_id: string;
  position: number;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_index: 0 | 1 | 2 | 3;
  explanation: string | null;
  created_at: string;
  updated_at: string;
}

// One row per attempt. Immutable audit trail.
export interface QuizAttempt {
  id: string;
  user_id: string;
  lesson_id: string;
  score: number;
  total: number;
  passed: boolean;
  answers: number[];
  attempted_at: string;
}

// Server response shape from RPC submit_quiz_attempt.
export interface QuizSubmissionResult {
  ok: boolean;
  error?: string;
  attempt_id?: string;
  score?: number;
  total?: number;
  passed?: boolean;
  threshold?: number;
  correct?: number[];
}

// Per-lesson status row from RPC get_my_quiz_status.
export interface QuizLessonStatus {
  lesson_id: string;
  lesson_number: number;
  has_questions: boolean;
  best_score: number;
  total: number;
  passed: boolean;
  attempts: number;
}

// ── Accounting (mig 20260524000030) ──────────────────────────────
export type PaymentMethod =
  | 'cash' | 'ccp' | 'baridi' | 'bank_transfer' | 'international_transfer' | 'other';
export type PaymentStatus = 'pending' | 'recorded' | 'cancelled';
export type PaymentCurrency = 'DZD' | 'EUR';

export interface Payment {
  id: string;
  activation_code_id: string | null;
  user_id: string;
  tier: Tier;
  course: Course;
  list_price_dzd: number;
  method: PaymentMethod | null;
  amount: number | null;
  currency: PaymentCurrency | null;
  notes: string | null;
  status: PaymentStatus;
  created_at: string;
  recorded_at: string | null;
  recorded_by: string | null;
  updated_at: string;
  // Enrichi par fetchAdminPayments (jointure profiles)
  profile?: Pick<Profile, 'first_name' | 'last_name' | 'email'>;
  // Enrichi par fetchAdminPayments (jointure activation_codes pour le code lui-même)
  activation_code?: { code: string; course: Course } | null;
}

export interface AccountingStats {
  ok: true;
  this_month: { dzd: number; eur: number; count: number };
  last_month: { dzd: number; eur: number; count: number };
  ytd:        { dzd: number; eur: number; count: number };
  pending:    number;
  pending_dzd: number;
  by_course:  { course: Course; dzd: number; eur: number; count: number }[];
  by_tier:    { tier: string; dzd: number; eur: number; count: number }[];
  by_method:  { method: string; dzd: number; eur: number; count: number }[];
  monthly:    { month: string; dzd: number; eur: number; count: number }[];
}

// ── E-com Delivery orders (mig 20260817000050) ────────────────
export type DeliveryMode = 'domicile' | 'stopdesk';
export type DeliverySyncStatus = 'draft' | 'syncing' | 'synced' | 'failed';

export interface DeliveryOrder {
  id: string;
  external_reference: string;
  customer_name: string;
  mobile_1: string;
  mobile_2: string | null;
  wilaya_id: number;
  wilaya_name: string;
  commune: string | null;
  delivery_mode: DeliveryMode;
  stopdesk_code: string | null;
  address: string | null;
  course: Course;
  article: string;
  ecom_ref_article: string | null;
  quantity: number;
  cod_amount: number;
  supplier_notes: string | null;
  activation_code_id: string | null;
  webinar_lead_id: string | null;
  sync_status: DeliverySyncStatus;
  ecom_tracking: string | null;
  ecom_parcel_id: number | null;
  ecom_situation: string | null;
  ecom_logistics_state: string | null;
  ecom_delivery_fee: number | null;
  ecom_confirmed: boolean;
  ecom_collected: boolean;
  ecom_recovered: boolean;
  last_error: string | null;
  last_synced_at: string | null;
  last_event_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_from_ecom_at?: string | null;
  deleted_from_ecom_event_id?: string | null;
  deleted_at?: string | null;
  deleted_by?: string | null;
  deleted_reason?: string | null;
  sync_started_at?: string | null;
  activation_code?: { code: string } | null;
}

export interface EcomOrderHistoryEvent {
  date?: string | null;
  heure?: string | null;
  situation?: string | null;
  etat?: string | null;
  etat_logistique?: string | null;
  commentaire?: string | null;
  note?: string | null;
  [key: string]: unknown;
}

export interface StaffMember {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  whatsapp: string | null;
  role: 'closer';
  permissions: string[];
  tasks: string[];
  auth_user_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WebinarFormExtraField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'select';
  required: boolean;
  options?: string[];
}

export interface WebinarFormSettings {
  id: boolean;
  eyebrow: string;
  title: string;
  description: string;
  image_url: string | null;
  sections: { id: string; title: string; description: string }[];
  extra_fields: WebinarFormExtraField[];
  google_sheet_url: string | null;
  backup_webhook_url?: string | null;
  updated_at: string;
}

export interface ReadinessSimulatorSettings {
  id: boolean;
  live_url: string;
  updated_at: string;
  updated_by: string | null;
}

// ── Webinar prospect CRM (mig 20260817000051) ─────────────────
export type WebinarLeadStatus =
  | 'new' | 'to_call' | 'nrp' | 'callback' | 'not_interested'
  | 'confirmed' | 'in_delivery' | 'delivered' | 'returned';

export interface WebinarLead {
  id: string;
  full_name: string;
  phone_raw: string;
  phone_normalized: string;
  email: string;
  attended_live: boolean | null;
  ready_to_pay: boolean | null;
  wilaya_id: number;
  wilaya_name: string;
  commune: string;
  address: string;
  source: string;
  campaign: string;
  status: WebinarLeadStatus;
  closer_name: string | null;
  closer_user_id: string | null;
  call_count: number;
  last_call_at: string | null;
  next_follow_up_at: string | null;
  latest_call_note: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
  deleted_reason?: string | null;
  delivery_orders?: Pick<DeliveryOrder, 'id' | 'ecom_tracking' | 'ecom_situation'>[];
}

export interface WebinarLeadActivity {
  id: string;
  lead_id: string;
  activity_type: 'submitted' | 'call' | 'status' | 'delivery' | 'assignment' | 'assignment_evidence' | 'contact' | 'note';
  status: WebinarLeadStatus | null;
  previous_status?: WebinarLeadStatus | null;
  note: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  actor_name?: string | null;
  actor_role?: 'admin' | 'closer' | 'system' | 'unknown';
  created_at: string;
}

export interface EcomWilaya {
  id: number;
  libelle: string;
  domicile: boolean;
  stopdesk: boolean;
}

export interface EcomCommune {
  id: number;
  id_wilaya: number;
  commune: string;
  code_postal: number | null;
  livrable: boolean;
}

export interface EcomStopdesk {
  id: number;
  id_wilaya: number;
  nom_bureau: string;
  code_stopdesk: string;
  adresse: string | null;
  commune: string | null;
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

export interface SalesAnalytics {
  ok: true;
  prospects: {
    total: number; to_contact: number; not_interested: number; converted: number; conversion_rate: number;
  };
  orders: {
    total: number; waiting: number; sent: number; failed: number; delivered: number; returned: number; cod_total: number;
  };
  prospect_status: { status: WebinarLeadStatus; n: number }[];
  orders_by_day: { day: string; n: number; amount: number }[];
}

export interface CloserPerformanceRow {
  closer_name: string;
  assigned: number;
  calls: number;
  confirmed: number;
  delivered: number;
  returned: number;
  cod_confirmed: number;
  cod_delivered: number;
  confirmation_rate: number;
  delivery_rate: number;
}

export interface CloserPerformance {
  ok: true;
  from_date?: string;
  closers: CloserPerformanceRow[];
  totals: { closers: number; assigned: number; calls: number; confirmed: number; delivered: number; cod_delivered: number };
}

export interface FunnelOverview {
  ok: true;
  registered: number;
  attended: number;
  called: number;
  confirmed: number;
  shipped: number;
  delivered: number;
  collected: number;
  returned: number;
  cod_confirmed: number;
  cod_delivered: number;
  cod_collected: number;
}

export interface CodWilayaRow {
  wilaya_id: number;
  wilaya_name: string;
  orders: number;
  shipped: number;
  delivered: number;
  returned: number;
  in_transit: number;
  collected: number;
  cod_collected: number;
  delivery_rate: number;
  return_rate: number;
}

export interface CodHealth {
  ok: true;
  totals: {
    orders: number; shipped: number; delivered: number; returned: number; in_transit: number; collected: number;
    cod_confirmed: number; cod_delivered: number; cod_collected: number; cod_returned: number;
    delivery_rate: number; return_rate: number;
  };
  by_wilaya: CodWilayaRow[];
}
