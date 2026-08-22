-- ============================================================================
-- Aurel Academy — Closer performance analytics (per-closer funnel + revenue)
-- ============================================================================
-- Aggregates the closing funnel per closer so admins can rank the team on both
-- activity (leads worked, calls) AND outcomes (confirmations, deliveries,
-- revenue) — never raw call count alone (a leaderboard on volume alone rewards
-- low-quality dialing). Keyed by webinar_leads.closer_name (the assigned closer,
-- set when a call is logged). Admin-only.
--
--   assigned        leads whose closer_name = X
--   calls           total calls logged across those leads (call_count)
--   confirmed       distinct leads of X that became a delivery order (a sale)
--   delivered       orders of X marked delivered (ecom_situation ~ 'livr')
--   returned        orders of X returned/refused (ecom_situation ~ 'retour|refus')
--   cod_confirmed   COD value of all confirmed orders
--   cod_delivered   COD value actually delivered (collected)
--   confirmation_rate  confirmed / assigned
--   delivery_rate      delivered / confirmed
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_get_closer_performance()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  WITH lead_stats AS (
    SELECT btrim(closer_name) AS closer,
           count(*)::int       AS assigned,
           coalesce(sum(call_count), 0)::int AS calls
    FROM public.webinar_leads
    WHERE closer_name IS NOT NULL AND btrim(closer_name) <> ''
    GROUP BY btrim(closer_name)
  ),
  order_stats AS (
    SELECT btrim(l.closer_name) AS closer,
           count(DISTINCT o.webinar_lead_id)::int AS confirmed,
           count(*) FILTER (WHERE lower(coalesce(o.ecom_situation,'')) LIKE '%livr%')::int AS delivered,
           count(*) FILTER (WHERE lower(coalesce(o.ecom_situation,'')) LIKE '%retour%'
                              OR lower(coalesce(o.ecom_situation,'')) LIKE '%refus%')::int AS returned,
           coalesce(sum(o.cod_amount), 0) AS cod_confirmed,
           coalesce(sum(o.cod_amount) FILTER (WHERE lower(coalesce(o.ecom_situation,'')) LIKE '%livr%'), 0) AS cod_delivered
    FROM public.delivery_orders o
    JOIN public.webinar_leads l ON l.id = o.webinar_lead_id
    WHERE l.closer_name IS NOT NULL AND btrim(l.closer_name) <> ''
    GROUP BY btrim(l.closer_name)
  )
  SELECT coalesce(jsonb_agg(row ORDER BY (row->>'cod_delivered')::numeric DESC, (row->>'confirmed')::int DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'closer_name',       ls.closer,
      'assigned',          ls.assigned,
      'calls',             ls.calls,
      'confirmed',         coalesce(os.confirmed, 0),
      'delivered',         coalesce(os.delivered, 0),
      'returned',          coalesce(os.returned, 0),
      'cod_confirmed',     coalesce(os.cod_confirmed, 0),
      'cod_delivered',     coalesce(os.cod_delivered, 0),
      'confirmation_rate', CASE WHEN ls.assigned = 0 THEN 0
                                ELSE round(coalesce(os.confirmed, 0)::numeric * 100 / ls.assigned, 1) END,
      'delivery_rate',     CASE WHEN coalesce(os.confirmed, 0) = 0 THEN 0
                                ELSE round(coalesce(os.delivered, 0)::numeric * 100 / os.confirmed, 1) END
    ) AS row
    FROM lead_stats ls
    LEFT JOIN order_stats os ON os.closer = ls.closer
  ) t;

  RETURN jsonb_build_object(
    'ok', true,
    'closers', v_rows,
    'totals', jsonb_build_object(
      'closers',       (SELECT count(*)::int FROM (SELECT 1 FROM public.webinar_leads WHERE closer_name IS NOT NULL AND btrim(closer_name) <> '' GROUP BY btrim(closer_name)) c),
      'assigned',      (SELECT count(*)::int FROM public.webinar_leads WHERE closer_name IS NOT NULL AND btrim(closer_name) <> ''),
      'calls',         (SELECT coalesce(sum(call_count),0)::int FROM public.webinar_leads WHERE closer_name IS NOT NULL AND btrim(closer_name) <> ''),
      'confirmed',     (SELECT count(DISTINCT o.webinar_lead_id)::int FROM public.delivery_orders o JOIN public.webinar_leads l ON l.id = o.webinar_lead_id WHERE l.closer_name IS NOT NULL AND btrim(l.closer_name) <> ''),
      'cod_delivered', (SELECT coalesce(sum(o.cod_amount) FILTER (WHERE lower(coalesce(o.ecom_situation,'')) LIKE '%livr%'),0) FROM public.delivery_orders o JOIN public.webinar_leads l ON l.id = o.webinar_lead_id WHERE l.closer_name IS NOT NULL AND btrim(l.closer_name) <> '')
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_closer_performance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_closer_performance() TO authenticated;

COMMIT;
