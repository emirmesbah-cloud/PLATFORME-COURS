-- Course-aware accounting and official list-price snapshots.
--
-- Official prices at this migration:
--   Pflege Autonome    12 900 DZD
--   Pflege Accompagné  42 800 DZD
--   Immigration        38 000 DZD
--
-- Actual received amounts remain admin-entered. `list_price_dzd` is a
-- historical reference captured at activation time, not booked revenue.

BEGIN;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS course TEXT NOT NULL DEFAULT 'pflege',
  ADD COLUMN IF NOT EXISTS list_price_dzd NUMERIC(12, 2);

DO $$
BEGIN
  ALTER TABLE public.payments
    ADD CONSTRAINT payments_course_check
    CHECK (course IN ('pflege', 'immigration'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- Backfill the course from the activation code and snapshot the official price.
UPDATE public.payments p
SET
  course = COALESCE(ac.course, 'pflege'),
  list_price_dzd = CASE
    WHEN COALESCE(ac.course, 'pflege') = 'immigration' THEN 38000
    WHEN p.tier = 'accompagne' THEN 42800
    ELSE 12900
  END
FROM public.activation_codes ac
WHERE p.activation_code_id = ac.id;

UPDATE public.payments
SET list_price_dzd = CASE
  WHEN course = 'immigration' THEN 38000
  WHEN tier = 'accompagne' THEN 42800
  ELSE 12900
END
WHERE list_price_dzd IS NULL;

ALTER TABLE public.payments
  ALTER COLUMN list_price_dzd SET NOT NULL;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_list_price_nonnegative;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_list_price_nonnegative CHECK (list_price_dzd >= 0);

CREATE INDEX IF NOT EXISTS payments_course_idx ON public.payments (course);

-- Future activations capture the course and list price automatically.
CREATE OR REPLACE FUNCTION public.create_pending_payment_on_activation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_used = TRUE
     AND COALESCE(OLD.is_used, FALSE) = FALSE
     AND NEW.used_by_user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.payments WHERE activation_code_id = NEW.id
     ) THEN
    INSERT INTO public.payments (
      activation_code_id,
      user_id,
      tier,
      course,
      list_price_dzd,
      status,
      created_at
    )
    VALUES (
      NEW.id,
      NEW.used_by_user_id,
      NEW.tier,
      COALESCE(NEW.course, 'pflege'),
      CASE
        WHEN COALESCE(NEW.course, 'pflege') = 'immigration' THEN 38000
        WHEN NEW.tier = 'accompagne' THEN 42800
        ELSE 12900
      END,
      'pending',
      COALESCE(NEW.used_at, NOW())
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Preserve the original accounting date when an existing recorded payment is
-- corrected. Cancelled rows are immutable through this RPC.
CREATE OR REPLACE FUNCTION public.admin_record_payment(
  p_payment_id UUID,
  p_method public.payment_method_enum,
  p_amount NUMERIC,
  p_currency public.payment_currency_enum,
  p_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_status public.payment_status_enum;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'NOT_AUTHENTICATED');
  END IF;
  IF NOT public.is_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'NOT_ADMIN');
  END IF;
  IF p_method IS NULL OR p_currency IS NULL OR p_amount IS NULL OR p_amount < 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'INVALID_PAYMENT_DETAILS');
  END IF;

  SELECT status
  INTO v_status
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'PAYMENT_NOT_FOUND');
  END IF;
  IF v_status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'PAYMENT_CANCELLED');
  END IF;

  UPDATE public.payments
  SET
    method = p_method,
    amount = p_amount,
    currency = p_currency,
    notes = NULLIF(BTRIM(p_notes), ''),
    status = 'recorded',
    recorded_at = COALESCE(recorded_at, NOW()),
    recorded_by = v_uid
  WHERE id = p_payment_id;

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_record_payment(
  UUID, public.payment_method_enum, NUMERIC, public.payment_currency_enum, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_record_payment(
  UUID, public.payment_method_enum, NUMERIC, public.payment_currency_enum, TEXT
) TO authenticated;

-- Replace the old five-argument listing RPC with a course-aware version.
DROP FUNCTION IF EXISTS public.admin_list_payments(
  TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
);

CREATE FUNCTION public.admin_list_payments(
  p_status TEXT DEFAULT NULL,
  p_tier TEXT DEFAULT NULL,
  p_method TEXT DEFAULT NULL,
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL,
  p_course TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rows JSONB;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('pending', 'recorded', 'cancelled') THEN
    RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = '22023';
  END IF;
  IF p_tier IS NOT NULL AND p_tier NOT IN ('autonome', 'accompagne') THEN
    RAISE EXCEPTION 'INVALID_TIER' USING ERRCODE = '22023';
  END IF;
  IF p_method IS NOT NULL AND p_method NOT IN (
    'cash', 'ccp', 'baridi', 'bank_transfer', 'international_transfer', 'other'
  ) THEN
    RAISE EXCEPTION 'INVALID_METHOD' USING ERRCODE = '22023';
  END IF;
  IF p_course IS NOT NULL AND p_course NOT IN ('pflege', 'immigration') THEN
    RAISE EXCEPTION 'INVALID_COURSE' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      p.created_at,
      to_jsonb(p)
        || jsonb_build_object(
          'profile', CASE
            WHEN pr.id IS NULL THEN NULL
            ELSE jsonb_build_object(
              'first_name', pr.first_name,
              'last_name', pr.last_name,
              'email', pr.email
            )
          END,
          'activation_code', CASE
            WHEN ac.id IS NULL THEN NULL
            ELSE jsonb_build_object('code', ac.code, 'course', ac.course)
          END
        ) AS row_data
    FROM public.payments p
    LEFT JOIN public.profiles pr ON pr.id = p.user_id
    LEFT JOIN public.activation_codes ac ON ac.id = p.activation_code_id
    WHERE (p_status IS NULL OR p.status::TEXT = p_status)
      AND (p_tier IS NULL OR p.tier::TEXT = p_tier)
      AND (p_method IS NULL OR p.method::TEXT = p_method)
      AND (p_course IS NULL OR p.course = p_course)
      AND (p_from IS NULL OR p.created_at >= p_from)
      AND (p_to IS NULL OR p.created_at < p_to)
    ORDER BY p.created_at DESC
    LIMIT 2000
  ) rows;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_payments(
  TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_payments(
  TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT
) TO authenticated;

-- Add pending list-price value and booked-revenue breakdown by course.
CREATE OR REPLACE FUNCTION public.admin_get_accounting_stats()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_now DATE := CURRENT_DATE;
  v_this_start DATE := DATE_TRUNC('month', v_now)::date;
  v_last_start DATE := (DATE_TRUNC('month', v_now) - INTERVAL '1 month')::date;
  v_year_start DATE := DATE_TRUNC('year', v_now)::date;
  v_result JSONB;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'NOT_AUTHORIZED');
  END IF;

  SELECT jsonb_build_object(
    'ok', TRUE,
    'this_month', (
      SELECT jsonb_build_object(
        'dzd', COALESCE(SUM(CASE WHEN currency = 'DZD' THEN amount ELSE 0 END), 0),
        'eur', COALESCE(SUM(CASE WHEN currency = 'EUR' THEN amount ELSE 0 END), 0),
        'count', COUNT(*)
      )
      FROM public.payments
      WHERE status = 'recorded' AND recorded_at >= v_this_start
    ),
    'last_month', (
      SELECT jsonb_build_object(
        'dzd', COALESCE(SUM(CASE WHEN currency = 'DZD' THEN amount ELSE 0 END), 0),
        'eur', COALESCE(SUM(CASE WHEN currency = 'EUR' THEN amount ELSE 0 END), 0),
        'count', COUNT(*)
      )
      FROM public.payments
      WHERE status = 'recorded'
        AND recorded_at >= v_last_start
        AND recorded_at < v_this_start
    ),
    'ytd', (
      SELECT jsonb_build_object(
        'dzd', COALESCE(SUM(CASE WHEN currency = 'DZD' THEN amount ELSE 0 END), 0),
        'eur', COALESCE(SUM(CASE WHEN currency = 'EUR' THEN amount ELSE 0 END), 0),
        'count', COUNT(*)
      )
      FROM public.payments
      WHERE status = 'recorded' AND recorded_at >= v_year_start
    ),
    'pending', (
      SELECT COUNT(*) FROM public.payments WHERE status = 'pending'
    ),
    'pending_dzd', (
      SELECT COALESCE(SUM(list_price_dzd), 0)
      FROM public.payments
      WHERE status = 'pending'
    ),
    'by_course', (
      SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.course), '[]'::jsonb)
      FROM (
        SELECT
          course,
          COALESCE(SUM(CASE WHEN currency = 'DZD' THEN amount ELSE 0 END), 0) AS dzd,
          COALESCE(SUM(CASE WHEN currency = 'EUR' THEN amount ELSE 0 END), 0) AS eur,
          COUNT(*) AS count
        FROM public.payments
        WHERE status = 'recorded'
        GROUP BY course
      ) c
    ),
    'by_tier', (
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.tier), '[]'::jsonb)
      FROM (
        SELECT
          tier::TEXT AS tier,
          COALESCE(SUM(CASE WHEN currency = 'DZD' THEN amount ELSE 0 END), 0) AS dzd,
          COALESCE(SUM(CASE WHEN currency = 'EUR' THEN amount ELSE 0 END), 0) AS eur,
          COUNT(*) AS count
        FROM public.payments
        WHERE status = 'recorded'
        GROUP BY tier
      ) t
    ),
    'by_method', (
      SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.method), '[]'::jsonb)
      FROM (
        SELECT
          method::TEXT AS method,
          COALESCE(SUM(CASE WHEN currency = 'DZD' THEN amount ELSE 0 END), 0) AS dzd,
          COALESCE(SUM(CASE WHEN currency = 'EUR' THEN amount ELSE 0 END), 0) AS eur,
          COUNT(*) AS count
        FROM public.payments
        WHERE status = 'recorded' AND method IS NOT NULL
        GROUP BY method
      ) m
    ),
    'monthly', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.month), '[]'::jsonb)
      FROM (
        SELECT
          TO_CHAR(DATE_TRUNC('month', recorded_at), 'YYYY-MM') AS month,
          COALESCE(SUM(CASE WHEN currency = 'DZD' THEN amount ELSE 0 END), 0) AS dzd,
          COALESCE(SUM(CASE WHEN currency = 'EUR' THEN amount ELSE 0 END), 0) AS eur,
          COUNT(*) AS count
        FROM public.payments
        WHERE status = 'recorded'
          AND recorded_at >= (v_now - INTERVAL '12 months')
        GROUP BY DATE_TRUNC('month', recorded_at)
      ) x
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_accounting_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_accounting_stats() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
