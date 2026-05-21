-- ============================================================================
-- SHERLOCK R14 — C4 : reset certificate numbering per year.
--
-- BUG : migration 014 replaced COUNT(*)+1 (race-prone) by a GLOBAL sequence
-- `certificates_year_seq`. That fixed the race but introduced a different
-- bug : numbering does not reset on January 1st. Certificate #2025-0042
-- can be followed by #2026-0043, then #2026-0044 — which makes the year
-- portion redundant and breaks the implicit promise of the format
-- (Nth-cert-OF-the-year).
--
-- FIX : drop the per-year counter pretense ; use a LOCK TABLE + COUNT(*)
-- bounded to the current year. SHARE ROW EXCLUSIVE lock blocks concurrent
-- issuance (rare event — one new cert every few hours at most), so the
-- COUNT is safe. The lock is held for microseconds.
--
-- Format unchanged : `AUREL-{YYYY}-{NNNN}`. We DROP the sequence (no longer
-- used). Existing certificate_numbers are not rewritten — they stay as-is.
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_certificate_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_year INT := EXTRACT(YEAR FROM NOW())::INT;
  v_n    INT;
BEGIN
  -- SHARE ROW EXCLUSIVE blocks other writers (INSERT/UPDATE/DELETE) but
  -- allows concurrent reads. Two parallel cert issuances will serialize
  -- through this lock and see consistent COUNTs. Lock released at end of
  -- the transaction (which is the issuing INSERT INTO certificates).
  LOCK TABLE certificates IN SHARE ROW EXCLUSIVE MODE;

  SELECT COUNT(*) + 1 INTO v_n
  FROM certificates
  WHERE EXTRACT(YEAR FROM issued_at) = v_year;

  RETURN format('AUREL-%s-%s', v_year, lpad(v_n::TEXT, 4, '0'));
END;
$$;

COMMENT ON FUNCTION generate_certificate_number() IS
  'R14-C4 : counts certs in current year under a SHARE ROW EXCLUSIVE lock for atomic numbering. Format: AUREL-{YYYY}-{NNNN}. Resets every Jan 1.';

-- Drop the old global sequence — no longer used. Idempotent.
DROP SEQUENCE IF EXISTS certificates_year_seq;
