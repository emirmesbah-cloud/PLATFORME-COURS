-- Run ONLY in a new disposable PostgreSQL database (never in production).
-- psql -v ON_ERROR_STOP=1 -d aurel_stock_mapping_test -f scripts/test-ecom-stock-mapping.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() <> 'aurel_stock_mapping_test' THEN
    RAISE EXCEPTION 'Use a disposable database named aurel_stock_mapping_test';
  END IF;
END $$;

CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE FUNCTION public.is_admin(p_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT p_id = '00000000-0000-0000-0000-000000000001'::uuid $$;
CREATE TYPE public.delivery_sync_status_enum AS ENUM ('draft', 'syncing', 'synced', 'failed');
CREATE TABLE public.delivery_orders (
  id text PRIMARY KEY,
  course text NOT NULL CHECK (course IN ('immigration', 'pflege')),
  ecom_ref_article text CHECK (ecom_ref_article IS NULL OR char_length(ecom_ref_article) <= 64),
  ecom_tracking text UNIQUE,
  deleted_at timestamptz,
  sync_status public.delivery_sync_status_enum NOT NULL DEFAULT 'draft',
  last_error text
);
CREATE TABLE public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES auth.users(id),
  action_type text NOT NULL,
  target_type text,
  metadata jsonb
);

-- Execute the actual migration, not a duplicate implementation.
\ir ../supabase/migrations/20260906000087_ecom_product_mappings.sql

BEGIN;
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001');
INSERT INTO public.delivery_orders(id, course, sync_status, last_error)
SELECT 'failed-' || n, 'immigration', 'failed', 'ECOM_REF_ARTICLE_REQUIRED'
FROM generate_series(1,6) n;
INSERT INTO public.delivery_orders(id, course, ecom_ref_article, ecom_tracking, deleted_at, sync_status) VALUES
 ('override', 'immigration', 'CUSTOM', NULL, NULL, 'draft'),
 ('sent', 'immigration', NULL, 'EXISTING-TRACKING', NULL, 'synced'),
 ('deleted', 'immigration', NULL, NULL, now(), 'draft'),
 ('inflight', 'immigration', NULL, NULL, NULL, 'syncing'),
 ('other-course', 'pflege', NULL, NULL, NULL, 'draft');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.admin_save_ecom_product_mapping('immigration', 'UNAUTHORIZED');
    RAISE EXCEPTION 'Non-admin mapping write was allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'FORBIDDEN' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.ecom_product_mappings(course, ref_article) VALUES ('immigration', 'BYPASS');
    RAISE EXCEPTION 'Direct mapping write was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
DO $$ DECLARE result jsonb; BEGIN
  result := public.admin_save_ecom_product_mapping('immigration', '  TEST-IMM  ');
  ASSERT result = '{"ok":true,"updated_orders":6}'::jsonb, 'Must repair exactly six eligible orders';
  ASSERT (SELECT ref_article = 'TEST-IMM' FROM public.ecom_product_mappings WHERE course='immigration'), 'Trim reference';
  result := public.admin_save_ecom_product_mapping('immigration', 'TEST-IMM');
  ASSERT result->>'updated_orders' = '0', 'Repeated save must be idempotent';
  PERFORM public.admin_save_ecom_product_mapping('pflege', 'TEST-PFL');
  BEGIN
    PERFORM public.admin_save_ecom_product_mapping('invalid', 'TEST');
    RAISE EXCEPTION 'Invalid programme was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'COURSE_INVALID' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.admin_save_ecom_product_mapping('immigration', '  ');
    RAISE EXCEPTION 'Blank reference was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'ECOM_REF_ARTICLE_REQUIRED' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT count(*) = 6 FROM public.delivery_orders WHERE id LIKE 'failed-%' AND ecom_ref_article='TEST-IMM' AND sync_status='draft' AND last_error IS NULL), 'Failed orders repaired';
  ASSERT (SELECT ecom_ref_article='CUSTOM' FROM public.delivery_orders WHERE id='override'), 'Explicit override preserved';
  ASSERT (SELECT count(*)=3 FROM public.delivery_orders WHERE id IN ('sent','deleted','inflight') AND ecom_ref_article IS NULL), 'Sent/deleted/inflight preserved';
  ASSERT (SELECT count(*)=1 FROM public.delivery_orders WHERE ecom_tracking IS NOT NULL), 'No parcel was sent';
  ASSERT (SELECT count(*)=3 FROM public.admin_audit_logs), 'Successful saves audited';
END $$;

INSERT INTO public.delivery_orders(id, course) VALUES ('future', 'immigration');
DO $$ BEGIN
  ASSERT (SELECT ecom_ref_article='TEST-IMM' FROM public.delivery_orders WHERE id='future'), 'New CRM/manual order inherits reference';
END $$;
UPDATE public.delivery_orders SET course='pflege' WHERE id='future';
DO $$ BEGIN
  ASSERT (SELECT ecom_ref_article='TEST-PFL' FROM public.delivery_orders WHERE id='future'), 'Programme change replaces previous reference';
END $$;
UPDATE public.delivery_orders SET course='immigration', ecom_ref_article='EXPLICIT' WHERE id='future';
DO $$ BEGIN
  ASSERT (SELECT ecom_ref_article='EXPLICIT' FROM public.delivery_orders WHERE id='future'), 'Programme change respects explicit override';
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
DO $$ BEGIN
  ASSERT (SELECT count(*)=0 FROM public.ecom_product_mappings), 'Non-admin cannot read mappings';
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.admin_save_ecom_product_mapping('immigration', 'ANON');
    RAISE EXCEPTION 'Anonymous write was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SET LOCAL ROLE service_role;
SELECT public.admin_save_ecom_product_mapping('immigration', 'TEST-IMM-NEW');
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT count(*)=6 FROM public.delivery_orders WHERE id LIKE 'failed-%' AND ecom_ref_article='TEST-IMM'), 'Later mapping update preserves filled orders';
END $$;
ROLLBACK;
\echo 'PASS: E-com stock mapping, automatic fill, six-order repair, preservation, validation and role boundaries'
