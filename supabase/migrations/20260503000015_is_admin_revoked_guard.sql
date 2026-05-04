-- ============================================================================
-- 20260503000015_is_admin_revoked_guard.sql
--
-- SECURITY (Sherlock round 2 — H2/L6) : `is_admin(UUID)` ne vérifiait que
-- la colonne `is_admin`, pas `revoked_at`. Conséquence : un admin révoqué
-- gardait ses pouvoirs via toutes les RPC qui utilisent `is_admin(auth.uid())`
-- (admin_generate_codes, admin_get_stats, admin_revoke_user, etc.) jusqu'à
-- l'expiration de son JWT — soit jusqu'à 1h après le UPDATE de
-- profiles.revoked_at.
--
-- Le `claim_session` revoked-guard ajouté en mig 014 kick le device via
-- realtime mais n'invalide pas le JWT lui-même. Donc l'attaquant qui
-- intercepte un JWT d'admin compromis pouvait continuer à appeler les
-- RPCs admin pendant 1h après révocation.
--
-- Fix : on ajoute `AND revoked_at IS NULL` au check de is_admin. Toutes
-- les RPCs qui utilisent is_admin(auth.uid()) héritent automatiquement.
-- ============================================================================

CREATE OR REPLACE FUNCTION is_admin(user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT is_admin
    FROM profiles
    WHERE id = user_id
      AND revoked_at IS NULL
  ), FALSE);
$$;

-- GRANT inchangé (authenticated only depuis mig 014, anon a été REVOKE).

COMMENT ON FUNCTION is_admin(UUID) IS
  'Returns TRUE iff the user is admin AND not revoked. Defense in depth: the only check needed across all admin RPCs.';
