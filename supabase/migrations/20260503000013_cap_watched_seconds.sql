-- ============================================================================
-- 20260503000013_cap_watched_seconds.sql
--
-- BUGFIX (Sherlock audit) : update_lesson_progress trustait p_watched_seconds
-- côté client. Un étudiant pouvait appeler 18 fois la RPC avec
-- watched_seconds=999999 → toutes les leçons "complétées" (seuil = 90% durée),
-- trigger lesson_progress_check_certificate déclenché → certificat délivré
-- en quelques secondes.
--
-- Fix :
--   1. Cap p_watched_seconds à `duration_minutes * 60 * 1.2` (120% de la
--      durée, tolérance pour replay/skip mais pas plus). Pas de moyen de
--      "watcher" 999999 secondes une leçon de 10 minutes.
--   2. Empêche un increment > wall-clock plausible : on accepte un
--      incrément max de (NOW() - lesson_progress.updated_at + 60s) entre
--      deux calls. Au-delà → on clamp.
--
-- Note : la précision réelle viendra avec l'intégration VDOCipher player.js
-- timeupdate events (côté frontend). Cette migration est la défense en
-- profondeur — quand les vidéos seront uploadées, même un client modifié ne
-- pourra pas frauder via cette RPC.
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
  v_max_watched_sec    INT;          -- cap dur : 120% de la durée
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

  -- Clamp valeurs négatives (input cleansing)
  IF p_watched_seconds  IS NULL OR p_watched_seconds  < 0 THEN p_watched_seconds  := 0; END IF;
  IF p_position_seconds IS NULL OR p_position_seconds < 0 THEN p_position_seconds := 0; END IF;

  -- Récup durée de la leçon
  SELECT duration_minutes INTO v_duration_min FROM lessons WHERE id = p_lesson_id;
  IF v_duration_min IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'LESSON_NOT_FOUND');
  END IF;

  v_threshold_sec   := (v_duration_min * 60 * 90) / 100;       -- 90% durée → completed
  v_max_watched_sec := (v_duration_min * 60 * 120) / 100;      -- 120% durée → cap absolu

  -- Cap absolu : impossible de "watcher" plus de 120% de la durée d'une leçon.
  -- Couvre le cas trivial du client qui envoie watched=999999.
  IF p_watched_seconds > v_max_watched_sec THEN
    p_watched_seconds := v_max_watched_sec;
  END IF;
  -- Cap position aussi (évite les valeurs absurdes en DB)
  IF p_position_seconds > v_max_watched_sec THEN
    p_position_seconds := v_max_watched_sec;
  END IF;

  -- Anti-fraud secondaire : limite l'incrément depuis le dernier update.
  -- Lit le state actuel pour ce (user, lesson). Si le delta entre l'ancien
  -- watched et le nouveau dépasse (NOW - updated_at + 60s), c'est suspect
  -- (un humain qui regarde la vidéo ne peut pas avancer de 30 minutes en
  -- 5 secondes wall-clock). On clamp à une valeur plausible.
  --
  -- Tolérance +60s pour absorber les drifts de clock client/serveur et les
  -- updates batch en fin de session.
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

  -- Ré-applique le cap absolu après le clamping (defense en profondeur).
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
    -- watched_seconds est cumulatif : on garde le max pour ne pas régresser.
    watched_seconds       = GREATEST(lesson_progress.watched_seconds, EXCLUDED.watched_seconds),
    completed             = lesson_progress.completed OR EXCLUDED.completed,
    completed_at          = COALESCE(lesson_progress.completed_at, EXCLUDED.completed_at),
    last_position_seconds = EXCLUDED.last_position_seconds,
    updated_at            = NOW();

  RETURN json_build_object(
    'ok', true,
    'completed', v_completed,
    'threshold_seconds', v_threshold_sec,
    'capped_to', v_clamped_watched
  );
END;
$$;

-- GRANT inchangé (déjà accordé en mig 004), mais on ré-applique pour
-- garantir la cohérence si quelqu'un applique cette migration sur un
-- environnement où le GRANT a été révoqué manuellement.
GRANT EXECUTE ON FUNCTION update_lesson_progress(UUID, INT, INT) TO authenticated;

COMMENT ON FUNCTION update_lesson_progress(UUID, INT, INT) IS
  'Update student progress on a lesson. Caps watched_seconds at 120% of duration AND limits per-call increment to wall-clock plausible.';
