-- =============================================================================
-- Activation flow — test suite (multi-course /activate)
-- =============================================================================
-- Covers the 9 required cases against the REAL functions, RLS helpers and
-- triggers.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → paste this whole file → Run.
--   Run it AFTER applying 20260806000048_activation_code_states.sql.
--
-- SAFETY
--   The whole script runs inside ONE transaction that ALWAYS ends in ROLLBACK.
--   It writes nothing: the temporary codes, auth users, profiles and the
--   payment rows created by the activation trigger are all thrown away. No
--   existing row is read-modified — the script only ever touches rows it
--   created itself.
--
-- READING THE RESULT
--   * Script completes with no error  →  ALL TESTS PASSED.
--   * Any failure aborts immediately with "Tn FAILED (...)" naming the case.
--   Per-test details are emitted as NOTICEs (Supabase: the "Messages" pane).
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_imm_user   UUID := gen_random_uuid();
  v_pfl_user   UUID := gen_random_uuid();
  v_dup_user   UUID := gen_random_uuid();
  v_res        JSON;
  v_course     TEXT;
  v_used       BOOLEAN;
  v_ok         BOOLEAN;
  v_payment    RECORD;

  -- Temporary codes. Realistic prefixes so we also prove the program is read
  -- from the `course` COLUMN and not from the prefix.
  c_imm   TEXT := 'IU-TSTMMG';   -- valid, immigration
  c_pfl   TEXT := 'AU-TSTPFL';   -- valid, pflege
  c_used  TEXT := 'AC-TSTUSE';   -- already redeemed
  c_rev   TEXT := 'IU-TSTREV';   -- revoked
  c_pend  TEXT := 'IU-TSTPND';   -- not yet available
  c_bad   TEXT := 'ZZ-NOSUCH';   -- never inserted
BEGIN

  -- ── Fixtures ──────────────────────────────────────────────────────────────
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  SELECT '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
         'activation-test+' || u.id || '@example.invalid', 'x-not-a-real-hash',
         NOW(), NOW(), NOW(), '{"provider":"email"}'::jsonb, '{}'::jsonb
  FROM (VALUES (v_imm_user), (v_pfl_user), (v_dup_user)) AS u(id);

  INSERT INTO activation_codes (code, tier, course, is_used, revoked_at, available_at, created_by, notes)
  VALUES
    (c_imm,  'autonome',   'immigration', FALSE, NULL,  NULL,                 'test-suite', 'TEMP — rolled back'),
    (c_pfl,  'autonome',   'pflege',      FALSE, NULL,  NULL,                 'test-suite', 'TEMP — rolled back'),
    (c_used, 'accompagne', 'pflege',      TRUE,  NULL,  NULL,                 'test-suite', 'TEMP — rolled back'),
    (c_rev,  'autonome',   'immigration', FALSE, NOW(), NULL,                 'test-suite', 'TEMP — rolled back'),
    (c_pend, 'autonome',   'immigration', FALSE, NULL,  NOW() + INTERVAL '7 day', 'test-suite', 'TEMP — rolled back');

  RAISE NOTICE '--- fixtures created (all rolled back at the end) ---';

  -- ══ T1 — a valid IMMIGRATION code resolves to the immigration program ═════
  v_res := validate_activation_code(c_imm);
  IF NOT (v_res->>'ok' = 'true' AND v_res->>'course' = 'immigration') THEN
    RAISE EXCEPTION 'T1 FAILED (valid immigration code): %', v_res;
  END IF;
  RAISE NOTICE 'T1 OK   valid immigration code -> program=% tier=%', v_res->>'course', v_res->>'tier';

  -- ══ T2 — a valid PFLEGE code resolves to the pflege program ══════════════
  v_res := validate_activation_code(c_pfl);
  IF NOT (v_res->>'ok' = 'true' AND v_res->>'course' = 'pflege') THEN
    RAISE EXCEPTION 'T2 FAILED (valid pflege code): %', v_res;
  END IF;
  RAISE NOTICE 'T2 OK   valid pflege code -> program=% tier=%', v_res->>'course', v_res->>'tier';

  -- ══ T3 — invalid code ════════════════════════════════════════════════════
  v_res := validate_activation_code(c_bad);
  IF NOT (v_res->>'ok' = 'false' AND v_res->>'error' = 'CODE_INVALID') THEN
    RAISE EXCEPTION 'T3 FAILED (invalid code): %', v_res;
  END IF;
  -- and no program is ever leaked alongside a rejection
  IF v_res->>'course' IS NOT NULL THEN
    RAISE EXCEPTION 'T3 FAILED (invalid code leaked a program): %', v_res;
  END IF;
  RAISE NOTICE 'T3 OK   invalid code -> CODE_INVALID, no program leaked';

  -- ══ T4 — already used code ═══════════════════════════════════════════════
  v_res := validate_activation_code(c_used);
  IF NOT (v_res->>'ok' = 'false' AND v_res->>'error' = 'CODE_ALREADY_USED') THEN
    RAISE EXCEPTION 'T4 FAILED (used code): %', v_res;
  END IF;
  RAISE NOTICE 'T4 OK   used code -> CODE_ALREADY_USED';

  -- ══ T5 — revoked code ════════════════════════════════════════════════════
  v_res := validate_activation_code(c_rev);
  IF NOT (v_res->>'ok' = 'false' AND v_res->>'error' = 'CODE_REVOKED') THEN
    RAISE EXCEPTION 'T5 FAILED (revoked code): %', v_res;
  END IF;
  RAISE NOTICE 'T5 OK   revoked code -> CODE_REVOKED';

  -- ══ T6 — pending code (valid, but not yet activatable) ═══════════════════
  v_res := validate_activation_code(c_pend);
  IF NOT (v_res->>'ok' = 'false' AND v_res->>'error' = 'CODE_PENDING') THEN
    RAISE EXCEPTION 'T6 FAILED (pending code): %', v_res;
  END IF;
  RAISE NOTICE 'T6 OK   pending code -> CODE_PENDING';

  -- ══ T7 — course authorization: redeeming enrolls in ONE course only ══════
  -- Immigration student.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_imm_user, 'role', 'authenticated')::text, TRUE);

  v_res := redeem_activation_code(c_imm, 'Test', 'Immigration', '+213555000001');
  IF NOT (v_res->>'ok' = 'true' AND v_res->>'course' = 'immigration') THEN
    RAISE EXCEPTION 'T7 FAILED (redeem immigration): %', v_res;
  END IF;

  SELECT course_access INTO v_course FROM profiles WHERE id = v_imm_user;
  IF v_course IS DISTINCT FROM 'immigration' THEN
    RAISE EXCEPTION 'T7 FAILED (enrollment): course_access=% expected immigration', v_course;
  END IF;
  -- has_course() is the expression EVERY course-isolation RLS policy uses
  -- (mig 036), so asserting it asserts the policies themselves.
  IF NOT has_course('immigration') THEN
    RAISE EXCEPTION 'T7 FAILED: immigration student denied immigration content';
  END IF;
  IF has_course('pflege') THEN
    RAISE EXCEPTION 'T7 FAILED: immigration student granted PFLEGE content';
  END IF;

  -- The activation trigger must book the payment against the right course.
  SELECT p.course, p.tier INTO v_payment
  FROM payments p JOIN activation_codes ac ON ac.id = p.activation_code_id
  WHERE ac.code = c_imm;
  IF v_payment.course IS DISTINCT FROM 'immigration' THEN
    RAISE EXCEPTION 'T7 FAILED (accounting): payment course=% expected immigration', v_payment.course;
  END IF;

  -- Pflege student, same code path, opposite program.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_pfl_user, 'role', 'authenticated')::text, TRUE);

  v_res := redeem_activation_code(c_pfl, 'Test', 'Pflege', '+213555000002');
  IF NOT (v_res->>'ok' = 'true' AND v_res->>'course' = 'pflege') THEN
    RAISE EXCEPTION 'T7 FAILED (redeem pflege): %', v_res;
  END IF;
  SELECT course_access INTO v_course FROM profiles WHERE id = v_pfl_user;
  IF v_course IS DISTINCT FROM 'pflege' THEN
    RAISE EXCEPTION 'T7 FAILED (enrollment): course_access=% expected pflege', v_course;
  END IF;
  IF NOT has_course('pflege') OR has_course('immigration') THEN
    RAISE EXCEPTION 'T7 FAILED: pflege student has the wrong course grants';
  END IF;
  RAISE NOTICE 'T7 OK   each code enrolls in its OWN course only; accounting matches';

  -- ══ T8 — manual URL / form / API manipulation cannot change the course ═══
  -- The React guards are cosmetic; this is the control that actually holds.
  -- Still acting as the PFLEGE student:
  v_ok := FALSE;
  BEGIN
    UPDATE profiles SET course_access = 'immigration' WHERE id = v_pfl_user;
  EXCEPTION WHEN OTHERS THEN
    v_ok := TRUE;   -- protect_profile_immutable_fields (mig 037) refused it
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'T8 FAILED: a student self-granted the other course';
  END IF;

  SELECT course_access INTO v_course FROM profiles WHERE id = v_pfl_user;
  IF v_course IS DISTINCT FROM 'pflege' THEN
    RAISE EXCEPTION 'T8 FAILED: course_access changed to %', v_course;
  END IF;
  -- ...and the entitlement used by every content policy is unchanged.
  IF has_course('immigration') THEN
    RAISE EXCEPTION 'T8 FAILED: pflege student can read immigration content';
  END IF;
  RAISE NOTICE 'T8 OK   self-escalation refused; cross-course content stays denied';

  -- ══ T9 — a failed activation must NOT consume the code ═══════════════════
  -- Deterministic failure: a user that already has a profile.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_pfl_user, 'role', 'authenticated')::text, TRUE);
  v_res := redeem_activation_code(c_pend, 'Test', 'Retry', '+213555000003');
  IF v_res->>'ok' <> 'false' THEN
    RAISE EXCEPTION 'T9 FAILED: redeem succeeded for a user who already has a profile: %', v_res;
  END IF;

  SELECT is_used INTO v_used FROM activation_codes WHERE code = c_pend;
  IF v_used THEN
    RAISE EXCEPTION 'T9 FAILED: code consumed by a FAILED activation';
  END IF;

  -- A revoked code is refused at redeem too, not only at validate — validate
  -- ran seconds earlier in the edge function, so redeem is the authoritative
  -- check (a code revoked in between must not slip through).
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_dup_user, 'role', 'authenticated')::text, TRUE);
  v_res := redeem_activation_code(c_rev, 'Test', 'Revoked', '+213555000004');
  IF NOT (v_res->>'ok' = 'false' AND v_res->>'error' = 'CODE_REVOKED') THEN
    RAISE EXCEPTION 'T9 FAILED: revoked code was not refused at redeem: %', v_res;
  END IF;
  SELECT is_used INTO v_used FROM activation_codes WHERE code = c_rev;
  IF v_used THEN
    RAISE EXCEPTION 'T9 FAILED: revoked code was consumed';
  END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = v_dup_user) THEN
    RAISE EXCEPTION 'T9 FAILED: a profile was created despite a refused redeem';
  END IF;
  RAISE NOTICE 'T9 OK   failed activation leaves the code redeemable and creates nothing';

  -- ══ Regression — pre-existing Pflege codes are untouched by mig 048 ══════
  -- Every code that existed before this work has course='pflege',
  -- revoked_at=NULL, available_at=NULL, so it must still validate exactly as
  -- it did before. Checked against REAL rows, read-only.
  IF EXISTS (
    SELECT 1 FROM activation_codes
    WHERE created_by <> 'test-suite' AND (course IS NULL OR course NOT IN ('pflege','immigration'))
  ) THEN
    RAISE EXCEPTION 'REGRESSION FAILED: existing codes with an unusable course value';
  END IF;

  SELECT COUNT(*) = 0 INTO v_ok
  FROM activation_codes
  WHERE created_by <> 'test-suite' AND is_used = FALSE
    AND (revoked_at IS NOT NULL OR available_at IS NOT NULL);
  IF NOT v_ok THEN
    RAISE EXCEPTION 'REGRESSION FAILED: mig 048 accidentally revoked or held existing codes';
  END IF;
  RAISE NOTICE 'REGRESSION OK  existing codes keep course + stay active/available';

  RAISE NOTICE '=========================================';
  RAISE NOTICE ' ALL TESTS PASSED — rolling back fixtures';
  RAISE NOTICE '=========================================';
END $$;

-- Nothing above is kept. This script is read-only in effect.
ROLLBACK;
