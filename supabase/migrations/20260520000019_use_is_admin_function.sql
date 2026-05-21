-- ============================================================================
-- SHERLOCK R13 — B15: use the is_admin(uuid) helper instead of an inline
-- SELECT on profiles.is_admin in protect_profile_immutable_fields.
--
-- Why:
--   - is_admin() is SECURITY DEFINER + STABLE, set_path-scoped to public,
--     and centralizes the "is this caller an admin?" semantics.
--   - The previous inline SELECT was identical at the time of writing but
--     drifts: a future change to is_admin (e.g. role-based, MFA-gated,
--     org-aware) would have to be repeated in every callsite.
--   - Bonus: if is_admin's STABLE volatility lets Postgres cache the result
--     inside the trigger for the duration of the statement.
--
-- Idempotent (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION protect_profile_immutable_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
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

  IF (NEW.revoked_at     IS DISTINCT FROM OLD.revoked_at)
  OR (NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason)
  OR (NEW.revoked_by     IS DISTINCT FROM OLD.revoked_by) THEN
    -- SHERLOCK R13 — was: SELECT is_admin FROM profiles WHERE id = auth.uid().
    -- Now uses the SECURITY DEFINER helper for consistency.
    IF NOT is_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Modification de revoked_* interdite';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
