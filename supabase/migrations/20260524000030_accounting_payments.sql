-- =============================================================================
-- Accounting : payments table + auto-creation trigger from activation_codes
-- =============================================================================
-- Goal : track every paid activation as a row, admin completes amount +
-- method afterwards. Aggregates for monthly revenue, per tier, per method.
--
-- Decisions (2026-05-24) :
-- - Auto-création : trigger sur activation_codes quand is_used flips true
-- - Pas de factures (out of scope)
-- - Devise : DZD ou EUR (Algérie + international)
-- - Méthodes : cash / ccp / baridi / bank_transfer / international_transfer / other
-- =============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.payment_method_enum AS ENUM (
    'cash', 'ccp', 'baridi', 'bank_transfer', 'international_transfer', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_status_enum AS ENUM ('pending', 'recorded', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_currency_enum AS ENUM ('DZD', 'EUR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ----------------------------------------------------------------------------
-- 2. payments table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Lien optionnel : si null, c'est un paiement manuel hors-code (extension future)
  activation_code_id   UUID REFERENCES public.activation_codes(id) ON DELETE SET NULL,
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Snapshot du tier au moment du paiement (au cas où on changerait le tier
  -- d'un étudiant plus tard — la compta doit refléter l'état initial).
  tier                 public.tier_enum NOT NULL,

  -- Saisie admin (NULL tant que status = pending)
  method               public.payment_method_enum,
  amount               NUMERIC(12, 2) CHECK (amount IS NULL OR amount >= 0),
  currency             public.payment_currency_enum,
  notes                TEXT,

  status               public.payment_status_enum NOT NULL DEFAULT 'pending',

  -- Audit
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_at          TIMESTAMPTZ,
  recorded_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payments_user_idx      ON public.payments (user_id);
CREATE INDEX IF NOT EXISTS payments_status_idx    ON public.payments (status);
CREATE INDEX IF NOT EXISTS payments_created_idx   ON public.payments (created_at DESC);
CREATE INDEX IF NOT EXISTS payments_tier_idx      ON public.payments (tier);
CREATE INDEX IF NOT EXISTS payments_method_idx    ON public.payments (method);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Admin-only on all operations. Students never touch this table.
CREATE POLICY "Admin full payments"
  ON public.payments FOR ALL
  TO authenticated
  USING     ( public.is_admin(auth.uid()) )
  WITH CHECK( public.is_admin(auth.uid()) );

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.touch_payments_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS payments_touch ON public.payments;
CREATE TRIGGER payments_touch
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.touch_payments_updated_at();


-- ----------------------------------------------------------------------------
-- 3. Trigger : auto-create payment row when an activation_code is used
-- ----------------------------------------------------------------------------
-- Fires on UPDATE OF is_used FALSE → TRUE on activation_codes. Creates
-- a pending payment for the activating user. If a payment already exists
-- for this code (e.g. trigger re-runs), do nothing (defensive).
CREATE OR REPLACE FUNCTION public.create_pending_payment_on_activation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only act when is_used flips false → true (initial activation).
  IF NEW.is_used = true AND COALESCE(OLD.is_used, false) = false
     AND NEW.used_by_user_id IS NOT NULL THEN
    -- Guard : skip if a payment already exists for this code.
    IF NOT EXISTS (
      SELECT 1 FROM public.payments WHERE activation_code_id = NEW.id
    ) THEN
      INSERT INTO public.payments (
        activation_code_id, user_id, tier, status, created_at
      ) VALUES (
        NEW.id, NEW.used_by_user_id, NEW.tier, 'pending', COALESCE(NEW.used_at, NOW())
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS activation_code_creates_payment ON public.activation_codes;
CREATE TRIGGER activation_code_creates_payment
  AFTER UPDATE OF is_used ON public.activation_codes
  FOR EACH ROW
  EXECUTE FUNCTION public.create_pending_payment_on_activation();


-- ----------------------------------------------------------------------------
-- 4. Backfill : create pending payment rows for codes ALREADY used
-- ----------------------------------------------------------------------------
-- One-shot : insert pending rows for every already-used activation code
-- that doesn't yet have a corresponding payment. After this migration,
-- the trigger handles new activations on the fly.
INSERT INTO public.payments (activation_code_id, user_id, tier, status, created_at)
SELECT
  ac.id,
  ac.used_by_user_id,
  ac.tier,
  'pending',
  COALESCE(ac.used_at, ac.created_at, NOW())
FROM public.activation_codes ac
WHERE ac.is_used = true
  AND ac.used_by_user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.activation_code_id = ac.id);


-- ----------------------------------------------------------------------------
-- 5. RPC : admin_record_payment(payment_id, method, amount, currency, notes)
-- ----------------------------------------------------------------------------
-- Completes a pending payment with the actual amount + method received.
-- Idempotent : can be called again to UPDATE an already-recorded payment.
CREATE OR REPLACE FUNCTION public.admin_record_payment(
  p_payment_id  UUID,
  p_method      public.payment_method_enum,
  p_amount      NUMERIC,
  p_currency    public.payment_currency_enum,
  p_notes       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  IF NOT public.is_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  END IF;

  IF p_amount IS NULL OR p_amount < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT');
  END IF;

  UPDATE public.payments
  SET method      = p_method,
      amount      = p_amount,
      currency    = p_currency,
      notes       = p_notes,
      status      = 'recorded',
      recorded_at = NOW(),
      recorded_by = v_uid
  WHERE id = p_payment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PAYMENT_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_record_payment(UUID, public.payment_method_enum, NUMERIC, public.payment_currency_enum, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_record_payment(UUID, public.payment_method_enum, NUMERIC, public.payment_currency_enum, TEXT) TO authenticated;


-- ----------------------------------------------------------------------------
-- 6. RPC : admin_cancel_payment(payment_id)
-- ----------------------------------------------------------------------------
-- Soft-cancel a payment (e.g. refund, code re-issued). Doesn't delete the
-- row so we keep the audit trail.
CREATE OR REPLACE FUNCTION public.admin_cancel_payment(p_payment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;
  UPDATE public.payments SET status = 'cancelled', recorded_by = v_uid
  WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PAYMENT_NOT_FOUND');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_cancel_payment(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_cancel_payment(UUID) TO authenticated;


-- ----------------------------------------------------------------------------
-- 7. RPC : admin_get_accounting_stats
-- ----------------------------------------------------------------------------
-- Returns aggregated stats for the dashboard. We sum per currency separately
-- (DZD vs EUR) because they're not interchangeable without a FX rate.
--
-- Output :
-- {
--   ok: true,
--   this_month:   { dzd, eur, count },
--   last_month:   { dzd, eur, count },
--   ytd:          { dzd, eur, count },
--   pending:      count,
--   by_tier:      [{ tier, dzd, eur, count }],
--   by_method:    [{ method, dzd, eur, count }],
--   monthly:      [{ month: 'YYYY-MM', dzd, eur, count }] (last 12 months)
-- }
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
  v_this_start  DATE := DATE_TRUNC('month', v_now)::date;
  v_last_start  DATE := (DATE_TRUNC('month', v_now) - INTERVAL '1 month')::date;
  v_year_start  DATE := DATE_TRUNC('year', v_now)::date;
  v_result JSONB;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  SELECT jsonb_build_object(
    'ok', true,
    'this_month', (
      SELECT jsonb_build_object(
        'dzd',   COALESCE(SUM(CASE WHEN currency = 'DZD' THEN amount ELSE 0 END), 0),
        'eur',   COALESCE(SUM(CASE WHEN currency = 'EUR' THEN amount ELSE 0 END), 0),
        'count', COUNT(*)
      ) FROM public.payments
      WHERE status = 'recorded' AND recorded_at >= v_this_start
    ),
    'last_month', (
      SELECT jsonb_build_object(
        'dzd',   COALESCE(SUM(CASE WHEN currency = 'DZD' THEN amount ELSE 0 END), 0),
        'eur',   COALESCE(SUM(CASE WHEN currency = 'EUR' THEN amount ELSE 0 END), 0),
        'count', COUNT(*)
      ) FROM public.payments
      WHERE status = 'recorded'
        AND recorded_at >= v_last_start AND recorded_at < v_this_start
    ),
    'ytd', (
      SELECT jsonb_build_object(
        'dzd',   COALESCE(SUM(CASE WHEN currency = 'DZD' THEN amount ELSE 0 END), 0),
        'eur',   COALESCE(SUM(CASE WHEN currency = 'EUR' THEN amount ELSE 0 END), 0),
        'count', COUNT(*)
      ) FROM public.payments
      WHERE status = 'recorded' AND recorded_at >= v_year_start
    ),
    'pending', (
      SELECT COUNT(*) FROM public.payments WHERE status = 'pending'
    ),
    'by_tier', (
      SELECT COALESCE(jsonb_agg(row_to_jsonb(t) ORDER BY t.tier), '[]'::jsonb)
      FROM (
        SELECT tier::text AS tier,
               COALESCE(SUM(CASE WHEN currency = 'DZD' THEN amount ELSE 0 END), 0) AS dzd,
               COALESCE(SUM(CASE WHEN currency = 'EUR' THEN amount ELSE 0 END), 0) AS eur,
               COUNT(*) AS count
        FROM public.payments
        WHERE status = 'recorded'
        GROUP BY tier
      ) t
    ),
    'by_method', (
      SELECT COALESCE(jsonb_agg(row_to_jsonb(m) ORDER BY m.method), '[]'::jsonb)
      FROM (
        SELECT method::text AS method,
               COALESCE(SUM(CASE WHEN currency = 'DZD' THEN amount ELSE 0 END), 0) AS dzd,
               COALESCE(SUM(CASE WHEN currency = 'EUR' THEN amount ELSE 0 END), 0) AS eur,
               COUNT(*) AS count
        FROM public.payments
        WHERE status = 'recorded' AND method IS NOT NULL
        GROUP BY method
      ) m
    ),
    'monthly', (
      SELECT COALESCE(jsonb_agg(row_to_jsonb(x) ORDER BY x.month), '[]'::jsonb)
      FROM (
        SELECT TO_CHAR(DATE_TRUNC('month', recorded_at), 'YYYY-MM') AS month,
               COALESCE(SUM(CASE WHEN currency = 'DZD' THEN amount ELSE 0 END), 0) AS dzd,
               COALESCE(SUM(CASE WHEN currency = 'EUR' THEN amount ELSE 0 END), 0) AS eur,
               COUNT(*) AS count
        FROM public.payments
        WHERE status = 'recorded'
          AND recorded_at >= (v_now - INTERVAL '12 months')
        GROUP BY DATE_TRUNC('month', recorded_at)
      ) x
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_accounting_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_accounting_stats() TO authenticated;

COMMIT;
