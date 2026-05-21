-- ============================================================================
-- SHERLOCK R13 — B17: force admin_audit_logs.admin_user_id to auth.uid()
-- on INSERT.
--
-- Bug: callers control the admin_user_id column. A misbehaving (or coerced)
-- admin RPC could write an audit row attributing the action to another
-- admin's uid, or to NULL. The audit trail is then unreliable. The existing
-- audit_logs_force_now() trigger fixes the timestamp; here we also fix the
-- actor.
--
-- Policy:
--   - If auth.uid() is non-null, we OVERWRITE NEW.admin_user_id with it.
--   - If auth.uid() IS NULL (the row was inserted via service_role inside
--     an edge function — e.g. system jobs, GDPR purge, scheduled cron),
--     we keep the value provided by the caller. Service_role is trusted by
--     definition; trusting NULL would either reject the row (NOT NULL
--     constraint) or break legitimate system audit rows.
--
-- This is enforced in addition to (not replacing) audit_logs_force_now().
-- We extend that trigger function so a single BEFORE INSERT trigger handles
-- both concerns.
--
-- Idempotent (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION audit_logs_force_now()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  -- SHERLOCK R3 — created_at is always server-side, never trust client.
  NEW.created_at := NOW();

  -- SHERLOCK R13 — admin_user_id is always the authenticated caller when one
  -- exists. Service_role calls (auth.uid() IS NULL) keep their provided uid.
  IF v_uid IS NOT NULL THEN
    NEW.admin_user_id := v_uid;
  END IF;

  RETURN NEW;
END;
$$;
