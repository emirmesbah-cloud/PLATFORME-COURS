-- Retired WhatsApp groups must stop receiving every visitor immediately.
--
-- Previously, removing a used group only changed its status to `retired`.
-- Existing 7-day IP stickies still resolved to that retired group, so a
-- visitor could receive a revoked WhatsApp invite after the admin removed it.

BEGIN;

CREATE OR REPLACE FUNCTION public.clear_retired_webinar_group_stickies()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'retired' AND OLD.status IS DISTINCT FROM 'retired' THEN
    DELETE FROM public.webinar_rotation_stickies
    WHERE link_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_retired_webinar_group_stickies() FROM PUBLIC;

DROP TRIGGER IF EXISTS webinar_rotation_links_clear_retired_stickies
  ON public.webinar_rotation_links;
CREATE TRIGGER webinar_rotation_links_clear_retired_stickies
  AFTER UPDATE OF status ON public.webinar_rotation_links
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_retired_webinar_group_stickies();

-- Remove stale assignments left by groups retired before this fix. Returning
-- visitors will be treated as new and assigned to the current active lot.
DELETE FROM public.webinar_rotation_stickies s
USING public.webinar_rotation_links l
WHERE s.link_id = l.id
  AND l.status = 'retired';

COMMIT;
