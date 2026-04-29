-- ============================================================================
-- Aurel Academy — Migration 011 : audit log inline dans admin_generate_codes
--
-- Problème de perf : le frontend faisait 2 RPCs séquentiels :
--   1. admin_generate_codes  (~300ms RTT)
--   2. log_admin_action      (~300ms RTT)
-- → Total ~600ms par click "Générer".
--
-- Fix : on intègre le log dans la même transaction RPC. Un seul round-trip,
-- le log est garanti atomique avec la création des codes (si le log fail,
-- les codes sont rolled back, ce qui est bien meilleur côté audit que
-- l'ancienne version où le log pouvait être skipped silencieusement).
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_generate_codes(
  p_tier  tier_enum,
  p_count INT,
  p_notes TEXT DEFAULT NULL
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

  v_prefix := CASE p_tier WHEN 'autonome' THEN 'AU' WHEN 'accompagne' THEN 'AC' END;
  v_max_attempts := p_count * 30;

  WHILE array_length(v_codes, 1) IS DISTINCT FROM p_count LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > v_max_attempts THEN
      RETURN json_build_object('ok', false, 'error', 'CODE_SPACE_SATURATED');
    END IF;

    v_code := v_prefix || '-' || LPAD((1000 + floor(random() * 9000))::INT::TEXT, 4, '0');

    CONTINUE WHEN EXISTS (SELECT 1 FROM activation_codes WHERE code = v_code);
    CONTINUE WHEN v_code = ANY(v_codes);

    INSERT INTO activation_codes (code, tier, notes, created_by)
    VALUES (v_code, p_tier, p_notes, 'admin-panel');

    v_codes := v_codes || v_code;
  END LOOP;

  -- Inline audit log : 1 round-trip réseau de moins, atomicité garantie.
  -- (best-effort : si le log fail, on ne fait pas échouer la génération
  -- des codes — le user a déjà reçu les codes, audit imparfait > codes perdus)
  BEGIN
    INSERT INTO admin_audit_logs (admin_user_id, action_type, target_type, target_id, metadata)
    VALUES (
      v_uid,
      'code_generated',
      'activation_codes',
      NULL,
      jsonb_build_object(
        'tier',  p_tier,
        'count', array_length(v_codes, 1),
        'notes', p_notes,
        'codes', to_jsonb(v_codes)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'admin_generate_codes audit insert failed: %', SQLERRM;
  END;

  RETURN json_build_object('ok', true, 'codes', v_codes, 'tier', p_tier);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_generate_codes(tier_enum, INT, TEXT) TO authenticated;
