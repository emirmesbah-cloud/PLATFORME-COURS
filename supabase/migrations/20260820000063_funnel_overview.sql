-- ============================================================================
-- Aurel Academy — Full-funnel overview (one screen, stage-to-stage conversion)
-- ============================================================================
-- The single "where do we leak" view: counts at every stage of the journey so
-- admins see drop-off from registration all the way to a delivered, paid order.
-- Admin-only, read-only. All data already exists in webinar_leads +
-- delivery_orders.
--
--   registered  total webinar_leads
--   attended    leads with attended_live = true (watched the live)
--   called      leads contacted at least once (call_count > 0)
--   confirmed   distinct leads that became a delivery order (a sale)
--   shipped     orders with an E-com tracking created
--   delivered   orders delivered (ecom_situation ~ 'livr')
--   returned    orders returned/refused (ecom_situation ~ 'retour|refus')
--   cod_confirmed / cod_delivered   COD value confirmed vs actually delivered
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_get_funnel_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'registered', (SELECT count(*)::int FROM public.webinar_leads),
    'attended',   (SELECT count(*)::int FROM public.webinar_leads WHERE attended_live = true),
    'called',     (SELECT count(*)::int FROM public.webinar_leads WHERE call_count > 0),
    'confirmed',  (SELECT count(DISTINCT webinar_lead_id)::int FROM public.delivery_orders WHERE webinar_lead_id IS NOT NULL),
    'shipped',    (SELECT count(*)::int FROM public.delivery_orders WHERE ecom_tracking IS NOT NULL),
    'delivered',  (SELECT count(*)::int FROM public.delivery_orders WHERE lower(coalesce(ecom_situation,'')) LIKE '%livr%'),
    'returned',   (SELECT count(*)::int FROM public.delivery_orders WHERE lower(coalesce(ecom_situation,'')) LIKE '%retour%' OR lower(coalesce(ecom_situation,'')) LIKE '%refus%'),
    'cod_confirmed', (SELECT coalesce(sum(cod_amount), 0) FROM public.delivery_orders),
    'cod_delivered', (SELECT coalesce(sum(cod_amount) FILTER (WHERE lower(coalesce(ecom_situation,'')) LIKE '%livr%'), 0) FROM public.delivery_orders)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_funnel_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_funnel_overview() TO authenticated;

COMMIT;
