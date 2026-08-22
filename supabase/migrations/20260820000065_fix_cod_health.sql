-- ============================================================================
-- Aurel Academy — Fix admin_get_cod_health (CTE scope bug)
-- ============================================================================
-- mig 064 defined `WITH base AS (...)` on the by-wilaya query, then a SECOND
-- statement computed the totals `FROM base`. A CTE only exists for the single
-- statement it is attached to, so the totals query failed at runtime with
-- "relation base does not exist" — which surfaced as "Impossible de charger la
-- santé COD". Fix: give the totals query its own base CTE.
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

  -- Own base CTE (the one above is out of scope here).
  WITH base AS (
    SELECT
      coalesce(cod_amount, 0) AS cod_amount,
      (ecom_tracking IS NOT NULL) AS shipped,
      (lower(coalesce(ecom_situation,'')) LIKE '%livr%') AS delivered,
      (lower(coalesce(ecom_situation,'')) LIKE '%retour%' OR lower(coalesce(ecom_situation,'')) LIKE '%refus%') AS returned
    FROM public.delivery_orders
  )
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
