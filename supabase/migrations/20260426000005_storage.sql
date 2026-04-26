-- ============================================================================
-- Aurel Academy — Plateforme étudiant — Phase 1
-- Migration 005 : buckets Storage + policies
-- ============================================================================
--
-- BUCKETS
--   bonus-resources    : privé. Accès via signed URLs (1h) côté frontend.
--   lesson-thumbnails  : public. Vignettes affichées sur le dashboard.
--
-- Note Supabase :
--   - storage.buckets et storage.objects sont gérés par le rôle service_role.
--   - Les policies sur storage.objects sont créées comme n'importe quelle
--     policy RLS (utilisent storage.foldername / storage.filename / etc.).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Création des buckets (idempotent)
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('bonus-resources',   'bonus-resources',   FALSE),
  ('lesson-thumbnails', 'lesson-thumbnails', TRUE)
ON CONFLICT (id) DO NOTHING;


-- ----------------------------------------------------------------------------
-- 2. Policies bonus-resources (privé)
--
--    Lecture autorisée pour tous les users authentifiés. Le frontend
--    génère des signed URLs (Supabase Storage API : createSignedUrl)
--    avec expiration 1h.
--
--    Pas de policy INSERT/UPDATE/DELETE pour authenticated → upload
--    se fait exclusivement via service_role (admin upload).
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "bonus-resources read for authenticated" ON storage.objects;
CREATE POLICY "bonus-resources read for authenticated"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'bonus-resources');


-- ----------------------------------------------------------------------------
-- 3. Policies lesson-thumbnails (public)
--
--    Lecture publique automatique vu que le bucket est `public = true`.
--    On laisse aussi une policy explicite pour clarté.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "lesson-thumbnails public read" ON storage.objects;
CREATE POLICY "lesson-thumbnails public read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'lesson-thumbnails');
