-- Keep quiz answer keys server-side.
--
-- RLS protected each course from the other course, but a student enrolled in a
-- course still had table-level SELECT and could request correct_index and
-- explanation directly through PostgREST. Student clients only need the prompt
-- and options; scoring already happens in SECURITY DEFINER RPCs.
BEGIN;

REVOKE SELECT ON TABLE public.quiz_questions FROM authenticated;
GRANT SELECT (
  id,
  lesson_id,
  position,
  question_text,
  option_a,
  option_b,
  option_c,
  option_d,
  created_at,
  updated_at
) ON TABLE public.quiz_questions TO authenticated;

REVOKE SELECT ON TABLE public.immigration_quiz_questions FROM authenticated;
GRANT SELECT (
  id,
  lesson_slug,
  module_slug,
  position,
  question_text,
  option_a,
  option_b,
  option_c,
  option_d,
  created_at,
  updated_at
) ON TABLE public.immigration_quiz_questions TO authenticated;

-- Admin pages still need the complete rows. Return them through guarded
-- functions so table column privileges cannot be used by a student.
CREATE OR REPLACE FUNCTION public.admin_list_quiz_questions()
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
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(to_jsonb(q) ORDER BY q.lesson_id, q.position),
    '[]'::jsonb
  )
  INTO v_rows
  FROM public.quiz_questions q;

  RETURN v_rows;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_quiz_questions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_quiz_questions() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_immigration_quiz_questions()
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
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(to_jsonb(q) ORDER BY q.lesson_slug, q.position),
    '[]'::jsonb
  )
  INTO v_rows
  FROM public.immigration_quiz_questions q;

  RETURN v_rows;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_immigration_quiz_questions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_immigration_quiz_questions() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
