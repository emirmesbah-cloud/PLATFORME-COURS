-- =============================================================================
-- Webinar CRM: one record from registration through calls, sale and delivery.
-- =============================================================================

BEGIN;

DO $$ BEGIN
  CREATE TYPE public.webinar_lead_status_enum AS ENUM (
    'new', 'to_call', 'nrp', 'callback', 'not_interested',
    'confirmed', 'in_delivery', 'delivered', 'returned'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.webinar_leads (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name             TEXT NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 100),
  phone_raw             TEXT NOT NULL CHECK (char_length(btrim(phone_raw)) BETWEEN 8 AND 30),
  phone_normalized      TEXT NOT NULL CHECK (char_length(phone_normalized) BETWEEN 9 AND 13),
  email                 TEXT NOT NULL CHECK (char_length(btrim(email)) BETWEEN 5 AND 254),
  attended_live         BOOLEAN NOT NULL,
  wilaya_id             INT NOT NULL CHECK (wilaya_id BETWEEN 1 AND 69),
  wilaya_name           TEXT NOT NULL CHECK (char_length(btrim(wilaya_name)) BETWEEN 2 AND 80),
  commune               TEXT NOT NULL CHECK (char_length(btrim(commune)) BETWEEN 1 AND 100),
  address               TEXT NOT NULL CHECK (char_length(btrim(address)) BETWEEN 1 AND 200),
  source                TEXT NOT NULL DEFAULT 'youtube_live',
  campaign              TEXT NOT NULL DEFAULT 'post_webinar',
  status                public.webinar_lead_status_enum NOT NULL DEFAULT 'new',
  closer_name           TEXT CHECK (closer_name IS NULL OR char_length(btrim(closer_name)) <= 80),
  call_count            INT NOT NULL DEFAULT 0 CHECK (call_count >= 0),
  last_call_at          TIMESTAMPTZ,
  next_follow_up_at     TIMESTAMPTZ,
  latest_call_note      TEXT CHECK (latest_call_note IS NULL OR char_length(latest_call_note) <= 2000),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webinar_leads_created_idx ON public.webinar_leads (created_at DESC);
CREATE INDEX IF NOT EXISTS webinar_leads_status_idx ON public.webinar_leads (status, created_at DESC);
CREATE INDEX IF NOT EXISTS webinar_leads_phone_idx ON public.webinar_leads (phone_normalized, created_at DESC);
CREATE INDEX IF NOT EXISTS webinar_leads_follow_up_idx ON public.webinar_leads (next_follow_up_at)
  WHERE next_follow_up_at IS NOT NULL;

ALTER TABLE public.webinar_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin full webinar leads" ON public.webinar_leads;
CREATE POLICY "Admin full webinar leads" ON public.webinar_leads FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.webinar_lead_activities (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id               UUID NOT NULL REFERENCES public.webinar_leads(id) ON DELETE CASCADE,
  activity_type         TEXT NOT NULL CHECK (activity_type IN ('submitted', 'call', 'status', 'delivery')),
  status                public.webinar_lead_status_enum,
  note                  TEXT CHECK (note IS NULL OR char_length(note) <= 2000),
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webinar_lead_activities_lead_idx
  ON public.webinar_lead_activities (lead_id, created_at DESC);
ALTER TABLE public.webinar_lead_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin read webinar lead activities" ON public.webinar_lead_activities;
CREATE POLICY "Admin read webinar lead activities" ON public.webinar_lead_activities FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Admin add webinar lead activities" ON public.webinar_lead_activities;
CREATE POLICY "Admin add webinar lead activities" ON public.webinar_lead_activities FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()) AND created_by = auth.uid());

-- Service-role-only bucket for anonymous form throttling. Raw IPs are never kept.
CREATE TABLE IF NOT EXISTS public.webinar_lead_rate_limits (
  key_hash              TEXT PRIMARY KEY,
  window_started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_count         INT NOT NULL DEFAULT 1 CHECK (request_count >= 0),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.webinar_lead_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.touch_webinar_leads_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS webinar_leads_touch ON public.webinar_leads;
CREATE TRIGGER webinar_leads_touch BEFORE UPDATE ON public.webinar_leads
  FOR EACH ROW EXECUTE FUNCTION public.touch_webinar_leads_updated_at();

CREATE OR REPLACE FUNCTION public.log_webinar_lead_submission()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.webinar_lead_activities (lead_id, activity_type, status, metadata)
  VALUES (NEW.id, 'submitted', NEW.status,
    jsonb_build_object('attended_live', NEW.attended_live, 'source', NEW.source));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS webinar_leads_log_submission ON public.webinar_leads;
CREATE TRIGGER webinar_leads_log_submission AFTER INSERT ON public.webinar_leads
  FOR EACH ROW EXECUTE FUNCTION public.log_webinar_lead_submission();

CREATE OR REPLACE FUNCTION public.admin_log_webinar_call(
  p_lead_id UUID,
  p_status public.webinar_lead_status_enum,
  p_closer_name TEXT,
  p_note TEXT DEFAULT NULL,
  p_next_follow_up_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_lead public.webinar_leads%ROWTYPE;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_closer_name IS NULL OR char_length(btrim(p_closer_name)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'closer_name_required' USING ERRCODE = '22023';
  END IF;
  IF p_note IS NOT NULL AND char_length(p_note) > 2000 THEN
    RAISE EXCEPTION 'note_too_long' USING ERRCODE = '22023';
  END IF;

  UPDATE public.webinar_leads
  SET status = p_status,
      closer_name = btrim(p_closer_name),
      call_count = call_count + 1,
      last_call_at = now(),
      next_follow_up_at = p_next_follow_up_at,
      latest_call_note = NULLIF(btrim(COALESCE(p_note, '')), '')
  WHERE id = p_lead_id
  RETURNING * INTO v_lead;

  IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO public.webinar_lead_activities (lead_id, activity_type, status, note, metadata, created_by)
  VALUES (
    v_lead.id, 'call', v_lead.status, NULLIF(btrim(COALESCE(p_note, '')), ''),
    jsonb_build_object('closer_name', v_lead.closer_name, 'next_follow_up_at', v_lead.next_follow_up_at),
    auth.uid()
  );
  RETURN to_jsonb(v_lead);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_log_webinar_call(UUID, public.webinar_lead_status_enum, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_log_webinar_call(UUID, public.webinar_lead_status_enum, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;

ALTER TABLE public.delivery_orders ADD COLUMN IF NOT EXISTS webinar_lead_id UUID
  REFERENCES public.webinar_leads(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS delivery_orders_webinar_lead_unique_idx
  ON public.delivery_orders (webinar_lead_id) WHERE webinar_lead_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.mark_webinar_lead_delivery_created()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.webinar_lead_id IS NULL THEN RETURN NEW; END IF;
  UPDATE public.webinar_leads
  SET status = 'in_delivery'
  WHERE id = NEW.webinar_lead_id;
  INSERT INTO public.webinar_lead_activities (
    lead_id, activity_type, status, note, metadata, created_by
  ) VALUES (
    NEW.webinar_lead_id, 'delivery', 'in_delivery', 'Commande E-com créée',
    jsonb_build_object('delivery_order_id', NEW.id, 'external_reference', NEW.external_reference),
    NEW.created_by
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_orders_mark_webinar_lead ON public.delivery_orders;
CREATE TRIGGER delivery_orders_mark_webinar_lead AFTER INSERT ON public.delivery_orders
  FOR EACH ROW EXECUTE FUNCTION public.mark_webinar_lead_delivery_created();

COMMENT ON TABLE public.webinar_leads IS
  'Single post-webinar prospect record from public registration through calls and conversion.';
COMMENT ON TABLE public.webinar_lead_activities IS
  'Immutable CRM timeline for webinar lead submissions, calls, status changes and delivery handoff.';

COMMIT;
