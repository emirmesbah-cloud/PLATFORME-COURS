-- ============================================================================
-- 20260503000016_sherlock_r3_backend.sql
--
-- Sherlock round 3 backend fixes — five concrete bugs in one migration :
--
-- 1. trigger_check_certificate fires on INSERT too (was UPDATE only)
--    Bug : if a student's first ever lesson_progress row is INSERTed with
--    completed=TRUE (rare but possible : seek to 90% on a tiny lesson, no
--    prior row), the trigger never fires and the certificate is never
--    issued. The 18th lesson must be reached via UPDATE for cert issuance.
--
-- 2. admin_revoke_user idempotent : WHERE revoked_at IS NULL
--    Bug : two admins clicking revoke at the same instant both succeed,
--    overwriting each other's `revoked_reason`/`revoked_by` and writing
--    two audit rows. Now : second concurrent revoke returns
--    ALREADY_REVOKED.
--
-- 3. audit_logs_force_now_trg restricted to BEFORE INSERT
--    Bug : trigger fired on BEFORE INSERT OR UPDATE. Any future UPDATE on
--    an audit row would clobber the original created_at. Now : trigger
--    fires only on INSERT, plus a separate BEFORE UPDATE/DELETE trigger
--    rejects any modification (audit immutability).
--
-- 4. UNIQUE PARTIAL INDEX on email_logs to prevent duplicate inactive
--    reminders if two cron triggers fire concurrently. The check-
--    inactive-users function reads email_logs then writes — race window.
--    INDEX makes the second insert fail loudly (caller catches and skips).
--
-- 5. Bonus-resources storage SELECT policy gains a revoked_at check.
--    Bug : revoked user's JWT stays valid up to 1h after revocation. Their
--    auth.uid() still passes the storage SELECT policy (which only
--    checked authenticated). They can still call createSignedUrl() on
--    paid bonuses. Now : policy joins profiles for revoked_at.
--
-- All idempotent (CREATE OR REPLACE / DROP IF EXISTS / IF NOT EXISTS).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. trigger_check_certificate also on INSERT
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trigger_check_certificate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Pour INSERT : OLD est NULL → on déclenche si NEW.completed = TRUE.
  -- Pour UPDATE : on déclenche si on transitionne FALSE/NULL → TRUE
  -- (évite N appels redondants par leçon pendant un re-watch déjà complété).
  IF NEW.completed = TRUE
     AND (TG_OP = 'INSERT' OR OLD.completed IS NULL OR OLD.completed = FALSE) THEN
    PERFORM check_and_issue_certificate(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lesson_progress_check_certificate ON lesson_progress;
CREATE TRIGGER lesson_progress_check_certificate
  AFTER INSERT OR UPDATE OF completed ON lesson_progress
  FOR EACH ROW
  EXECUTE FUNCTION trigger_check_certificate();


-- ----------------------------------------------------------------------------
-- 2. admin_revoke_user — WHERE revoked_at IS NULL guard
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_revoke_user(p_user_id UUID, p_reason TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor    UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_target_exists BOOLEAN;
BEGIN
  IF v_actor IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  -- Note : is_admin() vérifie aussi revoked_at depuis mig 015.
  -- Un admin révoqué ne passe plus.
  IF NOT is_admin(v_actor) THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  IF p_user_id = v_actor THEN
    RETURN json_build_object('ok', false, 'error', 'CANNOT_REVOKE_SELF');
  END IF;

  -- Idempotent : ne fait rien si déjà révoqué. Évite double-audit en cas de
  -- clicks concurrents par 2 admins, ou de retry réseau côté UI.
  UPDATE profiles
  SET
    revoked_at         = NOW(),
    revoked_reason     = p_reason,
    revoked_by         = v_actor,
    current_session_id = gen_random_uuid()
  WHERE id = p_user_id
    AND revoked_at IS NULL;

  IF NOT FOUND THEN
    -- Distinguer USER_NOT_FOUND de ALREADY_REVOKED pour le caller
    SELECT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) INTO v_target_exists;
    IF NOT v_target_exists THEN
      RETURN json_build_object('ok', false, 'error', 'USER_NOT_FOUND');
    END IF;
    RETURN json_build_object('ok', false, 'error', 'ALREADY_REVOKED');
  END IF;

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


-- ----------------------------------------------------------------------------
-- 3. audit_logs : trigger restricted to INSERT, plus immutability guard
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS audit_logs_force_now_trg ON admin_audit_logs;
CREATE TRIGGER audit_logs_force_now_trg
  BEFORE INSERT ON admin_audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION audit_logs_force_now();

-- Audit trail integrity : on rejette tout UPDATE ou DELETE sur admin_audit_logs.
-- Service_role peut bypass via SUSPEND TRIGGER si jamais il faut purger
-- (retention policy à venir), mais aucun caller normal ne doit pouvoir muter.
CREATE OR REPLACE FUNCTION audit_logs_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_logs is immutable (UPDATE/DELETE forbidden — open a retention RPC if needed)';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_immutable_trg ON admin_audit_logs;
CREATE TRIGGER audit_logs_immutable_trg
  BEFORE UPDATE OR DELETE ON admin_audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION audit_logs_immutable();


-- ----------------------------------------------------------------------------
-- 4. UNIQUE PARTIAL INDEX on email_logs : 1 reminder_inactive max par user
--    par jour (UTC). Évite les doublons sur cron concurrent.
-- ----------------------------------------------------------------------------
-- Note : on utilise sent_at::date qui est IMMUTABLE pour timestamp WITHOUT
-- TIME ZONE — donc on cast via AT TIME ZONE 'UTC' explicitement.
-- Pour rester immutable on indexe sur (date_trunc) avec timestamp (no tz)
-- via cast.
--
-- Approche pragmatique : indexer sur (user_id, email_type, sent_at::date)
-- où sent_at::date applique le timezone session (STABLE, pas IMMUTABLE).
-- Donc on stocke directement une colonne calculée stockée :
ALTER TABLE email_logs
  ADD COLUMN IF NOT EXISTS sent_day_utc DATE
    GENERATED ALWAYS AS ((sent_at AT TIME ZONE 'UTC')::DATE) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS email_logs_one_reminder_per_day_idx
  ON email_logs (user_id, email_type, sent_day_utc)
  WHERE email_type = 'reminder_inactive';


-- ----------------------------------------------------------------------------
-- 5. bonus-resources storage : revoked_at check
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "bonus-resources read for authenticated" ON storage.objects;
CREATE POLICY "bonus-resources read for authenticated"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'bonus-resources'
    AND auth.uid() IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND revoked_at IS NOT NULL
    )
  );

-- Same hardening for bonus-resources WRITE (admins only) — ré-applique le check
-- via is_admin() qui inclut maintenant revoked_at (mig 015).
DROP POLICY IF EXISTS "Admins write bonus-resources" ON storage.objects;
CREATE POLICY "Admins write bonus-resources"
  ON storage.objects FOR ALL
  TO authenticated
  USING (bucket_id = 'bonus-resources' AND is_admin(auth.uid()))
  WITH CHECK (bucket_id = 'bonus-resources' AND is_admin(auth.uid()));


COMMENT ON FUNCTION trigger_check_certificate() IS
  'Issues certificate on first transition to completed=TRUE. Fires on INSERT or UPDATE OF completed.';
COMMENT ON FUNCTION admin_revoke_user(UUID, TEXT) IS
  'Idempotent revoke. Returns ALREADY_REVOKED on second call. Atomic audit insert.';
COMMENT ON FUNCTION audit_logs_immutable() IS
  'Hard-block UPDATE/DELETE on admin_audit_logs. Use service_role + temporarily disable trigger for retention purges.';
