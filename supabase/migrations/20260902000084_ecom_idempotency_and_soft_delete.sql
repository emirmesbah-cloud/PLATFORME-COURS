-- Aurel Academy — durable E-com ledger, soft deletion and sync claiming.

BEGIN;

ALTER TABLE public.delivery_orders
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_reason text,
  ADD COLUMN IF NOT EXISTS sync_lock_token uuid,
  ADD COLUMN IF NOT EXISTS sync_started_at timestamptz;

ALTER TABLE public.webinar_leads
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_reason text;

ALTER TABLE public.webinar_lead_activities
  ADD COLUMN IF NOT EXISTS source_event_id text;
CREATE UNIQUE INDEX IF NOT EXISTS webinar_lead_activities_source_event_unique_idx
  ON public.webinar_lead_activities(source_event_id);

-- OTP minting is authenticated but expensive. Cap abusive refresh loops while
-- keeping normal lesson navigation and React retries far below the threshold.
CREATE TABLE IF NOT EXISTS public.vdocipher_otp_rate_limits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vdocipher_otp_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consume_vdocipher_otp_rate_limit()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  INSERT INTO public.vdocipher_otp_rate_limits(user_id, window_started_at, request_count, updated_at)
  VALUES (auth.uid(), now(), 1, now())
  ON CONFLICT (user_id) DO UPDATE SET
    window_started_at = CASE
      WHEN vdocipher_otp_rate_limits.window_started_at <= now() - interval '1 minute' THEN now()
      ELSE vdocipher_otp_rate_limits.window_started_at
    END,
    request_count = CASE
      WHEN vdocipher_otp_rate_limits.window_started_at <= now() - interval '1 minute' THEN 1
      ELSE vdocipher_otp_rate_limits.request_count + 1
    END,
    updated_at = now()
  RETURNING request_count INTO v_count;
  RETURN v_count <= 20;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_vdocipher_otp_rate_limit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_vdocipher_otp_rate_limit() TO authenticated;

CREATE INDEX IF NOT EXISTS delivery_orders_active_created_idx
  ON public.delivery_orders(created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS webinar_leads_active_created_idx
  ON public.webinar_leads(created_at DESC) WHERE deleted_at IS NULL;

-- A deleted order is retained as evidence but no longer blocks a replacement
-- order for the same prospect.
DROP INDEX IF EXISTS public.delivery_orders_webinar_lead_unique_idx;
CREATE UNIQUE INDEX delivery_orders_webinar_lead_unique_idx
  ON public.delivery_orders(webinar_lead_id)
  WHERE webinar_lead_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.ecom_sync_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.delivery_orders(id) ON DELETE RESTRICT,
  lock_token uuid NOT NULL UNIQUE,
  external_reference text NOT NULL,
  status text NOT NULL DEFAULT 'claimed'
    CHECK (status IN ('claimed', 'sent', 'succeeded', 'failed')),
  tracking text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ecom_sync_attempts_order_idx
  ON public.ecom_sync_attempts(order_id, created_at DESC);
ALTER TABLE public.ecom_sync_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read E-com sync attempts" ON public.ecom_sync_attempts;
CREATE POLICY "Admins read E-com sync attempts"
  ON public.ecom_sync_attempts FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- Claim is atomic. A five-minute lease permits recovery after a crashed Edge
-- Function while preventing two admins from creating the parcel concurrently.
CREATE OR REPLACE FUNCTION public.claim_delivery_order_sync(
  p_order_id uuid,
  p_lock_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claimed boolean := false;
  v_reference text;
BEGIN
  UPDATE public.delivery_orders
  SET sync_status = 'syncing',
      sync_lock_token = p_lock_token,
      sync_started_at = now(),
      last_error = null,
      updated_at = now()
  WHERE id = p_order_id
    AND deleted_at IS NULL
    AND ecom_tracking IS NULL
    AND (
      sync_status <> 'syncing'
      OR sync_started_at IS NULL
      OR sync_started_at < now() - interval '5 minutes'
    )
  RETURNING external_reference INTO v_reference;

  v_claimed := FOUND;
  IF v_claimed THEN
    INSERT INTO public.ecom_sync_attempts(order_id, lock_token, external_reference)
    VALUES (p_order_id, p_lock_token, v_reference);
  END IF;
  RETURN v_claimed;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_delivery_order_sync(uuid, uuid) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_delivery_order_sync(uuid, uuid) TO service_role;

-- Closers never see soft-deleted leads, even through direct PostgREST calls.
DROP POLICY IF EXISTS "Closers read assigned webinar leads" ON public.webinar_leads;
CREATE POLICY "Closers read assigned webinar leads"
  ON public.webinar_leads FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.has_staff_permission(auth.uid(), 'prospects')
    AND closer_user_id = auth.uid()
  );

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
    o.webinar_lead_id, o.id, o.ecom_tracking, o.ecom_situation
  FROM public.delivery_orders o
  JOIN public.webinar_leads l ON l.id = o.webinar_lead_id
  WHERE auth.uid() IS NOT NULL
    AND o.deleted_at IS NULL
    AND l.deleted_at IS NULL
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

-- Confirmed prospects can receive a replacement active order after an earlier
-- order was archived/deleted; no other CRM status creates an order.
CREATE OR REPLACE FUNCTION public.admin_bulk_create_orders(p_lead_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lead public.webinar_leads%ROWTYPE;
  v_order uuid;
  v_created integer := 0;
  v_skipped integer := 0;
BEGIN
  IF NOT public.is_admin(v_uid) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_lead_ids IS NULL OR array_length(p_lead_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'created', 0, 'skipped', 0);
  END IF;

  FOR v_lead IN
    SELECT * FROM public.webinar_leads
    WHERE id = ANY(p_lead_ids) AND deleted_at IS NULL
    FOR UPDATE
  LOOP
    IF v_lead.status <> 'confirmed' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    SELECT id INTO v_order
    FROM public.delivery_orders
    WHERE webinar_lead_id = v_lead.id AND deleted_at IS NULL
    LIMIT 1;
    IF v_order IS NOT NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.delivery_orders(
      customer_name, mobile_1, wilaya_id, wilaya_name, commune, delivery_mode,
      address, course, article, quantity, cod_amount, supplier_notes,
      webinar_lead_id, created_by
    ) VALUES (
      left(btrim(v_lead.full_name), 60), v_lead.phone_normalized,
      v_lead.wilaya_id, v_lead.wilaya_name, v_lead.commune, 'domicile',
      nullif(left(btrim(coalesce(v_lead.address, '')), 100), ''),
      'immigration', 'Programme Aurel Academy — Immigration', 1, 38000,
      'Interdiction d''ouvrir le colis', v_lead.id, v_uid
    );
    v_created := v_created + 1;

    INSERT INTO public.webinar_lead_activities(lead_id, activity_type, status, note, metadata, created_by)
    VALUES (
      v_lead.id, 'delivery', v_lead.status,
      'Commande interne créée sans modifier le statut CRM',
      jsonb_build_object('bulk', true, 'actor', 'admin', 'crm_status_preserved', true),
      v_uid
    );
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'created', v_created, 'skipped', v_skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_bulk_create_orders(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_bulk_create_orders(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
