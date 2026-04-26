-- ============================================================================
-- Aurel Academy — Phase 3
-- Migration 007 : tables + RPC pour notes, certificats, feedback, emails, audit
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. lesson_notes (notes personnelles par leçon, auto-save)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lesson_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id   UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  content     TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS lesson_notes_user_idx   ON lesson_notes (user_id);
CREATE INDEX IF NOT EXISTS lesson_notes_lesson_idx ON lesson_notes (lesson_id);

ALTER TABLE lesson_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own notes" ON lesson_notes;
CREATE POLICY "Users manage own notes"
  ON lesson_notes FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ----------------------------------------------------------------------------
-- 2. certificates (1 certificat par étudiant qui complète les 18 leçons)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS certificates (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  certificate_number          TEXT UNIQUE NOT NULL,
  issued_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pdf_url                     TEXT,
  full_name_on_certificate    TEXT NOT NULL,
  course_completion_date      DATE NOT NULL
);

CREATE INDEX IF NOT EXISTS certificates_user_idx     ON certificates (user_id);
CREATE INDEX IF NOT EXISTS certificates_number_idx   ON certificates (certificate_number);

ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own certificate"     ON certificates;
DROP POLICY IF EXISTS "Admins read all certificates"   ON certificates;

CREATE POLICY "Users read own certificate"
  ON certificates FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins read all certificates"
  ON certificates FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));


-- ----------------------------------------------------------------------------
-- 3. feedback (témoignages étudiants après complétion)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  rating            INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  testimonial       TEXT,
  would_recommend   BOOLEAN NOT NULL,
  is_public         BOOLEAN NOT NULL DEFAULT FALSE,
  is_approved       BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS feedback_user_idx       ON feedback (user_id);
CREATE INDEX IF NOT EXISTS feedback_approved_idx   ON feedback (is_approved, is_public);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users insert own feedback"           ON feedback;
DROP POLICY IF EXISTS "Users read own feedback"             ON feedback;
DROP POLICY IF EXISTS "Admins manage all feedback"          ON feedback;
DROP POLICY IF EXISTS "Public read approved feedback"       ON feedback;

CREATE POLICY "Users insert own feedback"
  ON feedback FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users read own feedback"
  ON feedback FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins manage all feedback"
  ON feedback FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Public read approved feedback"
  ON feedback FOR SELECT
  TO anon, authenticated
  USING (is_public = TRUE AND is_approved = TRUE);


-- ----------------------------------------------------------------------------
-- 4. email_logs (logs des emails transactionnels envoyés via Resend)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email_type            TEXT NOT NULL,
  recipient_email       TEXT NOT NULL,
  subject               TEXT NOT NULL,
  sent_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status                TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'pending')),
  provider_message_id   TEXT,
  error_message         TEXT
);

CREATE INDEX IF NOT EXISTS email_logs_user_idx       ON email_logs (user_id);
CREATE INDEX IF NOT EXISTS email_logs_type_idx       ON email_logs (email_type);
CREATE INDEX IF NOT EXISTS email_logs_status_idx     ON email_logs (status);
CREATE INDEX IF NOT EXISTS email_logs_sent_idx       ON email_logs (sent_at DESC);

ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read all email logs" ON email_logs;
CREATE POLICY "Admins read all email logs"
  ON email_logs FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));


-- ----------------------------------------------------------------------------
-- 5. admin_audit_logs (trace de toutes les actions admin sensibles)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type     TEXT NOT NULL,
  target_type     TEXT,
  target_id       TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_admin_idx       ON admin_audit_logs (admin_user_id);
CREATE INDEX IF NOT EXISTS audit_action_idx      ON admin_audit_logs (action_type);
CREATE INDEX IF NOT EXISTS audit_created_idx     ON admin_audit_logs (created_at DESC);

ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read audit logs"   ON admin_audit_logs;
DROP POLICY IF EXISTS "Admins insert audit logs" ON admin_audit_logs;

CREATE POLICY "Admins read audit logs"
  ON admin_audit_logs FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

CREATE POLICY "Admins insert audit logs"
  ON admin_audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (is_admin(auth.uid()) AND auth.uid() = admin_user_id);


-- ----------------------------------------------------------------------------
-- 6. RPC : generate_certificate_number (helper interne)
--    Génère un numéro AUREL-{YYYY}-{NNNN}
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_certificate_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  year_suffix TEXT;
  counter INT;
BEGIN
  year_suffix := TO_CHAR(NOW(), 'YYYY');
  SELECT COUNT(*) + 1 INTO counter
  FROM certificates
  WHERE EXTRACT(YEAR FROM issued_at) = EXTRACT(YEAR FROM NOW());

  RETURN 'AUREL-' || year_suffix || '-' || LPAD(counter::TEXT, 4, '0');
END;
$$;


-- ----------------------------------------------------------------------------
-- 7. RPC : check_and_issue_certificate
--    À appeler après update_lesson_progress.
--    Si l'user a complété toutes les leçons publiées → crée certificate
--    et retourne son id. Sinon retourne NULL.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_and_issue_certificate(p_user_id UUID DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid             UUID;
  v_total_lessons   INT;
  v_completed       INT;
  v_existing_cert   UUID;
  v_existing_number TEXT;
  v_new_cert_id     UUID;
  v_new_cert_number TEXT;
  v_profile         RECORD;
BEGIN
  v_uid := COALESCE(p_user_id, auth.uid());
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  -- Si appelé avec p_user_id explicite, doit être admin OU le user lui-même.
  IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() AND NOT is_admin(auth.uid()) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_ALLOWED');
  END IF;

  -- Compte des leçons publiées
  SELECT COUNT(*) INTO v_total_lessons FROM lessons WHERE is_published = TRUE;

  IF v_total_lessons = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'NO_PUBLISHED_LESSONS');
  END IF;

  -- Compte de leçons complétées par l'user (parmi les publiées)
  SELECT COUNT(*) INTO v_completed
  FROM lesson_progress lp
  JOIN lessons l ON l.id = lp.lesson_id
  WHERE lp.user_id = v_uid AND lp.completed = TRUE AND l.is_published = TRUE;

  IF v_completed < v_total_lessons THEN
    RETURN json_build_object(
      'ok',                false,
      'error',             'NOT_YET_COMPLETED',
      'completed',         v_completed,
      'total',             v_total_lessons,
      'remaining',         v_total_lessons - v_completed
    );
  END IF;

  -- Si certificat déjà émis : retourner l'existant
  SELECT id, certificate_number INTO v_existing_cert, v_existing_number
  FROM certificates WHERE user_id = v_uid;

  IF v_existing_cert IS NOT NULL THEN
    RETURN json_build_object(
      'ok',                  true,
      'created',             false,
      'certificate_id',      v_existing_cert,
      'certificate_number',  v_existing_number
    );
  END IF;

  -- Récupère prénom + nom pour le certificat
  SELECT first_name, last_name INTO v_profile FROM profiles WHERE id = v_uid;
  IF v_profile IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND');
  END IF;

  v_new_cert_number := generate_certificate_number();

  INSERT INTO certificates (user_id, certificate_number, full_name_on_certificate, course_completion_date)
  VALUES (
    v_uid,
    v_new_cert_number,
    TRIM(v_profile.first_name || ' ' || v_profile.last_name),
    CURRENT_DATE
  )
  RETURNING id INTO v_new_cert_id;

  RETURN json_build_object(
    'ok',                  true,
    'created',             true,
    'certificate_id',      v_new_cert_id,
    'certificate_number',  v_new_cert_number
  );
END;
$$;

GRANT EXECUTE ON FUNCTION check_and_issue_certificate(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION generate_certificate_number()    TO authenticated;


-- ----------------------------------------------------------------------------
-- 8. RPC : log_admin_action
--    Helper appelé par le frontend après chaque action admin sensible.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_admin_action(
  p_action_type TEXT,
  p_target_type TEXT DEFAULT NULL,
  p_target_id   TEXT DEFAULT NULL,
  p_metadata    JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_log_id UUID;
BEGIN
  IF v_uid IS NULL OR NOT is_admin(v_uid) THEN
    RETURN NULL;
  END IF;

  INSERT INTO admin_audit_logs (admin_user_id, action_type, target_type, target_id, metadata)
  VALUES (v_uid, p_action_type, p_target_type, p_target_id, p_metadata)
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION log_admin_action(TEXT, TEXT, TEXT, JSONB) TO authenticated;


-- ----------------------------------------------------------------------------
-- 9. RPC : admin_get_advanced_analytics
--    Aggrège les données pour /admin/analytics (5 sections)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_get_advanced_analytics()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_result JSON;
BEGIN
  IF v_uid IS NULL OR NOT is_admin(v_uid) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_ADMIN');
  END IF;

  WITH
  -- 1. Acquisition : inscriptions par jour (30 derniers jours), par tier
  acquisition AS (
    SELECT
      DATE_TRUNC('day', activated_at)::date AS day,
      tier,
      COUNT(*) AS new_students
    FROM profiles
    WHERE is_admin = FALSE
      AND activated_at > NOW() - INTERVAL '30 days'
    GROUP BY 1, 2
    ORDER BY 1
  ),
  -- 2. Engagement : KPIs
  total_codes AS (SELECT COUNT(*) AS c, COUNT(*) FILTER (WHERE is_used) AS used FROM activation_codes),
  total_students AS (SELECT COUNT(*) AS c FROM profiles WHERE is_admin = FALSE),
  total_certs AS (SELECT COUNT(*) AS c FROM certificates),
  active_30d AS (
    SELECT COUNT(DISTINCT user_id) AS c FROM lesson_progress
    WHERE updated_at > NOW() - INTERVAL '30 days'
  ),
  avg_completion_days AS (
    SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (c.issued_at - p.activated_at)) / 86400), 0) AS days
    FROM certificates c
    JOIN profiles p ON p.id = c.user_id
  ),
  -- 3. Daily watched minutes (30 jours)
  daily_minutes AS (
    SELECT
      DATE_TRUNC('day', updated_at)::date AS day,
      ROUND(SUM(watched_seconds)::NUMERIC / 60, 1) AS minutes
    FROM lesson_progress
    WHERE updated_at > NOW() - INTERVAL '30 days'
    GROUP BY 1
    ORDER BY 1
  ),
  -- 4. Funnel : pour chaque leçon, % started vs completed
  funnel AS (
    SELECT
      l.lesson_number,
      l.title,
      COUNT(DISTINCT lp.user_id) FILTER (WHERE lp.watched_seconds > 0) AS started,
      COUNT(DISTINCT lp.user_id) FILTER (WHERE lp.completed) AS completed
    FROM lessons l
    LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id
    GROUP BY l.lesson_number, l.title
    ORDER BY l.lesson_number
  ),
  -- 5. Feedback distribution
  feedback_dist AS (
    SELECT rating, COUNT(*) AS n
    FROM feedback
    WHERE is_approved = TRUE
    GROUP BY rating
    ORDER BY rating
  ),
  nps AS (
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE would_recommend) AS recommend
    FROM feedback
    WHERE is_approved = TRUE
  ),
  -- 6. Top engaged students
  top_engaged AS (
    SELECT
      p.id, p.first_name, p.last_name, p.email, p.tier,
      COALESCE(SUM(lp.watched_seconds), 0) AS total_seconds
    FROM profiles p
    LEFT JOIN lesson_progress lp ON lp.user_id = p.id
    WHERE p.is_admin = FALSE
    GROUP BY p.id
    ORDER BY total_seconds DESC NULLS LAST
    LIMIT 10
  ),
  top_fast AS (
    SELECT
      p.id, p.first_name, p.last_name, p.email, p.tier,
      EXTRACT(EPOCH FROM (c.issued_at - p.activated_at)) / 86400 AS days_to_complete
    FROM certificates c
    JOIN profiles p ON p.id = c.user_id
    ORDER BY days_to_complete ASC
    LIMIT 10
  )

  SELECT json_build_object(
    'ok', true,
    'acquisition', (SELECT json_agg(row_to_json(a)) FROM acquisition a),
    'engagement', json_build_object(
      'total_codes',      (SELECT c FROM total_codes),
      'codes_used',       (SELECT used FROM total_codes),
      'activation_rate',  ROUND(
        ((SELECT used FROM total_codes)::NUMERIC / NULLIF((SELECT c FROM total_codes), 0)) * 100, 1
      ),
      'completion_rate',  ROUND(
        ((SELECT c FROM total_certs)::NUMERIC / NULLIF((SELECT c FROM total_students), 0)) * 100, 1
      ),
      'avg_completion_days', ROUND((SELECT days FROM avg_completion_days)::NUMERIC, 1),
      'active_last_30d',  (SELECT c FROM active_30d)
    ),
    'daily_minutes', (SELECT json_agg(row_to_json(d)) FROM daily_minutes d),
    'funnel',        (SELECT json_agg(row_to_json(f)) FROM funnel f),
    'feedback_dist', (SELECT json_agg(row_to_json(fd)) FROM feedback_dist fd),
    'nps', (SELECT json_build_object(
      'total', total,
      'recommend', recommend,
      'percent', ROUND(recommend::NUMERIC / NULLIF(total, 0) * 100, 1)
    ) FROM nps),
    'top_engaged', (SELECT json_agg(row_to_json(te)) FROM top_engaged te),
    'top_fast',    (SELECT json_agg(row_to_json(tf)) FROM top_fast tf)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_advanced_analytics() TO authenticated;


-- ----------------------------------------------------------------------------
-- 10. Trigger : auto-issue certificat quand lesson_progress passe à completed
--    Note : on déclenche aussi check_and_issue_certificate quand le user
--    complète sa dernière leçon. Pas d'envoi d'email ici (c'est l'edge function
--    qui s'en charge).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trigger_check_certificate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.completed = TRUE AND (OLD.completed IS NULL OR OLD.completed = FALSE) THEN
    PERFORM check_and_issue_certificate(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lesson_progress_check_certificate ON lesson_progress;
CREATE TRIGGER lesson_progress_check_certificate
  AFTER UPDATE OF completed ON lesson_progress
  FOR EACH ROW
  EXECUTE FUNCTION trigger_check_certificate();

-- ============================================================================
-- FIN migration 007
-- ============================================================================
