-- ============================================================================
-- 20260503000017_code_keyspace_6char.sql
--
-- SECURITY (Sherlock R3 finding C2) : codes d'activation 4 chiffres = 9 000
-- valeurs possibles par tier. Une fois quelques centaines de codes émis,
-- un attaquant qui leak un code peut deviner les voisins (proximité
-- spatiale = peu d'entropie restante). Vu que `validate_activation_code`
-- est désormais authenticated-only (mig 014), l'attaque nécessite un
-- compte étudiant + automation, mais le coût d'attaque reste bas.
--
-- Fix : nouveaux codes en 6 caractères alphanumériques (32 chars sans
-- I/O/0/1 pour éviter les confusions visuelles) → keyspace ~ 1.07 milliard
-- par tier. Les codes existants 4-chiffres restent valides (backward-compat
-- via le regex étendu côté admin_generate_codes & côté frontend).
--
-- Stratégie de transition :
--   - admin_generate_codes émet désormais des codes 6-char.
--   - validate_activation_code accepte les deux formats (existant +
--     nouveau) sans changement (la fonction normalise déjà toUpperCase
--     et matche par exact code).
--   - Frontend Activate.tsx + AdminCodes.tsx élargissent le regex pour
--     accepter les deux formats pendant la phase de cohabitation.
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
  -- Alphabet sans I/L/O/0/1 (ambiguïtés visuelles) — 32 chars.
  -- Inclut explicitement chiffres 23456789 + lettres ABCDEFGHJKMNPQRSTUVWXYZ.
  v_alphabet TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_alphabet_len INT := 31;
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

    -- Génère un suffixe 6-char depuis l'alphabet (~ 1.07e9 valeurs)
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

  -- Audit log inline (idem mig 011, format inchangé)
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

-- validate_activation_code reste inchangé : il match exact-string sur
-- activation_codes.code, donc il accepte automatiquement les deux formats.
-- redeem_activation_code idem.

COMMENT ON FUNCTION admin_generate_codes(tier_enum, INT, TEXT) IS
  'Generates new 6-char alphanum activation codes (keyspace ~1.07e9 per tier). Old 4-digit codes remain valid via redeem_activation_code (no normalization needed).';
