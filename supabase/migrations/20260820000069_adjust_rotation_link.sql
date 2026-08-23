-- ============================================================================
-- Aurel Academy — Manually adjust / reactivate a rotation group
-- ============================================================================
-- WhatsApp exposes no join/leave signal, so the rotation count only ever grows
-- (it counts leads ROUTED to a group, not current members). When people leave,
-- a group reads "full" while it still has room, and leads stop going there.
--
-- adjust_rotation_link lets an admin set a group's count to what they actually
-- see in WhatsApp. Setting it below the 1000 cap makes the group ACTIVE again
-- (works on full AND retired links → reclaim capacity, stop losing leads).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.adjust_rotation_link(p_link_id UUID, p_count INT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_link   public.webinar_rotation_links%ROWTYPE;
  v_count  INT;
  v_status TEXT;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO v_link FROM public.webinar_rotation_links WHERE id = p_link_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', FALSE, 'error', 'NOT_FOUND');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('wa-rot:' || v_link.funnel));

  v_count  := greatest(0, coalesce(p_count, 0));
  -- Under the cap → the group is usable again (reactivates full/retired links).
  v_status := CASE WHEN v_count >= 1000 THEN 'full' ELSE 'active' END;

  UPDATE public.webinar_rotation_links
  SET unique_ip_count = v_count,
      status          = v_status,
      alerted_990     = (v_count >= 990)
  WHERE id = p_link_id;

  -- Reclaiming capacity means the funnel is no longer "all full": let a future
  -- all-full alert fire again.
  IF v_status = 'active' THEN
    UPDATE public.webinar_rotation_state
    SET all_full_alerted = FALSE, updated_at = now()
    WHERE funnel = v_link.funnel;
  END IF;

  INSERT INTO public.admin_audit_logs (admin_user_id, action_type, target_type, target_id, metadata)
  VALUES (v_uid, 'webinar_rotation_link_adjusted', 'webinar_rotation', v_link.funnel,
          jsonb_build_object('link_id', p_link_id, 'position', v_link.position,
                             'from', v_link.unique_ip_count, 'to', v_count, 'status', v_status));

  RETURN json_build_object('ok', TRUE, 'count', v_count, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_rotation_link(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_rotation_link(UUID, INT) TO authenticated;

COMMIT;
