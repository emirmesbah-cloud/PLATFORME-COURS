-- Sherlock R24 follow-up: write integrity, RPC entitlement, activation
-- throttling storage, and feedback publication consent.
BEGIN;

-- Client writes must go through the SECURITY DEFINER RPCs that recompute the
-- authoritative completed/passed values.
REVOKE INSERT, UPDATE ON public.lesson_progress FROM authenticated;
REVOKE INSERT, UPDATE ON public.quiz_attempts FROM authenticated;
REVOKE INSERT, UPDATE ON public.immigration_progress FROM authenticated;
REVOKE INSERT, UPDATE ON public.immigration_quiz_attempts FROM authenticated;

CREATE TABLE IF NOT EXISTS public.activation_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activation_attempts_ip_time_idx
  ON public.activation_attempts (ip, attempted_at DESC);
ALTER TABLE public.activation_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.activation_attempts FROM anon, authenticated;

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS publish_consent BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.submit_quiz_attempt(
  p_lesson_id UUID,
  p_answers INT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_total INT;
  v_score INT := 0;
  v_correct INT[];
  v_passed BOOLEAN;
  v_threshold INT;
  v_attempt_id UUID;
  v_i INT;
  v_lesson_pub BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  IF NOT public.is_admin(v_uid) AND NOT public.has_course('pflege') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COURSE_FORBIDDEN');
  END IF;

  SELECT is_published INTO v_lesson_pub
  FROM public.lessons WHERE id = p_lesson_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LESSON_NOT_FOUND');
  END IF;
  IF NOT v_lesson_pub AND NOT public.is_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LESSON_NOT_PUBLISHED');
  END IF;

  SELECT ARRAY_AGG(correct_index ORDER BY position) INTO v_correct
  FROM public.quiz_questions WHERE lesson_id = p_lesson_id;
  v_total := COALESCE(array_length(v_correct, 1), 0);
  IF v_total = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_QUESTIONS');
  END IF;
  IF p_answers IS NULL OR COALESCE(array_length(p_answers, 1), 0) <> v_total THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_ANSWERS_COUNT', 'expected', v_total);
  END IF;

  FOR v_i IN 1..v_total LOOP
    IF p_answers[v_i] IS NOT NULL AND p_answers[v_i] = v_correct[v_i] THEN
      v_score := v_score + 1;
    END IF;
  END LOOP;
  v_threshold := CEIL(v_total * 0.6)::INT;
  v_passed := v_score >= v_threshold;

  INSERT INTO public.quiz_attempts (user_id, lesson_id, score, total, passed, answers)
  VALUES (v_uid, p_lesson_id, v_score, v_total, v_passed, p_answers)
  RETURNING id INTO v_attempt_id;

  RETURN jsonb_build_object(
    'ok', true, 'attempt_id', v_attempt_id, 'score', v_score,
    'total', v_total, 'passed', v_passed, 'threshold', v_threshold
  );
END;
$$;
REVOKE ALL ON FUNCTION public.submit_quiz_attempt(UUID, INT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_quiz_attempt(UUID, INT[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_immigration_quiz_attempt(
  p_lesson_slug TEXT,
  p_answers INT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_total INT;
  v_score INT := 0;
  v_correct INT[];
  v_passed BOOLEAN;
  v_threshold INT;
  v_module TEXT;
  v_i INT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  IF NOT public.is_admin(v_uid) AND NOT public.has_course('immigration') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COURSE_FORBIDDEN');
  END IF;

  SELECT ARRAY_AGG(correct_index ORDER BY position), MIN(module_slug)
  INTO v_correct, v_module
  FROM public.immigration_quiz_questions
  WHERE lesson_slug = p_lesson_slug;
  v_total := COALESCE(array_length(v_correct, 1), 0);
  IF v_total = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_QUESTIONS');
  END IF;
  IF p_answers IS NULL OR COALESCE(array_length(p_answers, 1), 0) <> v_total THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_ANSWERS_COUNT', 'expected', v_total);
  END IF;

  FOR v_i IN 1..v_total LOOP
    IF p_answers[v_i] IS NOT NULL AND p_answers[v_i] = v_correct[v_i] THEN
      v_score := v_score + 1;
    END IF;
  END LOOP;
  v_threshold := CEIL(v_total * 0.6)::INT;
  v_passed := v_score >= v_threshold;

  INSERT INTO public.immigration_quiz_attempts
    (user_id, lesson_slug, module_slug, score, total, passed, answers)
  VALUES (v_uid, p_lesson_slug, v_module, v_score, v_total, v_passed, p_answers);

  RETURN jsonb_build_object(
    'ok', true, 'score', v_score, 'total', v_total,
    'passed', v_passed, 'threshold', v_threshold
  );
END;
$$;
REVOKE ALL ON FUNCTION public.submit_immigration_quiz_attempt(TEXT, INT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_immigration_quiz_attempt(TEXT, INT[]) TO authenticated;

-- Keep the existing status implementation but prevent the SECURITY DEFINER
-- function from revealing the Immigration slug catalogue cross-course.
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

  SELECT COALESCE(jsonb_agg(row_to_jsonb(r)), '[]'::jsonb) INTO v_lessons
  FROM (
    SELECT
      s.lesson_slug,
      BOOL_OR(p.completed) AS completed,
      EXISTS (
        SELECT 1 FROM public.immigration_quiz_questions q
        WHERE q.lesson_slug = s.lesson_slug
      ) AS has_questions,
      COALESCE(MAX(a.score), 0) AS best_score,
      COALESCE(MAX(a.total), 0) AS total,
      BOOL_OR(a.passed) AS passed,
      COUNT(a.id) AS attempts
    FROM (
      SELECT lesson_slug FROM public.immigration_progress WHERE user_id = v_uid
      UNION
      SELECT lesson_slug FROM public.immigration_quiz_attempts WHERE user_id = v_uid
      UNION
      SELECT DISTINCT lesson_slug FROM public.immigration_quiz_questions
    ) s
    LEFT JOIN public.immigration_progress p
      ON p.lesson_slug = s.lesson_slug AND p.user_id = v_uid
    LEFT JOIN public.immigration_quiz_attempts a
      ON a.lesson_slug = s.lesson_slug AND a.user_id = v_uid
    GROUP BY s.lesson_slug
  ) r;
  RETURN jsonb_build_object('ok', true, 'lessons', v_lessons);
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_immigration_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_immigration_status() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
