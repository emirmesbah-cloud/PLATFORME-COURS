-- ============================================================================
-- Aurel Academy — WhatsApp rotation: optional human name per group link
-- ============================================================================
-- WhatsApp invite codes are opaque, so an admin can't tell which group is which
-- at a glance. Add an optional label the admin can set/edit per link, shown in
-- the rotation card next to the code (falls back to the code when empty).
-- Purely cosmetic — never used by the assign logic.
-- ============================================================================

BEGIN;

ALTER TABLE public.webinar_rotation_links
  ADD COLUMN IF NOT EXISTS label TEXT;

-- rename_rotation_link: set/clear a link's display name. is_admin-gated, audited.
CREATE OR REPLACE FUNCTION public.rename_rotation_link(p_link_id UUID, p_label TEXT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_link  public.webinar_rotation_links%ROWTYPE;
  v_label TEXT;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO v_link FROM public.webinar_rotation_links WHERE id = p_link_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', FALSE, 'error', 'NOT_FOUND');
  END IF;

  v_label := NULLIF(btrim(COALESCE(p_label, '')), '');
  IF v_label IS NOT NULL AND char_length(v_label) > 80 THEN
    v_label := left(v_label, 80);
  END IF;

  UPDATE public.webinar_rotation_links SET label = v_label WHERE id = p_link_id;

  INSERT INTO public.admin_audit_logs (admin_user_id, action_type, target_type, target_id, metadata)
  VALUES (v_uid, 'webinar_rotation_link_renamed', 'webinar_rotation', v_link.funnel,
          jsonb_build_object('link_id', p_link_id, 'position', v_link.position, 'label', v_label));

  RETURN json_build_object('ok', TRUE, 'label', v_label);
END;
$$;

REVOKE ALL ON FUNCTION public.rename_rotation_link(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rename_rotation_link(UUID, TEXT) TO authenticated;

COMMIT;
