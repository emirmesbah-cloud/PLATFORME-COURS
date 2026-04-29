-- ============================================================================
-- Aurel Academy — Migration 010 : HOTFIX RLS recursion sur profiles
--
-- Problème : la migration 009 a réécrit la policy "Admins read all profiles"
-- en inlinant un sub-SELECT vers profiles, ce qui déclenche RLS récursivement
-- → "infinite recursion detected in policy for relation profiles" sur TOUS
-- les SELECT vers profiles (étudiants comme admins).
--
-- Fix : revenir à la policy basée sur is_admin(UUID) qui est SECURITY DEFINER
-- STABLE, donc bypass la RLS proprement.
-- ============================================================================

DROP POLICY IF EXISTS "Admins read all profiles" ON profiles;

CREATE POLICY "Admins read all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));
