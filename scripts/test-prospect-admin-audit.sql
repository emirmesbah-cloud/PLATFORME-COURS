-- Only for a new disposable PostgreSQL database; never run in production.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database()<>'aurel_prospect_audit_test' THEN RAISE EXCEPTION 'Use disposable aurel_prospect_audit_test'; END IF;
END $$;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY, first_name text, last_name text, is_admin boolean, staff_role text);
CREATE TABLE public.staff_members(auth_user_id uuid, first_name text, last_name text);
CREATE FUNCTION public.is_admin(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS
$$ SELECT coalesce((SELECT is_admin FROM profiles WHERE id=p_id),false) $$;
CREATE TYPE public.webinar_lead_status_enum AS ENUM('new','to_call','nrp','callback','not_interested','confirmed','in_delivery','delivered','returned');
CREATE TABLE public.webinar_leads(id uuid PRIMARY KEY, status public.webinar_lead_status_enum NOT NULL DEFAULT 'to_call', closer_user_id uuid, closer_name text, note text, call_count integer DEFAULT 0, deleted_at timestamptz);
CREATE TABLE public.webinar_lead_activities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid REFERENCES webinar_leads(id),activity_type text,status public.webinar_lead_status_enum,note text,metadata jsonb NOT NULL DEFAULT '{}',created_by uuid,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.delivery_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),webinar_lead_id uuid REFERENCES webinar_leads(id),external_reference text,created_by uuid,created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.can_manage_webinar_lead(p_id uuid,p_lead uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS
$$ SELECT is_admin(p_id) OR EXISTS(SELECT 1 FROM webinar_leads WHERE id=p_lead AND closer_user_id=p_id) $$;

INSERT INTO profiles VALUES
 ('00000000-0000-0000-0000-000000000001','Test','Admin',true,'admin'),
 ('00000000-0000-0000-0000-000000000002','Test','Closer',false,'closer'),
 ('00000000-0000-0000-0000-000000000003','Other','Closer',false,'closer');
INSERT INTO webinar_leads(id) VALUES('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
INSERT INTO webinar_lead_activities(lead_id,activity_type,status,note,created_by,created_at)
VALUES('10000000-0000-0000-0000-000000000001','call','nrp','Historic note','00000000-0000-0000-0000-000000000002','2026-08-20T10:00:00Z');
INSERT INTO delivery_orders(webinar_lead_id,external_reference,created_by,created_at)
VALUES('10000000-0000-0000-0000-000000000002','OLD-ORDER','00000000-0000-0000-0000-000000000001','2026-08-20T11:00:00Z');
\ir ../supabase/migrations/20260906000088_admin_prospect_audit.sql

BEGIN;
DO $$ BEGIN
  ASSERT (SELECT count(*)=2 FROM webinar_lead_admin_events), 'Legacy activity and missing order evidence preserved';
  ASSERT (SELECT actor_role='unknown' AND created_at='2026-08-20T10:00:00Z'::timestamptz FROM webinar_lead_admin_events WHERE event_type='call'), 'Never infer historical role/date';
  ASSERT NOT EXISTS(SELECT 1 FROM webinar_lead_admin_events WHERE event_type='assignment'), 'No invented historic attributions';
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
UPDATE webinar_leads SET closer_user_id='00000000-0000-0000-0000-000000000002',closer_name='Test Closer' WHERE id='10000000-0000-0000-0000-000000000001';
UPDATE webinar_leads SET closer_name='Test Closer' WHERE id='10000000-0000-0000-0000-000000000001';
DO $$ BEGIN
  ASSERT (SELECT count(*)=1 FROM webinar_lead_admin_events WHERE event_type='assignment'), 'No duplicate attribution on unchanged row';
  ASSERT (SELECT actor_role='admin' AND actor_name='Test Admin' AND metadata->>'closer_name'='Test Closer' FROM webinar_lead_admin_events WHERE event_type='assignment'), 'Admin attribution snapshot';
END $$;

-- These are the actual row + activity writes emitted by the existing scoped
-- status/call RPCs. Exercise the new triggers against both steps atomically.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
UPDATE webinar_leads SET status='callback',call_count=call_count+1 WHERE id='10000000-0000-0000-0000-000000000001';
INSERT INTO webinar_lead_activities(lead_id,activity_type,status,note,metadata,created_by)
VALUES('10000000-0000-0000-0000-000000000001','call','callback','Call back tomorrow','{"call_attempt":2,"next_follow_up_at":"2026-09-07T10:00:00Z"}','00000000-0000-0000-0000-000000000002');
DO $$ BEGIN
  ASSERT (SELECT count(*)=1 FROM webinar_lead_admin_events WHERE status='callback'), 'One call action, not duplicate status and call';
  ASSERT (SELECT event_type='call' AND previous_status='to_call' AND actor_role='closer' AND note='Call back tomorrow' AND metadata->>'call_attempt'='2' FROM webinar_lead_admin_events WHERE status='callback'), 'Call has previous status, author and note';
END $$;

SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT (SELECT count(*)=0 FROM public.webinar_lead_admin_events), 'Closer RLS hides admin history';
  BEGIN
    PERFORM public.admin_get_webinar_lead_history('10000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'Closer read admin RPC';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'FORBIDDEN' THEN RAISE; END IF; END;
  PERFORM public.staff_log_webinar_contact('10000000-0000-0000-0000-000000000001','phone');
  BEGIN
    PERFORM public.staff_log_webinar_contact('10000000-0000-0000-0000-000000000002','phone');
    RAISE EXCEPTION 'Closer logged another closer lead';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'FORBIDDEN' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.staff_log_webinar_contact('10000000-0000-0000-0000-000000000001','invalid');
    RAISE EXCEPTION 'Invalid channel accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'CHANNEL_INVALID' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.append_webinar_lead_admin_event('10000000-0000-0000-0000-000000000001','call',NULL,NULL,'forged','{}',auth.uid());
    RAISE EXCEPTION 'Closer accessed internal writer';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT call_count=1 AND status='callback' FROM webinar_leads WHERE id='10000000-0000-0000-0000-000000000001'), 'Contact click never changes counts/status';
  ASSERT (SELECT metadata->>'call_completed'='false' FROM webinar_lead_admin_events WHERE event_type='contact'), 'Contact is explicitly not a completed call';
END $$;

-- Confirmation without note, then manual/admin order creation.
UPDATE webinar_leads SET status='confirmed' WHERE id='10000000-0000-0000-0000-000000000001';
INSERT INTO webinar_lead_activities(lead_id,activity_type,status,created_by)
VALUES('10000000-0000-0000-0000-000000000001','call','confirmed','00000000-0000-0000-0000-000000000002');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
INSERT INTO delivery_orders(webinar_lead_id,external_reference,created_by)
VALUES('10000000-0000-0000-0000-000000000001','NEW-ORDER','00000000-0000-0000-0000-000000000001');
INSERT INTO webinar_lead_activities(lead_id,activity_type,status,note,metadata,created_by)
VALUES('10000000-0000-0000-0000-000000000001','delivery','confirmed','Internal order','{"bulk":true}','00000000-0000-0000-0000-000000000001');
DO $$ BEGIN
  ASSERT (SELECT count(*)=1 FROM webinar_lead_admin_events WHERE lead_id='10000000-0000-0000-0000-000000000001' AND event_type='delivery'), 'One precise handoff for manual/bulk order';
  ASSERT (SELECT actor_role='admin' AND metadata->>'external_reference'='NEW-ORDER' AND metadata->>'action'='order_created' AND note='Internal order' FROM webinar_lead_admin_events WHERE metadata->>'external_reference'='NEW-ORDER'), 'Order retains admin actor and reference';
  ASSERT (SELECT status='confirmed' FROM webinar_leads WHERE id='10000000-0000-0000-0000-000000000001'), 'Audit never modifies CRM state';
END $$;
UPDATE webinar_leads SET closer_user_id='00000000-0000-0000-0000-000000000003',closer_name='Other Closer' WHERE id='10000000-0000-0000-0000-000000000001';
UPDATE profiles SET first_name='Changed',is_admin=true WHERE id='00000000-0000-0000-0000-000000000002';
DO $$ BEGIN
  ASSERT (SELECT actor_name='Test Closer' AND actor_role='closer' FROM webinar_lead_admin_events WHERE status='callback'), 'Author snapshot survives profile edits';
  ASSERT EXISTS(SELECT 1 FROM webinar_lead_admin_events WHERE event_type='assignment' AND metadata->>'previous_closer_name'='Test Closer' AND metadata->>'closer_name'='Other Closer'), 'Reassignment has both closers';
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
  result:=public.admin_get_webinar_lead_history('10000000-0000-0000-0000-000000000001');
  ASSERT jsonb_array_length(result)>=6, 'Admin sees complete timeline';
  BEGIN
    UPDATE public.webinar_lead_admin_events SET actor_name='forged';
    RAISE EXCEPTION 'Admin could overwrite audit';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.admin_get_webinar_lead_history('10000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'Anonymous read';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
\echo 'PASS: admin prospect audit, snapshots, status/call merge, order handoff, scoped contact and role isolation'
