-- =============================================================================
-- Multi-course gating (single course per student)
-- =============================================================================
-- A student belongs to exactly ONE course : 'pflege' (default, existing) or
-- 'immigration' (new). Admins see everything regardless.
--
-- This is the lightweight gating for the UI-only phase (videos not recorded
-- yet). When the Immigration course launches with real videos, we'll migrate
-- the content into proper course/section/module tables — but the access model
-- (course_access on profiles) stays the same.
-- =============================================================================

BEGIN;

-- 1. Add the column. All existing students = pflege (they bought Pflege).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS course_access TEXT NOT NULL DEFAULT 'pflege';

-- 2. Constrain to known values.
DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_course_access_check
    CHECK (course_access IN ('pflege', 'immigration'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS profiles_course_access_idx
  ON public.profiles (course_access);

-- 3. RPC : admin sets a student's course. Admin-only, audited.
CREATE OR REPLACE FUNCTION public.admin_set_course_access(
  p_user_id UUID,
  p_course  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  IF p_course NOT IN ('pflege', 'immigration') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_COURSE');
  END IF;

  UPDATE public.profiles SET course_access = p_course WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('ok', true, 'course', p_course);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_course_access(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_course_access(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
