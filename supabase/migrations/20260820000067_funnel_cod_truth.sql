-- ============================================================================
-- Aurel Academy — Funnel + COD analytics: truthful delivered / encaissé
-- ============================================================================
-- Fixes two things the previous funnel/COD RPCs got wrong:
--
-- 1. DELIVERED ≠ ENCAISSÉ, and the old code conflated them AND mis-detected
--    "delivered". It matched ecom_situation LIKE '%livr%', which wrongly caught
--    "Sortir en livraison" (out for delivery). The authoritative signals are:
--      * livré     = webinar_leads.status = 'delivered'  (webhook sets it from
--                    E-com id_situation = 7)
--      * retour    = webinar_leads.status = 'returned'    (id_situation 5/6/18)
--      * encaissé  = delivery_orders.ecom_recovered = true (E-com `recouvert` =
--                    money actually remitted to the merchant) — its OWN status,
--                    separate from delivered.
--
-- 2. Track ONLY the program we sell, not the whole E-com store: every metric is
--    scoped to orders that came from the webinar funnel (webinar_lead_id set),
--    i.e. the 38 000 DZD "Programme Aurel Academy — Immigration".
-- ============================================================================

BEGIN;

-- ── Full-funnel overview ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_funnel_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  WITH prog AS (
    -- program orders only (came from a webinar lead) + their lead status
    SELECT o.cod_amount, o.ecom_tracking, o.ecom_recovered, o.webinar_lead_id, l.status AS lead_status
    FROM public.delivery_orders o
    JOIN public.webinar_leads l ON l.id = o.webinar_lead_id
  )
  SELECT jsonb_build_object(
    'ok', true,
    'registered', (SELECT count(*)::int FROM public.webinar_leads),
    'attended',   (SELECT count(*)::int FROM public.webinar_leads WHERE attended_live = true),
    'called',     (SELECT count(*)::int FROM public.webinar_leads WHERE call_count > 0),
    'confirmed',  (SELECT count(DISTINCT webinar_lead_id)::int FROM prog),
    'shipped',    (SELECT count(*)::int FROM prog WHERE ecom_tracking IS NOT NULL),
    'delivered',  (SELECT count(*)::int FROM prog WHERE lead_status = 'delivered'),
    'collected',  (SELECT count(*)::int FROM prog WHERE ecom_recovered = true),
    'returned',   (SELECT count(*)::int FROM prog WHERE lead_status = 'returned'),
    'cod_confirmed', (SELECT coalesce(sum(cod_amount), 0) FROM prog),
    'cod_delivered', (SELECT coalesce(sum(cod_amount) FILTER (WHERE lead_status = 'delivered'), 0) FROM prog),
    'cod_collected', (SELECT coalesce(sum(cod_amount) FILTER (WHERE ecom_recovered = true), 0) FROM prog)
  ) INTO v;

  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_funnel_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_funnel_overview() TO authenticated;

-- ── COD health (per wilaya) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_cod_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_by_wilaya jsonb;
  v_totals    jsonb;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  WITH base AS (
    SELECT
      o.wilaya_id, o.wilaya_name, coalesce(o.cod_amount, 0) AS cod_amount,
      (o.ecom_tracking IS NOT NULL) AS shipped,
      (l.status = 'delivered')      AS delivered,
      (l.status = 'returned')       AS returned,
      (o.ecom_recovered = true)     AS collected
    FROM public.delivery_orders o
    JOIN public.webinar_leads l ON l.id = o.webinar_lead_id
  ),
  agg AS (
    SELECT
      wilaya_id, max(wilaya_name) AS wilaya_name,
      count(*)::int AS orders,
      count(*) FILTER (WHERE shipped)::int   AS shipped,
      count(*) FILTER (WHERE delivered)::int AS delivered,
      count(*) FILTER (WHERE returned)::int  AS returned,
      count(*) FILTER (WHERE shipped AND NOT delivered AND NOT returned)::int AS in_transit,
      count(*) FILTER (WHERE collected)::int AS collected,
      coalesce(sum(cod_amount) FILTER (WHERE collected), 0) AS cod_collected
    FROM base
    GROUP BY wilaya_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'wilaya_id', wilaya_id, 'wilaya_name', wilaya_name,
    'orders', orders, 'shipped', shipped, 'delivered', delivered, 'returned', returned,
    'in_transit', in_transit, 'collected', collected, 'cod_collected', cod_collected,
    'delivery_rate', CASE WHEN shipped = 0 THEN 0 ELSE round(delivered::numeric * 100 / shipped, 1) END,
    'return_rate',   CASE WHEN shipped = 0 THEN 0 ELSE round(returned::numeric * 100 / shipped, 1) END
  ) ORDER BY returned DESC, orders DESC), '[]'::jsonb)
  INTO v_by_wilaya
  FROM agg;

  WITH base AS (
    SELECT
      coalesce(o.cod_amount, 0) AS cod_amount,
      (o.ecom_tracking IS NOT NULL) AS shipped,
      (l.status = 'delivered')      AS delivered,
      (l.status = 'returned')       AS returned,
      (o.ecom_recovered = true)     AS collected
    FROM public.delivery_orders o
    JOIN public.webinar_leads l ON l.id = o.webinar_lead_id
  )
  SELECT jsonb_build_object(
    'orders',        count(*)::int,
    'shipped',       count(*) FILTER (WHERE shipped)::int,
    'delivered',     count(*) FILTER (WHERE delivered)::int,
    'returned',      count(*) FILTER (WHERE returned)::int,
    'in_transit',    count(*) FILTER (WHERE shipped AND NOT delivered AND NOT returned)::int,
    'collected',     count(*) FILTER (WHERE collected)::int,
    'cod_confirmed', coalesce(sum(cod_amount), 0),
    'cod_delivered', coalesce(sum(cod_amount) FILTER (WHERE delivered), 0),
    'cod_collected', coalesce(sum(cod_amount) FILTER (WHERE collected), 0),
    'cod_returned',  coalesce(sum(cod_amount) FILTER (WHERE returned), 0),
    'delivery_rate', CASE WHEN count(*) FILTER (WHERE shipped) = 0 THEN 0
                          ELSE round(count(*) FILTER (WHERE delivered)::numeric * 100 / count(*) FILTER (WHERE shipped), 1) END,
    'return_rate',   CASE WHEN count(*) FILTER (WHERE shipped) = 0 THEN 0
                          ELSE round(count(*) FILTER (WHERE returned)::numeric * 100 / count(*) FILTER (WHERE shipped), 1) END
  )
  INTO v_totals
  FROM base;

  RETURN jsonb_build_object('ok', true, 'totals', v_totals, 'by_wilaya', v_by_wilaya);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_cod_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_cod_health() TO authenticated;

COMMIT;
