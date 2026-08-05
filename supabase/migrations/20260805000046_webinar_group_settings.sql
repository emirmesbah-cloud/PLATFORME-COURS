-- Admin-managed WhatsApp destinations for the public webinar pages.
-- The group codes are public configuration; only confirmed admins may change them.

CREATE TABLE IF NOT EXISTS public.webinar_groups (
  slug                  TEXT PRIMARY KEY
                        CHECK (slug IN ('immigration', 'pflege')),
  whatsapp_group_code   TEXT NOT NULL
                        CHECK (whatsapp_group_code ~ '^[A-Za-z0-9_-]{10,100}$'),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.webinar_groups (slug, whatsapp_group_code)
VALUES
  ('immigration', 'CulvnfIkpquE3FCBDQGbTE'),
  ('pflege', 'J3S49Jfkz6DH6K9z2SWfIG')
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE public.webinar_groups ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.webinar_groups FROM anon, authenticated;
GRANT SELECT ON TABLE public.webinar_groups TO anon, authenticated;
GRANT UPDATE (whatsapp_group_code) ON TABLE public.webinar_groups TO authenticated;

DROP POLICY IF EXISTS "Anyone reads webinar groups" ON public.webinar_groups;
DROP POLICY IF EXISTS "Admins update webinar groups" ON public.webinar_groups;

CREATE POLICY "Anyone reads webinar groups"
  ON public.webinar_groups
  FOR SELECT
  TO anon, authenticated
  USING (TRUE);

CREATE POLICY "Admins update webinar groups"
  ON public.webinar_groups
  FOR UPDATE
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.audit_webinar_group_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Authenticated callers must be admins. service_role / direct SQL has no
  -- auth.uid() and is already restricted by database privileges.
  IF auth.uid() IS NOT NULL AND NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Only the invite code is mutable. The timestamp is always server-owned.
  NEW.slug := OLD.slug;
  NEW.updated_at := NOW();

  IF auth.uid() IS NOT NULL
     AND NEW.whatsapp_group_code IS DISTINCT FROM OLD.whatsapp_group_code THEN
    INSERT INTO public.admin_audit_logs (
      admin_user_id,
      action_type,
      target_type,
      target_id,
      metadata
    ) VALUES (
      auth.uid(),
      'webinar_group_updated',
      'webinar_group',
      NEW.slug,
      jsonb_build_object(
        'previous_code', OLD.whatsapp_group_code,
        'new_code', NEW.whatsapp_group_code
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_webinar_group_update() FROM PUBLIC;

DROP TRIGGER IF EXISTS webinar_groups_audit_update_trg ON public.webinar_groups;
CREATE TRIGGER webinar_groups_audit_update_trg
  BEFORE UPDATE ON public.webinar_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_webinar_group_update();

COMMENT ON TABLE public.webinar_groups IS
  'Public WhatsApp invite-code destinations used by Aurel Academy webinar landing pages. Admin updates are RLS-protected and audited.';
