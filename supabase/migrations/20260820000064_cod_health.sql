-- ============================================================================
-- Aurel Academy — COD health board (delivery / return performance by wilaya)
-- ============================================================================
-- Cash-on-delivery lives or dies on the return (RTO) rate. This gives admins the
-- COD money picture at a glance and, crucially, a per-wilaya breakdown so they
-- can spot regions that eat the margin (high returns) and act on them.
-- Admin-only, read-only. Data all from delivery_orders.
--
--   shipped     ecom_tracking created
--   delivered   ecom_situation ~ 'livr'
--   returned    ecom_situation ~ 'retour|refus'
--   in_transit  shipped but neither delivered nor returned yet
--   delivery_rate = delivered / shipped ; return_rate = returned / shipped
--   cod_delivered = COD actually collected ; cod_at_risk = returned + in-transit
-- ============================================================================

BEGIN;

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
      wilaya_id,
      wilaya_name,
      coalesce(cod_amount, 0) AS cod_amount,
      (ecom_tracking IS NOT NULL) AS shipped,
      (lower(coalesce(ecom_situation,'')) LIKE '%livr%') AS delivered,
      (lower(coalesce(ecom_situation,'')) LIKE '%retour%' OR lower(coalesce(ecom_situation,'')) LIKE '%refus%') AS returned
    FROM public.delivery_orders
  ),
  agg AS (
    SELECT
      wilaya_id,
      max(wilaya_name) AS wilaya_name,
      count(*)::int AS orders,
      count(*) FILTER (WHERE shipped)::int AS shipped,
      count(*) FILTER (WHERE delivered)::int AS delivered,
      count(*) FILTER (WHERE returned)::int AS returned,
      count(*) FILTER (WHERE shipped AND NOT delivered AND NOT returned)::int AS in_transit,
      coalesce(sum(cod_amount) FILTER (WHERE delivered), 0) AS cod_delivered
    FROM base
    GROUP BY wilaya_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'wilaya_id', wilaya_id,
    'wilaya_name', wilaya_name,
    'orders', orders,
    'shipped', shipped,
    'delivered', delivered,
    'returned', returned,
    'in_transit', in_transit,
    'cod_delivered', cod_delivered,
    'delivery_rate', CASE WHEN shipped = 0 THEN 0 ELSE round(delivered::numeric * 100 / shipped, 1) END,
    'return_rate',   CASE WHEN shipped = 0 THEN 0 ELSE round(returned::numeric * 100 / shipped, 1) END
  ) ORDER BY returned DESC, orders DESC), '[]'::jsonb)
  INTO v_by_wilaya
  FROM agg;

  SELECT jsonb_build_object(
    'orders',        count(*)::int,
    'shipped',       count(*) FILTER (WHERE shipped)::int,
    'delivered',     count(*) FILTER (WHERE delivered)::int,
    'returned',      count(*) FILTER (WHERE returned)::int,
    'in_transit',    count(*) FILTER (WHERE shipped AND NOT delivered AND NOT returned)::int,
    'cod_confirmed', coalesce(sum(cod_amount), 0),
    'cod_delivered', coalesce(sum(cod_amount) FILTER (WHERE delivered), 0),
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
