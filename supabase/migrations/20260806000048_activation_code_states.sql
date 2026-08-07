-- =============================================================================
-- Activation code states + server-side program lookup   (migration 048)
-- =============================================================================
-- Goal : /activate serves BOTH courses from the SAME url, and the program is
-- decided SERVER-SIDE from the code that was actually validated — never from
-- the URL, a query param, a prefix parsed in the browser, or anything else the
-- client can set.
--
-- ── What ALREADY exists and is reused as-is (migration 032) ──────────────────
--   activation_codes.course TEXT NOT NULL DEFAULT 'pflege'
--                           CHECK (course IN ('pflege','immigration'))
--   => the code→program relation is already there, and every pre-existing code
--      is ALREADY classified 'pflege'. This migration therefore performs NO
--      backfill, NO re-classification and touches ZERO existing rows. Existing
--      Pflege codes keep working unchanged; existing users and their
--      profiles.course_access are untouched.
--
-- ── What this migration ADDS ────────────────────────────────────────────────
--   activation_codes.revoked_at   TIMESTAMPTZ  NULL = active
--   activation_codes.available_at TIMESTAMPTZ  NULL = redeemable now;
--                                              a FUTURE value = "pending"
-- Both are additive and nullable, so every existing row keeps its exact
-- current behaviour (NULL / NULL = active and immediately redeemable).
--
-- and it teaches the two activation RPCs (a) the code's program and (b) the
-- four states the activation page must tell apart :
--   validate_activation_code(code) -> { ok, tier, course } | { ok:false, error }
--         errors : CODE_INVALID · CODE_ALREADY_USED · CODE_REVOKED · CODE_PENDING
--   redeem_activation_code(...)    -> re-checks the SAME states under FOR UPDATE.
--         validate() runs seconds earlier in the edge function, so redeem() is
--         the authoritative check (TOCTOU): a code revoked between the two calls
--         must NOT redeem.
--
-- ── Enumeration hardening ───────────────────────────────────────────────────
-- validate_activation_code was EXECUTE-able by `authenticated` (anon was
-- revoked in mig 014). Nothing in the app calls it from the client — the only
-- caller is the activate-account edge function, which uses service_role and
-- therefore bypasses grants entirely. Leaving the grant in place let any
-- logged-in student enumerate unused codes (and, now that the RPC returns the
-- course, their program too) while bypassing the edge function's per-IP
-- throttle. We revoke it: the throttled edge function becomes the ONLY way to
-- probe a code.
--
-- ── Admin operations (no admin UI is added — deliberately out of scope) ─────
--   Revoke a code   : UPDATE activation_codes SET revoked_at = NOW()  WHERE code = 'AU-XXXXXX';
--   Un-revoke       : UPDATE activation_codes SET revoked_at = NULL   WHERE code = 'AU-XXXXXX';
--   Hold as pending : UPDATE activation_codes SET available_at = '2026-09-01T00:00:00Z' WHERE code = 'IU-XXXXXX';
--   Release         : UPDATE activation_codes SET available_at = NULL WHERE code = 'IU-XXXXXX';
--
-- ── ROLLBACK (safe — restores the exact previous behaviour) ─────────────────
--   BEGIN;
--   ALTER TABLE public.activation_codes DROP COLUMN IF EXISTS revoked_at;
--   ALTER TABLE public.activation_codes DROP COLUMN IF EXISTS available_at;
--   GRANT EXECUTE ON FUNCTION validate_activation_code(TEXT) TO authenticated;
--   -- then re-run, in this order, the previous definitions :
--   --   20260426000004_rpc_functions.sql        (validate_activation_code)
--   --   20260611000032_course_activation_codes.sql (redeem_activation_code)
--   COMMIT;
--
-- Idempotent : safe to re-run.
-- =============================================================================

BEGIN;

-- ── 1. Code lifecycle columns ───────────────────────────────────────────────
ALTER TABLE public.activation_codes
  ADD COLUMN IF NOT EXISTS revoked_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ;

COMMENT ON COLUMN public.activation_codes.revoked_at IS
  'NULL = active. Set to a timestamp to permanently kill the code (CODE_REVOKED).';
COMMENT ON COLUMN public.activation_codes.available_at IS
  'NULL = redeemable immediately. A FUTURE timestamp holds the code (CODE_PENDING).';

-- Partial index : the activation hot path only ever looks at live codes.
CREATE INDEX IF NOT EXISTS activation_codes_active_idx
  ON public.activation_codes (code)
  WHERE revoked_at IS NULL AND is_used = FALSE;

-- ── 2. validate_activation_code : returns the PROGRAM + the exact state ─────
-- Returning `course` is what makes the server-side program decision possible
-- BEFORE the account form is rendered (step 1 → step 2 of the activation flow).
CREATE OR REPLACE FUNCTION validate_activation_code(p_code TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row activation_codes%ROWTYPE;
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'CODE_INVALID');
  END IF;

  SELECT * INTO v_row FROM activation_codes WHERE code = trim(p_code);

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'CODE_INVALID');
  END IF;

  -- State precedence : revoked > used > pending.
  -- A revoked code is dead whatever else is true of it. "Already used" is more
  -- actionable to the student than "not yet available" for a code that somehow
  -- ended up in both states.
  IF v_row.revoked_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'CODE_REVOKED');
  END IF;

  IF v_row.is_used THEN
    RETURN json_build_object('ok', false, 'error', 'CODE_ALREADY_USED');
  END IF;

  IF v_row.available_at IS NOT NULL AND v_row.available_at > NOW() THEN
    RETURN json_build_object('ok', false, 'error', 'CODE_PENDING');
  END IF;

  RETURN json_build_object(
    'ok',     true,
    'tier',   v_row.tier,
    'course', COALESCE(v_row.course, 'pflege')
  );
END;
$$;

-- Only the service_role edge function may probe codes (see header).
REVOKE EXECUTE ON FUNCTION validate_activation_code(TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION validate_activation_code(TEXT) FROM anon;

-- ── 3. redeem_activation_code : authoritative state check + enrollment ──────
-- Unchanged from mig 032 except for the revoked/pending checks. Still ONE
-- plpgsql function = ONE transaction : the profile INSERT (which carries the
-- enrollment, profiles.course_access) and the "mark code used" UPDATE either
-- both commit or both roll back. The code is therefore never consumed unless
-- the account AND the enrollment succeeded — a failed attempt leaves the code
-- redeemable, so the student can simply retry.
CREATE OR REPLACE FUNCTION redeem_activation_code(
  p_code        TEXT,
  p_first_name  TEXT,
  p_last_name   TEXT,
  p_whatsapp    TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_user_email TEXT;
  v_code_row   activation_codes%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'CODE_INVALID');
  END IF;
  IF p_first_name IS NULL OR length(trim(p_first_name)) = 0
     OR p_last_name IS NULL OR length(trim(p_last_name)) = 0
     OR p_whatsapp IS NULL OR length(trim(p_whatsapp)) = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'MISSING_FIELDS');
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  IF v_user_email IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  IF EXISTS (SELECT 1 FROM profiles WHERE id = v_user_id) THEN
    RETURN json_build_object('ok', false, 'error', 'PROFILE_ALREADY_EXISTS');
  END IF;

  -- Row lock : two clients redeeming the same code race here, one wins.
  SELECT * INTO v_code_row
  FROM activation_codes
  WHERE code = trim(p_code)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'CODE_INVALID');
  END IF;

  -- Same precedence as validate_activation_code. Re-checked HERE because this
  -- is the only check that runs under the row lock : a code revoked or held
  -- between validate() and redeem() must not slip through.
  IF v_code_row.revoked_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'CODE_REVOKED');
  END IF;
  IF v_code_row.is_used THEN
    RETURN json_build_object('ok', false, 'error', 'CODE_ALREADY_USED');
  END IF;
  IF v_code_row.available_at IS NOT NULL AND v_code_row.available_at > NOW() THEN
    RETURN json_build_object('ok', false, 'error', 'CODE_PENDING');
  END IF;

  -- Enrollment. profiles.course_access IS the enrollment (one course per
  -- student, mig 031) and it is taken from the CODE — never from the caller.
  -- The client cannot influence it : it is not a parameter of this function,
  -- and protect_profile_immutable_fields (mig 037) blocks any later self-edit.
  INSERT INTO profiles (id, email, first_name, last_name, whatsapp, tier, course_access, activated_at)
  VALUES (
    v_user_id, v_user_email,
    trim(p_first_name), trim(p_last_name), trim(p_whatsapp),
    v_code_row.tier,
    COALESCE(v_code_row.course, 'pflege'),
    NOW()
  );

  -- Marked used ONLY after the profile+enrollment insert above succeeded.
  UPDATE activation_codes
  SET is_used = TRUE, used_by_user_id = v_user_id, used_at = NOW()
  WHERE id = v_code_row.id;

  RETURN json_build_object(
    'ok',     true,
    'tier',   v_code_row.tier,
    'course', COALESCE(v_code_row.course, 'pflege')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION redeem_activation_code(TEXT, TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
