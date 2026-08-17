-- Business workflow: every closer outcome produces an E-com draft order.
-- E-com returns are free, so Aurel wants every prospect prepared for dispatch.

CREATE OR REPLACE FUNCTION public.admin_log_webinar_call_with_order(
  p_lead_id uuid,
  p_status public.webinar_lead_status_enum,
  p_closer_name text,
  p_note text DEFAULT NULL,
  p_next_follow_up_at timestamptz DEFAULT NULL
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
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  SELECT * INTO v_lead FROM public.webinar_leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;

  PERFORM public.admin_log_webinar_call(
    p_lead_id, p_status, p_closer_name, p_note, p_next_follow_up_at
  );

  SELECT id INTO v_order_id
  FROM public.delivery_orders
  WHERE webinar_lead_id = p_lead_id
  LIMIT 1;

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
      'Interdiction d''ouvrir le colis', p_lead_id, auth.uid()
    ) RETURNING id INTO v_order_id;
    v_created := true;
  END IF;

  -- The delivery insert trigger marks the lead in_delivery. Restore the
  -- closer's chosen outcome so the CRM remains truthful.
  UPDATE public.webinar_leads SET status = p_status, updated_at = now() WHERE id = p_lead_id;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id, 'created', v_created);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_log_webinar_call_with_order(uuid,public.webinar_lead_status_enum,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_log_webinar_call_with_order(uuid,public.webinar_lead_status_enum,text,text,timestamptz) TO authenticated;

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
  SELECT count(*)::integer INTO v_leads FROM public.webinar_leads;
  SELECT count(*)::integer INTO v_orders FROM public.delivery_orders;
  RETURN jsonb_build_object(
    'ok', true,
    'prospects', jsonb_build_object(
      'total', v_leads,
      'to_contact', (SELECT count(*)::integer FROM public.webinar_leads WHERE status IN ('new','to_call','nrp','callback')),
      'not_interested', (SELECT count(*)::integer FROM public.webinar_leads WHERE status = 'not_interested'),
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
      FROM (SELECT status::text, count(*)::integer n FROM public.webinar_leads GROUP BY status) s
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

REVOKE ALL ON FUNCTION public.admin_get_sales_analytics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_sales_analytics() TO authenticated;
