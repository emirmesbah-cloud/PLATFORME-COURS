-- Publish every Immigration lesson that already has a VdoCipher video.
--
-- Lessons without a usable video id remain private. This intentionally does
-- not touch the Pflege `lessons` table.

BEGIN;

UPDATE public.immigration_lessons
SET
  is_published = TRUE,
  updated_at = NOW()
WHERE
  is_published = FALSE
  AND NULLIF(BTRIM(vdocipher_video_id), '') IS NOT NULL;

COMMIT;
