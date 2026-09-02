-- Fix Immigration progression drift between the static student curriculum and
-- the server-side gate.
--
-- immigration_lessons is a media/admin catalogue. It can contain drafts and
-- custom lessons, so a broad numeric-prefix scan must never make one of those
-- rows a prerequisite for a main module. The quiz question catalogue contains
-- the canonical lessons for modules 1-10; quiz attempts/results remain wholly
-- irrelevant. Module 0 has no quiz catalogue, so its four canonical lessons
-- are declared explicitly.

BEGIN;

CREATE OR REPLACE FUNCTION public.can_access_immigration_lesson(p_lesson_slug text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_module text;
  v_module_number integer;
  v_previous_module text;
  v_expected_count integer := 0;
  v_all_completed boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  IF public.is_admin(v_uid) THEN RETURN true; END IF;
  IF NOT public.has_course('immigration') THEN RETURN false; END IF;

  v_module := public.immigration_lesson_module(p_lesson_slug);
  IF v_module IS NULL THEN RETURN false; END IF;
  IF v_module IN ('module-0', 'niches', 'tutos') THEN RETURN true; END IF;
  IF v_module !~ '^module-[1-9][0-9]*$' THEN RETURN false; END IF;

  v_module_number := substring(v_module FROM '^module-([0-9]+)$')::integer;
  v_previous_module := 'module-' || (v_module_number - 1)::text;

  WITH expected AS (
    -- Modules 1-10: questions identify the canonical lesson slugs, but quiz
    -- attempts and pass/fail results are deliberately not consulted.
    SELECT DISTINCT q.lesson_slug
    FROM public.immigration_quiz_questions q
    WHERE q.module_slug = v_previous_module

    UNION

    -- Introduction/module 0 intentionally has no quiz questions.
    SELECT intro.lesson_slug
    FROM (VALUES
      ('0-1-pourquoi-l-allemagne-te-veut-les'::text),
      ('0-2-les-3-mensonges-qui-font-perdre-des-annees'::text),
      ('0-3-qui-reussit-vs-qui-echoue-le-vrai-facteur'::text),
      ('0-4-comment-utiliser-cette-formation-ta'::text)
    ) AS intro(lesson_slug)
    WHERE v_previous_module = 'module-0'
  ), completion AS (
    SELECT e.lesson_slug, EXISTS (
      SELECT 1
      FROM public.immigration_progress p
      WHERE p.user_id = v_uid
        AND p.lesson_slug = e.lesson_slug
        AND p.completed = true
    ) AS completed
    FROM expected e
  )
  SELECT count(*), coalesce(bool_and(completed), false)
  INTO v_expected_count, v_all_completed
  FROM completion;

  RETURN v_expected_count > 0 AND v_all_completed;
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_immigration_lesson(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_immigration_lesson(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
