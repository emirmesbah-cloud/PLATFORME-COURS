-- ============================================================================
-- Aurel Academy — Migration 008 : Single Active Session per account
--
-- Objectif : empêcher le partage de compte entre plusieurs personnes.
--
-- Mécanisme :
--   1. Une colonne `current_session_id` UUID sur `profiles`.
--   2. Au login, le client appelle `claim_session()` → génère un nouveau
--      session_id, l'écrit dans le profile, le retourne au client.
--      Le client le stocke en localStorage.
--   3. Toute session précédente (autre device) qui avait l'ancien session_id
--      le détecte via Supabase Realtime (UPDATE sur profiles) → log out auto.
--   4. À chaque app boot avec un JWT existant, le client appelle
--      `verify_session(local_session_id)` → si mismatch, log out forcé.
--
-- UX : quand l'utilisateur Sara login sur device B, son device A reçoit en
-- temps réel l'event de mismatch et affiche un toast :
--   "Vous avez été déconnecté car votre compte est utilisé sur un autre appareil."
--
-- Sécurité : le session_id est unguessable (UUID v4). Pas de mécanisme de
-- vol — seule la connaissance du email+password permet de claim une session.
-- ============================================================================

-- 1. Colonne sur profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS current_session_id UUID;

CREATE INDEX IF NOT EXISTS idx_profiles_current_session_id
  ON profiles(current_session_id);

-- Le trigger anti-tampering (migration 001) bloque déjà l'UPDATE sur des
-- colonnes immuables (tier, email, id, activated_at). current_session_id
-- est volontairement modifiable par l'utilisateur pour son PROPRE row, c'est
-- géré par les policies RLS standards et la RPC ci-dessous.

-- ----------------------------------------------------------------------------
-- 2. RPC claim_session
--    Appelée après chaque login/activation → génère un nouvel ID, l'écrit
--    dans profiles, retourne l'ID au client.
--    Effet collatéral : tout autre device qui avait l'ancien ID est notifié
--    via Realtime et se déconnecte automatiquement.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_session()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_new_id UUID := gen_random_uuid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  UPDATE profiles
  SET current_session_id = v_new_id
  WHERE id = v_uid;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND');
  END IF;

  RETURN json_build_object('ok', true, 'session_id', v_new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION claim_session() TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. RPC verify_session
--    Le client envoie l'ID stocké en localStorage. La RPC compare avec
--    ce qui est en DB. Si match → ok. Sinon → kicked, le client doit logout.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION verify_session(p_session_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_db_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT current_session_id INTO v_db_id FROM profiles WHERE id = v_uid;

  IF v_db_id IS NULL THEN
    -- Pas de session enregistrée (vieux profile pré-migration)
    -- → on accepte l'ancienne session une fois, puis le prochain login claim_session.
    RETURN json_build_object('ok', true, 'note', 'no_db_session');
  END IF;

  IF v_db_id IS DISTINCT FROM p_session_id THEN
    RETURN json_build_object('ok', false, 'error', 'SESSION_MISMATCH');
  END IF;

  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION verify_session(UUID) TO authenticated;
