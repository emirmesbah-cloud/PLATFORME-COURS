-- ============================================================================
-- Aurel Academy — Plateforme étudiant — Phase 1
-- Migration 004 : fonctions RPC (PostgreSQL)
-- ============================================================================
--
-- IMPORTANT — Architecture du flow d'activation
-- ----------------------------------------------
-- PostgreSQL ne peut pas appeler `supabase.auth.signUp()` directement (l'API
-- d'auth vit hors de Postgres). Le flow de la spec est implémenté en deux
-- couches :
--
--   1. Edge Function `/functions/v1/activate-account`  (Deno + service_role)
--      - Reçoit { code, email, password, first_name, last_name, whatsapp }
--      - Valide le code (RPC validate_activation_code)
--      - Crée l'utilisateur via auth.admin.createUser
--      - Appelle la RPC `redeem_activation_code` pour créer le profile et
--        marquer le code utilisé (atomique côté DB)
--      - Retourne la session token au client
--
--   2. RPC SQL `redeem_activation_code(code, first_name, last_name, whatsapp)`
--      - SECURITY DEFINER : valide + crée profile + marque code utilisé
--      - Tourne dans une transaction unique → atomique
--
-- Le client peut donc appeler EITHER l'edge function (recommandé), EITHER les
-- RPC à la main s'il préfère gérer le signUp côté client.
--
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. validate_activation_code
--    Vérifie qu'un code existe et n'est pas utilisé. Retourne le tier.
--    Erreurs : CODE_INVALID, CODE_ALREADY_USED.
-- ----------------------------------------------------------------------------
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

  IF v_row.is_used THEN
    RETURN json_build_object('ok', false, 'error', 'CODE_ALREADY_USED');
  END IF;

  RETURN json_build_object('ok', true, 'tier', v_row.tier);
END;
$$;

GRANT EXECUTE ON FUNCTION validate_activation_code(TEXT) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. redeem_activation_code
--    Appelée APRÈS qu'un utilisateur soit authentifié (auth.uid() set).
--    - Valide le code
--    - Crée le row profiles correspondant
--    - Marque le code utilisé (transaction atomique)
--
--    Erreurs explicites : CODE_INVALID, CODE_ALREADY_USED, NOT_AUTHENTICATED,
--                         PROFILE_ALREADY_EXISTS, EMAIL_MISMATCH.
-- ----------------------------------------------------------------------------
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

  -- Récup email de l'utilisateur authentifié (pour profile.email)
  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  IF v_user_email IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  -- Profile déjà existant ?
  IF EXISTS (SELECT 1 FROM profiles WHERE id = v_user_id) THEN
    RETURN json_build_object('ok', false, 'error', 'PROFILE_ALREADY_EXISTS');
  END IF;

  -- Verrouille le code en row-level pour éviter les races (deux clients
  -- redeem le même code en parallèle).
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

  -- Crée le profile
  INSERT INTO profiles (id, email, first_name, last_name, whatsapp, tier, activated_at)
  VALUES (
    v_user_id,
    v_user_email,
    trim(p_first_name),
    trim(p_last_name),
    trim(p_whatsapp),
    v_code_row.tier,
    NOW()
  );

  -- Marque le code utilisé
  UPDATE activation_codes
  SET is_used = TRUE,
      used_by_user_id = v_user_id,
      used_at = NOW()
  WHERE id = v_code_row.id;

  RETURN json_build_object(
    'ok', true,
    'tier', v_code_row.tier,
    'user_id', v_user_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION redeem_activation_code(TEXT, TEXT, TEXT, TEXT) TO authenticated;


-- ----------------------------------------------------------------------------
-- 3. get_user_progress_summary
--    Retourne un résumé global de la progression d'un utilisateur.
--    Si p_user_id est NULL, utilise auth.uid() (sécurise contre l'usurpation
--    sauf service_role).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_user_progress_summary(p_user_id UUID DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid                   UUID;
  v_total_lessons         INT;
  v_completed_lessons     INT;
  v_total_watched_seconds BIGINT;
  v_last_lesson_number    INT;
  v_pct                   NUMERIC;
BEGIN
  -- Sécurité : si appelé via authenticated, force p_user_id = auth.uid()
  IF auth.uid() IS NOT NULL THEN
    v_uid := auth.uid();
  ELSE
    v_uid := p_user_id;  -- service_role : autorisé à lire pour n'importe qui
  END IF;

  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT COUNT(*) INTO v_total_lessons FROM lessons;

  SELECT
    COALESCE(SUM(CASE WHEN lp.completed THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(lp.watched_seconds), 0)
  INTO v_completed_lessons, v_total_watched_seconds
  FROM lesson_progress lp
  WHERE lp.user_id = v_uid;

  -- Dernière leçon visionnée (= la plus récemment updated)
  SELECT l.lesson_number INTO v_last_lesson_number
  FROM lesson_progress lp
  JOIN lessons l ON l.id = lp.lesson_id
  WHERE lp.user_id = v_uid
  ORDER BY lp.updated_at DESC
  LIMIT 1;

  v_pct := CASE
    WHEN v_total_lessons > 0
      THEN ROUND((v_completed_lessons::NUMERIC / v_total_lessons::NUMERIC) * 100, 1)
    ELSE 0
  END;

  RETURN json_build_object(
    'ok', true,
    'total_lessons',          v_total_lessons,
    'completed_lessons',      v_completed_lessons,
    'percentage_complete',    v_pct,
    'total_watched_seconds',  v_total_watched_seconds,
    'last_lesson_watched',    v_last_lesson_number
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_progress_summary(UUID) TO authenticated;


-- ----------------------------------------------------------------------------
-- 4. update_lesson_progress
--    UPSERT dans lesson_progress + détecte la complétion (≥90% de la durée).
--    Toujours scopé à auth.uid() (sécurité).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_lesson_progress(
  p_lesson_id        UUID,
  p_watched_seconds  INT,
  p_position_seconds INT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid           UUID := auth.uid();
  v_duration_min  INT;
  v_threshold_sec INT;
  v_completed     BOOLEAN;
  v_completed_at  TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  IF p_lesson_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'LESSON_REQUIRED');
  END IF;

  -- Clamp valeurs négatives
  IF p_watched_seconds IS NULL OR p_watched_seconds < 0 THEN p_watched_seconds := 0; END IF;
  IF p_position_seconds IS NULL OR p_position_seconds < 0 THEN p_position_seconds := 0; END IF;

  -- Récup durée de la leçon
  SELECT duration_minutes INTO v_duration_min FROM lessons WHERE id = p_lesson_id;
  IF v_duration_min IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'LESSON_NOT_FOUND');
  END IF;

  v_threshold_sec := (v_duration_min * 60 * 90) / 100;  -- 90% de la durée
  v_completed     := p_watched_seconds >= v_threshold_sec;
  v_completed_at  := CASE WHEN v_completed THEN NOW() ELSE NULL END;

  INSERT INTO lesson_progress (
    user_id, lesson_id, watched_seconds, completed, completed_at,
    last_position_seconds, updated_at
  ) VALUES (
    v_uid, p_lesson_id, p_watched_seconds, v_completed, v_completed_at,
    p_position_seconds, NOW()
  )
  ON CONFLICT (user_id, lesson_id) DO UPDATE SET
    -- watched_seconds est cumulatif : on garde le max pour ne pas régresser.
    watched_seconds       = GREATEST(lesson_progress.watched_seconds, EXCLUDED.watched_seconds),
    completed             = lesson_progress.completed OR EXCLUDED.completed,
    completed_at          = COALESCE(lesson_progress.completed_at, EXCLUDED.completed_at),
    last_position_seconds = EXCLUDED.last_position_seconds,
    updated_at            = NOW();

  RETURN json_build_object(
    'ok', true,
    'completed', v_completed,
    'threshold_seconds', v_threshold_sec
  );
END;
$$;

GRANT EXECUTE ON FUNCTION update_lesson_progress(UUID, INT, INT) TO authenticated;


-- ----------------------------------------------------------------------------
-- 5. touch_last_login
--    Met à jour profiles.last_login_at = NOW() pour l'utilisateur courant.
--    À appeler côté client juste après auth.signInWithPassword().
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_last_login()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  UPDATE profiles SET last_login_at = NOW() WHERE id = v_uid;
  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION touch_last_login() TO authenticated;
