-- ============================================================================
-- SHERLOCK R14 — M16 : route self-service user actions to a separate
-- `user_audit_logs` table, keeping `admin_audit_logs` strictly for admin
-- moderation actions.
--
-- BUG : migration 018 (gdpr_purge_unsubscribe) made `unsubscribe_via_token`
-- write to `admin_audit_logs` with admin_user_id = the user himself. That's
-- semantically wrong (it's not an admin action) and pollutes the AdminAudit
-- page UI with thousands of unsubscribe rows, drowning the real admin
-- moderation events.
--
-- FIX :
--   1. Create `user_audit_logs(user_id, action, details, created_at, ip, ua)`.
--   2. Re-route `unsubscribe_via_token` INSERT to that table.
--   3. AdminAudit page (queries.ts fetchAuditLogs) keeps reading from
--      admin_audit_logs — no UI change needed.
--
-- Pas de migration data depuis admin_audit_logs car les rows existantes
-- "email_unsubscribe" sont laissées en place (l'audit historique reste
-- consultable côté SQL si besoin). Les nouveaux events vont au bon endroit.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  details     JSONB,
  ip          TEXT,
  ua          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_audit_logs_user_id   ON user_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_audit_logs_created   ON user_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_audit_logs_action    ON user_audit_logs(action);

-- RLS : la table est accédée uniquement via les RPCs SECURITY DEFINER
-- (unsubscribe_via_token + futures user-actions). Pas de GRANT côté
-- authenticated/anon. Les admins peuvent lire via service_role direct.
ALTER TABLE user_audit_logs ENABLE ROW LEVEL SECURITY;
-- Pas de policy CREATE POLICY → personne ne peut SELECT/INSERT/UPDATE/DELETE
-- via REST (que les SECURITY DEFINER bypassent).


-- ----------------------------------------------------------------------------
-- Re-route unsubscribe_via_token vers user_audit_logs.
-- Signature et comportement public identique (json {ok}).
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

  UPDATE profiles
  SET email_opt_out_marketing = TRUE
  WHERE email_opt_out_token = p_token
    AND email_opt_out_marketing = FALSE
  RETURNING id, email INTO v_uid, v_email;

  -- SHERLOCK R14 — M16 : insert dans user_audit_logs (vs admin_audit_logs avant).
  IF v_uid IS NOT NULL THEN
    BEGIN
      INSERT INTO user_audit_logs (user_id, action, details)
      VALUES (
        v_uid,
        'email_unsubscribe',
        jsonb_build_object('via', 'token_link')
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'unsubscribe audit failed: %', SQLERRM;
    END;
  END IF;

  -- Reply ok=true même si le token ne match aucun user (anti-enumeration).
  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION unsubscribe_via_token(UUID) TO anon, authenticated;

COMMENT ON TABLE user_audit_logs IS
  'R14-M16 : self-service user audit trail (unsubscribe, future GDPR data-access requests, etc.). Distinct from admin_audit_logs which is moderation/admin-action only.';
