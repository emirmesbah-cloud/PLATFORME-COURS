-- Manual closer assignment, reliable closer status changes, and CRM status
-- independence from delivery-order creation.

BEGIN;

-- New prospects stay unassigned until an admin explicitly attributes them.
DROP TRIGGER IF EXISTS webinar_leads_auto_assign ON public.webinar_leads;
COMMENT ON FUNCTION public.auto_assign_webinar_lead() IS
  'Legacy rotation function retained for rollback only. No trigger calls it; closer assignment is admin-only.';

-- This legacy compatibility trigger inspected auth.uid() even inside the
-- scoped SECURITY DEFINER RPC and rejected the new confirmed/follow-up fields.
-- Direct closer UPDATE access is already removed by migration 76, so the RPC
-- is now the single safe write path.
DROP TRIGGER IF EXISTS webinar_leads_protect_closer_update ON public.webinar_leads;

DROP FUNCTION IF EXISTS public.staff_update_webinar_lead(uuid, text, text, boolean);
CREATE FUNCTION public.staff_update_webinar_lead(
  p_lead_id uuid,
  p_status text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_update_note boolean DEFAULT false,
  p_next_follow_up_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_status public.webinar_lead_status_enum;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 2000), '');
  v_updated integer := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_webinar_lead(v_uid, p_lead_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  v_is_admin := public.is_admin(v_uid);

  IF char_length(coalesce(p_note, '')) > 2000 THEN
    RAISE EXCEPTION 'NOTE_TOO_LONG';
  END IF;

  IF p_status IS NOT NULL THEN
    IF v_is_admin THEN
      IF p_status NOT IN ('to_call', 'nrp', 'callback', 'not_interested', 'confirmed', 'in_delivery', 'delivered', 'returned') THEN
        RAISE EXCEPTION 'STATUS_NOT_ALLOWED: %', p_status;
      END IF;
    ELSE
      IF p_status NOT IN ('to_call', 'nrp', 'callback', 'not_interested', 'confirmed', 'returned') THEN
        RAISE EXCEPTION 'STATUS_NOT_ALLOWED: %', p_status;
      END IF;
      -- A reason is required for every closer outcome except Confirmé.
      IF p_status <> 'confirmed' AND v_note IS NULL THEN
        RAISE EXCEPTION 'NOTE_REQUIRED';
      END IF;
    END IF;

    IF p_status = 'callback' AND p_next_follow_up_at IS NULL THEN
      RAISE EXCEPTION 'FOLLOW_UP_DATE_REQUIRED';
    END IF;
    v_status := p_status::public.webinar_lead_status_enum;
  END IF;

  UPDATE public.webinar_leads
  SET status = CASE WHEN p_status IS NULL THEN status ELSE v_status END,
      note = CASE WHEN p_update_note THEN v_note ELSE note END,
      latest_call_note = CASE
        WHEN p_status IS NOT NULL AND v_note IS NOT NULL THEN v_note
        ELSE latest_call_note
      END,
      last_call_at = CASE WHEN p_status IS NOT NULL THEN now() ELSE last_call_at END,
      next_follow_up_at = CASE
        WHEN p_status = 'callback' THEN p_next_follow_up_at
        WHEN p_status IS NOT NULL THEN NULL
        ELSE next_follow_up_at
      END,
      updated_at = now()
  WHERE id = p_lead_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF p_status IS NOT NULL THEN
    INSERT INTO public.webinar_lead_activities(lead_id, activity_type, status, note, metadata, created_by)
    VALUES (
      p_lead_id,
      'status',
      v_status,
      v_note,
      jsonb_build_object(
        'scoped_rpc', true,
        'actor', CASE WHEN v_is_admin THEN 'admin' ELSE 'closer' END,
        'next_follow_up_at', CASE WHEN p_status = 'callback' THEN p_next_follow_up_at ELSE NULL END
      ),
      v_uid
    );
  END IF;
  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;
REVOKE ALL ON FUNCTION public.staff_update_webinar_lead(uuid, text, text, boolean, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_update_webinar_lead(uuid, text, text, boolean, timestamptz) TO authenticated;

-- Creating/sending a delivery order must not rewrite the closer's CRM status.
DROP TRIGGER IF EXISTS delivery_orders_mark_webinar_lead ON public.delivery_orders;

CREATE OR REPLACE FUNCTION public.admin_bulk_create_orders(p_lead_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lead public.webinar_leads%ROWTYPE;
  v_order uuid;
  v_created integer := 0;
  v_skipped integer := 0;
BEGIN
  IF NOT public.is_admin(v_uid) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_lead_ids IS NULL OR array_length(p_lead_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'created', 0, 'skipped', 0);
  END IF;

  FOR v_lead IN SELECT * FROM public.webinar_leads WHERE id = ANY(p_lead_ids) FOR UPDATE
  LOOP
    SELECT id INTO v_order FROM public.delivery_orders WHERE webinar_lead_id = v_lead.id LIMIT 1;
    IF v_order IS NOT NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.delivery_orders(
      customer_name, mobile_1, wilaya_id, wilaya_name, commune, delivery_mode,
      address, course, article, quantity, cod_amount, supplier_notes,
      webinar_lead_id, created_by
    ) VALUES (
      left(btrim(v_lead.full_name), 60), v_lead.phone_normalized,
      v_lead.wilaya_id, v_lead.wilaya_name, v_lead.commune, 'domicile',
      nullif(left(btrim(coalesce(v_lead.address, '')), 100), ''),
      'immigration', 'Programme Aurel Academy — Immigration', 1, 38000,
      'Interdiction d''ouvrir le colis', v_lead.id, v_uid
    );
    v_created := v_created + 1;

    INSERT INTO public.webinar_lead_activities(lead_id, activity_type, status, note, metadata, created_by)
    VALUES (
      v_lead.id, 'delivery', v_lead.status,
      'Commande interne créée sans modifier le statut CRM',
      jsonb_build_object('bulk', true, 'actor', 'admin', 'crm_status_preserved', true),
      v_uid
    );
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'created', v_created, 'skipped', v_skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_bulk_create_orders(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_bulk_create_orders(uuid[]) TO authenticated;

COMMIT;
