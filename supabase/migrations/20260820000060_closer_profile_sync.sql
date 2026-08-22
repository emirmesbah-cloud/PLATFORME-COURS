-- ============================================================================
-- Aurel Academy — Closer access fix: keep profiles in sync with staff_members
-- ============================================================================
-- BUG being fixed: when an admin attributes a closer via the dashboard, only a
-- staff_members row is written. The matching profile's staff_role stays
-- 'student', so the closer lands in the student course with no closer access.
--
-- mig 055 added a trigger on PROFILES (fires when a profile is created / its
-- email changes) + a one-time backfill. But an EXISTING student promoted to
-- closer never has their profile touched again, so the sync never runs for them.
--
-- Fix: mirror the other direction too. Whenever a staff_members row is inserted
-- or updated, reflect it onto the matching profile (by email):
--   * active closer  → profile.staff_role='closer', staff_permissions=<perms>
--   * deactivated    → profile.staff_role='student', staff_permissions='{}'
-- Admins are never downgraded. Plus a one-time backfill for closers already
-- attributed. The change reaches the closer's open session live (the profiles
-- Realtime subscription in useAuth), so the "Closer" button appears without a
-- re-login.
-- ============================================================================

BEGIN;

-- BEFORE : link the staff row to the matching auth account (by email) if not set.
CREATE OR REPLACE FUNCTION public.link_staff_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.auth_user_id IS NULL THEN
    NEW.auth_user_id := (
      SELECT id FROM public.profiles
      WHERE lower(email) = lower(NEW.email) AND is_admin = FALSE
      LIMIT 1
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_members_link_auth ON public.staff_members;
CREATE TRIGGER staff_members_link_auth
  BEFORE INSERT OR UPDATE ON public.staff_members
  FOR EACH ROW EXECUTE FUNCTION public.link_staff_auth_user();

-- AFTER : reflect the staff row onto the matching profile.
-- Only touches non-admins. Updates staff_role/staff_permissions, which are NOT
-- watched by mig 055's profiles trigger (scoped to email/is_admin), so there is
-- no trigger recursion.
CREATE OR REPLACE FUNCTION public.sync_profile_from_staff()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.profiles p
  SET staff_role        = CASE WHEN NEW.is_active THEN 'closer' ELSE 'student' END,
      staff_permissions = CASE WHEN NEW.is_active THEN NEW.permissions ELSE ARRAY[]::TEXT[] END
  WHERE lower(p.email) = lower(NEW.email)
    AND p.is_admin = FALSE
    AND (
      p.staff_role IS DISTINCT FROM (CASE WHEN NEW.is_active THEN 'closer' ELSE 'student' END)
      OR p.staff_permissions IS DISTINCT FROM (CASE WHEN NEW.is_active THEN NEW.permissions ELSE ARRAY[]::TEXT[] END)
    );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS staff_members_sync_profile ON public.staff_members;
CREATE TRIGGER staff_members_sync_profile
  AFTER INSERT OR UPDATE ON public.staff_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_from_staff();

-- ── One-time backfill for closers already attributed before this migration ──
-- Link accounts by email.
UPDATE public.staff_members s
SET auth_user_id = p.id, updated_at = now()
FROM public.profiles p
WHERE lower(p.email) = lower(s.email) AND s.auth_user_id IS NULL AND p.is_admin = FALSE;

-- Promote active closers.
UPDATE public.profiles p
SET staff_role = 'closer', staff_permissions = s.permissions
FROM public.staff_members s
WHERE lower(p.email) = lower(s.email)
  AND s.is_active = TRUE
  AND p.is_admin = FALSE
  AND (p.staff_role IS DISTINCT FROM 'closer' OR p.staff_permissions IS DISTINCT FROM s.permissions);

-- Demote anyone tied to a deactivated staff row.
UPDATE public.profiles p
SET staff_role = 'student', staff_permissions = ARRAY[]::TEXT[]
FROM public.staff_members s
WHERE lower(p.email) = lower(s.email)
  AND s.is_active = FALSE
  AND p.is_admin = FALSE
  AND p.staff_role = 'closer';

COMMIT;
