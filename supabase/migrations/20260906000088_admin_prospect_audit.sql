-- Admin-only, actor-snapshotted CRM audit. The closer's shared timeline and
-- permissions remain unchanged. No historical assignment dates are invented.
BEGIN;

CREATE TABLE public.webinar_lead_admin_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES public.webinar_leads(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('submitted','assignment','call','status','delivery','contact','note')),
  status public.webinar_lead_status_enum,
  previous_status public.webinar_lead_status_enum,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  actor_name text NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('admin','closer','system','unknown')),
  source_activity_id uuid UNIQUE,
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX webinar_lead_admin_events_timeline_idx
  ON public.webinar_lead_admin_events(lead_id, created_at DESC, id DESC);
ALTER TABLE public.webinar_lead_admin_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webinar_lead_admin_events FROM anon, authenticated;
GRANT SELECT ON public.webinar_lead_admin_events TO authenticated;
GRANT ALL ON public.webinar_lead_admin_events TO service_role;
CREATE POLICY "Admins read detailed prospect audit"
  ON public.webinar_lead_admin_events FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE FUNCTION public.append_webinar_lead_admin_event(
  p_lead_id uuid, p_type text, p_status public.webinar_lead_status_enum,
  p_previous public.webinar_lead_status_enum, p_note text, p_metadata jsonb,
  p_actor uuid, p_activity uuid DEFAULT NULL, p_created_at timestamptz DEFAULT clock_timestamp()
)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id bigint; v_name text; v_role text;
BEGIN
  SELECT nullif(concat_ws(' ', nullif(btrim(p.first_name), ''), nullif(btrim(p.last_name), '')), ''),
    CASE WHEN p.is_admin THEN 'admin' WHEN p.staff_role = 'closer' THEN 'closer' ELSE 'unknown' END
  INTO v_name, v_role FROM public.profiles p WHERE p.id = p_actor;
  IF v_name IS NULL THEN
    SELECT nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), '') INTO v_name
    FROM public.staff_members s WHERE s.auth_user_id = p_actor LIMIT 1;
  END IF;
  INSERT INTO public.webinar_lead_admin_events(
    lead_id,event_type,status,previous_status,note,metadata,actor_id,actor_name,actor_role,source_activity_id,created_at
  ) VALUES (
    p_lead_id,p_type,p_status,p_previous,p_note,coalesce(p_metadata,'{}'),p_actor,
    coalesce(v_name, CASE WHEN p_actor IS NULL THEN 'Système' ELSE 'Auteur non identifié' END),
    CASE WHEN p_actor IS NULL THEN 'system' ELSE coalesce(v_role,'unknown') END,p_activity,p_created_at
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.append_webinar_lead_admin_event(uuid,text,public.webinar_lead_status_enum,public.webinar_lead_status_enum,text,jsonb,uuid,uuid,timestamptz) FROM PUBLIC, anon, authenticated;

-- Preserve known historic evidence and timestamps. A present-day role must not
-- be presented as proof of the actor's role at an older event.
INSERT INTO public.webinar_lead_admin_events(
  lead_id,event_type,status,note,metadata,actor_id,actor_name,actor_role,source_activity_id,created_at
)
SELECT a.lead_id,a.activity_type,a.status,a.note,
  a.metadata || jsonb_build_object('audit_legacy',true),a.created_by,
  coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),s.name,
    CASE WHEN a.created_by IS NULL THEN 'Auteur non enregistré' ELSE 'Auteur non identifié' END),
  CASE WHEN a.metadata->>'actor' IN ('admin','closer') THEN a.metadata->>'actor' ELSE 'unknown' END,
  a.id,a.created_at
FROM public.webinar_lead_activities a
LEFT JOIN public.profiles p ON p.id=a.created_by
LEFT JOIN LATERAL (
  SELECT nullif(btrim(concat_ws(' ',first_name,last_name)),'') AS name
  FROM public.staff_members WHERE auth_user_id=a.created_by LIMIT 1
) s ON true;

-- Add the order reference to a matching historic handoff. Exact transaction
-- timestamps/actor or an explicit order id are required; no fuzzy attribution.
UPDATE public.webinar_lead_admin_events e
SET metadata=e.metadata || jsonb_build_object('action','order_created','delivery_order_id',o.id,'external_reference',o.external_reference)
FROM public.delivery_orders o
WHERE e.lead_id=o.webinar_lead_id AND e.event_type='delivery'
  AND (e.metadata->>'delivery_order_id'=o.id::text OR
    (e.created_at=o.created_at AND e.actor_id IS NOT DISTINCT FROM o.created_by));
INSERT INTO public.webinar_lead_admin_events(lead_id,event_type,metadata,actor_id,actor_name,actor_role,created_at)
SELECT o.webinar_lead_id,'delivery',jsonb_build_object(
    'audit_legacy',true,'action','order_created','delivery_order_id',o.id,'external_reference',o.external_reference),
  o.created_by,coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),'Auteur non identifié'),'unknown',o.created_at
FROM public.delivery_orders o LEFT JOIN public.profiles p ON p.id=o.created_by
WHERE o.webinar_lead_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM public.webinar_lead_admin_events e WHERE e.metadata->>'delivery_order_id'=o.id::text
);

CREATE FUNCTION public.audit_webinar_lead_admin_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.closer_user_id IS NOT NULL OR nullif(btrim(NEW.closer_name),'') IS NOT NULL THEN
      PERFORM public.append_webinar_lead_admin_event(NEW.id,'assignment',NEW.status,NULL,NULL,
        jsonb_build_object('previous_closer_id',NULL,'previous_closer_name',NULL,
          'closer_id',NEW.closer_user_id,'closer_name',NEW.closer_name),auth.uid());
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.closer_user_id IS DISTINCT FROM OLD.closer_user_id OR NEW.closer_name IS DISTINCT FROM OLD.closer_name THEN
    PERFORM public.append_webinar_lead_admin_event(NEW.id,'assignment',NEW.status,NULL,NULL,
      jsonb_build_object('previous_closer_id',OLD.closer_user_id,'previous_closer_name',OLD.closer_name,
        'closer_id',NEW.closer_user_id,'closer_name',NEW.closer_name),auth.uid());
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.append_webinar_lead_admin_event(NEW.id,'status',NEW.status,OLD.status,NULL,
      jsonb_build_object('action','status_changed'),auth.uid());
  END IF;
  IF NEW.note IS DISTINCT FROM OLD.note THEN
    PERFORM public.append_webinar_lead_admin_event(NEW.id,'note',NEW.status,NULL,NEW.note,
      jsonb_build_object('action','note_changed','previous_note',OLD.note),auth.uid());
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_webinar_lead_admin_changes() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER webinar_leads_admin_audit AFTER INSERT OR UPDATE ON public.webinar_leads
  FOR EACH ROW EXECUTE FUNCTION public.audit_webinar_lead_admin_changes();

CREATE FUNCTION public.audit_webinar_order_handoff()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor uuid; v_action text;
BEGIN
  IF NEW.webinar_lead_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.webinar_lead_id IS NOT DISTINCT FROM OLD.webinar_lead_id THEN RETURN NEW; END IF;
    v_actor:=auth.uid(); v_action:='order_linked';
  ELSE
    v_actor:=coalesce(auth.uid(),NEW.created_by); v_action:='order_created';
  END IF;
  PERFORM public.append_webinar_lead_admin_event(NEW.webinar_lead_id,'delivery',NULL,NULL,NULL,
    jsonb_build_object('action',v_action,'delivery_order_id',NEW.id,'external_reference',NEW.external_reference,
      'crm_status_preserved',true),v_actor);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_webinar_order_handoff() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER delivery_orders_admin_handoff_audit AFTER INSERT OR UPDATE OF webinar_lead_id ON public.delivery_orders
  FOR EACH ROW EXECUTE FUNCTION public.audit_webinar_order_handoff();

-- Attach the note/call outcome to the row-change event from this very same
-- transaction. One status action stays one entry, including bulk and old clients.
CREATE FUNCTION public.audit_webinar_activity_details()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_event bigint;
BEGIN
  IF NEW.activity_type IN ('call','status') THEN
    SELECT id INTO v_event FROM public.webinar_lead_admin_events
    WHERE lead_id=NEW.lead_id AND transaction_id=txid_current() AND event_type='status'
      AND status IS NOT DISTINCT FROM NEW.status AND source_activity_id IS NULL
      AND actor_id IS NOT DISTINCT FROM NEW.created_by
    ORDER BY id DESC LIMIT 1;
  ELSIF NEW.activity_type='delivery' THEN
    SELECT id INTO v_event FROM public.webinar_lead_admin_events
    WHERE lead_id=NEW.lead_id AND transaction_id=txid_current() AND event_type='delivery'
      AND metadata->>'action' IN ('order_created','order_linked') AND source_activity_id IS NULL
      AND actor_id IS NOT DISTINCT FROM NEW.created_by
    ORDER BY id DESC LIMIT 1;
  END IF;
  IF v_event IS NOT NULL THEN
    UPDATE public.webinar_lead_admin_events SET event_type=NEW.activity_type, note=NEW.note,
      metadata=NEW.metadata || metadata, source_activity_id=NEW.id
    WHERE id=v_event;
  ELSE
    PERFORM public.append_webinar_lead_admin_event(NEW.lead_id,NEW.activity_type,NEW.status,NULL,
      NEW.note,NEW.metadata,NEW.created_by,NEW.id,NEW.created_at);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_webinar_activity_details() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER webinar_lead_activity_admin_audit AFTER INSERT ON public.webinar_lead_activities
  FOR EACH ROW EXECUTE FUNCTION public.audit_webinar_activity_details();

-- A contact link opening is evidence of a click, NOT evidence of a completed
-- call. It never modifies CRM status, counters, reminders or the closer timeline.
CREATE FUNCTION public.staff_log_webinar_contact(p_lead_id uuid,p_channel text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.can_manage_webinar_lead(auth.uid(),p_lead_id),false) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.webinar_leads WHERE id=p_lead_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'LEAD_NOT_FOUND';
  END IF;
  IF p_channel IS NULL OR p_channel NOT IN ('phone','whatsapp') THEN RAISE EXCEPTION 'CHANNEL_INVALID'; END IF;
  PERFORM public.append_webinar_lead_admin_event(p_lead_id,'contact',NULL,NULL,NULL,
    jsonb_build_object('action','contact_opened','channel',p_channel,'call_completed',false),auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.staff_log_webinar_contact(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_log_webinar_contact(uuid,text) TO authenticated;

CREATE FUNCTION public.admin_get_webinar_lead_history(p_lead_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_history jsonb;
BEGIN
  IF NOT coalesce(public.is_admin(auth.uid()),false) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',id::text,'lead_id',lead_id,'activity_type',event_type,'status',status,'previous_status',previous_status,
    'note',note,'metadata',metadata,'created_by',actor_id,'actor_name',actor_name,'actor_role',actor_role,'created_at',created_at
  ) ORDER BY created_at DESC,id DESC),'[]'::jsonb) INTO v_history
  FROM public.webinar_lead_admin_events WHERE lead_id=p_lead_id;
  RETURN v_history;
END $$;
REVOKE ALL ON FUNCTION public.admin_get_webinar_lead_history(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_webinar_lead_history(uuid) TO authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.webinar_lead_admin_events;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
