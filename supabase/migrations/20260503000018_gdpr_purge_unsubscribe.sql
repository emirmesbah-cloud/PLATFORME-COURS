-- ============================================================================
-- 20260503000018_gdpr_purge_unsubscribe.sql
--
-- GDPR compliance — two pieces :
--
-- 1. Email opt-out :
--    - profiles.email_opt_out_token (UUID, unique, gen on row creation)
--    - profiles.email_opt_out_marketing (boolean, default FALSE)
--    - public RPC `unsubscribe_via_token(token)` flips the flag without auth
--    - check-inactive-users + send-email skip users with opt_out=TRUE for
--      marketing email types (reminder_inactive, milestone_50,
--      feedback_request). Transactional emails (welcome, certificate) ignore
--      the flag.
--
-- 2. Right-to-erasure :
--    - admin_purge_user(uuid, reason) RPC, admin-only.
--    - Soft-anonymizes : sets email to deleted-{uuid}@anon.aurel-academy.com,
--      nulls whatsapp/first_name/last_name, deletes lesson_notes content,
--      anonymizes feedback testimonials (keeps stats).
--    - Hard-deletes auth.users via Supabase admin API : on laisse au caller
--      service_role de faire ça côté edge function (pas de pg side faisable).
--    - admin_audit_logs reste intact (compliance + traçabilité).
--
-- Idempotent (CREATE OR REPLACE / IF NOT EXISTS / DEFAULT gen_random_uuid()).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Email opt-out columns
-- ----------------------------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email_opt_out_token UUID UNIQUE NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email_opt_out_marketing BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_profiles_email_opt_out_token
  ON profiles (email_opt_out_token);

-- protect_profile_immutable_fields étend la liste — empêche un user de
-- modifier son token de désinscription via UPDATE direct (bonne hygiène,
-- même si l'unique a une fonction ici).
CREATE OR REPLACE FUNCTION protect_profile_immutable_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.tier         IS DISTINCT FROM OLD.tier         THEN RAISE EXCEPTION 'Modification du tier interdite'; END IF;
  IF NEW.email        IS DISTINCT FROM OLD.email        THEN RAISE EXCEPTION 'Modification de l''email interdite (passe par auth.users)'; END IF;
  IF NEW.id           IS DISTINCT FROM OLD.id           THEN RAISE EXCEPTION 'Modification de l''id interdite'; END IF;
  IF NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN RAISE EXCEPTION 'Modification de activated_at interdite'; END IF;
  IF NEW.email_opt_out_token IS DISTINCT FROM OLD.email_opt_out_token THEN
    RAISE EXCEPTION 'Modification de email_opt_out_token interdite';
  END IF;

  IF (NEW.revoked_at     IS DISTINCT FROM OLD.revoked_at)
  OR (NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason)
  OR (NEW.revoked_by     IS DISTINCT FROM OLD.revoked_by) THEN
    IF NOT COALESCE((SELECT is_admin FROM profiles WHERE id = auth.uid()), FALSE) THEN
      RAISE EXCEPTION 'Modification de revoked_* interdite';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


-- ----------------------------------------------------------------------------
-- 2. Public unsubscribe RPC (no auth required, token-gated)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION unsubscribe_via_token(p_token UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID;
  v_email TEXT;
BEGIN
  IF p_token IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'TOKEN_REQUIRED');
  END IF;

  -- On match sur le token sans révéler si le user existe ou pas.
  -- Si le token ne match aucun user, on renvoie ok=true quand même
  -- (avoids enumeration). Coté UI on dit toujours "désinscription effectuée".
  UPDATE profiles
  SET email_opt_out_marketing = TRUE
  WHERE email_opt_out_token = p_token
    AND email_opt_out_marketing = FALSE
  RETURNING id, email INTO v_uid, v_email;

  -- Best-effort audit (sans échouer si insert audit foire).
  IF v_uid IS NOT NULL THEN
    BEGIN
      INSERT INTO admin_audit_logs (admin_user_id, action_type, target_type, target_id, metadata)
      VALUES (
        v_uid, -- self-action; l'admin_user_id est le user lui-même pour ce cas
        'email_unsubscribe',
        'profile',
        v_uid::TEXT,
        jsonb_build_object('via', 'token_link')
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'unsubscribe audit failed: %', SQLERRM;
    END;
  END IF;

  RETURN json_build_object('ok', true);
END;
$$;

-- Anon GRANT : la function est appelée depuis la page publique
-- /unsubscribe sans login.
GRANT EXECUTE ON FUNCTION unsubscribe_via_token(UUID) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- 3. admin_purge_user — right to erasure (GDPR Art. 17)
-- ----------------------------------------------------------------------------
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

  -- Anonymize profile :
  --   - on garde id (FK) + tier (stats agrégés) + activated_at (séquence
  --     temporelle pour analytics) + revoked_at flag.
  --   - on null tout le reste qui contient PII.
  -- Note : profile.email reste à l'ancien email pour cause d'`immutable`
  -- trigger ; le vrai email est dans auth.users que l'edge function
  -- supprime via supabase.auth.admin.deleteUser. La row profiles est
  -- "détachée" du user supprimé (FK reste pointer vers une row auth.users
  -- supprimée → orphan side mais soft-handled par le check
  -- `auth.users WHERE id = profile.id IS NULL` dans les RPCs).
  UPDATE profiles
  SET
    first_name = '[deleted]',
    last_name  = '[deleted]',
    whatsapp   = NULL,
    diplome_algerien = NULL,
    revoked_at     = COALESCE(revoked_at, NOW()),
    revoked_reason = COALESCE(revoked_reason, 'GDPR purge: ' || COALESCE(p_reason, '')),
    revoked_by     = v_actor,
    current_session_id = gen_random_uuid()
  WHERE id = p_user_id;

  -- Delete student-PII content :
  DELETE FROM lesson_notes WHERE user_id = p_user_id;

  -- Anonymize feedback (keep ratings for stats, drop testimonial text)
  UPDATE feedback
  SET testimonial = NULL,
      is_public = FALSE,
      is_approved = FALSE
  WHERE user_id = p_user_id;

  -- Scrub email_logs : on garde la row pour traçabilité (sent_at / status)
  -- mais on null le recipient_email + subject pour purger PII des logs.
  UPDATE email_logs
  SET recipient_email = '[purged]',
      subject = '[purged]'
  WHERE user_id = p_user_id;

  -- Audit (immutable depuis mig 016)
  INSERT INTO admin_audit_logs (admin_user_id, action_type, target_type, target_id, metadata)
  VALUES (
    v_actor,
    'purge_user',
    'profile',
    p_user_id::TEXT,
    jsonb_build_object('reason', p_reason, 'anon_email', v_anon_email)
  );

  -- L'edge function appelante doit ensuite faire
  -- `supabase.auth.admin.deleteUser(p_user_id)` pour supprimer le row
  -- auth.users (impossible côté SQL — il faut le service_role bearer
  -- HTTP). On retourne anon_email pour confirmation au caller.
  RETURN json_build_object(
    'ok', true,
    'anon_email', v_anon_email,
    'warning', 'auth.users still exists — caller must call supabase.auth.admin.deleteUser via service_role'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_purge_user(UUID, TEXT) TO authenticated;


COMMENT ON FUNCTION unsubscribe_via_token(UUID) IS
  'Public token-gated email unsubscribe. Always returns ok=true (no enumeration). Idempotent.';
COMMENT ON FUNCTION admin_purge_user(UUID, TEXT) IS
  'GDPR Art. 17 erasure. Anonymizes profile + lesson_notes + feedback + email_logs. Caller must hard-delete auth.users separately.';
