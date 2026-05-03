-- ============================================================================
-- 20260503000012_fix_admin_revoke_audit.sql
--
-- BUGFIX (Sherlock audit) : admin_revoke_user et admin_unrevoke_user (mig 009)
-- inséraient dans `admin_audit_logs` avec les colonnes `actor_id, action,
-- target_id, details` — mais la table (mig 007) a les colonnes
-- `admin_user_id, action_type, target_type, target_id, metadata`.
--
-- L'INSERT levait toujours une exception côté Postgres, mais le bloc
-- `EXCEPTION WHEN OTHERS THEN RETURN ok:true` la swallow → l'admin voyait
-- "révocation OK" et aucune ligne d'audit n'a JAMAIS été écrite. La trace
-- de toutes les révocations / dérévocations passées est perdue (rien à
-- récupérer rétroactivement).
--
-- On re-crée les deux fonctions :
--   - bonnes colonnes (admin_user_id, action_type, target_type, target_id, metadata)
--   - SUPPRESSION du EXCEPTION swallow : si l'audit échoue, la révocation échoue
--     aussi (atomic) → on ne peut plus se retrouver avec un user révoqué sans
--     trace. C'était le pire des deux mondes.
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_revoke_user(p_user_id UUID, p_reason TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor    UUID := auth.uid();
  v_is_admin BOOLEAN;
BEGIN
  IF v_actor IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_actor;
  IF NOT COALESCE(v_is_admin, FALSE) THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  -- Refuse self-revocation : un admin ne peut pas se virer lui-même par accident
  IF p_user_id = v_actor THEN
    RETURN json_build_object('ok', false, 'error', 'CANNOT_REVOKE_SELF');
  END IF;

  -- Mark profile as revoked + reset session_id pour forcer logout via realtime sub
  UPDATE profiles
  SET
    revoked_at         = NOW(),
    revoked_reason     = p_reason,
    revoked_by         = v_actor,
    current_session_id = gen_random_uuid()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  END IF;

  -- Audit : bonnes colonnes maintenant. Pas d'EXCEPTION wrapper —
  -- si l'INSERT échoue, toute la transaction rollback (incluant le
  -- UPDATE profiles ci-dessus). Plus de "révocation silencieuse non auditée".
  INSERT INTO admin_audit_logs (admin_user_id, action_type, target_type, target_id, metadata)
  VALUES (
    v_actor,
    'revoke_user',
    'profile',
    p_user_id::TEXT,
    jsonb_build_object('reason', p_reason)
  );

  RETURN json_build_object('ok', true, 'revoked_at', NOW());
END;
$$;

GRANT EXECUTE ON FUNCTION admin_revoke_user(UUID, TEXT) TO authenticated;


CREATE OR REPLACE FUNCTION admin_unrevoke_user(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor    UUID := auth.uid();
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

  INSERT INTO admin_audit_logs (admin_user_id, action_type, target_type, target_id, metadata)
  VALUES (
    v_actor,
    'unrevoke_user',
    'profile',
    p_user_id::TEXT,
    '{}'::jsonb
  );

  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_unrevoke_user(UUID) TO authenticated;

COMMENT ON FUNCTION admin_revoke_user(UUID, TEXT) IS
  'Revoke a user account (soft delete). Atomic: audit insert failure rolls back the revoke.';
COMMENT ON FUNCTION admin_unrevoke_user(UUID) IS
  'Reverse of admin_revoke_user. Atomic: audit insert failure rolls back the unrevoke.';
