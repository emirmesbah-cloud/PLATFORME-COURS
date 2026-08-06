-- Enforce Immigration module progression on direct URLs and direct API calls.
--
-- The overview already displayed modules 1-10 as locked until the preceding
-- module was cleared, but lesson/media/quiz RPCs did not enforce that rule.
-- A student could paste a lesson URL, mint a video OTP, mark the lesson done,
-- and submit its quiz while the module was visibly locked.
BEGIN;

CREATE OR REPLACE FUNCTION public.immigration_lesson_module(p_lesson_slug TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_module TEXT;
  v_number_match TEXT[];
BEGIN
  IF p_lesson_slug IS NULL OR length(trim(p_lesson_slug)) = 0 THEN
    RETURN NULL;
  END IF;

  -- Quiz-backed lessons already carry their canonical module_slug.
  SELECT MIN(q.module_slug)
  INTO v_module
  FROM public.immigration_quiz_questions q
  WHERE q.lesson_slug = p_lesson_slug;
  IF v_module IS NOT NULL THEN
    RETURN v_module;
  END IF;

  -- Lessons without a quiz must at least exist in the managed media catalogue.
  IF NOT EXISTS (
    SELECT 1 FROM public.immigration_lessons l
    WHERE l.lesson_slug = p_lesson_slug
  ) THEN
    RETURN NULL;
  END IF;

  v_number_match := regexp_match(p_lesson_slug, '^([0-9]+)-');
  IF v_number_match IS NOT NULL THEN
    RETURN 'module-' || v_number_match[1];
  END IF;
  IF p_lesson_slug LIKE 'niche-%' OR p_lesson_slug LIKE 'n-%' THEN
    RETURN 'niches';
  END IF;
  IF p_lesson_slug LIKE 'tuto-%' THEN
    RETURN 'tutos';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.immigration_lesson_module(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.immigration_lesson_module(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_access_immigration_lesson(p_lesson_slug TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_module TEXT;
  v_module_number INT;
  v_previous_module TEXT;
  v_expected_count INT := 0;
  v_all_cleared BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;
  IF public.is_admin(v_uid) THEN
    RETURN TRUE;
  END IF;
  IF NOT public.has_course('immigration') THEN
    RETURN FALSE;
  END IF;

  v_module := public.immigration_lesson_module(p_lesson_slug);
  IF v_module IS NULL THEN
    RETURN FALSE;
  END IF;
  IF v_module IN ('module-0', 'niches', 'tutos') THEN
    RETURN TRUE;
  END IF;
  IF v_module !~ '^module-[1-9][0-9]*$' THEN
    RETURN FALSE;
  END IF;

  v_module_number := substring(v_module FROM '^module-([0-9]+)$')::INT;
  v_previous_module := 'module-' || (v_module_number - 1)::TEXT;

  WITH expected AS (
    SELECT DISTINCT q.lesson_slug
    FROM public.immigration_quiz_questions q
    WHERE q.module_slug = v_previous_module
    UNION
    SELECT DISTINCT l.lesson_slug
    FROM public.immigration_lessons l
    WHERE l.lesson_slug ~ ('^' || (v_module_number - 1)::TEXT || '-')
  ), clearance AS (
    SELECT
      e.lesson_slug,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM public.immigration_quiz_questions q
          WHERE q.lesson_slug = e.lesson_slug
        ) THEN EXISTS (
          SELECT 1 FROM public.immigration_quiz_attempts a
          WHERE a.user_id = v_uid
            AND a.lesson_slug = e.lesson_slug
            AND a.passed = TRUE
        )
        ELSE EXISTS (
          SELECT 1 FROM public.immigration_progress p
          WHERE p.user_id = v_uid
            AND p.lesson_slug = e.lesson_slug
            AND p.completed = TRUE
        )
      END AS cleared
    FROM expected e
  )
  SELECT COUNT(*), COALESCE(BOOL_AND(cleared), FALSE)
  INTO v_expected_count, v_all_cleared
  FROM clearance;

  RETURN v_expected_count > 0 AND v_all_cleared;
END;
$$;
REVOKE ALL ON FUNCTION public.can_access_immigration_lesson(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_immigration_lesson(TEXT) TO authenticated;

-- Hide locked lesson media IDs and quiz prompts from direct PostgREST reads.
DROP POLICY IF EXISTS "Read immigration_lessons (immigration or admin)" ON public.immigration_lessons;
CREATE POLICY "Read accessible immigration lessons"
  ON public.immigration_lessons FOR SELECT TO authenticated
  USING (public.can_access_immigration_lesson(lesson_slug));

DROP POLICY IF EXISTS "Read immigration_quiz_questions (immigration or admin)" ON public.immigration_quiz_questions;
CREATE POLICY "Read accessible immigration quiz questions"
  ON public.immigration_quiz_questions FOR SELECT TO authenticated
  USING (public.can_access_immigration_lesson(lesson_slug));

CREATE OR REPLACE FUNCTION public.set_immigration_lesson_completed(
  p_lesson_slug TEXT,
  p_module_slug TEXT,
  p_completed BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_canonical_module TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  IF NOT public.is_admin(v_uid) AND NOT public.has_course('immigration') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COURSE_FORBIDDEN');
  END IF;

  v_canonical_module := public.immigration_lesson_module(p_lesson_slug);
  IF v_canonical_module IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LESSON_NOT_FOUND');
  END IF;
  IF p_module_slug IS DISTINCT FROM v_canonical_module THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_MODULE');
  END IF;
  IF NOT public.can_access_immigration_lesson(p_lesson_slug) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LESSON_LOCKED');
  END IF;

  INSERT INTO public.immigration_progress
    (user_id, lesson_slug, module_slug, completed, completed_at, updated_at)
  VALUES (
    v_uid, p_lesson_slug, v_canonical_module, COALESCE(p_completed, FALSE),
    CASE WHEN COALESCE(p_completed, FALSE) THEN NOW() ELSE NULL END, NOW()
  )
  ON CONFLICT (user_id, lesson_slug) DO UPDATE
    SET module_slug = EXCLUDED.module_slug,
        completed = EXCLUDED.completed,
        completed_at = EXCLUDED.completed_at,
        updated_at = NOW();

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.set_immigration_lesson_completed(TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_immigration_lesson_completed(TEXT, TEXT, BOOLEAN) TO authenticated;

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
  IF NOT public.can_access_immigration_lesson(p_lesson_slug) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LESSON_LOCKED');
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

CREATE OR REPLACE FUNCTION public.upsert_immigration_note(
  p_lesson_slug TEXT,
  p_content TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  IF NOT public.is_admin(v_uid) AND NOT public.has_course('immigration') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COURSE_FORBIDDEN');
  END IF;
  IF NOT public.can_access_immigration_lesson(p_lesson_slug) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LESSON_LOCKED');
  END IF;

  INSERT INTO public.immigration_notes (user_id, lesson_slug, content, updated_at)
  VALUES (v_uid, p_lesson_slug, left(COALESCE(p_content, ''), 20000), NOW())
  ON CONFLICT (user_id, lesson_slug) DO UPDATE
    SET content = EXCLUDED.content, updated_at = NOW();

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_immigration_note(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_immigration_note(TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
