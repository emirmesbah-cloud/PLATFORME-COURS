-- =============================================================================
-- E-com Delivery integration: local order ledger + webhook idempotency
-- =============================================================================
-- API credentials never live in this schema or in the browser. They are stored
-- as Supabase Edge Function secrets (ECOM_API_KEY / ECOM_API_TOKEN).

BEGIN;

DO $$ BEGIN
  CREATE TYPE public.delivery_mode_enum AS ENUM ('domicile', 'stopdesk');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.delivery_sync_status_enum AS ENUM ('draft', 'syncing', 'synced', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.delivery_orders (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_reference       TEXT NOT NULL UNIQUE
                             DEFAULT ('AA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),

  customer_name            TEXT NOT NULL CHECK (char_length(btrim(customer_name)) BETWEEN 1 AND 60),
  mobile_1                 TEXT NOT NULL CHECK (char_length(btrim(mobile_1)) BETWEEN 1 AND 25),
  mobile_2                 TEXT CHECK (mobile_2 IS NULL OR char_length(btrim(mobile_2)) <= 25),
  wilaya_id                INT NOT NULL CHECK (wilaya_id BETWEEN 1 AND 58),
  wilaya_name              TEXT NOT NULL,
  commune                  TEXT,
  delivery_mode            public.delivery_mode_enum NOT NULL DEFAULT 'domicile',
  stopdesk_code            TEXT,
  address                  TEXT CHECK (address IS NULL OR char_length(address) <= 100),

  course                   TEXT NOT NULL DEFAULT 'immigration'
                             CHECK (course IN ('pflege', 'immigration')),
  article                  TEXT NOT NULL CHECK (char_length(btrim(article)) BETWEEN 1 AND 255),
  ecom_ref_article         TEXT CHECK (ecom_ref_article IS NULL OR char_length(ecom_ref_article) <= 64),
  quantity                 INT NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  cod_amount               NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (cod_amount >= 0),
  supplier_notes           TEXT CHECK (supplier_notes IS NULL OR char_length(supplier_notes) <= 255),
  activation_code_id       UUID REFERENCES public.activation_codes(id) ON DELETE SET NULL,

  sync_status              public.delivery_sync_status_enum NOT NULL DEFAULT 'draft',
  ecom_tracking            TEXT UNIQUE,
  ecom_parcel_id           BIGINT,
  ecom_situation           TEXT,
  ecom_logistics_state     TEXT,
  ecom_delivery_fee        NUMERIC(12, 2),
  ecom_confirmed           BOOLEAN NOT NULL DEFAULT false,
  ecom_collected           BOOLEAN NOT NULL DEFAULT false,
  ecom_recovered           BOOLEAN NOT NULL DEFAULT false,
  last_error               TEXT,
  last_synced_at           TIMESTAMPTZ,
  last_event_at            TIMESTAMPTZ,

  created_by               UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT delivery_destination_required CHECK (
    (delivery_mode = 'domicile' AND commune IS NOT NULL AND btrim(commune) <> '')
    OR
    (delivery_mode = 'stopdesk' AND stopdesk_code IS NOT NULL AND btrim(stopdesk_code) <> '')
  )
);

CREATE INDEX IF NOT EXISTS delivery_orders_created_idx
  ON public.delivery_orders (created_at DESC);
CREATE INDEX IF NOT EXISTS delivery_orders_sync_idx
  ON public.delivery_orders (sync_status, created_at DESC);
CREATE INDEX IF NOT EXISTS delivery_orders_tracking_idx
  ON public.delivery_orders (ecom_tracking) WHERE ecom_tracking IS NOT NULL;
CREATE INDEX IF NOT EXISTS delivery_orders_course_idx
  ON public.delivery_orders (course, created_at DESC);

ALTER TABLE public.delivery_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin full delivery orders" ON public.delivery_orders;
CREATE POLICY "Admin full delivery orders"
  ON public.delivery_orders FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.touch_delivery_orders_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_orders_touch ON public.delivery_orders;
CREATE TRIGGER delivery_orders_touch
  BEFORE UPDATE ON public.delivery_orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_delivery_orders_updated_at();

-- Service-role-only event inbox. A unique event id makes webhook retries safe.
CREATE TABLE IF NOT EXISTS public.ecom_webhook_events (
  event_id       TEXT PRIMARY KEY,
  tracking       TEXT NOT NULL,
  situation      TEXT,
  payload        JSONB NOT NULL,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at   TIMESTAMPTZ,
  processing_error TEXT
);

CREATE INDEX IF NOT EXISTS ecom_webhook_tracking_idx
  ON public.ecom_webhook_events (tracking, received_at DESC);

ALTER TABLE public.ecom_webhook_events ENABLE ROW LEVEL SECURITY;
-- Intentionally no client policies: only service_role in the webhook function.

COMMENT ON TABLE public.delivery_orders IS
  'Aurel order ledger synchronized server-side with E-com Delivery API v2.';
COMMENT ON TABLE public.ecom_webhook_events IS
  'Idempotent inbox for signed E-com Delivery status webhooks; service-role only.';

COMMIT;
