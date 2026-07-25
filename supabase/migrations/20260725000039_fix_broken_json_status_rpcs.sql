-- Fix three production RPCs that called the nonexistent row_to_jsonb(record).
-- PostgreSQL provides to_jsonb(anyelement), which correctly serializes each
-- derived-table row before jsonb_agg collects it.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_quiz_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rows JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  IF NOT public.is_admin(v_uid) AND NOT public.has_course('pflege') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COURSE_FORBIDDEN');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.lesson_number), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      l.id AS lesson_id,
      l.lesson_number,
      EXISTS (
        SELECT 1
        FROM public.quiz_questions q
        WHERE q.lesson_id = l.id
      ) AS has_questions,
      COALESCE(MAX(qa.score), 0) AS best_score,
      COALESCE(MAX(qa.total), 0) AS total,
      COALESCE(BOOL_OR(qa.passed), false) AS passed,
      COUNT(qa.id) AS attempts
    FROM public.lessons l
    LEFT JOIN public.quiz_attempts qa
      ON qa.lesson_id = l.id
     AND qa.user_id = v_uid
    GROUP BY l.id, l.lesson_number
  ) r;

  RETURN jsonb_build_object('ok', true, 'lessons', v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_quiz_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_quiz_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_immigration_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_lessons JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  IF NOT public.is_admin(v_uid) AND NOT public.has_course('immigration') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COURSE_FORBIDDEN');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
  INTO v_lessons
  FROM (
    SELECT
      s.lesson_slug,
      COALESCE(BOOL_OR(p.completed), false) AS completed,
      EXISTS (
        SELECT 1
        FROM public.immigration_quiz_questions q
        WHERE q.lesson_slug = s.lesson_slug
      ) AS has_questions,
      COALESCE(MAX(a.score), 0) AS best_score,
      COALESCE(MAX(a.total), 0) AS total,
      COALESCE(BOOL_OR(a.passed), false) AS passed,
      COUNT(a.id) AS attempts
    FROM (
      SELECT lesson_slug
      FROM public.immigration_progress
      WHERE user_id = v_uid
      UNION
      SELECT lesson_slug
      FROM public.immigration_quiz_attempts
      WHERE user_id = v_uid
      UNION
      SELECT DISTINCT lesson_slug
      FROM public.immigration_quiz_questions
    ) s
    LEFT JOIN public.immigration_progress p
      ON p.lesson_slug = s.lesson_slug
     AND p.user_id = v_uid
    LEFT JOIN public.immigration_quiz_attempts a
      ON a.lesson_slug = s.lesson_slug
     AND a.user_id = v_uid
    GROUP BY s.lesson_slug
  ) r;

  RETURN jsonb_build_object('ok', true, 'lessons', v_lessons);
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_immigration_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_immigration_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_accounting_stats()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_now DATE := CURRENT_DATE;
  v_this_start DATE := DATE_TRUNC('month', v_now)::date;
  v_last_start DATE := (DATE_TRUNC('month', v_now) - INTERVAL '1 month')::date;
  v_year_start DATE := DATE_TRUNC('year', v_now)::date;
  v_result JSONB;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  SELECT jsonb_build_object(
    'ok', true,
    'this_month', (
      SELECT jsonb_build_object(
        'dzd', COALESCE(SUM(CASE WHEN currency = 'DZD' THEN amount ELSE 0 END), 0),
        'eur', COALESCE(SUM(CASE WHEN currency = 'EUR' THEN amount ELSE 0 END), 0),
        'count', COUNT(*)
      )
      FROM public.payments
      WHERE status = 'recorded'
        AND recorded_at >= v_this_start
    ),
    'last_month', (
      SELECT jsonb_build_object(
        'dzd', COALESCE(SUM(CASE WHEN currency = 'DZD' THEN amount ELSE 0 END), 0),
        'eur', COALESCE(SUM(CASE WHEN currency = 'EUR' THEN amount ELSE 0 END), 0),
        'count', COUNT(*)
      )
      FROM public.payments
      WHERE status = 'recorded'
        AND recorded_at >= v_last_start
        AND recorded_at < v_this_start
    ),
    'ytd', (
      SELECT jsonb_build_object(
        'dzd', COALESCE(SUM(CASE WHEN currency = 'DZD' THEN amount ELSE 0 END), 0),
        'eur', COALESCE(SUM(CASE WHEN currency = 'EUR' THEN amount ELSE 0 END), 0),
        'count', COUNT(*)
      )
      FROM public.payments
      WHERE status = 'recorded'
        AND recorded_at >= v_year_start
    ),
    'pending', (
      SELECT COUNT(*)
      FROM public.payments
      WHERE status = 'pending'
    ),
    'by_tier', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.tier), '[]'::jsonb)
      FROM (
        SELECT
          tier::text AS tier,
          COALESCE(SUM(CASE WHEN currency = 'DZD' THEN amount ELSE 0 END), 0) AS dzd,
          COALESCE(SUM(CASE WHEN currency = 'EUR' THEN amount ELSE 0 END), 0) AS eur,
          COUNT(*) AS count
        FROM public.payments
        WHERE status = 'recorded'
        GROUP BY tier
      ) t
    ),
    'by_method', (
      SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.method), '[]'::jsonb)
      FROM (
        SELECT
          method::text AS method,
          COALESCE(SUM(CASE WHEN currency = 'DZD' THEN amount ELSE 0 END), 0) AS dzd,
          COALESCE(SUM(CASE WHEN currency = 'EUR' THEN amount ELSE 0 END), 0) AS eur,
          COUNT(*) AS count
        FROM public.payments
        WHERE status = 'recorded'
          AND method IS NOT NULL
        GROUP BY method
      ) m
    ),
    'monthly', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.month), '[]'::jsonb)
      FROM (
        SELECT
          TO_CHAR(DATE_TRUNC('month', recorded_at), 'YYYY-MM') AS month,
          COALESCE(SUM(CASE WHEN currency = 'DZD' THEN amount ELSE 0 END), 0) AS dzd,
          COALESCE(SUM(CASE WHEN currency = 'EUR' THEN amount ELSE 0 END), 0) AS eur,
          COUNT(*) AS count
        FROM public.payments
        WHERE status = 'recorded'
          AND recorded_at >= (v_now - INTERVAL '12 months')
        GROUP BY DATE_TRUNC('month', recorded_at)
      ) x
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_accounting_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_accounting_stats() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
