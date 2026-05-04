-- ============================================================================
-- 20260503000021_drop_security_definer_view.sql
--
-- ⚠️  CRITICAL SECURITY FIX — Supabase Security Advisor flagged this. ⚠️
--
-- The view `public.admin_profiles_all` (mig 009) is `SECURITY DEFINER` by
-- default (Postgres views execute with the privileges of the view CREATOR,
-- typically `postgres` superuser). Combined with Supabase's default
-- `GRANT SELECT ON public.* TO anon, authenticated`, this view was a
-- COMPLETE RLS BYPASS :
--
--   - anon could `SELECT * FROM admin_profiles_all` → see every profile
--   - authenticated users could read profiles their RLS would normally hide
--   - revoked users' PII was readable
--   - admin emails + whatsapp readable to anyone
--
-- The view was defined in mig 009 with the intent "let admins see all
-- profiles including revoked", but the same migration also added a proper
-- RLS policy `"Admins read all profiles" ON profiles USING (is_admin(uid))`
-- which gives admins the access they need WITHOUT bypassing RLS for everyone.
--
-- The view is NEVER referenced anywhere :
--   $ grep -r 'admin_profiles_all' supabase app/src
--     → only the mig 009 CREATE statement
--
-- Fix : DROP the view. Admins continue to use `profiles` directly with the
-- "Admins read all profiles" RLS policy. No code change needed downstream.
-- ============================================================================

DROP VIEW IF EXISTS public.admin_profiles_all;

-- Belt-and-suspenders : also explicitly REVOKE any leftover grants from
-- anon/authenticated on this view (in case some Supabase auto-grant left
-- a stale entry around even after DROP IF EXISTS). Idempotent — safe even
-- if the view doesn't exist.
DO $$
BEGIN
  -- This block runs only if the view (or a recreated one) somehow lingers
  -- with public grants. The DROP above handles the normal case.
  IF EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'admin_profiles_all'
  ) THEN
    EXECUTE 'REVOKE ALL ON public.admin_profiles_all FROM anon, authenticated, public';
  END IF;
END
$$;
