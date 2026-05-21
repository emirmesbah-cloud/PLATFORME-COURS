-- ============================================================================
-- SHERLOCK R14 — C3 : split FOR ALL storage policies on bonus-resources +
-- lesson-thumbnails into explicit INSERT / UPDATE / SELECT, kicking DELETE
-- off the authenticated grant.
--
-- BUG : migration 006 created `Admins write bonus-resources` as FOR ALL,
-- meaning an admin (or anyone who compromises an admin account / poisons
-- is_admin somehow) can DELETE storage objects directly without any audit
-- trail. The bonus PDFs are paid content — accidental admin click or
-- malicious actor with admin creds can permanently destroy them.
--
-- FIX : DROP the FOR ALL policy and re-create as 3 separate policies
-- (INSERT, UPDATE, SELECT) for authenticated admins. DELETE is left
-- unspecified → defaults to deny for authenticated, only the service_role
-- (server-side) can delete. Same treatment for lesson-thumbnails.
--
-- Idempotent : DROP IF EXISTS + CREATE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. bonus-resources : split ALL → INSERT + UPDATE + SELECT
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins write bonus-resources"        ON storage.objects;
DROP POLICY IF EXISTS "Admins insert bonus-resources"       ON storage.objects;
DROP POLICY IF EXISTS "Admins update bonus-resources"       ON storage.objects;
DROP POLICY IF EXISTS "Admins select bonus-resources"       ON storage.objects;

CREATE POLICY "Admins insert bonus-resources"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'bonus-resources' AND is_admin(auth.uid()));

CREATE POLICY "Admins update bonus-resources"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'bonus-resources' AND is_admin(auth.uid()))
  WITH CHECK (bucket_id = 'bonus-resources' AND is_admin(auth.uid()));

CREATE POLICY "Admins select bonus-resources"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'bonus-resources' AND is_admin(auth.uid()));

-- DELETE on bonus-resources : no policy for `authenticated` → denied.
-- Hard-deletes must go through service_role (server-side script with audit
-- trail). This protects paid bonus PDFs from accidental/malicious wipe.


-- ----------------------------------------------------------------------------
-- 2. lesson-thumbnails : same split, even though they're public-readable.
--    The bucket is `public = true`, so anon read continues working via the
--    bucket-level public flag + the explicit "lesson-thumbnails public read"
--    policy from migration 005. We just lock down write/delete.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins write lesson-thumbnails"  ON storage.objects;
DROP POLICY IF EXISTS "Admins insert lesson-thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Admins update lesson-thumbnails" ON storage.objects;

CREATE POLICY "Admins insert lesson-thumbnails"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'lesson-thumbnails' AND is_admin(auth.uid()));

CREATE POLICY "Admins update lesson-thumbnails"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'lesson-thumbnails' AND is_admin(auth.uid()))
  WITH CHECK (bucket_id = 'lesson-thumbnails' AND is_admin(auth.uid()));

-- DELETE on lesson-thumbnails : service_role only (same reasoning).
