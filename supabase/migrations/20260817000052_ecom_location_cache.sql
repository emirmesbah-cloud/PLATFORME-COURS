-- Cache E-com's delivery catalog so the public webinar form never exposes
-- credentials and does not call E-com once per visitor.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ecom_location_cache (
  cache_key   TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('wilayas', 'communes')),
  payload     JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'array'),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ecom_location_cache ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ecom_location_cache IS
  'Service-role-only cache of sanitized E-com wilayas and deliverable communes.';

COMMIT;
