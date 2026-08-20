-- ============================================================================
-- Aurel Academy — WhatsApp rotation: remove/undo a single link
-- ============================================================================
-- Lets an admin delete a link they added (e.g. a mistake) directly from the
-- rotation card, safely:
--   * If the link has NO members yet (unique_ip_count = 0) → hard DELETE. It was
--     never used, nobody is affected, and it leaves no trace. (It has no
--     stickies either, since a sticky is only written when a lead is counted,
--     so the ON DELETE CASCADE removes nothing.)
--   * If the link already has members (> 0) → RETIRE it instead (status
--     'retired'). It stops receiving new leads, but everyone already sent there
--     keeps their link (their sticky still resolves to it). Never lose a member.
-- is_admin-gated, advisory-locked per funnel (so it can't race an assign), and
-- audit-logged like the other rotation admin actions.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.remove_rotation_link(p_link_id UUID)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_link    public.webinar_rotation_links%ROWTYPE;
  v_deleted BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO v_link FROM public.webinar_rotation_links WHERE id = p_link_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', FALSE, 'error', 'NOT_FOUND');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('wa-rot:' || v_link.funnel));

  -- Re-read the count under the lock so a lead counted a millisecond ago can't
  -- be lost by a stale "0" decision.
  SELECT * INTO v_link FROM public.webinar_rotation_links WHERE id = p_link_id;

  IF v_link.unique_ip_count = 0 THEN
    DELETE FROM public.webinar_rotation_links WHERE id = p_link_id;
    v_deleted := TRUE;
  ELSE
    UPDATE public.webinar_rotation_links SET status = 'retired' WHERE id = p_link_id;
  END IF;

  INSERT INTO public.admin_audit_logs (admin_user_id, action_type, target_type, target_id, metadata)
  VALUES (v_uid, 'webinar_rotation_link_removed', 'webinar_rotation', v_link.funnel,
          jsonb_build_object('link_id', p_link_id, 'position', v_link.position,
                             'count', v_link.unique_ip_count, 'deleted', v_deleted));

  RETURN json_build_object('ok', TRUE, 'deleted', v_deleted, 'retired', NOT v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_rotation_link(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_rotation_link(UUID) TO authenticated;

COMMIT;
