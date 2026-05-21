-- ============================================================================
-- SHERLOCK R13 — B16: exclude revoked accounts from top_engaged / top_fast
-- in admin_get_advanced_analytics.
--
-- Bug: a revoked user (revoked_at IS NOT NULL) still has their watched_seconds
-- and certificate rows. They polluted the "top 10 most engaged" and "top 10
-- fastest to complete" lists, giving admins a misleading view of currently
-- active learners.
--
-- Fix: add `AND p.revoked_at IS NULL` to both CTEs. Everything else (rates,
-- daily minutes, funnel) keeps revoked users in the population on purpose —
-- those are historical metrics.
--
-- Function signature unchanged. Idempotent (CREATE OR REPLACE).
-- ============================================================================

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
  daily_minutes AS (
    SELECT
      DATE_TRUNC('day', updated_at)::date AS day,
      ROUND(SUM(watched_seconds)::NUMERIC / 60, 1) AS minutes
    FROM lesson_progress
    WHERE updated_at > NOW() - INTERVAL '30 days'
    GROUP BY 1
    ORDER BY 1
  ),
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
  -- SHERLOCK R13 — B16: exclude revoked profiles from "top engaged".
  top_engaged AS (
    SELECT
      p.id, p.first_name, p.last_name, p.email, p.tier,
      COALESCE(SUM(lp.watched_seconds), 0) AS total_seconds
    FROM profiles p
    LEFT JOIN lesson_progress lp ON lp.user_id = p.id
    WHERE p.is_admin = FALSE
      AND p.revoked_at IS NULL
    GROUP BY p.id
    ORDER BY total_seconds DESC NULLS LAST
    LIMIT 10
  ),
  -- SHERLOCK R13 — B16: exclude revoked profiles from "fastest to complete".
  top_fast AS (
    SELECT
      p.id, p.first_name, p.last_name, p.email, p.tier,
      EXTRACT(EPOCH FROM (c.issued_at - p.activated_at)) / 86400 AS days_to_complete
    FROM certificates c
    JOIN profiles p ON p.id = c.user_id
    WHERE p.revoked_at IS NULL
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
