-- ============================================================================
-- Aurel Academy — Bulk prospect operations (set status / send to Commandes)
-- ============================================================================
-- Two staff (prospects-permission) bulk actions from the Prospects table:
--   admin_bulk_set_lead_status : set the CRM status of many leads at once
--       (working statuses only — to_call / nrp / callback / not_interested).
--       Logs a 'status' activity per lead for the history.
--   admin_bulk_create_orders   : push many leads straight to Commandes — creates
--       a delivery order (same defaults as the single-lead flow) for each lead
--       that doesn't already have one, sets status='in_delivery', preserves the
--       closer. Idempotent: leads that already have an order are skipped.
-- ============================================================================

BEGIN;

-- Bulk status change.
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
  -- Only the manual CRM working statuses may be bulk-set. Order-driven statuses
  -- (in_delivery/delivered/returned/confirmed) are not, to avoid desyncing with
  -- the actual delivery orders — use "Envoyer vers Commandes" / E-com for those.
  IF p_status NOT IN ('to_call', 'nrp', 'callback', 'not_interested') THEN
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

-- Bulk send to Commandes (create a delivery order per lead, once).
CREATE OR REPLACE FUNCTION public.admin_bulk_create_orders(p_lead_ids UUID[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead    public.webinar_leads%ROWTYPE;
  v_order   UUID;
  v_created INT := 0;
  v_skipped INT := 0;
BEGIN
  IF NOT public.has_staff_permission(auth.uid(), 'prospects') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_lead_ids IS NULL OR array_length(p_lead_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'created', 0, 'skipped', 0);
  END IF;

  FOR v_lead IN SELECT * FROM public.webinar_leads WHERE id = ANY(p_lead_ids) LOOP
    SELECT id INTO v_order FROM public.delivery_orders WHERE webinar_lead_id = v_lead.id LIMIT 1;
    IF v_order IS NOT NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.delivery_orders(
      customer_name, mobile_1, wilaya_id, wilaya_name, commune, delivery_mode, address,
      course, article, quantity, cod_amount, supplier_notes, webinar_lead_id, created_by
    ) VALUES (
      left(btrim(v_lead.full_name), 60), v_lead.phone_normalized, v_lead.wilaya_id, v_lead.wilaya_name,
      v_lead.commune, 'domicile', nullif(left(btrim(coalesce(v_lead.address, '')), 100), ''),
      'immigration', 'Programme Aurel Academy — Immigration', 1, 38000, 'Interdiction d''ouvrir le colis',
      v_lead.id, auth.uid()
    );
    v_created := v_created + 1;

    UPDATE public.webinar_leads SET status = 'in_delivery', updated_at = now() WHERE id = v_lead.id;
    INSERT INTO public.webinar_lead_activities(lead_id, activity_type, status, metadata, created_by)
    VALUES (v_lead.id, 'delivery', 'in_delivery', jsonb_build_object('bulk', true), auth.uid());
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'created', v_created, 'skipped', v_skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_bulk_create_orders(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_bulk_create_orders(UUID[]) TO authenticated;

COMMIT;
