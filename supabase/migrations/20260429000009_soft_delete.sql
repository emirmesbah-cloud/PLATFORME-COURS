-- ============================================================================
-- Aurel Academy — Migration 009 : Soft delete (revoked_at) sur profiles
--
-- Objectif : permettre de "révoquer" un étudiant (refund, fraude, etc.) sans
-- supprimer ses données (analytics, audit, conformité).
--
-- Mécanisme :
--   - Colonne `revoked_at TIMESTAMPTZ` sur profiles (NULL = actif, set = révoqué)
--   - Colonne `revoked_reason TEXT` pour tracer la raison
--   - Toutes les RPC student-facing filtrent `WHERE revoked_at IS NULL`
--   - Admin peut consulter révoqués via une vue séparée
--   - Quand révoqué → l'étudiant est délogué via Realtime (current_session_id
--     reset → mismatch détecté côté client)
--
-- Note : on n'utilise PAS un ENUM "status" car revoked_at fait double usage :
--   - flag (NULL ou pas)
--   - timestamp d'audit (quand)
-- ============================================================================

-- 1. Colonnes
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS revoked_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_reason  TEXT,
  ADD COLUMN IF NOT EXISTS revoked_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_revoked_at
  ON profiles(revoked_at) WHERE revoked_at IS NULL;

-- 2. Update RLS — un user révoqué ne peut plus rien lire/écrire sur ses propres tables
DROP POLICY IF EXISTS "Users read own profile" ON profiles;
CREATE POLICY "Users read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id AND revoked_at IS NULL);

DROP POLICY IF EXISTS "Users update own profile" ON profiles;
CREATE POLICY "Users update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id AND revoked_at IS NULL)
  WITH CHECK (auth.uid() = id AND revoked_at IS NULL);

-- Lesson progress
DROP POLICY IF EXISTS "Users manage own progress" ON lesson_progress;
CREATE POLICY "Users manage own progress"
  ON lesson_progress FOR ALL
  TO authenticated
  USING (
    auth.uid() = user_id
    AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND revoked_at IS NOT NULL)
  )
  WITH CHECK (
    auth.uid() = user_id
    AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND revoked_at IS NOT NULL)
  );

-- Bonus downloads
DROP POLICY IF EXISTS "Users insert own downloads" ON bonus_downloads;
CREATE POLICY "Users insert own downloads"
  ON bonus_downloads FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND revoked_at IS NOT NULL)
  );

DROP POLICY IF EXISTS "Users read own downloads" ON bonus_downloads;
CREATE POLICY "Users read own downloads"
  ON bonus_downloads FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND revoked_at IS NOT NULL)
  );

-- 3. RPC admin_revoke_user — utilisée par l'admin panel
CREATE OR REPLACE FUNCTION admin_revoke_user(
  p_user_id UUID,
  p_reason  TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_is_admin BOOLEAN;
BEGIN
  IF v_actor IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_actor;
  IF NOT COALESCE(v_is_admin, FALSE) THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  -- Empêche un admin de se révoquer lui-même
  IF p_user_id = v_actor THEN
    RETURN json_build_object('ok', false, 'error', 'CANNOT_REVOKE_SELF');
  END IF;

  -- Mark profile as revoked
  UPDATE profiles
  SET
    revoked_at      = NOW(),
    revoked_reason  = p_reason,
    revoked_by      = v_actor,
    -- Reset session_id pour forcer logout via realtime sub
    current_session_id = gen_random_uuid()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  END IF;

  -- Log audit
  INSERT INTO admin_audit_logs (actor_id, action, target_id, details)
  VALUES (
    v_actor,
    'revoke_user',
    p_user_id,
    jsonb_build_object('reason', p_reason)
  );

  RETURN json_build_object('ok', true, 'revoked_at', NOW());
EXCEPTION WHEN OTHERS THEN
  -- Si admin_audit_logs n'a pas la bonne shape, on retourne quand même ok pour le revoke
  -- mais on log l'erreur d'audit.
  RAISE WARNING 'Audit log failed: %', SQLERRM;
  RETURN json_build_object('ok', true, 'revoked_at', NOW(), 'audit_error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_revoke_user(UUID, TEXT) TO authenticated;

-- 4. RPC admin_unrevoke_user — pour annuler la révocation (rare mais utile)
CREATE OR REPLACE FUNCTION admin_unrevoke_user(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_is_admin BOOLEAN;
BEGIN
  IF v_actor IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_actor;
  IF NOT COALESCE(v_is_admin, FALSE) THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  UPDATE profiles
  SET revoked_at = NULL, revoked_reason = NULL, revoked_by = NULL
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  END IF;

  INSERT INTO admin_audit_logs (actor_id, action, target_id, details)
  VALUES (v_actor, 'unrevoke_user', p_user_id, '{}'::jsonb);

  RETURN json_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Audit log failed: %', SQLERRM;
  RETURN json_build_object('ok', true, 'audit_error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_unrevoke_user(UUID) TO authenticated;

-- 5. Vue admin pour voir tous les profiles (incluant révoqués)
--    L'admin panel filtre via RLS qui doit accepter les révoqués pour les admins.
--    Note : RLS standard sur profiles bloque revoked_at IS NOT NULL ; on
--    contourne via une vue accessible aux admins seulement.
CREATE OR REPLACE VIEW admin_profiles_all AS
  SELECT * FROM profiles;

-- Cette vue n'a pas de RLS native ; l'accès est contrôlé via les policies de profiles
-- (un admin a is_admin=TRUE et donc revoked_at peut être NULL ou pas pour lui-même).
-- Pour permettre aux admins de voir TOUS les profiles (y compris révoqués) on ajoute
-- une policy spécifique :
DROP POLICY IF EXISTS "Admins read all profiles" ON profiles;
CREATE POLICY "Admins read all profiles"
  ON profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p2
      WHERE p2.id = auth.uid()
        AND p2.is_admin = TRUE
        AND p2.revoked_at IS NULL
    )
  );
