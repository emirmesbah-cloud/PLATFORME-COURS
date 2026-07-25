-- Return accounting rows through an explicitly admin-guarded function.
-- The direct PostgREST embed returned an empty list in production even though
-- admin_get_accounting_stats saw the same 15 payment rows.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_list_payments(
  p_status TEXT DEFAULT NULL,
  p_tier TEXT DEFAULT NULL,
  p_method TEXT DEFAULT NULL,
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL
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

  SELECT COALESCE(
    jsonb_agg(row_data ORDER BY created_at DESC),
    '[]'::jsonb
  )
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
            ELSE jsonb_build_object('code', ac.code)
          END
        ) AS row_data
    FROM public.payments p
    LEFT JOIN public.profiles pr ON pr.id = p.user_id
    LEFT JOIN public.activation_codes ac ON ac.id = p.activation_code_id
    WHERE (p_status IS NULL OR p.status::TEXT = p_status)
      AND (p_tier IS NULL OR p.tier::TEXT = p_tier)
      AND (p_method IS NULL OR p.method::TEXT = p_method)
      AND (p_from IS NULL OR p.created_at >= p_from)
      AND (p_to IS NULL OR p.created_at < p_to)
    ORDER BY p.created_at DESC
    LIMIT 2000
  ) rows;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_payments(
  TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_payments(
  TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
