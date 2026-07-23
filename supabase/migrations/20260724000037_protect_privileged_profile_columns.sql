-- =============================================================================
-- CRITICAL FIX (Sherlock R24) — protect profiles.is_admin & course_access
-- =============================================================================
-- LIVE-VERIFIED privilege escalation (2026-07-24): the profiles immutability
-- trigger guarded tier/email/id/activated_at/revoked_* but NOT `is_admin` or
-- `course_access`. The is_admin guard existed in mig 006, was dropped in mig 014
-- ("security_sweep"), and was never restored. Combined with the row-scoped
-- "Users update own profile" RLS (no column restriction) and the default
-- table-level UPDATE grant to `authenticated`, ANY logged-in student could run,
-- from the browser console, on their OWN row:
--     supabase.from('profiles').update({ is_admin: true }).eq('id', myId)
--       -> full admin takeover (all PII, code generation, revenue, GDPR purge)
--     supabase.from('profiles').update({ course_access: 'immigration' }).eq(...)
--       -> steal the other course; DEFEATS migration 036 + the vdocipher-otp gate
-- Both were reproduced against production with a throwaway account.
--
-- Fix: extend protect_profile_immutable_fields to block non-admin changes to
-- is_admin and course_access — same pattern as revoked_*. A column-level REVOKE
-- is NOT used because `authenticated` holds table-level UPDATE (needed for the
-- legit profile-edit flow), which overrides column REVOKEs; the BEFORE-UPDATE
-- trigger is the airtight control. Unaffected:
--   * service_role / migrations (auth.uid() IS NULL early-return)
--   * admins editing via client (is_admin(auth.uid()) = true)
--   * admin_set_course_access + redeem_activation_code (SECURITY DEFINER; the
--     latter INSERTs, so this BEFORE-UPDATE trigger never fires for it)
--   * normal profile edits (name / whatsapp) — those columns are untouched
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION protect_profile_immutable_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- service_role (no JWT) bypasses — admin setup / migrations / SECURITY DEFINER RPCs.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.tier         IS DISTINCT FROM OLD.tier         THEN RAISE EXCEPTION 'Modification du tier interdite'; END IF;
  IF NEW.email        IS DISTINCT FROM OLD.email        THEN RAISE EXCEPTION 'Modification de l''email interdite (passe par auth.users)'; END IF;
  IF NEW.id           IS DISTINCT FROM OLD.id           THEN RAISE EXCEPTION 'Modification de l''id interdite'; END IF;
  IF NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN RAISE EXCEPTION 'Modification de activated_at interdite'; END IF;
  IF NEW.email_opt_out_token IS DISTINCT FROM OLD.email_opt_out_token THEN
    RAISE EXCEPTION 'Modification de email_opt_out_token interdite';
  END IF;

  -- R24: is_admin is privileged — only an admin caller may change it.
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    IF NOT is_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Modification de is_admin interdite';
    END IF;
  END IF;

  -- R24: course_access is the entitlement source for course isolation (mig 036)
  -- and the vdocipher-otp gate — only an admin caller may change it.
  IF NEW.course_access IS DISTINCT FROM OLD.course_access THEN
    IF NOT is_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Modification de course_access interdite';
    END IF;
  END IF;

  IF (NEW.revoked_at     IS DISTINCT FROM OLD.revoked_at)
  OR (NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason)
  OR (NEW.revoked_by     IS DISTINCT FROM OLD.revoked_by) THEN
    IF NOT is_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Modification de revoked_* interdite';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
