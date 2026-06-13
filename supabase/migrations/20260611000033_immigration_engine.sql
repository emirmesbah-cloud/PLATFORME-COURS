-- =============================================================================
-- Immigration course engine — progress, notes, quiz (slug-keyed, ISOLATED)
-- =============================================================================
-- Immigration lessons live in static frontend data (src/data/immigration-
-- structure.ts), keyed by lesson_slug. These tables store the per-user dynamic
-- data, keyed by that same lesson_slug. Fully isolated from the Pflege tables
-- (lessons / lesson_progress / quiz_questions / ...) → zero regression risk on
-- the live Pflege course.
--
-- Pass threshold : 3/5 (60%), unlimited retries — same rule as Pflege.
-- Progressive lock : on the 11 main modules only (module-0 … module-10).
-- Niches + tutos are free-access (pick-your-own / reference), no lock.
-- =============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. immigration_progress — one row per (user, lesson_slug)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.immigration_progress (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_slug   TEXT NOT NULL,
  module_slug   TEXT NOT NULL,
  completed     BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, lesson_slug)
);
CREATE INDEX IF NOT EXISTS imm_progress_user_idx ON public.immigration_progress (user_id);
ALTER TABLE public.immigration_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "imm_progress own" ON public.immigration_progress FOR ALL
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 2. immigration_notes — student's personal notes per lesson
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.immigration_notes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_slug  TEXT NOT NULL,
  content      TEXT NOT NULL DEFAULT '',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, lesson_slug)
);
CREATE INDEX IF NOT EXISTS imm_notes_user_idx ON public.immigration_notes (user_id);
ALTER TABLE public.immigration_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "imm_notes own" ON public.immigration_notes FOR ALL
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 3. immigration_quiz_questions — admin-authored, keyed by lesson_slug
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.immigration_quiz_questions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_slug    TEXT NOT NULL,
  module_slug    TEXT NOT NULL,
  position       INT  NOT NULL CHECK (position BETWEEN 1 AND 50),
  question_text  TEXT NOT NULL CHECK (char_length(question_text) BETWEEN 5 AND 500),
  option_a       TEXT NOT NULL,
  option_b       TEXT NOT NULL,
  option_c       TEXT NOT NULL,
  option_d       TEXT NOT NULL,
  correct_index  INT  NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
  explanation    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lesson_slug, position)
);
CREATE INDEX IF NOT EXISTS imm_q_lesson_idx ON public.immigration_quiz_questions (lesson_slug, position);
ALTER TABLE public.immigration_quiz_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "imm_q read" ON public.immigration_quiz_questions FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "imm_q admin write" ON public.immigration_quiz_questions FOR ALL
  TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.touch_imm_q_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := NOW(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS imm_q_touch ON public.immigration_quiz_questions;
CREATE TRIGGER imm_q_touch BEFORE UPDATE ON public.immigration_quiz_questions
  FOR EACH ROW EXECUTE FUNCTION public.touch_imm_q_updated_at();

-- ----------------------------------------------------------------------------
-- 4. immigration_quiz_attempts — immutable audit trail
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.immigration_quiz_attempts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_slug   TEXT NOT NULL,
  module_slug   TEXT NOT NULL,
  score         INT  NOT NULL CHECK (score >= 0 AND score <= total),
  total         INT  NOT NULL CHECK (total > 0 AND total <= 50),
  passed        BOOLEAN NOT NULL,
  answers       INT[] NOT NULL DEFAULT '{}',
  attempted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS imm_attempts_idx
  ON public.immigration_quiz_attempts (user_id, lesson_slug, passed, attempted_at DESC);
ALTER TABLE public.immigration_quiz_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "imm_attempts read own" ON public.immigration_quiz_attempts FOR SELECT
  TO authenticated USING (auth.uid() = user_id OR public.is_admin(auth.uid()));
CREATE POLICY "imm_attempts insert own" ON public.immigration_quiz_attempts FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 5. RPC submit_immigration_quiz_attempt — server-side scoring (anti-cheat)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_immigration_quiz_attempt(
  p_lesson_slug TEXT,
  p_answers     INT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_total     INT;
  v_score     INT := 0;
  v_correct   INT[];
  v_passed    BOOLEAN;
  v_threshold INT;
  v_module    TEXT;
  v_i         INT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT ARRAY_AGG(correct_index ORDER BY position),
         MIN(module_slug)
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
  v_passed    := v_score >= v_threshold;

  INSERT INTO public.immigration_quiz_attempts
    (user_id, lesson_slug, module_slug, score, total, passed, answers)
  VALUES (v_uid, p_lesson_slug, v_module, v_score, v_total, v_passed, p_answers);

  RETURN jsonb_build_object(
    'ok', true, 'score', v_score, 'total', v_total,
    'passed', v_passed, 'threshold', v_threshold, 'correct', v_correct
  );
END;
$$;
REVOKE ALL ON FUNCTION public.submit_immigration_quiz_attempt(TEXT, INT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_immigration_quiz_attempt(TEXT, INT[]) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. RPC get_my_immigration_status — progress + quiz state in one call
-- ----------------------------------------------------------------------------
-- Returns, per lesson_slug : completed, has_questions, best_score, passed.
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

  SELECT COALESCE(jsonb_agg(row_to_jsonb(r)), '[]'::jsonb) INTO v_lessons
  FROM (
    -- Union of every lesson_slug we know about (from progress, questions, attempts)
    SELECT
      s.lesson_slug,
      BOOL_OR(p.completed)                              AS completed,
      EXISTS (SELECT 1 FROM public.immigration_quiz_questions q WHERE q.lesson_slug = s.lesson_slug) AS has_questions,
      COALESCE(MAX(a.score), 0)                         AS best_score,
      COALESCE(MAX(a.total), 0)                         AS total,
      BOOL_OR(a.passed)                                 AS passed,
      COUNT(a.id)                                       AS attempts
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

-- ----------------------------------------------------------------------------
-- 7. RPC set_immigration_lesson_completed — mark/unmark a lesson done
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_immigration_lesson_completed(
  p_lesson_slug TEXT,
  p_module_slug TEXT,
  p_completed   BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  INSERT INTO public.immigration_progress (user_id, lesson_slug, module_slug, completed, completed_at, updated_at)
  VALUES (v_uid, p_lesson_slug, p_module_slug, p_completed,
          CASE WHEN p_completed THEN NOW() ELSE NULL END, NOW())
  ON CONFLICT (user_id, lesson_slug) DO UPDATE
    SET completed = EXCLUDED.completed,
        completed_at = EXCLUDED.completed_at,
        updated_at = NOW();
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.set_immigration_lesson_completed(TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_immigration_lesson_completed(TEXT, TEXT, BOOLEAN) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. RPC upsert_immigration_note
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_immigration_note(
  p_lesson_slug TEXT,
  p_content     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  INSERT INTO public.immigration_notes (user_id, lesson_slug, content, updated_at)
  VALUES (v_uid, p_lesson_slug, COALESCE(p_content, ''), NOW())
  ON CONFLICT (user_id, lesson_slug) DO UPDATE
    SET content = EXCLUDED.content, updated_at = NOW();
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_immigration_note(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_immigration_note(TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
