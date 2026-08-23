-- ============================================================================
-- Aurel Academy — Separate "prêt à payer" from the retired webinar-attendance
-- ============================================================================
-- The lead form question changed (2026-08-23) from "as-tu vu le webinar" to
-- "je suis prêt à payer 38 000 DZD". The first version wrongly REUSED the
-- attended_live boolean, so every OLDER lead (who answered the attendance
-- question) looked like "prêt à payer = Oui/Non", which is false — they were
-- never asked the payment question.
--
-- Fix: a dedicated, NULLABLE ready_to_pay column.
--   * older leads         → ready_to_pay = NULL  (never asked → shown as "—")
--   * leads from now on    → ready_to_pay = their real Oui/Non answer
-- attended_live is kept (historical) but made nullable; new leads don't set it.
-- The funnel's "Prêts à payer" stage now counts ready_to_pay = true.
-- ============================================================================

BEGIN;

ALTER TABLE public.webinar_leads
  ADD COLUMN IF NOT EXISTS ready_to_pay BOOLEAN;

COMMENT ON COLUMN public.webinar_leads.ready_to_pay IS
  'Answer to "prêt à payer 38 000 DZD" (form question since 2026-08-23). NULL = never asked (older leads, who instead answered the retired attended_live question).';

-- attended_live is now legacy; new leads leave it NULL (question retired).
ALTER TABLE public.webinar_leads
  ALTER COLUMN attended_live DROP NOT NULL;

-- Funnel: "Prêts à payer" = leads who answered the payment question with yes.
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
    SELECT o.cod_amount, o.ecom_tracking, o.ecom_recovered, o.webinar_lead_id, l.status AS lead_status
    FROM public.delivery_orders o
    JOIN public.webinar_leads l ON l.id = o.webinar_lead_id
  )
  SELECT jsonb_build_object(
    'ok', true,
    'registered', (SELECT count(*)::int FROM public.webinar_leads),
    'attended',   (SELECT count(*)::int FROM public.webinar_leads WHERE ready_to_pay = true),
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

COMMIT;
