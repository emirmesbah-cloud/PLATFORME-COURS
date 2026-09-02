-- Aurel Academy — active-record analytics after introducing soft deletion.
-- Archived mistakes remain auditable in history but never inflate KPIs/revenue.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_get_sales_analytics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_leads integer; v_orders integer;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT count(*)::integer INTO v_leads FROM public.webinar_leads WHERE deleted_at IS NULL;
  SELECT count(*)::integer INTO v_orders FROM public.delivery_orders WHERE deleted_at IS NULL;
  RETURN jsonb_build_object(
    'ok', true,
    'prospects', jsonb_build_object(
      'total', v_leads,
      'to_contact', (SELECT count(*)::integer FROM public.webinar_leads WHERE deleted_at IS NULL AND status IN ('new','to_call','nrp','callback')),
      'not_interested', (SELECT count(*)::integer FROM public.webinar_leads WHERE deleted_at IS NULL AND status = 'not_interested'),
      'converted', (SELECT count(DISTINCT webinar_lead_id)::integer FROM public.delivery_orders WHERE deleted_at IS NULL AND webinar_lead_id IS NOT NULL),
      'conversion_rate', CASE WHEN v_leads = 0 THEN 0 ELSE round((SELECT count(DISTINCT webinar_lead_id)::numeric FROM public.delivery_orders WHERE deleted_at IS NULL AND webinar_lead_id IS NOT NULL) * 100 / v_leads, 1) END
    ),
    'orders', jsonb_build_object(
      'total', v_orders,
      'waiting', (SELECT count(*)::integer FROM public.delivery_orders WHERE deleted_at IS NULL AND ecom_tracking IS NULL),
      'sent', (SELECT count(*)::integer FROM public.delivery_orders WHERE deleted_at IS NULL AND ecom_tracking IS NOT NULL),
      'failed', (SELECT count(*)::integer FROM public.delivery_orders WHERE deleted_at IS NULL AND sync_status = 'failed'),
      'delivered', (SELECT count(*)::integer FROM public.delivery_orders o JOIN public.webinar_leads l ON l.id = o.webinar_lead_id WHERE o.deleted_at IS NULL AND l.deleted_at IS NULL AND l.status = 'delivered'),
      'returned', (SELECT count(*)::integer FROM public.delivery_orders o JOIN public.webinar_leads l ON l.id = o.webinar_lead_id WHERE o.deleted_at IS NULL AND l.deleted_at IS NULL AND l.status = 'returned'),
      'cod_total', (SELECT coalesce(sum(cod_amount), 0) FROM public.delivery_orders WHERE deleted_at IS NULL)
    ),
    'prospect_status', coalesce((
      SELECT jsonb_agg(jsonb_build_object('status', status, 'n', n) ORDER BY status)
      FROM (SELECT status::text, count(*)::integer n FROM public.webinar_leads WHERE deleted_at IS NULL GROUP BY status) s
    ), '[]'::jsonb),
    'orders_by_day', coalesce((
      SELECT jsonb_agg(jsonb_build_object('day', order_day, 'n', n, 'amount', amount) ORDER BY order_day)
      FROM (
        SELECT created_at::date::text AS order_day, count(*)::integer AS n, sum(cod_amount) AS amount
        FROM public.delivery_orders
        WHERE deleted_at IS NULL AND created_at >= now() - interval '30 days'
        GROUP BY created_at::date
      ) d
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_sales_analytics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_sales_analytics() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_funnel_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  WITH prog AS (
    SELECT o.cod_amount, o.ecom_tracking, o.ecom_recovered, o.webinar_lead_id, l.status AS lead_status
    FROM public.delivery_orders o
    JOIN public.webinar_leads l ON l.id = o.webinar_lead_id
    WHERE o.deleted_at IS NULL AND l.deleted_at IS NULL
  )
  SELECT jsonb_build_object(
    'ok', true,
    'registered', (SELECT count(*)::int FROM public.webinar_leads WHERE deleted_at IS NULL),
    'attended', (SELECT count(*)::int FROM public.webinar_leads WHERE deleted_at IS NULL AND ready_to_pay = true),
    'called', (SELECT count(*)::int FROM public.webinar_leads WHERE deleted_at IS NULL AND call_count > 0),
    'confirmed', (SELECT count(DISTINCT webinar_lead_id)::int FROM prog),
    'shipped', (SELECT count(*)::int FROM prog WHERE ecom_tracking IS NOT NULL),
    'delivered', (SELECT count(*)::int FROM prog WHERE lead_status = 'delivered'),
    'collected', (SELECT count(*)::int FROM prog WHERE ecom_recovered = true),
    'returned', (SELECT count(*)::int FROM prog WHERE lead_status = 'returned'),
    'cod_confirmed', (SELECT coalesce(sum(cod_amount), 0) FROM prog),
    'cod_delivered', (SELECT coalesce(sum(cod_amount) FILTER (WHERE lead_status = 'delivered'), 0) FROM prog),
    'cod_collected', (SELECT coalesce(sum(cod_amount) FILTER (WHERE ecom_recovered = true), 0) FROM prog)
  ) INTO v;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_funnel_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_funnel_overview() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_closer_performance()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  WITH roster AS (
    SELECT btrim(first_name || ' ' || last_name) AS closer
    FROM public.staff_members WHERE role = 'closer' AND is_active
    UNION
    SELECT btrim(closer_name) FROM public.webinar_leads
    WHERE deleted_at IS NULL AND closer_name IS NOT NULL AND btrim(closer_name) <> ''
  ), event_rollup AS (
    SELECT l.id AS lead_id,
      count(a.id) FILTER (WHERE a.activity_type = 'call' OR a.metadata->>'actor' = 'closer')::int AS timeline_calls,
      bool_or(a.status = 'confirmed' AND (
        a.created_by = l.closer_user_id OR a.metadata->>'actor' = 'closer'
        OR lower(btrim(coalesce(a.metadata->>'closer_name', ''))) = lower(btrim(coalesce(l.closer_name, '')))
      )) AS closer_confirmed
    FROM public.webinar_leads l
    LEFT JOIN public.webinar_lead_activities a ON a.lead_id = l.id
    WHERE l.deleted_at IS NULL
    GROUP BY l.id
  ), lead_stats AS (
    SELECT btrim(l.closer_name) AS closer,
      count(*)::int AS assigned,
      coalesce(sum(greatest(l.call_count, coalesce(e.timeline_calls, 0))), 0)::int AS calls,
      count(*) FILTER (WHERE coalesce(e.closer_confirmed, false))::int AS confirmed,
      count(*) FILTER (WHERE l.status = 'delivered')::int AS delivered,
      count(*) FILTER (WHERE l.status = 'returned')::int AS returned
    FROM public.webinar_leads l
    LEFT JOIN event_rollup e ON e.lead_id = l.id
    WHERE l.deleted_at IS NULL AND l.closer_name IS NOT NULL AND btrim(l.closer_name) <> ''
    GROUP BY btrim(l.closer_name)
  ), order_stats AS (
    SELECT btrim(l.closer_name) AS closer,
      coalesce(sum(o.cod_amount), 0) AS cod_confirmed,
      coalesce(sum(o.cod_amount) FILTER (WHERE l.status = 'delivered'), 0) AS cod_delivered
    FROM public.delivery_orders o
    JOIN public.webinar_leads l ON l.id = o.webinar_lead_id
    WHERE o.deleted_at IS NULL AND l.deleted_at IS NULL AND l.closer_name IS NOT NULL AND btrim(l.closer_name) <> ''
    GROUP BY btrim(l.closer_name)
  ), rows AS (
    SELECT r.closer AS closer_name,
      coalesce(ls.assigned, 0)::int AS assigned,
      coalesce(ls.calls, 0)::int AS calls,
      coalesce(ls.confirmed, 0)::int AS confirmed,
      coalesce(ls.delivered, 0)::int AS delivered,
      coalesce(ls.returned, 0)::int AS returned,
      coalesce(os.cod_confirmed, 0) AS cod_confirmed,
      coalesce(os.cod_delivered, 0) AS cod_delivered,
      CASE WHEN coalesce(ls.assigned, 0) = 0 THEN 0 ELSE round(coalesce(ls.confirmed, 0)::numeric * 100 / ls.assigned, 1) END AS confirmation_rate,
      CASE WHEN coalesce(ls.confirmed, 0) = 0 THEN 0 ELSE round(coalesce(ls.delivered, 0)::numeric * 100 / ls.confirmed, 1) END AS delivery_rate
    FROM roster r
    LEFT JOIN lead_stats ls ON lower(ls.closer) = lower(r.closer)
    LEFT JOIN order_stats os ON lower(os.closer) = lower(r.closer)
  )
  SELECT jsonb_build_object(
    'ok', true,
    'closers', coalesce((SELECT jsonb_agg(to_jsonb(rows) ORDER BY cod_delivered DESC, delivered DESC, closer_name) FROM rows), '[]'::jsonb),
    'totals', jsonb_build_object(
      'closers', (SELECT count(*)::int FROM rows),
      'assigned', (SELECT coalesce(sum(assigned), 0)::int FROM rows),
      'calls', (SELECT coalesce(sum(calls), 0)::int FROM rows),
      'confirmed', (SELECT coalesce(sum(confirmed), 0)::int FROM rows),
      'delivered', (SELECT coalesce(sum(delivered), 0)::int FROM rows),
      'cod_delivered', (SELECT coalesce(sum(cod_delivered), 0) FROM rows)
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_closer_performance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_closer_performance() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_cod_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_by_wilaya jsonb; v_totals jsonb;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  WITH base AS (
    SELECT o.wilaya_id, o.wilaya_name, coalesce(o.cod_amount, 0) AS cod_amount,
      (o.ecom_tracking IS NOT NULL) AS shipped, (l.status = 'delivered') AS delivered,
      (l.status = 'returned') AS returned, (o.ecom_recovered = true) AS collected
    FROM public.delivery_orders o JOIN public.webinar_leads l ON l.id = o.webinar_lead_id
    WHERE o.deleted_at IS NULL AND l.deleted_at IS NULL
  ), agg AS (
    SELECT wilaya_id, max(wilaya_name) AS wilaya_name, count(*)::int AS orders,
      count(*) FILTER (WHERE shipped)::int AS shipped,
      count(*) FILTER (WHERE delivered)::int AS delivered,
      count(*) FILTER (WHERE returned)::int AS returned,
      count(*) FILTER (WHERE shipped AND NOT delivered AND NOT returned)::int AS in_transit,
      count(*) FILTER (WHERE collected)::int AS collected,
      coalesce(sum(cod_amount) FILTER (WHERE collected), 0) AS cod_collected
    FROM base GROUP BY wilaya_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'wilaya_id', wilaya_id, 'wilaya_name', wilaya_name, 'orders', orders,
    'shipped', shipped, 'delivered', delivered, 'returned', returned,
    'in_transit', in_transit, 'collected', collected, 'cod_collected', cod_collected,
    'delivery_rate', CASE WHEN shipped = 0 THEN 0 ELSE round(delivered::numeric * 100 / shipped, 1) END,
    'return_rate', CASE WHEN shipped = 0 THEN 0 ELSE round(returned::numeric * 100 / shipped, 1) END
  ) ORDER BY returned DESC, orders DESC), '[]'::jsonb) INTO v_by_wilaya FROM agg;

  WITH base AS (
    SELECT coalesce(o.cod_amount, 0) AS cod_amount,
      (o.ecom_tracking IS NOT NULL) AS shipped, (l.status = 'delivered') AS delivered,
      (l.status = 'returned') AS returned, (o.ecom_recovered = true) AS collected
    FROM public.delivery_orders o JOIN public.webinar_leads l ON l.id = o.webinar_lead_id
    WHERE o.deleted_at IS NULL AND l.deleted_at IS NULL
  )
  SELECT jsonb_build_object(
    'orders', count(*)::int, 'shipped', count(*) FILTER (WHERE shipped)::int,
    'delivered', count(*) FILTER (WHERE delivered)::int,
    'returned', count(*) FILTER (WHERE returned)::int,
    'in_transit', count(*) FILTER (WHERE shipped AND NOT delivered AND NOT returned)::int,
    'collected', count(*) FILTER (WHERE collected)::int,
    'cod_confirmed', coalesce(sum(cod_amount), 0),
    'cod_delivered', coalesce(sum(cod_amount) FILTER (WHERE delivered), 0),
    'cod_collected', coalesce(sum(cod_amount) FILTER (WHERE collected), 0),
    'cod_returned', coalesce(sum(cod_amount) FILTER (WHERE returned), 0),
    'delivery_rate', CASE WHEN count(*) FILTER (WHERE shipped) = 0 THEN 0 ELSE round(count(*) FILTER (WHERE delivered)::numeric * 100 / count(*) FILTER (WHERE shipped), 1) END,
    'return_rate', CASE WHEN count(*) FILTER (WHERE shipped) = 0 THEN 0 ELSE round(count(*) FILTER (WHERE returned)::numeric * 100 / count(*) FILTER (WHERE shipped), 1) END
  ) INTO v_totals FROM base;
  RETURN jsonb_build_object('ok', true, 'totals', v_totals, 'by_wilaya', v_by_wilaya);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_cod_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_cod_health() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
