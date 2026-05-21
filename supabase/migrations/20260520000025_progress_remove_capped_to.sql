-- ============================================================================
-- SHERLOCK R14 — M15 : drop `capped_to` from update_lesson_progress JSON
-- response.
--
-- BUG : the response from update_lesson_progress includes `capped_to`, which
-- exposes the server's internal anti-fraud clamp value. A client that's
-- being clamped knows exactly the max it can send AND knows the wall-clock
-- formula (NOW() - last_updated + 60s). With that information, a fraud
-- script can pace its calls to maximize watched_seconds increments without
-- ever being detected. Better : keep the clamp completely server-side and
-- return only the player-relevant flags (completed, threshold_seconds).
--
-- The clamping logic stays IDENTICAL to migration 013 (cap_watched_seconds).
-- Only the response shape changes. Capping events that would have leaked
-- could be picked up later via a Postgres NOTICE if needed — for now we
-- just keep the leak closed.
-- ============================================================================

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

  -- SHERLOCK R14 — M15 : on retire `capped_to` du JSON public. Le caller n'a
  -- pas besoin de la valeur exacte stockée — il sait s'il est completed et
  -- le threshold. Garder le cap interne sans le révéler ferme l'oracle de
  -- fraud-pacing.
  RETURN json_build_object(
    'ok', true,
    'completed', v_completed,
    'threshold_seconds', v_threshold_sec
  );
END;
$$;

GRANT EXECUTE ON FUNCTION update_lesson_progress(UUID, INT, INT) TO authenticated;

COMMENT ON FUNCTION update_lesson_progress(UUID, INT, INT) IS
  'R14-M15 : update student progress. Caps watched_seconds at 120% of duration AND limits per-call increment to wall-clock plausible. Response no longer exposes the clamped value (no fraud-pacing oracle).';
