-- Aurel Academy — singleton YouTube Live destination for the readiness simulator.
--
-- The simulator points to one permanent Edge Function URL. Administrators
-- replace this single row, so an old destination can never remain active in
-- the application after a successful save.

CREATE TABLE IF NOT EXISTS public.readiness_simulator_settings (
  id          BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  live_url    TEXT NOT NULL DEFAULT 'https://www.youtube.com/channel/UCPPFO0edrI4sc6m4b9WTAdQ',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT readiness_live_url_length CHECK (char_length(live_url) BETWEEN 12 AND 2048),
  CONSTRAINT readiness_live_url_youtube CHECK (
    live_url ~* '^https://((www|m)\.)?youtube\.com(/|$)'
    OR live_url ~* '^https://youtu\.be(/|$)'
  )
);

INSERT INTO public.readiness_simulator_settings (id)
VALUES (TRUE)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.readiness_simulator_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.readiness_simulator_settings FROM anon, authenticated;
GRANT SELECT ON TABLE public.readiness_simulator_settings TO authenticated;

DROP POLICY IF EXISTS "Admins read readiness settings" ON public.readiness_simulator_settings;
CREATE POLICY "Admins read readiness settings"
  ON public.readiness_simulator_settings
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.admin_set_readiness_live_url(p_live_url TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_url       TEXT := btrim(coalesce(p_live_url, ''));
  v_previous  TEXT;
  v_row       public.readiness_simulator_settings%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF char_length(v_url) NOT BETWEEN 12 AND 2048
     OR v_url ~ '[[:space:][:cntrl:]]'
     OR NOT (
       v_url ~* '^https://((www|m)\.)?youtube\.com(/|$)'
       OR v_url ~* '^https://youtu\.be(/|$)'
     ) THEN
    RAISE EXCEPTION 'INVALID_YOUTUBE_URL';
  END IF;

  SELECT live_url INTO v_previous
  FROM public.readiness_simulator_settings
  WHERE id = TRUE
  FOR UPDATE;

  UPDATE public.readiness_simulator_settings
  SET live_url = v_url,
      updated_at = now(),
      updated_by = v_uid
  WHERE id = TRUE
  RETURNING * INTO v_row;

  INSERT INTO public.admin_audit_logs (
    admin_user_id, action_type, target_type, target_id, metadata
  ) VALUES (
    v_uid,
    'readiness_live_url_replaced',
    'readiness_simulator_settings',
    'current',
    jsonb_build_object('previous_url', v_previous, 'new_url', v_url)
  );

  RETURN jsonb_build_object(
    'id', v_row.id,
    'live_url', v_row.live_url,
    'updated_at', v_row.updated_at,
    'updated_by', v_row.updated_by
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_readiness_live_url(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_readiness_live_url(TEXT) TO authenticated;

COMMENT ON TABLE public.readiness_simulator_settings IS
  'Singleton current YouTube destination used by the readiness-live redirect.';
COMMENT ON FUNCTION public.admin_set_readiness_live_url(TEXT) IS
  'Atomically replaces the current readiness simulator YouTube destination; admin only and audited.';
