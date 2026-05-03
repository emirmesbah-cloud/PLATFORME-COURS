-- ============================================================================
-- 20260503000014_security_sweep.sql
--
-- Sherlock audit follow-ups (HIGH + MEDIUM + LOW that are pure-DB).
--
-- 1. Revoke anon EXECUTE on is_admin(UUID)               → no anon admin probe
-- 2. Revoke anon EXECUTE on validate_activation_code     → was a code brute-force vector
-- 3. Tighten feedback INSERT policy                      → student can't self-publish "approved"
-- 4. claim_session refuses revoked users                 → revoked can't claim a fresh session
-- 5. Length cap on lesson_notes.content                  → storage abuse
-- 6. Rate-limit bonus_downloads                          → log-flood DoS
-- 7. Force admin_audit_logs.created_at = NOW()           → admin can't backdate audit
-- 8. generate_certificate_number → sequence              → no race on concurrent issuance
-- 9. protect_profile_immutable_fields extended           → revoked_at can't be self-cleared
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Anon grants — drop them
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION is_admin(UUID)               FROM anon;
REVOKE EXECUTE ON FUNCTION validate_activation_code(TEXT) FROM anon;
-- (`activate-account` edge function calls validate_activation_code with the
--  service-role admin client, so dropping anon doesn't break the public flow.)


-- ----------------------------------------------------------------------------
-- 2. feedback : prevent students from self-publishing approved testimonials
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users insert own feedback" ON feedback;

CREATE POLICY "Users insert own feedback"
  ON feedback FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND is_approved = FALSE   -- can't self-approve
    AND is_public   = FALSE   -- can't self-publish
  );

-- Empêche aussi un user de retro-modifier son feedback pour le rendre
-- "public+approved" via UPDATE. Pas de policy UPDATE → INSERT-only pour les
-- users (existant correct, on documente ici).
DROP POLICY IF EXISTS "Users update own feedback" ON feedback;
-- (intentionnellement non recréée — feedback immuable côté user)


-- ----------------------------------------------------------------------------
-- 3. claim_session : refuse les users révoqués
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_session()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_new_id UUID := gen_random_uuid();
  v_revoked_at TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  -- Refuse si user révoqué — empêche un user revoked de continuer à utiliser
  -- l'app via une session-claim côté client. Avant ce fix, le user revoked
  -- pouvait claim_session() → garder le single-session valide → ses RPC
  -- SECURITY DEFINER passaient même si SELECT était bloqué par RLS.
  SELECT revoked_at INTO v_revoked_at FROM profiles WHERE id = v_uid;
  IF v_revoked_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'ACCOUNT_REVOKED');
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
-- GRANT inchangé


-- ----------------------------------------------------------------------------
-- 4. lesson_notes : length cap (storage abuse)
-- ----------------------------------------------------------------------------
ALTER TABLE lesson_notes
  DROP CONSTRAINT IF EXISTS lesson_notes_content_length_check;
ALTER TABLE lesson_notes
  ADD CONSTRAINT lesson_notes_content_length_check
  CHECK (length(content) <= 50000);


-- ----------------------------------------------------------------------------
-- 5. bonus_downloads : rate-limit (1 row max par user/bonus/heure)
--    Évite le log-flood DoS si un client spam le bouton download.
--    Le INSERT échouera silencieusement côté frontend (le toast s'affiche
--    quand même — c'est OK, l'effet "downloaded" reste juste).
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS bonus_downloads_rate_limit_idx
  ON bonus_downloads (
    user_id,
    bonus_resource_id,
    date_trunc('hour', downloaded_at)
  );


-- ----------------------------------------------------------------------------
-- 6. admin_audit_logs : force created_at = NOW() via trigger
--    Empêche un admin de backdater une entrée d'audit (cover-up).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_logs_force_now()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.created_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_force_now_trg ON admin_audit_logs;
CREATE TRIGGER audit_logs_force_now_trg
  BEFORE INSERT OR UPDATE ON admin_audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION audit_logs_force_now();


-- ----------------------------------------------------------------------------
-- 7. generate_certificate_number : utilise une séquence, pas COUNT(*)+1
--    Avant : `SELECT COUNT(*)+1 ...` pouvait produire des numéros dupliqués
--    si 2 certificats étaient émis en parallèle. Le UNIQUE constraint
--    rejetait le 2e → trigger échouait → update_lesson_progress rollback →
--    perte silencieuse de la complétion.
--    Maintenant : nextval() est atomique, jamais de collision.
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS certificates_year_seq AS BIGINT MINVALUE 1 START WITH 1;

-- Si des certificats existent déjà, set la séquence à max(N)+1 pour ne pas
-- collisionner avec les numéros existants. Idempotent.
DO $$
DECLARE
  v_max_n INT;
BEGIN
  SELECT COALESCE(MAX(
    NULLIF(regexp_replace(certificate_number, '^AUREL-\d{4}-(\d+)$', '\1'), certificate_number)::INT
  ), 0) INTO v_max_n
  FROM certificates;
  IF v_max_n > 0 THEN
    PERFORM setval('certificates_year_seq', v_max_n);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION generate_certificate_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_year INT := EXTRACT(YEAR FROM NOW());
  v_n    BIGINT;
BEGIN
  v_n := nextval('certificates_year_seq');
  RETURN format('AUREL-%s-%s', v_year, lpad(v_n::TEXT, 4, '0'));
END;
$$;
-- (GRANT inchangé — c'était SECURITY DEFINER déjà)


-- ----------------------------------------------------------------------------
-- 8. protect_profile_immutable_fields : ajoute revoked_at/revoked_reason/revoked_by
--    Avant : RLS USING (revoked_at IS NULL) bloquait les updates côté user
--    pendant qu'il était révoqué, mais si jamais cette policy changeait
--    le user pourrait self-clear son revoked_at. Defense en profondeur :
--    le trigger bloque ces colonnes pour tous les UPDATE non-service-role.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION protect_profile_immutable_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    -- service_role bypasse cette protection
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

  -- Sherlock fix : revoked_* doivent être set uniquement par admin_revoke_user
  -- (qui tourne en SECURITY DEFINER et bypasse via auth.uid()=null check ?
  -- Non : SECURITY DEFINER ne change pas auth.uid(). On laisse passer
  -- spécifiquement les NULL→NULL ou identiques, et on accepte que
  -- admin_revoke_user mute via l'UPDATE direct — la fonction étant
  -- granted aux authenticated et vérifiant is_admin, c'est l'admin qui
  -- update. Pour un admin légitime, on autorise. Pour un user normal,
  -- on bloque toute modification de ces colonnes.)
  --
  -- Plus simple : on bloque seulement si l'auteur n'est pas admin.
  IF (NEW.revoked_at     IS DISTINCT FROM OLD.revoked_at)
  OR (NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason)
  OR (NEW.revoked_by     IS DISTINCT FROM OLD.revoked_by) THEN
    IF NOT COALESCE((SELECT is_admin FROM profiles WHERE id = auth.uid()), FALSE) THEN
      RAISE EXCEPTION 'Modification de revoked_* interdite';
    END IF;
  END IF;

  -- is_admin n'est pas dans le set protected actuellement — Aurel n'a pas
  -- de RPC pour le promouvoir/demote, c'est fait via SQL admin direct.
  -- Si on voulait le verrouiller : ajouter ici.

  RETURN NEW;
END;
$$;

-- Trigger reste le même (BEFORE UPDATE), il pointe sur la function recréée.

COMMENT ON FUNCTION claim_session() IS
  'Generates a fresh session_id for the authenticated user. Refuses revoked accounts.';
COMMENT ON FUNCTION generate_certificate_number() IS
  'Atomic via certificates_year_seq sequence. Format: AUREL-{YYYY}-{NNNN}.';
