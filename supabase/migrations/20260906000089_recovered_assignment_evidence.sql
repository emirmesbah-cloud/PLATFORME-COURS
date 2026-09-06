-- Add recovered evidence to the PRIVATE admin timeline only.
-- No backup SQL is restored. No prospect, assignment, status, order, activity,
-- account or permission is updated. Unknown historical actors stay unknown.
-- These are evidence observations, NOT native 'assignment' events.
BEGIN;

ALTER TABLE public.webinar_lead_admin_events
  DROP CONSTRAINT IF EXISTS webinar_lead_admin_events_event_type_check;
ALTER TABLE public.webinar_lead_admin_events
  ADD CONSTRAINT webinar_lead_admin_events_event_type_check CHECK (
    event_type IN ('submitted','assignment','call','status','delivery','contact','note','assignment_evidence')
  );
ALTER TABLE public.webinar_lead_admin_events
  DROP CONSTRAINT IF EXISTS webinar_lead_admin_events_recovery_check;
ALTER TABLE public.webinar_lead_admin_events
  ADD CONSTRAINT webinar_lead_admin_events_recovery_check CHECK (
    event_type <> 'assignment_evidence' OR (
      actor_id IS NULL AND actor_role = 'unknown' AND status IS NULL
      AND previous_status IS NULL AND source_activity_id IS NULL
      AND jsonb_typeof(metadata->'recovery_key') = 'string'
      AND length(metadata->>'recovery_key') > 0
      AND metadata->>'recovery_kind' IN ('snapshot','interval','correlation')
    ) IS TRUE
  );
CREATE UNIQUE INDEX IF NOT EXISTS webinar_lead_admin_events_recovery_key_idx
  ON public.webinar_lead_admin_events(lead_id, (metadata->>'recovery_key'))
  WHERE event_type = 'assignment_evidence';

-- Real customer/closer data must never be committed to the public repository.
-- An operator imports the reviewed, private payload separately after deployment.
-- Only the database owner can invoke this function; no application role receives
-- an import permission. SECURITY INVOKER cannot elevate the caller's privileges.
CREATE OR REPLACE FUNCTION public.import_webinar_assignment_evidence(p_events jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_inserted integer;
BEGIN
  IF jsonb_typeof(p_events) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'EVIDENCE_ARRAY_REQUIRED'; END IF;
  IF jsonb_array_length(p_events)>10000 THEN RAISE EXCEPTION 'EVIDENCE_BATCH_TOO_LARGE'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_events) e
    WHERE (jsonb_typeof(e)='object' AND jsonb_typeof(e->'metadata')='object'
      AND jsonb_typeof(e->'lead_id')='string' AND jsonb_typeof(e->'created_at')='string'
      AND jsonb_typeof(e->'metadata'->'recovery_key')='string'
      AND length(e->'metadata'->>'recovery_key')>0
      AND e->'metadata'->>'recovery_kind' IN ('snapshot','interval','correlation')) IS NOT TRUE
  ) THEN RAISE EXCEPTION 'EVIDENCE_INVALID'; END IF;

  INSERT INTO public.webinar_lead_admin_events(lead_id,event_type,note,metadata,actor_id,actor_name,actor_role,created_at)
  SELECT e.lead_id,'assignment_evidence',e.note,e.metadata,NULL,'Auteur non prouvé','unknown',e.created_at
  FROM jsonb_to_recordset(p_events) AS e(lead_id uuid,created_at timestamptz,note text,metadata jsonb)
  JOIN public.webinar_leads l ON l.id=e.lead_id AND l.deleted_at IS NULL
  ON CONFLICT (lead_id, (metadata->>'recovery_key')) WHERE event_type='assignment_evidence' DO NOTHING;
  GET DIAGNOSTICS v_inserted=ROW_COUNT;
  RETURN jsonb_build_object('submitted',jsonb_array_length(p_events),'inserted',v_inserted,
    'skipped',jsonb_array_length(p_events)-v_inserted);
END $$;
REVOKE ALL ON FUNCTION public.import_webinar_assignment_evidence(jsonb) FROM PUBLIC,anon,authenticated,service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
