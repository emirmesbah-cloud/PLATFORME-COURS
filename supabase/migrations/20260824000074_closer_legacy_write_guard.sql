-- Keep the previously deployed frontend operational while all future clients
-- move to staff_update_webinar_lead(). RLS grants UPDATE only on an assigned
-- row, and this trigger limits a closer to the two legacy editable fields.

BEGIN;

CREATE OR REPLACE FUNCTION public.protect_closer_webinar_lead_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF public.is_admin(v_uid) THEN RETURN NEW; END IF;
  IF NOT public.has_staff_permission(v_uid, 'prospects')
     OR OLD.closer_user_id IS DISTINCT FROM v_uid
     OR NEW.closer_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- Excluding exactly the legacy-editable fields leaves a stable comparison of
  -- every protected field, including assignment, contact and delivery data.
  IF (to_jsonb(NEW) - ARRAY['status', 'note', 'updated_at'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'note', 'updated_at']) THEN
    RAISE EXCEPTION 'CLOSER_FIELDS_NOT_ALLOWED';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status::text NOT IN ('to_call', 'nrp', 'callback', 'not_interested', 'delivered', 'returned') THEN
    RAISE EXCEPTION 'STATUS_NOT_ALLOWED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS webinar_leads_protect_closer_update ON public.webinar_leads;
CREATE TRIGGER webinar_leads_protect_closer_update
BEFORE UPDATE ON public.webinar_leads
FOR EACH ROW EXECUTE FUNCTION public.protect_closer_webinar_lead_update();

DROP POLICY IF EXISTS "Closers update assigned lead status and note" ON public.webinar_leads;
CREATE POLICY "Closers update assigned lead status and note"
  ON public.webinar_leads FOR UPDATE TO authenticated
  USING (
    public.has_staff_permission(auth.uid(), 'prospects')
    AND closer_user_id = auth.uid()
  )
  WITH CHECK (
    public.has_staff_permission(auth.uid(), 'prospects')
    AND closer_user_id = auth.uid()
  );

COMMIT;
