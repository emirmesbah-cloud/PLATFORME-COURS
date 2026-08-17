BEGIN;

-- Keep closer permissions in the login profile synchronized with the admin directory.
CREATE OR REPLACE FUNCTION public.sync_staff_member_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.auth_user_id IS NOT NULL THEN
    UPDATE public.profiles
    SET staff_role = 'closer', staff_permissions = NEW.permissions
    WHERE id = NEW.auth_user_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sync_staff_member_profile_trigger ON public.staff_members;
CREATE TRIGGER sync_staff_member_profile_trigger
AFTER INSERT OR UPDATE OF auth_user_id, permissions ON public.staff_members
FOR EACH ROW EXECUTE FUNCTION public.sync_staff_member_profile();

-- Large printable batches: 500 codes = up to 2,000 pages in the 4-page format.
CREATE OR REPLACE FUNCTION public.admin_generate_codes(
  p_tier tier_enum, p_count INT, p_notes TEXT DEFAULT NULL, p_course TEXT DEFAULT 'pflege'
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid UUID := auth.uid(); v_prefix TEXT; v_codes TEXT[] := ARRAY[]::TEXT[];
  v_code TEXT; v_attempts INT := 0; v_max_attempts INT;
  v_alphabet TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; v_alphabet_len INT := length(v_alphabet); v_i INT;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  IF NOT is_admin(v_uid) THEN RETURN json_build_object('ok', false, 'error', 'NOT_ADMIN'); END IF;
  IF p_count IS NULL OR p_count <= 0 OR p_count > 500 THEN RETURN json_build_object('ok', false, 'error', 'INVALID_COUNT'); END IF;
  IF p_course NOT IN ('pflege', 'immigration') THEN RETURN json_build_object('ok', false, 'error', 'INVALID_COURSE'); END IF;
  v_prefix := CASE WHEN p_course = 'immigration' THEN 'IU' WHEN p_tier = 'autonome' THEN 'AU' ELSE 'AC' END;
  v_max_attempts := p_count * 30;
  WHILE array_length(v_codes, 1) IS DISTINCT FROM p_count LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > v_max_attempts THEN RETURN json_build_object('ok', false, 'error', 'CODE_SPACE_SATURATED'); END IF;
    v_code := v_prefix || '-';
    FOR v_i IN 1..6 LOOP v_code := v_code || substr(v_alphabet, 1 + floor(random() * v_alphabet_len)::INT, 1); END LOOP;
    CONTINUE WHEN EXISTS (SELECT 1 FROM activation_codes WHERE code = v_code);
    CONTINUE WHEN v_code = ANY(v_codes);
    INSERT INTO activation_codes (code, tier, course, notes, created_by) VALUES (v_code, p_tier, p_course, p_notes, 'admin-panel');
    v_codes := v_codes || v_code;
  END LOOP;
  BEGIN
    INSERT INTO admin_audit_logs (admin_user_id, action_type, target_type, target_id, metadata)
    VALUES (v_uid, 'code_generated', 'activation_codes', NULL, jsonb_build_object('tier', p_tier, 'course', p_course, 'count', p_count, 'notes', p_notes));
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'admin_generate_codes audit insert failed: %', SQLERRM; END;
  RETURN json_build_object('ok', true, 'codes', v_codes, 'tier', p_tier, 'course', p_course);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_generate_codes(tier_enum, INT, TEXT, TEXT) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
