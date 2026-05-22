-- ============================================================================
-- DISCLAIMER GATE — mandatory non-skippable video before lessons access.
--
-- Spec :
--   - New students MUST watch a disclaimer video before accessing /lecons/*.
--   - Cannot be skipped (server-side wall-clock timer enforces minimum view time).
--   - Cannot be accelerated (VDOCipher player config locks playbackRates=[1.0]).
--   - Existing students see it once on next login (only admins auto-acked).
--   - Acknowledgment requires explicit checkbox + button click.
--   - User can re-watch later via Profile page (re-watch ≠ re-ack).
--
-- Anti-bypass strategy :
--   - Client calls start_disclaimer() → server stamps disclaimer_started_at = NOW().
--   - Client must wait MIN_DURATION seconds wall-clock before acknowledge_disclaimer()
--     will accept the call. Even if the user accelerates video via DevTools or
--     skips, the server timer is the actual gate.
--   - update_lesson_progress() also checks disclaimer is acknowledged
--     (belt + suspenders : even if route guard is bypassed, no progress can be
--     saved without ack).
--
-- Constants :
--   - DISCLAIMER_MIN_DURATION_SECONDS = 90 (matches medium-length video, 90s-3min).
--     Update this constant + redeploy if video duration changes.
-- ============================================================================

-- ── Step 1 : Add columns to profiles ─────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS disclaimer_started_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disclaimer_acknowledged_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.disclaimer_started_at IS
  'Disclaimer gate : when user first opened the /disclaimer page. Used as the wall-clock anchor for the server-side min-duration timer. NULL = never opened.';
COMMENT ON COLUMN profiles.disclaimer_acknowledged_at IS
  'Disclaimer gate : when user explicitly checked the consent box + clicked Continuer AND wall-clock timer was satisfied. NULL = not yet acknowledged → user blocked from lessons.';

-- ── Step 2 : Auto-acknowledge admins (they don't need to watch) ──────────────
UPDATE profiles
SET disclaimer_acknowledged_at = NOW()
WHERE is_admin = TRUE
  AND disclaimer_acknowledged_at IS NULL;

-- ── Step 3 : RPC start_disclaimer() ──────────────────────────────────────────
-- Called when /disclaimer page mounts. Stamps the started_at anchor for the
-- server-side timer. Idempotent : if user closes tab and re-opens, the timer
-- resets (intentional — we want THIS session to fulfill the minimum, not a
-- previous abandoned attempt).
CREATE OR REPLACE FUNCTION start_disclaimer()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_min_seconds INT := 90;  -- See DISCLAIMER_MIN_DURATION_SECONDS in comment above.
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  UPDATE profiles
  SET disclaimer_started_at = NOW()
  WHERE id = v_uid;

  RETURN json_build_object(
    'ok', true,
    'min_duration_seconds', v_min_seconds
  );
END;
$$;

GRANT EXECUTE ON FUNCTION start_disclaimer() TO authenticated;

COMMENT ON FUNCTION start_disclaimer() IS
  'Disclaimer gate : stamp disclaimer_started_at = NOW() for the calling user. Returns the minimum wall-clock duration the user must wait before acknowledge_disclaimer() will succeed.';


-- ── Step 4 : RPC acknowledge_disclaimer() ────────────────────────────────────
-- Called when user clicks Continuer (after checking the consent box).
-- Server-side validation :
--   1. disclaimer_started_at must be set (user actually opened /disclaimer)
--   2. NOW() - disclaimer_started_at >= MIN_DURATION (wall-clock gate)
--   3. p_consent_given must be true (explicit checkbox required)
-- On success : stamps disclaimer_acknowledged_at = NOW() + audit log entry.
CREATE OR REPLACE FUNCTION acknowledge_disclaimer(p_consent_given BOOLEAN)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_min_seconds INT := 90;
  v_started_at TIMESTAMPTZ;
  v_already_acked TIMESTAMPTZ;
  v_elapsed_sec NUMERIC;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  IF p_consent_given IS NOT TRUE THEN
    RETURN json_build_object('ok', false, 'error', 'CONSENT_REQUIRED');
  END IF;

  SELECT disclaimer_started_at, disclaimer_acknowledged_at
    INTO v_started_at, v_already_acked
    FROM profiles
    WHERE id = v_uid;

  -- Already acknowledged → idempotent success (no double-ack drama).
  IF v_already_acked IS NOT NULL THEN
    RETURN json_build_object('ok', true, 'already_acknowledged', true);
  END IF;

  IF v_started_at IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NEVER_STARTED');
  END IF;

  v_elapsed_sec := EXTRACT(EPOCH FROM (NOW() - v_started_at));
  IF v_elapsed_sec < v_min_seconds THEN
    RETURN json_build_object(
      'ok', false,
      'error', 'TOO_FAST',
      'elapsed_seconds', ROUND(v_elapsed_sec, 1),
      'min_seconds', v_min_seconds,
      'remaining_seconds', ROUND(v_min_seconds - v_elapsed_sec, 1)
    );
  END IF;

  -- All checks passed — mark acknowledged.
  UPDATE profiles
  SET disclaimer_acknowledged_at = NOW()
  WHERE id = v_uid;

  -- Audit log (legal evidence : timestamp + elapsed time + explicit consent).
  BEGIN
    INSERT INTO user_audit_logs (user_id, action, details)
    VALUES (
      v_uid,
      'disclaimer_acknowledged',
      jsonb_build_object(
        'elapsed_seconds', ROUND(v_elapsed_sec, 1),
        'min_seconds_required', v_min_seconds,
        'consent_given', p_consent_given
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'disclaimer ack audit log failed: %', SQLERRM;
  END;

  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION acknowledge_disclaimer(BOOLEAN) TO authenticated;

COMMENT ON FUNCTION acknowledge_disclaimer(BOOLEAN) IS
  'Disclaimer gate : validate wall-clock elapsed time + explicit consent, then mark acknowledged. Idempotent if already acknowledged. Writes user_audit_logs entry for legal evidence.';


-- ── Step 5 : Belt-and-suspenders on update_lesson_progress ───────────────────
-- Even if a malicious client bypasses the React route guard via direct API
-- call, no progress can be saved without disclaimer acknowledgment. This
-- closes the last possible bypass : "skip /disclaimer + directly POST to
-- /rest/v1/rpc/update_lesson_progress".
--
-- Note : we re-issue the full function definition (CREATE OR REPLACE) with
-- the new check at the top. Everything else stays identical to migration
-- 20260520000025 (R14-M15 capped_to removal).
CREATE OR REPLACE FUNCTION update_lesson_progress(
  p_lesson_id        UUID,
  p_watched_seconds  INT,
  p_position_seconds INT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid                UUID := auth.uid();
  v_disclaimer_acked   TIMESTAMPTZ;
  v_duration_min       INT;
  v_threshold_sec      INT;
  v_max_watched_sec    INT;
  v_prev_watched       INT := 0;
  v_prev_updated_at    TIMESTAMPTZ;
  v_max_plausible_inc  INT;
  v_clamped_inc        INT;
  v_clamped_watched    INT;
  v_completed          BOOLEAN;
  v_completed_at       TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  -- DISCLAIMER GATE : block all lesson progress writes until ack'd.
  SELECT disclaimer_acknowledged_at INTO v_disclaimer_acked
    FROM profiles WHERE id = v_uid;
  IF v_disclaimer_acked IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'DISCLAIMER_REQUIRED');
  END IF;

  IF p_lesson_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'LESSON_REQUIRED');
  END IF;

  IF p_watched_seconds  IS NULL OR p_watched_seconds  < 0 THEN p_watched_seconds  := 0; END IF;
  IF p_position_seconds IS NULL OR p_position_seconds < 0 THEN p_position_seconds := 0; END IF;

  SELECT duration_minutes INTO v_duration_min FROM lessons WHERE id = p_lesson_id;
  IF v_duration_min IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'LESSON_NOT_FOUND');
  END IF;

  v_threshold_sec   := (v_duration_min * 60 * 90) / 100;
  v_max_watched_sec := (v_duration_min * 60 * 120) / 100;

  IF p_watched_seconds > v_max_watched_sec THEN
    p_watched_seconds := v_max_watched_sec;
  END IF;
  IF p_position_seconds > v_max_watched_sec THEN
    p_position_seconds := v_max_watched_sec;
  END IF;

  SELECT watched_seconds, updated_at
    INTO v_prev_watched, v_prev_updated_at
    FROM lesson_progress
    WHERE user_id = v_uid AND lesson_id = p_lesson_id;

  IF FOUND AND p_watched_seconds > v_prev_watched THEN
    v_max_plausible_inc :=
      CEIL(EXTRACT(EPOCH FROM (NOW() - v_prev_updated_at)))::INT + 60;
    v_clamped_inc :=
      LEAST(p_watched_seconds - v_prev_watched, v_max_plausible_inc);
    v_clamped_watched := v_prev_watched + GREATEST(v_clamped_inc, 0);
  ELSE
    v_clamped_watched := p_watched_seconds;
  END IF;

  IF v_clamped_watched > v_max_watched_sec THEN
    v_clamped_watched := v_max_watched_sec;
  END IF;

  v_completed    := v_clamped_watched >= v_threshold_sec;
  v_completed_at := CASE WHEN v_completed THEN NOW() ELSE NULL END;

  INSERT INTO lesson_progress (
    user_id, lesson_id, watched_seconds, completed, completed_at,
    last_position_seconds, updated_at
  ) VALUES (
    v_uid, p_lesson_id, v_clamped_watched, v_completed, v_completed_at,
    p_position_seconds, NOW()
  )
  ON CONFLICT (user_id, lesson_id) DO UPDATE SET
    watched_seconds       = GREATEST(lesson_progress.watched_seconds, EXCLUDED.watched_seconds),
    completed             = lesson_progress.completed OR EXCLUDED.completed,
    completed_at          = COALESCE(lesson_progress.completed_at, EXCLUDED.completed_at),
    last_position_seconds = EXCLUDED.last_position_seconds,
    updated_at            = NOW();

  RETURN json_build_object(
    'ok', true,
    'completed', v_completed,
    'threshold_seconds', v_threshold_sec
  );
END;
$$;

GRANT EXECUTE ON FUNCTION update_lesson_progress(UUID, INT, INT) TO authenticated;

COMMENT ON FUNCTION update_lesson_progress(UUID, INT, INT) IS
  'R14-M15 + Disclaimer gate : update student progress. Caps at 120% of duration + wall-clock plausibility. NEW : rejects all writes if disclaimer_acknowledged_at is NULL (defense in depth against route-guard bypass).';
