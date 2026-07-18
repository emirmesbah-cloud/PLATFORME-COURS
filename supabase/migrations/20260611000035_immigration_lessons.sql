-- =============================================================================
-- Immigration lesson media — VDOCipher video id + publish flag, per lesson_slug
-- =============================================================================
-- Mirrors the Pflege `lessons` table's video-management columns, but for the
-- Immigration course (whose lesson tree lives in static frontend data). Lets the
-- admin pre-fill / publish video ids ahead of recording. The student lesson
-- reader shows the VDOCipher player only when is_published = true AND a video id
-- is present ; otherwise the "coming soon" placeholder.
--
-- One row per lesson_slug. Rows are created on demand by the admin RPC (no need
-- to pre-seed all 61 — absent row = no video, not published).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.immigration_lessons (
  lesson_slug          TEXT PRIMARY KEY,
  vdocipher_video_id   TEXT,
  is_published         BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup by video id (the OTP Edge Function checks this on every play).
CREATE INDEX IF NOT EXISTS imm_lessons_video_idx
  ON public.immigration_lessons (vdocipher_video_id)
  WHERE vdocipher_video_id IS NOT NULL;

ALTER TABLE public.immigration_lessons ENABLE ROW LEVEL SECURITY;

-- Authenticated users may read (the reader needs to know if a video is ready).
DROP POLICY IF EXISTS "imm_lessons read" ON public.immigration_lessons;
CREATE POLICY "imm_lessons read" ON public.immigration_lessons FOR SELECT
  TO authenticated USING (true);

-- Only admins may write (defense in depth — the RPC is SECURITY DEFINER anyway).
DROP POLICY IF EXISTS "imm_lessons admin write" ON public.immigration_lessons;
CREATE POLICY "imm_lessons admin write" ON public.immigration_lessons FOR ALL
  TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- RPC : admin upsert (set video id + publish flag for a lesson)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_immigration_lesson(
  p_lesson_slug        TEXT,
  p_vdocipher_video_id TEXT,
  p_is_published       BOOLEAN
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
  IF p_lesson_slug IS NULL OR length(trim(p_lesson_slug)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MISSING_SLUG');
  END IF;

  INSERT INTO public.immigration_lessons (lesson_slug, vdocipher_video_id, is_published, updated_at)
  VALUES (
    p_lesson_slug,
    NULLIF(trim(COALESCE(p_vdocipher_video_id, '')), ''),
    COALESCE(p_is_published, FALSE),
    NOW()
  )
  ON CONFLICT (lesson_slug) DO UPDATE
    SET vdocipher_video_id = NULLIF(trim(COALESCE(p_vdocipher_video_id, '')), ''),
        is_published       = COALESCE(p_is_published, FALSE),
        updated_at         = NOW();

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_immigration_lesson(TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_immigration_lesson(TEXT, TEXT, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
