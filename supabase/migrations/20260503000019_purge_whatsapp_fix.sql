-- ============================================================================
-- 20260503000019_purge_whatsapp_fix.sql
--
-- BUG FIX (Sherlock R4 — caught by E2E admin test) :
-- `admin_purge_user` (mig 018) tentait `whatsapp = NULL` mais la colonne
-- `profiles.whatsapp` est `TEXT NOT NULL` (mig 001). Résultat :
--   ERROR 23502: null value in column "whatsapp" of relation "profiles"
--   violates not-null constraint
-- → toute la transaction roll-back, l'INSERT audit roll-back aussi, et la
-- fonction retournait `data=null` côté caller. **Aucune donnée n'était
-- supprimée**. La GDPR erasure était silently no-op.
--
-- Fix : on remplace whatsapp par '[purged]' au lieu de NULL. Permet
-- l'erasure de la PII tout en respectant la contrainte NOT NULL.
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_purge_user(p_user_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor      UUID := auth.uid();
  v_anon_email TEXT;
  v_target_exists BOOLEAN;
BEGIN
  IF v_actor IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  IF NOT is_admin(v_actor) THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  IF p_user_id = v_actor THEN
    RETURN json_build_object('ok', false, 'error', 'CANNOT_PURGE_SELF');
  END IF;

  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) INTO v_target_exists;
  IF NOT v_target_exists THEN
    RETURN json_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  END IF;

  v_anon_email := 'deleted-' || p_user_id::TEXT || '@anon.aurel-academy.com';

  -- Anonymize profile.
  -- Bug fix : whatsapp TEXT NOT NULL → on remplace par placeholder ASCII
  -- au lieu de NULL. Idem first_name/last_name (déjà placeholder).
  UPDATE profiles
  SET
    first_name = '[deleted]',
    last_name  = '[deleted]',
    whatsapp   = '[purged]',
    diplome_algerien = NULL,
    revoked_at     = COALESCE(revoked_at, NOW()),
    revoked_reason = COALESCE(revoked_reason, 'GDPR purge: ' || COALESCE(p_reason, '')),
    revoked_by     = v_actor,
    current_session_id = gen_random_uuid()
  WHERE id = p_user_id;

  DELETE FROM lesson_notes WHERE user_id = p_user_id;

  UPDATE feedback
  SET testimonial = NULL,
      is_public = FALSE,
      is_approved = FALSE
  WHERE user_id = p_user_id;

  UPDATE email_logs
  SET recipient_email = '[purged]',
      subject = '[purged]'
  WHERE user_id = p_user_id;

  INSERT INTO admin_audit_logs (admin_user_id, action_type, target_type, target_id, metadata)
  VALUES (
    v_actor,
    'purge_user',
    'profile',
    p_user_id::TEXT,
    jsonb_build_object('reason', p_reason, 'anon_email', v_anon_email)
  );

  RETURN json_build_object(
    'ok', true,
    'anon_email', v_anon_email,
    'warning', 'auth.users still exists — caller must call supabase.auth.admin.deleteUser via service_role'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_purge_user(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION admin_purge_user(UUID, TEXT) IS
  'GDPR Art. 17 erasure. Anonymizes profile (whatsapp=[purged] to satisfy NOT NULL) + lesson_notes + feedback + email_logs. Caller must hard-delete auth.users separately via service_role.';
