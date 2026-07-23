-- =============================================================================
-- Server-side COURSE ISOLATION  (Sherlock R24)
-- =============================================================================
-- The two courses (Pflege / Immigration) were separated ONLY in the React UI.
-- profiles.course_access was referenced in ZERO rls policies, so any logged-in
-- account could read the OTHER course's paid content straight from the API:
--   - immigration_lessons  -> every vdocipher_video_id
--   - immigration_quiz_questions / quiz_questions -> every correct_index (answer key)
--   - lessons -> Pflege video ids
--   - bonus_resources -> paid bonus file rows
-- (Verified live: a course_access='pflege' student read all 40 Immigration video
--  IDs and all 255 quiz answers.)
--
-- This scopes every course-content SELECT policy to the caller's course, with an
-- admin bypass, via a SECURITY DEFINER helper — the SAME non-recursive pattern as
-- is_admin() (see RUNBOOK "règle d'or" : never sub-SELECT the same table in a
-- policy; always go through a SECURITY DEFINER STABLE function).
--
-- Idempotent. Only data change is one additive column on bonus_resources.
-- AFTER APPLYING: run the smoke test (RUNBOOK) — watch select_lessons especially,
-- and make sure the smoke-test account has course_access='pflege'.
-- =============================================================================

BEGIN;

-- ── helper : caller owns p_course AND is not revoked ────────────────────────
CREATE OR REPLACE FUNCTION public.has_course(p_course TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER          -- bypasses RLS to read profiles (same design as is_admin)
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT course_access = p_course AND revoked_at IS NULL
       FROM public.profiles WHERE id = auth.uid()),
    FALSE
  );
$$;
REVOKE ALL  ON FUNCTION public.has_course(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_course(TEXT) TO authenticated;

-- ── Pflege content : only pflege students (or admins) ───────────────────────
DROP POLICY IF EXISTS "Authenticated users read lessons" ON public.lessons;
CREATE POLICY "Read lessons (pflege or admin)"
  ON public.lessons FOR SELECT TO authenticated
  USING (public.has_course('pflege') OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Authenticated read quiz_questions" ON public.quiz_questions;
CREATE POLICY "Read quiz_questions (pflege or admin)"
  ON public.quiz_questions FOR SELECT TO authenticated
  USING (public.has_course('pflege') OR public.is_admin(auth.uid()));

-- ── Immigration content : only immigration students (or admins) ─────────────
DROP POLICY IF EXISTS "imm_lessons read" ON public.immigration_lessons;
CREATE POLICY "Read immigration_lessons (immigration or admin)"
  ON public.immigration_lessons FOR SELECT TO authenticated
  USING (public.has_course('immigration') OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "imm_q read" ON public.immigration_quiz_questions;
CREATE POLICY "Read immigration_quiz_questions (immigration or admin)"
  ON public.immigration_quiz_questions FOR SELECT TO authenticated
  USING (public.has_course('immigration') OR public.is_admin(auth.uid()));

-- ── Bonus resources : add a course tag, scope reads by it ───────────────────
ALTER TABLE public.bonus_resources
  ADD COLUMN IF NOT EXISTS course TEXT NOT NULL DEFAULT 'pflege';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bonus_resources_course_check') THEN
    ALTER TABLE public.bonus_resources
      ADD CONSTRAINT bonus_resources_course_check CHECK (course IN ('pflege','immigration'));
  END IF;
END $$;

DROP POLICY IF EXISTS "Authenticated users read bonus" ON public.bonus_resources;
CREATE POLICY "Read bonus (own course or admin)"
  ON public.bonus_resources FOR SELECT TO authenticated
  USING (public.has_course(course) OR public.is_admin(auth.uid()));

-- ── Storage : bonus-resources bucket holds only Pflege files today. Scope
-- reads so a free/immigration account can't sign URLs for paid Pflege PDFs.
-- (has_course already enforces "not revoked", preserving the old revoked check.)
-- When Immigration bonuses land in this bucket, switch to a course-prefixed
-- path check (name starts with 'immigration/' vs 'pflege/').
DROP POLICY IF EXISTS "bonus-resources read for authenticated" ON storage.objects;
CREATE POLICY "bonus-resources read for authenticated"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'bonus-resources'
    AND (public.has_course('pflege') OR public.is_admin(auth.uid()))
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
