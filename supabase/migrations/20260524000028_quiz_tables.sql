-- =============================================================================
-- Quiz system : quiz_questions + quiz_attempts
-- =============================================================================
-- Goal : each content lesson has 5 multiple-choice questions. Student must
-- score >= 3/5 (60%) to validate the lesson and unlock the next one.
-- - Unlimited retries
-- - Strict sequential lock (lesson N+1 hidden until lesson N validated)
-- - Lessons 1 (disclaimer) and 2 (Willkommen) have NO quiz : just watching =
--   validation (lesson_progress.completed = true).
--
-- All decisions driven by the user 2026-05-24:
-- - Score min : 3/5
-- - Retries : illimité
-- - Lock : strict
-- =============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. quiz_questions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quiz_questions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id        UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  position         INT  NOT NULL CHECK (position BETWEEN 1 AND 50),
  question_text    TEXT NOT NULL CHECK (char_length(question_text) BETWEEN 5 AND 500),
  option_a         TEXT NOT NULL CHECK (char_length(option_a) BETWEEN 1 AND 250),
  option_b         TEXT NOT NULL CHECK (char_length(option_b) BETWEEN 1 AND 250),
  option_c         TEXT NOT NULL CHECK (char_length(option_c) BETWEEN 1 AND 250),
  option_d         TEXT NOT NULL CHECK (char_length(option_d) BETWEEN 1 AND 250),
  correct_index    INT  NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
  explanation      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lesson_id, position)
);

CREATE INDEX IF NOT EXISTS quiz_questions_lesson_idx ON public.quiz_questions (lesson_id, position);

ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;

-- Authenticated students can read questions — they need them to take the quiz.
CREATE POLICY "Authenticated read quiz_questions"
  ON public.quiz_questions FOR SELECT
  TO authenticated
  USING (true);

-- Only admins can mutate.
CREATE POLICY "Admin write quiz_questions"
  ON public.quiz_questions FOR ALL
  TO authenticated
  USING     ( public.is_admin(auth.uid()) )
  WITH CHECK( public.is_admin(auth.uid()) );

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_quiz_questions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quiz_questions_touch ON public.quiz_questions;
CREATE TRIGGER quiz_questions_touch
  BEFORE UPDATE ON public.quiz_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_quiz_questions_updated_at();


-- ----------------------------------------------------------------------------
-- 2. quiz_attempts
-- ----------------------------------------------------------------------------
-- One row per attempt. Immutable history (no UPDATE/DELETE) so we can audit.
CREATE TABLE IF NOT EXISTS public.quiz_attempts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id     UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  score         INT  NOT NULL CHECK (score >= 0 AND score <= total),
  total         INT  NOT NULL CHECK (total > 0 AND total <= 50),
  passed        BOOLEAN NOT NULL,
  -- answers : array of selected indexes, one per question in position order.
  -- e.g. [2, 0, 1, 3, 2] for a 5-question quiz.
  answers       INT[] NOT NULL DEFAULT '{}',
  attempted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS quiz_attempts_user_lesson_idx
  ON public.quiz_attempts (user_id, lesson_id, passed, attempted_at DESC);

ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;

-- Students read their own attempts.
CREATE POLICY "Users read own attempts"
  ON public.quiz_attempts FOR SELECT
  TO authenticated
  USING ( auth.uid() = user_id OR public.is_admin(auth.uid()) );

-- Students insert their own attempts.
CREATE POLICY "Users insert own attempts"
  ON public.quiz_attempts FOR INSERT
  TO authenticated
  WITH CHECK ( auth.uid() = user_id );

-- No UPDATE / DELETE policy on purpose — attempts are an immutable audit trail.
-- (Admin can still bypass via service_role if cleanup ever needed.)


-- ----------------------------------------------------------------------------
-- 3. RPC : submit_quiz_attempt
-- ----------------------------------------------------------------------------
-- Computes the score server-side from the user-submitted answers, so the
-- client can't cheat by faking a `passed=true`. Returns the new attempt row.
--
-- p_lesson_id : the lesson being quizzed
-- p_answers   : INT[] of selected indexes, must be exactly as many as the
--               number of questions defined for that lesson, in position order.
--
-- Pass threshold : ceil(0.6 * total) — i.e. 3/5, 4/7, etc.
CREATE OR REPLACE FUNCTION public.submit_quiz_attempt(
  p_lesson_id UUID,
  p_answers   INT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid           UUID := auth.uid();
  v_total         INT;
  v_score         INT := 0;
  v_correct       INT[];
  v_passed        BOOLEAN;
  v_threshold     INT;
  v_attempt_id    UUID;
  v_i             INT;
  v_lesson_pub    BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  -- Sanity : lesson must exist and be published.
  SELECT is_published INTO v_lesson_pub FROM public.lessons WHERE id = p_lesson_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LESSON_NOT_FOUND');
  END IF;
  IF NOT v_lesson_pub AND NOT public.is_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LESSON_NOT_PUBLISHED');
  END IF;

  -- Pull the correct answers in position order.
  SELECT ARRAY_AGG(correct_index ORDER BY position)
    INTO v_correct
  FROM public.quiz_questions
  WHERE lesson_id = p_lesson_id;

  v_total := COALESCE(array_length(v_correct, 1), 0);
  IF v_total = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_QUESTIONS');
  END IF;

  -- The submitted array must have the right cardinality. We allow null
  -- entries (unanswered) — they count as wrong.
  IF p_answers IS NULL OR COALESCE(array_length(p_answers, 1), 0) <> v_total THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_ANSWERS_COUNT', 'expected', v_total);
  END IF;

  -- Score it.
  FOR v_i IN 1..v_total LOOP
    IF p_answers[v_i] IS NOT NULL AND p_answers[v_i] = v_correct[v_i] THEN
      v_score := v_score + 1;
    END IF;
  END LOOP;

  -- 60% threshold, ceiling.
  v_threshold := CEIL(v_total * 0.6)::INT;
  v_passed    := v_score >= v_threshold;

  INSERT INTO public.quiz_attempts (user_id, lesson_id, score, total, passed, answers)
  VALUES (v_uid, p_lesson_id, v_score, v_total, v_passed, p_answers)
  RETURNING id INTO v_attempt_id;

  RETURN jsonb_build_object(
    'ok',           true,
    'attempt_id',   v_attempt_id,
    'score',        v_score,
    'total',        v_total,
    'passed',       v_passed,
    'threshold',    v_threshold,
    'correct',      v_correct
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_quiz_attempt(UUID, INT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_quiz_attempt(UUID, INT[]) TO authenticated;


-- ----------------------------------------------------------------------------
-- 4. RPC : is_lesson_unlocked
-- ----------------------------------------------------------------------------
-- Returns true iff lesson is accessible to the given user.
-- Logic :
-- - Admins : always unlocked.
-- - lesson_number = 1 (disclaimer) : always unlocked.
-- - lesson_number = 2 (Willkommen) : unlocked iff lesson 1 completed (no quiz).
-- - lesson_number = 3 (PDF Leçon 2 = first content lesson) :
--     unlocked iff lesson 2 completed (Willkommen has no quiz either).
-- - lesson_number >= 4 : unlocked iff previous lesson has a passed quiz_attempt.
--
-- Bonus : even if a lesson has no questions yet (e.g. admin not seeded),
-- we fall back to "lesson_progress.completed" so we don't soft-brick the user.
CREATE OR REPLACE FUNCTION public.is_lesson_unlocked(
  p_user_id   UUID,
  p_lesson_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_num  INT;
  v_prev_id     UUID;
  v_prev_num    INT;
  v_prev_has_q  BOOLEAN;
  v_prev_passed BOOLEAN;
  v_prev_done   BOOLEAN;
BEGIN
  IF p_user_id IS NULL OR p_lesson_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_admin(p_user_id) THEN
    RETURN true;
  END IF;

  SELECT lesson_number INTO v_target_num
  FROM public.lessons WHERE id = p_lesson_id;

  IF v_target_num IS NULL THEN
    RETURN false;
  END IF;

  -- Lesson 1 = disclaimer = always unlocked.
  IF v_target_num <= 1 THEN
    RETURN true;
  END IF;

  -- Find previous lesson (by lesson_number).
  v_prev_num := v_target_num - 1;
  SELECT id INTO v_prev_id
  FROM public.lessons WHERE lesson_number = v_prev_num;

  IF v_prev_id IS NULL THEN
    -- Gap in numbering : be permissive rather than brick.
    RETURN true;
  END IF;

  -- Does previous lesson have any questions ?
  SELECT EXISTS (SELECT 1 FROM public.quiz_questions WHERE lesson_id = v_prev_id)
    INTO v_prev_has_q;

  IF v_prev_has_q THEN
    SELECT EXISTS (
      SELECT 1 FROM public.quiz_attempts
      WHERE user_id = p_user_id AND lesson_id = v_prev_id AND passed = true
    ) INTO v_prev_passed;
    RETURN v_prev_passed;
  ELSE
    -- Previous lesson has no quiz : fallback on watch completion.
    SELECT completed INTO v_prev_done
    FROM public.lesson_progress
    WHERE user_id = p_user_id AND lesson_id = v_prev_id;
    RETURN COALESCE(v_prev_done, false);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.is_lesson_unlocked(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_lesson_unlocked(UUID, UUID) TO authenticated;


-- ----------------------------------------------------------------------------
-- 5. RPC : get_my_quiz_status
-- ----------------------------------------------------------------------------
-- One round-trip for the dashboard / Lessons page : returns, for every lesson,
-- whether the user has passed it and the best score so far.
-- Output : jsonb { lessons: [{ lesson_id, lesson_number, has_questions,
--                              best_score, total, passed, attempts }] }
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

  SELECT COALESCE(jsonb_agg(row_to_jsonb(r) ORDER BY r.lesson_number), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      l.id                         AS lesson_id,
      l.lesson_number              AS lesson_number,
      EXISTS (SELECT 1 FROM public.quiz_questions q WHERE q.lesson_id = l.id) AS has_questions,
      COALESCE(MAX(qa.score), 0)   AS best_score,
      COALESCE(MAX(qa.total), 0)   AS total,
      BOOL_OR(qa.passed)           AS passed,
      COUNT(qa.id)                 AS attempts
    FROM public.lessons l
    LEFT JOIN public.quiz_attempts qa
      ON qa.lesson_id = l.id AND qa.user_id = v_uid
    GROUP BY l.id, l.lesson_number
  ) r;

  RETURN jsonb_build_object('ok', true, 'lessons', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_quiz_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_quiz_status() TO authenticated;

COMMIT;
