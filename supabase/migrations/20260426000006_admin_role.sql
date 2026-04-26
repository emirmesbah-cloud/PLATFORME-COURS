-- ============================================================================
-- Aurel Academy — Phase 1.5
-- Migration 006 : rôle admin (is_admin column + helper function + admin RLS)
-- ============================================================================

-- 1. Colonne is_admin sur profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_profiles_is_admin
  ON profiles(is_admin) WHERE is_admin = TRUE;

-- 2. Helper SECURITY DEFINER : retourne TRUE si l'user est admin.
--    SECURITY DEFINER + STABLE → contourne RLS en restant safe (ne lit que profiles.is_admin).
CREATE OR REPLACE FUNCTION is_admin(user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT is_admin FROM profiles WHERE id = user_id), FALSE);
$$;

GRANT EXECUTE ON FUNCTION is_admin(UUID) TO authenticated, anon;

-- 3. Le trigger de protection des champs immuables doit autoriser le service_role
--    à muter is_admin (pour le set-up manuel via dashboard) — on ajoute is_admin
--    à la liste des colonnes protégées contre l'auto-upgrade par les users.
CREATE OR REPLACE FUNCTION protect_profile_immutable_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    -- service_role bypasse cette protection (utile pour le set-up admin).
    RETURN NEW;
  END IF;

  IF NEW.tier IS DISTINCT FROM OLD.tier THEN
    RAISE EXCEPTION 'Modification du tier interdite';
  END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Modification de l''email interdite (passe par auth.users)';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Modification de l''id interdite';
  END IF;
  IF NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN
    RAISE EXCEPTION 'Modification de activated_at interdite';
  END IF;
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    RAISE EXCEPTION 'Modification de is_admin interdite (réservé service_role)';
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Policies admin
DROP POLICY IF EXISTS "Admins read all profiles"           ON profiles;
DROP POLICY IF EXISTS "Admins read all activation_codes"   ON activation_codes;
DROP POLICY IF EXISTS "Admins insert activation_codes"     ON activation_codes;
DROP POLICY IF EXISTS "Admins read all progress"           ON lesson_progress;
DROP POLICY IF EXISTS "Admins update lessons"              ON lessons;
DROP POLICY IF EXISTS "Admins update bonus_resources"      ON bonus_resources;
DROP POLICY IF EXISTS "Admins read all bonus_downloads"    ON bonus_downloads;

-- profiles : admins lisent tout (s'ajoute à la policy "Users read own profile")
CREATE POLICY "Admins read all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

-- activation_codes : admins lisent tout + peuvent insérer
CREATE POLICY "Admins read all activation_codes"
  ON activation_codes FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

CREATE POLICY "Admins insert activation_codes"
  ON activation_codes FOR INSERT
  TO authenticated
  WITH CHECK (is_admin(auth.uid()));

-- lesson_progress : admins lisent tout (en plus de "Users manage own progress")
CREATE POLICY "Admins read all progress"
  ON lesson_progress FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

-- lessons : admins peuvent updater (vdocipher_video_id, is_published)
CREATE POLICY "Admins update lessons"
  ON lessons FOR UPDATE
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- bonus_resources : admins peuvent updater (file_url, is_published)
CREATE POLICY "Admins update bonus_resources"
  ON bonus_resources FOR UPDATE
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- bonus_downloads : admins lisent tout (audit)
CREATE POLICY "Admins read all bonus_downloads"
  ON bonus_downloads FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

-- 5. Storage : admins peuvent uploader/écrire dans bonus-resources
DROP POLICY IF EXISTS "Admins write bonus-resources" ON storage.objects;
CREATE POLICY "Admins write bonus-resources"
  ON storage.objects FOR ALL
  TO authenticated
  USING (bucket_id = 'bonus-resources' AND is_admin(auth.uid()))
  WITH CHECK (bucket_id = 'bonus-resources' AND is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins write lesson-thumbnails" ON storage.objects;
CREATE POLICY "Admins write lesson-thumbnails"
  ON storage.objects FOR ALL
  TO authenticated
  USING (bucket_id = 'lesson-thumbnails' AND is_admin(auth.uid()))
  WITH CHECK (bucket_id = 'lesson-thumbnails' AND is_admin(auth.uid()));

-- 6. Admin RPC : générer N codes en bulk depuis le panel admin (sans service_role).
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

    -- 4 chiffres random : 1000-9999
    v_code := v_prefix || '-' || LPAD((1000 + floor(random() * 9000))::INT::TEXT, 4, '0');

    -- Skip si déjà existant
    CONTINUE WHEN EXISTS (SELECT 1 FROM activation_codes WHERE code = v_code);
    CONTINUE WHEN v_code = ANY(v_codes);

    INSERT INTO activation_codes (code, tier, notes, created_by)
    VALUES (v_code, p_tier, p_notes, 'admin-panel');

    v_codes := v_codes || v_code;
  END LOOP;

  RETURN json_build_object('ok', true, 'codes', v_codes, 'tier', p_tier);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_generate_codes(tier_enum, INT, TEXT) TO authenticated;

-- 7. Admin stats RPC : dashboard /admin
CREATE OR REPLACE FUNCTION admin_get_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_total_students INT;
  v_active_week INT;
  v_codes_total INT;
  v_codes_used INT;
  v_avg_completion NUMERIC;
BEGIN
  IF v_uid IS NULL OR NOT is_admin(v_uid) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_ADMIN');
  END IF;

  SELECT COUNT(*) INTO v_total_students FROM profiles WHERE is_admin = FALSE;

  SELECT COUNT(DISTINCT lp.user_id) INTO v_active_week
  FROM lesson_progress lp
  WHERE lp.updated_at > NOW() - INTERVAL '7 days';

  SELECT COUNT(*), COUNT(*) FILTER (WHERE is_used = TRUE)
  INTO v_codes_total, v_codes_used
  FROM activation_codes;

  -- moyenne de % de leçons complétées par étudiant
  SELECT COALESCE(AVG(pct), 0) INTO v_avg_completion FROM (
    SELECT (COUNT(*) FILTER (WHERE completed)::NUMERIC / NULLIF(18, 0)) * 100 AS pct
    FROM lesson_progress
    GROUP BY user_id
  ) t;

  RETURN json_build_object(
    'ok', true,
    'total_students',   v_total_students,
    'active_week',      v_active_week,
    'codes_total',      v_codes_total,
    'codes_used',       v_codes_used,
    'codes_available',  v_codes_total - v_codes_used,
    'avg_completion',   ROUND(v_avg_completion, 1)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_stats() TO authenticated;
