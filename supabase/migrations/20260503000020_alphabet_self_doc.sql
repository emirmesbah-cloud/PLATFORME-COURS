-- ============================================================================
-- 20260503000020_alphabet_self_doc.sql
--
-- DOC FIX (Sherlock R5) : `admin_generate_codes` (mig 017) avait une magic
-- `v_alphabet_len = 31` hardcodée et un commentaire trompeur "32 chars".
-- L'alphabet actuel `'ABCDEFGHJKMNPQRSTUVWXYZ23456789'` contient 31 chars
-- (skip set : I, L, O, 0, 1 = 5 retraits, pas 4 → 36 - 5 = 31). Keyspace
-- réel = 31^6 = ~887M / tier (toujours énorme, juste pas 1.07e9).
--
-- Fix : on calcule `length(v_alphabet)` dynamiquement → impossible de
-- drift, plus de bug-classe possible si l'alphabet est jamais modifié.
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
  -- Alphabet 31 chars : 22 lettres (sans I/L/O) + 8 chiffres (sans 0/1).
  -- Keyspace = 31^6 ≈ 887M / tier. Cas confusion visuelle minimisée.
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

  v_prefix := CASE p_tier WHEN 'autonome' THEN 'AU' WHEN 'accompagne' THEN 'AC' END;
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

    INSERT INTO activation_codes (code, tier, notes, created_by)
    VALUES (v_code, p_tier, p_notes, 'admin-panel');

    v_codes := v_codes || v_code;
  END LOOP;

  BEGIN
    INSERT INTO admin_audit_logs (admin_user_id, action_type, target_type, target_id, metadata)
    VALUES (
      v_uid,
      'code_generated',
      'activation_codes',
      NULL,
      jsonb_build_object(
        'tier',  p_tier,
        'count', p_count,
        'notes', p_notes,
        'codes_format', '6char-alphanum'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'admin_generate_codes audit insert failed: %', SQLERRM;
  END;

  RETURN json_build_object('ok', true, 'codes', v_codes, 'tier', p_tier);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_generate_codes(tier_enum, INT, TEXT) TO authenticated;
