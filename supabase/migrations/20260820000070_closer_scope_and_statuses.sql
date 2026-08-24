-- ============================================================================
-- Aurel Academy — Scope closers to their own prospects + more bulk statuses
-- ============================================================================
--   1. A closer now sees ONLY the prospects assigned to them (lead.closer_name
--      matches their profile name). Admins still see everything. Leads that are
--      unassigned (no closer) stay invisible to closers until an admin attributes
--      them. Same scope on lead activities.
--   2. Bulk "Changer le statut" now allows the delivery outcomes too
--      (Livré / Retour) on top of the working statuses.
-- ============================================================================

BEGIN;

-- ── Closers see only their attributed prospects ─────────────────────────────
DROP POLICY IF EXISTS "Staff prospect access" ON public.webinar_leads;
CREATE POLICY "Staff prospect access" ON public.webinar_leads FOR ALL TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR (
      public.has_staff_permission(auth.uid(), 'prospects')
      AND lower(btrim(coalesce(closer_name, ''))) <> ''
      AND lower(btrim(coalesce(closer_name, ''))) =
          lower(btrim((SELECT p.first_name || ' ' || p.last_name FROM public.profiles p WHERE p.id = auth.uid())))
    )
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR (
      public.has_staff_permission(auth.uid(), 'prospects')
      AND lower(btrim(coalesce(closer_name, ''))) =
          lower(btrim((SELECT p.first_name || ' ' || p.last_name FROM public.profiles p WHERE p.id = auth.uid())))
    )
  );

DROP POLICY IF EXISTS "Staff read webinar lead activities" ON public.webinar_lead_activities;
CREATE POLICY "Staff read webinar lead activities" ON public.webinar_lead_activities FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR (
      public.has_staff_permission(auth.uid(), 'prospects')
      AND EXISTS (
        SELECT 1 FROM public.webinar_leads l
        WHERE l.id = webinar_lead_activities.lead_id
          AND lower(btrim(coalesce(l.closer_name, ''))) =
              lower(btrim((SELECT p.first_name || ' ' || p.last_name FROM public.profiles p WHERE p.id = auth.uid())))
      )
    )
  );

-- ── More statuses in bulk "Changer le statut" ───────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_bulk_set_lead_status(
  p_lead_ids UUID[],
  p_status   TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status public.webinar_lead_status_enum;
  v_count  INT := 0;
BEGIN
  IF NOT public.has_staff_permission(auth.uid(), 'prospects') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_lead_ids IS NULL OR array_length(p_lead_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'updated', 0);
  END IF;
  -- Working + delivery-outcome statuses. "in_delivery"/"confirmed" stay out —
  -- those need an order, so they go through "Envoyer vers Commandes" / E-com.
  IF p_status NOT IN ('to_call', 'nrp', 'callback', 'not_interested', 'delivered', 'returned') THEN
    RAISE EXCEPTION 'STATUS_NOT_ALLOWED: %', p_status;
  END IF;
  v_status := p_status::public.webinar_lead_status_enum;

  UPDATE public.webinar_leads
  SET status = v_status, updated_at = now()
  WHERE id = ANY(p_lead_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.webinar_lead_activities(lead_id, activity_type, status, metadata, created_by)
  SELECT id, 'status', v_status, jsonb_build_object('bulk', true), auth.uid()
  FROM public.webinar_leads WHERE id = ANY(p_lead_ids);

  RETURN jsonb_build_object('ok', true, 'updated', v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_bulk_set_lead_status(UUID[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_bulk_set_lead_status(UUID[], TEXT) TO authenticated;

COMMIT;
