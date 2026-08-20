-- ============================================================================
-- Aurel Academy — WhatsApp rotation follow-up: reliable alerts + guardrail
-- ============================================================================
-- Follow-up to 20260819000057. Two additive changes, no behaviour change to the
-- assign path itself:
--
--   1. reset_rotation_alert(): lets the edge function UN-set an alert flag when
--      the alert email fails to send. assign_webinar_group() still flips the
--      flag to TRUE atomically (so concurrent leads never spam duplicates), but
--      if the email delivery fails the edge function calls this to flip it back
--      to FALSE — so the very next lead re-fires the alert. Net effect: alerts
--      are retried instead of being lost on a single Resend hiccup, with no
--      burst of duplicates (the flag is TRUE the moment it fires).
--
--   2. UNIQUE (funnel, position) guardrail: positions are already unique in
--      practice (assigned under the advisory lock), this just enforces it so a
--      stray manual insert can never make the round-robin order ambiguous.
-- ============================================================================

BEGIN;

-- 1. Guardrail: one position per funnel.
CREATE UNIQUE INDEX IF NOT EXISTS webinar_rotation_links_funnel_position_uidx
  ON public.webinar_rotation_links (funnel, position);

-- 2. Reset an alert flag so it can fire again (called by the edge function only
--    when the alert email failed to send). service_role only.
--      p_kind = 'near_full' + p_position → clears alerted_990 on that link
--      p_kind = 'all_full'               → clears all_full_alerted on the funnel
CREATE OR REPLACE FUNCTION public.reset_rotation_alert(
  p_funnel   TEXT,
  p_kind     TEXT,
  p_position INT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_funnel NOT IN ('immigration', 'tiktok') THEN
    RETURN json_build_object('ok', FALSE);
  END IF;

  -- Serialise with assign/admin writes on the same funnel.
  PERFORM pg_advisory_xact_lock(hashtext('wa-rot:' || p_funnel));

  IF p_kind = 'near_full' AND p_position IS NOT NULL THEN
    UPDATE public.webinar_rotation_links
    SET alerted_990 = FALSE
    WHERE funnel = p_funnel AND position = p_position AND status <> 'retired';
  ELSIF p_kind = 'all_full' THEN
    UPDATE public.webinar_rotation_state
    SET all_full_alerted = FALSE, updated_at = now()
    WHERE funnel = p_funnel;
  ELSE
    RETURN json_build_object('ok', FALSE);
  END IF;

  RETURN json_build_object('ok', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.reset_rotation_alert(TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_rotation_alert(TEXT, TEXT, INT) TO service_role;

COMMIT;
