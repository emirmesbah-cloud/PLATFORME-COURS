-- =============================================================================
-- Course-aware activation codes
-- =============================================================================
-- An activation code now carries WHICH course it unlocks. At redemption the
-- student's profiles.course_access is set automatically — no manual admin
-- toggle needed for Immigration sales.
--
-- Prefix scheme (backwards compatible — existing AU/AC codes untouched) :
--   AU-  Pflege      · Autonome
--   AC-  Pflege      · Accompagné
--   IU-  Immigration · Autonome
--   IC-  Immigration · Accompagné
-- =============================================================================

BEGIN;

-- 1. course column on activation_codes (existing rows = pflege).
ALTER TABLE public.activation_codes
  ADD COLUMN IF NOT EXISTS course TEXT NOT NULL DEFAULT 'pflege';

DO $$ BEGIN
  ALTER TABLE public.activation_codes
    ADD CONSTRAINT activation_codes_course_check
    CHECK (course IN ('pflege', 'immigration'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. admin_generate_codes : add p_course, pick prefix from (course, tier).
CREATE OR REPLACE FUNCTION admin_generate_codes(
  p_tier   tier_enum,
  p_count  INT,
  p_notes  TEXT DEFAULT NULL,
  p_course TEXT DEFAULT 'pflege'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_prefix  TEXT;
  v_codes   TEXT[] := ARRAY[]::TEXT[];
  v_code    TEXT;
  v_attempts INT := 0;
  v_max_attempts INT;
  v_alphabet TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_alphabet_len INT := length(v_alphabet);
  v_i INT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  IF NOT is_admin(v_uid) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_ADMIN');
  END IF;
  IF p_count IS NULL OR p_count <= 0 OR p_count > 50 THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_COUNT');
  END IF;
  IF p_course NOT IN ('pflege', 'immigration') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_COURSE');
  END IF;

  -- Prefix encodes the course (+ tier for Pflege only).
  --   Pflege has 2 offers  : AU (autonome) / AC (accompagné)
  --   Immigration has ONE  : IU (autonome only) — no accompagné offer.
  -- For immigration we force IU regardless of tier (single offer).
  v_prefix := CASE
    WHEN p_course = 'immigration'                          THEN 'IU'
    WHEN p_course = 'pflege' AND p_tier = 'autonome'        THEN 'AU'
    WHEN p_course = 'pflege' AND p_tier = 'accompagne'      THEN 'AC'
  END;
  v_max_attempts := p_count * 30;

  WHILE array_length(v_codes, 1) IS DISTINCT FROM p_count LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > v_max_attempts THEN
      RETURN json_build_object('ok', false, 'error', 'CODE_SPACE_SATURATED');
    END IF;

    v_code := v_prefix || '-';
    FOR v_i IN 1..6 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * v_alphabet_len)::INT, 1);
    END LOOP;

    CONTINUE WHEN EXISTS (SELECT 1 FROM activation_codes WHERE code = v_code);
    CONTINUE WHEN v_code = ANY(v_codes);

    INSERT INTO activation_codes (code, tier, course, notes, created_by)
    VALUES (v_code, p_tier, p_course, p_notes, 'admin-panel');

    v_codes := v_codes || v_code;
  END LOOP;

  BEGIN
    INSERT INTO admin_audit_logs (admin_user_id, action_type, target_type, target_id, metadata)
    VALUES (
      v_uid, 'code_generated', 'activation_codes', NULL,
      jsonb_build_object('tier', p_tier, 'course', p_course, 'count', p_count, 'notes', p_notes)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'admin_generate_codes audit insert failed: %', SQLERRM;
  END;

  RETURN json_build_object('ok', true, 'codes', v_codes, 'tier', p_tier, 'course', p_course);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_generate_codes(tier_enum, INT, TEXT, TEXT) TO authenticated;

-- 3. redeem_activation_code : set profiles.course_access from the code's course.
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

  SELECT * INTO v_code_row
  FROM activation_codes
  WHERE code = trim(p_code)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'CODE_INVALID');
  END IF;
  IF v_code_row.is_used THEN
    RETURN json_build_object('ok', false, 'error', 'CODE_ALREADY_USED');
  END IF;

  -- Crée le profile avec le cours du code (course_access).
  INSERT INTO profiles (id, email, first_name, last_name, whatsapp, tier, course_access, activated_at)
  VALUES (
    v_user_id, v_user_email,
    trim(p_first_name), trim(p_last_name), trim(p_whatsapp),
    v_code_row.tier,
    COALESCE(v_code_row.course, 'pflege'),
    NOW()
  );

  UPDATE activation_codes
  SET is_used = TRUE, used_by_user_id = v_user_id, used_at = NOW()
  WHERE id = v_code_row.id;

  RETURN json_build_object('ok', true, 'tier', v_code_row.tier, 'course', COALESCE(v_code_row.course, 'pflege'));
END;
$$;

GRANT EXECUTE ON FUNCTION redeem_activation_code(TEXT, TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
