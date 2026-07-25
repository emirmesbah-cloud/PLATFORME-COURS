-- Connect the six ready VdoCipher videos that were present in the
-- "Immigration Allemagne" folders but missing from the platform.
--
-- Existing non-empty mappings are never overwritten. The assertion at the end
-- rolls back the transaction if any lesson already points to another video.

BEGIN;

WITH video_map(lesson_slug, video_id) AS (
  VALUES
    ('0-1-pourquoi-l-allemagne-te-veut-les', '03b12525ff3645179bcdb96ec9d132a9'),
    ('0-2-les-3-mensonges-qui-font-perdre-des-annees', '0f786b862737441aa7930ffe121bc51c'),
    ('0-3-qui-reussit-vs-qui-echoue-le-vrai-facteur', '664f3697b6ac45de8651a8bf07369b46'),
    ('0-4-comment-utiliser-cette-formation-ta', 'b4e6ef1e1b1740af80010205deec7015'),
    ('1-1-comprendre-la-logique-toutes-les', '7be436f8b9d44d1d9cd4fb6f443f7f61'),
    ('1-2-les-voies-principales-travail-qualifie', 'afb7d9b5c1e54fbb9aa03ee3f0386ea3')
)
INSERT INTO public.immigration_lessons (
  lesson_slug,
  vdocipher_video_id,
  is_published,
  updated_at
)
SELECT lesson_slug, video_id, TRUE, NOW()
FROM video_map
ON CONFLICT (lesson_slug) DO UPDATE
SET
  vdocipher_video_id = EXCLUDED.vdocipher_video_id,
  is_published = TRUE,
  updated_at = NOW()
WHERE NULLIF(BTRIM(public.immigration_lessons.vdocipher_video_id), '') IS NULL;

DO $$
DECLARE
  v_match_count INTEGER;
BEGIN
  WITH video_map(lesson_slug, video_id) AS (
    VALUES
      ('0-1-pourquoi-l-allemagne-te-veut-les', '03b12525ff3645179bcdb96ec9d132a9'),
      ('0-2-les-3-mensonges-qui-font-perdre-des-annees', '0f786b862737441aa7930ffe121bc51c'),
      ('0-3-qui-reussit-vs-qui-echoue-le-vrai-facteur', '664f3697b6ac45de8651a8bf07369b46'),
      ('0-4-comment-utiliser-cette-formation-ta', 'b4e6ef1e1b1740af80010205deec7015'),
      ('1-1-comprendre-la-logique-toutes-les', '7be436f8b9d44d1d9cd4fb6f443f7f61'),
      ('1-2-les-voies-principales-travail-qualifie', 'afb7d9b5c1e54fbb9aa03ee3f0386ea3')
  )
  SELECT COUNT(*)
  INTO v_match_count
  FROM video_map vm
  JOIN public.immigration_lessons il
    ON il.lesson_slug = vm.lesson_slug
   AND il.vdocipher_video_id = vm.video_id
   AND il.is_published = TRUE;

  IF v_match_count <> 6 THEN
    RAISE EXCEPTION
      'Immigration video mapping conflict: expected 6 verified mappings, found %',
      v_match_count;
  END IF;
END;
$$;

COMMIT;
