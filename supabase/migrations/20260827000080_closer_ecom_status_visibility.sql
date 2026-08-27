-- Let closers see only the E-com tracking/status attached to prospects that
-- an admin assigned to them.  delivery_orders remains admin-only through RLS;
-- this narrow SECURITY DEFINER function does not expose other order fields or
-- any write capability.

BEGIN;

CREATE OR REPLACE FUNCTION public.staff_get_webinar_delivery_statuses()
RETURNS TABLE (
  webinar_lead_id uuid,
  id uuid,
  ecom_tracking text,
  ecom_situation text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT ON (o.webinar_lead_id)
    o.webinar_lead_id,
    o.id,
    o.ecom_tracking,
    o.ecom_situation
  FROM public.delivery_orders o
  JOIN public.webinar_leads l ON l.id = o.webinar_lead_id
  WHERE auth.uid() IS NOT NULL
    AND (
      public.is_admin(auth.uid())
      OR (
        public.has_staff_permission(auth.uid(), 'prospects')
        AND l.closer_user_id = auth.uid()
      )
    )
  ORDER BY o.webinar_lead_id, o.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.staff_get_webinar_delivery_statuses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_get_webinar_delivery_statuses() TO authenticated;

COMMENT ON FUNCTION public.staff_get_webinar_delivery_statuses() IS
  'Read-only E-com tracking/status for admins or the closer assigned to the related webinar lead.';

COMMIT;
