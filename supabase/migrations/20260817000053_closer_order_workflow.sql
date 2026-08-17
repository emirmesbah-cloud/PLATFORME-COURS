-- Safer closer workflow: a confirmed sale creates exactly one draft order,
-- accidental clicks are handled in the UI, and deletions are explicit RPCs.

CREATE OR REPLACE FUNCTION public.admin_confirm_webinar_purchase(
  p_lead_id uuid,
  p_closer_name text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead public.webinar_leads%ROWTYPE;
  v_order_id uuid;
  v_created boolean := false;
  v_now timestamptz := now();
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF length(btrim(coalesce(p_closer_name, ''))) < 2 THEN
    RAISE EXCEPTION 'CLOSER_REQUIRED';
  END IF;

  SELECT * INTO v_lead
  FROM public.webinar_leads
  WHERE id = p_lead_id AND attended_live = true
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;

  SELECT id INTO v_order_id
  FROM public.delivery_orders
  WHERE webinar_lead_id = p_lead_id
  LIMIT 1;

  UPDATE public.webinar_leads
  SET status = 'in_delivery',
      closer_name = left(btrim(p_closer_name), 80),
      call_count = call_count + 1,
      last_call_at = v_now,
      next_follow_up_at = NULL,
      latest_call_note = nullif(left(btrim(coalesce(p_note, '')), 2000), ''),
      updated_at = v_now
  WHERE id = p_lead_id;

  INSERT INTO public.webinar_lead_activities(
    lead_id, activity_type, status, note, metadata, created_by
  ) VALUES (
    p_lead_id, 'call', 'in_delivery',
    nullif(left(btrim(coalesce(p_note, '')), 2000), ''),
    jsonb_build_object('closer_name', left(btrim(p_closer_name), 80), 'purchase_confirmed', true),
    auth.uid()
  );

  IF v_order_id IS NULL THEN
    INSERT INTO public.delivery_orders(
      customer_name, mobile_1, wilaya_id, wilaya_name, commune,
      delivery_mode, address, course, article, quantity, cod_amount,
      supplier_notes, webinar_lead_id, created_by
    ) VALUES (
      left(btrim(v_lead.full_name), 60), v_lead.phone_normalized,
      v_lead.wilaya_id, v_lead.wilaya_name, v_lead.commune,
      'domicile', nullif(left(btrim(v_lead.address), 100), ''),
      'immigration', 'Programme Aurel Academy — Immigration', 1, 38000,
      left('Prospect webinar · ' || v_lead.email, 255), p_lead_id, auth.uid()
    ) RETURNING id INTO v_order_id;
    v_created := true;
  END IF;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id, 'created', v_created);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_webinar_lead(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF EXISTS (SELECT 1 FROM public.delivery_orders WHERE webinar_lead_id = p_lead_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LEAD_HAS_ORDER');
  END IF;
  DELETE FROM public.webinar_leads WHERE id = p_lead_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'LEAD_NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_sales_analytics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_leads integer;
  v_orders integer;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT count(*)::integer INTO v_leads FROM public.webinar_leads WHERE attended_live = true;
  SELECT count(*)::integer INTO v_orders FROM public.delivery_orders;

  RETURN jsonb_build_object(
    'ok', true,
    'prospects', jsonb_build_object(
      'total', v_leads,
      'to_contact', (SELECT count(*)::integer FROM public.webinar_leads WHERE attended_live = true AND status IN ('new','to_call','nrp','callback')),
      'not_interested', (SELECT count(*)::integer FROM public.webinar_leads WHERE attended_live = true AND status = 'not_interested'),
      'converted', (SELECT count(DISTINCT webinar_lead_id)::integer FROM public.delivery_orders WHERE webinar_lead_id IS NOT NULL),
      'conversion_rate', CASE WHEN v_leads = 0 THEN 0 ELSE round((SELECT count(DISTINCT webinar_lead_id)::numeric FROM public.delivery_orders WHERE webinar_lead_id IS NOT NULL) * 100 / v_leads, 1) END
    ),
    'orders', jsonb_build_object(
      'total', v_orders,
      'waiting', (SELECT count(*)::integer FROM public.delivery_orders WHERE ecom_tracking IS NULL),
      'sent', (SELECT count(*)::integer FROM public.delivery_orders WHERE ecom_tracking IS NOT NULL),
      'failed', (SELECT count(*)::integer FROM public.delivery_orders WHERE sync_status = 'failed'),
      'delivered', (SELECT count(*)::integer FROM public.delivery_orders WHERE lower(coalesce(ecom_situation,'')) LIKE '%livr%'),
      'returned', (SELECT count(*)::integer FROM public.delivery_orders WHERE lower(coalesce(ecom_situation,'')) LIKE '%retour%' OR lower(coalesce(ecom_situation,'')) LIKE '%refus%'),
      'cod_total', (SELECT coalesce(sum(cod_amount), 0) FROM public.delivery_orders)
    ),
    'prospect_status', coalesce((
      SELECT jsonb_agg(jsonb_build_object('status', status, 'n', n) ORDER BY status)
      FROM (SELECT status::text, count(*)::integer n FROM public.webinar_leads WHERE attended_live = true GROUP BY status) s
    ), '[]'::jsonb),
    'orders_by_day', coalesce((
      SELECT jsonb_agg(jsonb_build_object('day', order_day, 'n', n, 'amount', amount) ORDER BY order_day)
      FROM (
        SELECT created_at::date::text AS order_day, count(*)::integer AS n, sum(cod_amount) AS amount
        FROM public.delivery_orders
        WHERE created_at >= now() - interval '30 days'
        GROUP BY created_at::date
      ) d
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_lead_after_draft_order_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.webinar_lead_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.delivery_orders WHERE webinar_lead_id = OLD.webinar_lead_id) THEN
    UPDATE public.webinar_leads
    SET status = 'to_call', updated_at = now()
    WHERE id = OLD.webinar_lead_id AND status IN ('confirmed', 'in_delivery');
    INSERT INTO public.webinar_lead_activities(lead_id, activity_type, status, note, metadata, created_by)
    VALUES (OLD.webinar_lead_id, 'status', 'to_call', 'Commande brouillon supprimée', '{}'::jsonb, auth.uid());
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS delivery_order_reset_lead_after_delete ON public.delivery_orders;
CREATE TRIGGER delivery_order_reset_lead_after_delete
AFTER DELETE ON public.delivery_orders
FOR EACH ROW EXECUTE FUNCTION public.reset_lead_after_draft_order_delete();

REVOKE ALL ON FUNCTION public.admin_confirm_webinar_purchase(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_webinar_lead(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_sales_analytics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_confirm_webinar_purchase(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_webinar_lead(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_sales_analytics() TO authenticated;
