-- ============================================================================
-- Aurel Academy — WhatsApp GROUP ROTATION for the immigration + tiktok funnels
-- ============================================================================
-- ADDITIVE feature. Pflege keeps using webinar_groups (single link) untouched.
--
-- Today each webinar funnel points at ONE WhatsApp group (webinar_groups, one
-- row per slug). For IMMIGRATION and TIKTOK we replace that single link with a
-- round-robin rotation across MANY group links so leads are spread evenly and
-- no group is overfilled. Rotation model (confirmed):
--
--   * Round-robin per lead in add-order: lead1→link1, lead2→link2, … then loop.
--   * STICKY by hashed IP, 7-day expiry: a returning IP within 7 days always
--     goes back to the SAME group (even if it is now full/retired) and is NOT
--     re-counted. Past 7 days it is treated as a brand-new lead.
--   * Count = UNIQUE IPs sent to a group. A sticky return never increments.
--   * Per-group CAP = 1000. At 990 → one-time alert flag. At 1000 → auto full.
--   * LOTS: admins add links in batches. "Activer un nouveau lot" retires the
--     entire previous lot; "Ajouter au lot actif" appends to the running lot.
--     A retired/full link still honours existing stickies (members already in).
--   * All active links full & no new lot → keep sending to the LAST group of the
--     lot (overfill, never lose a lead) + all-full alert flag.
--   * Misconfiguration / no links → per-funnel EMERGENCY link fallback.
--   * Counting is ATOMIC: a per-funnel advisory lock serialises every decision.
--
-- The public NEVER reads these tables directly. The webinar-rotate edge function
-- (service_role) calls assign_webinar_group(); the merci page calls that edge
-- function with a shared secret. Admins manage links through the three admin
-- RPCs below, all is_admin-gated and audit-logged.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Helper: normalise a pasted value to a bare, validated WhatsApp group code.
-- Accepts EITHER a bare code OR a full https://chat.whatsapp.com/<code> URL
-- (also the legacy /invite/<code> form). Mirrors parseWhatsAppGroupCode() in
-- AdminWebinarGroups.tsx so the RPC is a second line of defence even if the UI
-- ever sends a raw URL. Raises on anything that is not a valid code.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wa_rotation_normalize_code(p_raw TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v TEXT;
BEGIN
  v := btrim(COALESCE(p_raw, ''));
  -- strip a full chat.whatsapp.com URL down to its code segment
  v := regexp_replace(v, '^https?://chat\.whatsapp\.com/(invite/)?', '', 'i');
  -- drop anything from the first path separator / query / fragment
  v := regexp_replace(v, '[/?#].*$', '');
  IF v ~ '^[A-Za-z0-9_-]{10,100}$' THEN
    RETURN v;
  END IF;
  RAISE EXCEPTION 'INVALID_WHATSAPP_CODE: %', p_raw;
END;
$$;
REVOKE ALL ON FUNCTION public.wa_rotation_normalize_code(TEXT) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- Table: webinar_rotation_links  — one row per WhatsApp group in the rotation.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webinar_rotation_links (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funnel           TEXT NOT NULL CHECK (funnel IN ('immigration', 'tiktok')),
  whatsapp_code    TEXT NOT NULL CHECK (whatsapp_code ~ '^[A-Za-z0-9_-]{10,100}$'),
  lot_number       INT  NOT NULL,
  position         INT  NOT NULL,                 -- add-order within the funnel
  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'full', 'retired')),
  unique_ip_count  INT  NOT NULL DEFAULT 0,
  alerted_990      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID                            -- admin who added the link
);

CREATE INDEX IF NOT EXISTS webinar_rotation_links_funnel_status_pos_idx
  ON public.webinar_rotation_links (funnel, status, position);

-- ----------------------------------------------------------------------------
-- Table: webinar_rotation_state  — one row per funnel; drives the round-robin.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webinar_rotation_state (
  funnel            TEXT PRIMARY KEY CHECK (funnel IN ('immigration', 'tiktok')),
  current_lot       INT    NOT NULL DEFAULT 1,
  assign_counter    BIGINT NOT NULL DEFAULT 0,     -- drives round-robin
  emergency_code    TEXT,                          -- per-funnel fallback code
  all_full_alerted  BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Table: webinar_rotation_stickies  — hashed-IP → group memory (7-day TTL).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webinar_rotation_stickies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funnel       TEXT NOT NULL,
  ip_hash      TEXT NOT NULL,      -- sha256('webinar-rotation:'||funnel||':'||ip)
  link_id      UUID NOT NULL REFERENCES public.webinar_rotation_links(id) ON DELETE CASCADE,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (funnel, ip_hash)         -- also serves as the (funnel, ip_hash) index
);

-- ----------------------------------------------------------------------------
-- SEED — keep both funnels working the instant this ships.
--   * a state row for immigration and tiktok
--   * the CURRENT live group (from webinar_groups) as lot #1, position 1, active
-- Idempotent: re-running never duplicates the seed link and never resets state.
-- ----------------------------------------------------------------------------
INSERT INTO public.webinar_rotation_state (funnel)
VALUES ('immigration'), ('tiktok')
ON CONFLICT (funnel) DO NOTHING;

INSERT INTO public.webinar_rotation_links (funnel, whatsapp_code, lot_number, position, status)
SELECT g.slug, g.whatsapp_group_code, 1, 1, 'active'
FROM public.webinar_groups g
WHERE g.slug IN ('immigration', 'tiktok')
  AND NOT EXISTS (
    SELECT 1 FROM public.webinar_rotation_links l WHERE l.funnel = g.slug
  );

-- ============================================================================
-- RLS — admins may READ links + state (for the dashboard). No direct writes:
-- every mutation goes through the SECURITY DEFINER admin RPCs below. The public
-- never touches these tables; it goes through the edge function (service_role).
-- Stickies are never exposed to the browser at all.
-- ============================================================================
ALTER TABLE public.webinar_rotation_links    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webinar_rotation_state    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webinar_rotation_stickies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.webinar_rotation_links    FROM anon, authenticated;
REVOKE ALL ON TABLE public.webinar_rotation_state    FROM anon, authenticated;
REVOKE ALL ON TABLE public.webinar_rotation_stickies FROM anon, authenticated;

GRANT SELECT ON TABLE public.webinar_rotation_links TO authenticated;
GRANT SELECT ON TABLE public.webinar_rotation_state TO authenticated;

DROP POLICY IF EXISTS "Admins read rotation links" ON public.webinar_rotation_links;
CREATE POLICY "Admins read rotation links"
  ON public.webinar_rotation_links
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins read rotation state" ON public.webinar_rotation_state;
CREATE POLICY "Admins read rotation state"
  ON public.webinar_rotation_state
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- (webinar_rotation_stickies: RLS on, no policy → authenticated/anon get nothing;
--  service_role bypasses RLS for the edge function.)

-- ============================================================================
-- RPC: assign_webinar_group(p_funnel, p_ip_hash, p_mode) RETURNS json
--   service_role only. Atomic per funnel (advisory xact lock). Sticky TTL 7d.
--   Returns: { code, source, near_full, all_full }.
--     source ∈ sticky | assigned | last_full | emergency | none | test | preview
--     near_full ∈ null | { position, lot, count }   (fire ONE 990/1000 alert)
--     all_full  ∈ bool                              (fire ONE all-full alert)
--   The RPC only FLAGS alerts; the edge function actually emails Amir.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.assign_webinar_group(
  p_funnel  TEXT,
  p_ip_hash TEXT,
  p_mode    TEXT DEFAULT 'assign'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state     public.webinar_rotation_state%ROWTYPE;
  v_link      public.webinar_rotation_links%ROWTYPE;
  v_sticky    public.webinar_rotation_stickies%ROWTYPE;
  v_n         INT;
  v_idx       INT;
  v_new_count INT;
  v_near_full JSON := NULL;
  v_all_full  BOOLEAN := FALSE;
  v_code      TEXT;
BEGIN
  IF p_funnel NOT IN ('immigration', 'tiktok') THEN
    RETURN json_build_object('code', NULL, 'source', 'none', 'near_full', NULL, 'all_full', FALSE);
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('assign', 'preview', 'test') THEN
    p_mode := 'assign';
  END IF;

  -- Atomicity: serialise every rotation decision for this funnel. Released at
  -- transaction end (each PostgREST RPC call is its own transaction).
  PERFORM pg_advisory_xact_lock(hashtext('wa-rot:' || p_funnel));

  SELECT * INTO v_state FROM public.webinar_rotation_state WHERE funnel = p_funnel;
  IF NOT FOUND THEN
    INSERT INTO public.webinar_rotation_state (funnel) VALUES (p_funnel)
    ON CONFLICT (funnel) DO NOTHING;
    SELECT * INTO v_state FROM public.webinar_rotation_state WHERE funnel = p_funnel;
  END IF;

  -- ── TEST / PREVIEW : pick a target WITHOUT counting or writing a sticky ────
  -- Used for admin testing and for bot / link-preview crawlers so they never
  -- burn a slot. Prefer first active link; else last full link; else emergency.
  IF p_mode IN ('test', 'preview') THEN
    SELECT whatsapp_code INTO v_code
    FROM public.webinar_rotation_links
    WHERE funnel = p_funnel AND status = 'active'
    ORDER BY position
    LIMIT 1;

    IF v_code IS NULL THEN
      SELECT whatsapp_code INTO v_code
      FROM public.webinar_rotation_links
      WHERE funnel = p_funnel AND status = 'full'
      ORDER BY position DESC
      LIMIT 1;
    END IF;

    IF v_code IS NULL THEN
      v_code := v_state.emergency_code;
    END IF;

    RETURN json_build_object('code', v_code, 'source', p_mode, 'near_full', NULL, 'all_full', FALSE);
  END IF;

  -- ── ASSIGN ────────────────────────────────────────────────────────────────
  -- 1. sticky lookup (valid = seen within the last 7 days)
  SELECT * INTO v_sticky FROM public.webinar_rotation_stickies
  WHERE funnel = p_funnel AND ip_hash = p_ip_hash;
  IF FOUND THEN
    IF v_sticky.last_seen_at > (now() - INTERVAL '7 days') THEN
      UPDATE public.webinar_rotation_stickies SET last_seen_at = now() WHERE id = v_sticky.id;
      SELECT whatsapp_code INTO v_code FROM public.webinar_rotation_links WHERE id = v_sticky.link_id;
      RETURN json_build_object('code', v_code, 'source', 'sticky', 'near_full', NULL, 'all_full', FALSE);
    ELSE
      -- expired → forget it and treat this IP as a fresh lead
      DELETE FROM public.webinar_rotation_stickies WHERE id = v_sticky.id;
    END IF;
  END IF;

  -- 2. active links, in add-order
  SELECT count(*) INTO v_n FROM public.webinar_rotation_links
  WHERE funnel = p_funnel AND status = 'active';

  -- 3. round-robin over active links
  IF v_n > 0 THEN
    v_idx := (v_state.assign_counter % v_n)::INT;

    SELECT * INTO v_link FROM public.webinar_rotation_links
    WHERE funnel = p_funnel AND status = 'active'
    ORDER BY position
    OFFSET v_idx LIMIT 1;

    v_new_count := v_link.unique_ip_count + 1;

    UPDATE public.webinar_rotation_state
    SET assign_counter = assign_counter + 1, updated_at = now()
    WHERE funnel = p_funnel;

    -- one-time 990/1000 near-full alert flag (snapshot alerted_990 = FALSE)
    IF v_new_count >= 990 AND NOT v_link.alerted_990 THEN
      v_near_full := json_build_object('position', v_link.position, 'lot', v_link.lot_number, 'count', v_new_count);
    END IF;

    UPDATE public.webinar_rotation_links
    SET unique_ip_count = v_new_count,
        alerted_990     = (alerted_990 OR v_new_count >= 990),
        status          = CASE WHEN v_new_count >= 1000 THEN 'full' ELSE status END
    WHERE id = v_link.id;

    INSERT INTO public.webinar_rotation_stickies (funnel, ip_hash, link_id, assigned_at, last_seen_at)
    VALUES (p_funnel, p_ip_hash, v_link.id, now(), now())
    ON CONFLICT (funnel, ip_hash) DO UPDATE
      SET link_id = EXCLUDED.link_id, assigned_at = now(), last_seen_at = now();

    -- if that click just filled the LAST active link → one all-full alert
    IF v_new_count >= 1000
       AND NOT v_state.all_full_alerted
       AND NOT EXISTS (
         SELECT 1 FROM public.webinar_rotation_links
         WHERE funnel = p_funnel AND status = 'active'
       ) THEN
      v_all_full := TRUE;
      UPDATE public.webinar_rotation_state SET all_full_alerted = TRUE, updated_at = now()
      WHERE funnel = p_funnel;
    END IF;

    RETURN json_build_object(
      'code', v_link.whatsapp_code, 'source', 'assigned',
      'near_full', v_near_full, 'all_full', v_all_full
    );
  END IF;

  -- 4. no active links left
  -- 4a. current lot has full links → send to the LAST one (overfill, never lose
  --     a lead) and fire the all-full alert once.
  SELECT * INTO v_link FROM public.webinar_rotation_links
  WHERE funnel = p_funnel AND status = 'full' AND lot_number = v_state.current_lot
  ORDER BY position DESC
  LIMIT 1;
  IF FOUND THEN
    IF NOT v_state.all_full_alerted THEN
      v_all_full := TRUE;
      UPDATE public.webinar_rotation_state SET all_full_alerted = TRUE, updated_at = now()
      WHERE funnel = p_funnel;
    END IF;
    RETURN json_build_object('code', v_link.whatsapp_code, 'source', 'last_full', 'near_full', NULL, 'all_full', v_all_full);
  END IF;

  -- 4b. emergency fallback
  IF v_state.emergency_code IS NOT NULL THEN
    RETURN json_build_object('code', v_state.emergency_code, 'source', 'emergency', 'near_full', NULL, 'all_full', FALSE);
  END IF;

  -- 4c. nothing configured at all
  RETURN json_build_object('code', NULL, 'source', 'none', 'near_full', NULL, 'all_full', FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.assign_webinar_group(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_webinar_group(TEXT, TEXT, TEXT) TO service_role;

-- ============================================================================
-- ADMIN RPCs — is_admin-gated, audit-logged. Called from the dashboard.
-- ============================================================================

-- add_rotation_links: append one or more links to the CURRENT lot (no retire).
CREATE OR REPLACE FUNCTION public.add_rotation_links(p_funnel TEXT, p_codes TEXT[])
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_lot   INT;
  v_pos   INT;
  v_code  TEXT;
  v_norm  TEXT;
  v_added INT := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_funnel NOT IN ('immigration', 'tiktok') THEN
    RAISE EXCEPTION 'INVALID_FUNNEL: %', p_funnel;
  END IF;
  IF p_codes IS NULL OR array_length(p_codes, 1) IS NULL THEN
    RAISE EXCEPTION 'NO_CODES';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('wa-rot:' || p_funnel));

  INSERT INTO public.webinar_rotation_state (funnel) VALUES (p_funnel) ON CONFLICT (funnel) DO NOTHING;
  SELECT current_lot INTO v_lot FROM public.webinar_rotation_state WHERE funnel = p_funnel;
  SELECT COALESCE(max(position), 0) INTO v_pos FROM public.webinar_rotation_links WHERE funnel = p_funnel;

  FOREACH v_code IN ARRAY p_codes LOOP
    v_norm := public.wa_rotation_normalize_code(v_code);
    v_pos  := v_pos + 1;
    INSERT INTO public.webinar_rotation_links (funnel, whatsapp_code, lot_number, position, status, created_by)
    VALUES (p_funnel, v_norm, v_lot, v_pos, 'active', v_uid);
    v_added := v_added + 1;
  END LOOP;

  INSERT INTO public.admin_audit_logs (admin_user_id, action_type, target_type, target_id, metadata)
  VALUES (v_uid, 'webinar_rotation_links_added', 'webinar_rotation', p_funnel,
          jsonb_build_object('lot', v_lot, 'count', v_added));

  RETURN json_build_object('ok', TRUE, 'added', v_added, 'lot', v_lot);
END;
$$;
REVOKE ALL ON FUNCTION public.add_rotation_links(TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_rotation_links(TEXT, TEXT[]) TO authenticated;

-- start_new_rotation_lot: RETIRE every current link (active AND full), bump the
-- lot, reset the round-robin counter + all-full flag, then insert the new lot as
-- the only active rotation. Existing stickies still resolve to their old group.
CREATE OR REPLACE FUNCTION public.start_new_rotation_lot(p_funnel TEXT, p_codes TEXT[])
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_new_lot INT;
  v_pos     INT;
  v_code    TEXT;
  v_norm    TEXT;
  v_added   INT := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_funnel NOT IN ('immigration', 'tiktok') THEN
    RAISE EXCEPTION 'INVALID_FUNNEL: %', p_funnel;
  END IF;
  IF p_codes IS NULL OR array_length(p_codes, 1) IS NULL THEN
    RAISE EXCEPTION 'NO_CODES';   -- a new lot must contain at least one link
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('wa-rot:' || p_funnel));

  -- retire ALL current links (even non-full ones)
  UPDATE public.webinar_rotation_links
  SET status = 'retired'
  WHERE funnel = p_funnel AND status <> 'retired';

  -- bump lot, reset counter + all-full flag
  INSERT INTO public.webinar_rotation_state (funnel, current_lot)
  VALUES (p_funnel, 2)
  ON CONFLICT (funnel) DO UPDATE
    SET current_lot      = webinar_rotation_state.current_lot + 1,
        assign_counter   = 0,
        all_full_alerted = FALSE,
        updated_at       = now()
  RETURNING current_lot INTO v_new_lot;

  SELECT COALESCE(max(position), 0) INTO v_pos FROM public.webinar_rotation_links WHERE funnel = p_funnel;

  FOREACH v_code IN ARRAY p_codes LOOP
    v_norm := public.wa_rotation_normalize_code(v_code);
    v_pos  := v_pos + 1;
    INSERT INTO public.webinar_rotation_links (funnel, whatsapp_code, lot_number, position, status, created_by)
    VALUES (p_funnel, v_norm, v_new_lot, v_pos, 'active', v_uid);
    v_added := v_added + 1;
  END LOOP;

  INSERT INTO public.admin_audit_logs (admin_user_id, action_type, target_type, target_id, metadata)
  VALUES (v_uid, 'webinar_rotation_lot_started', 'webinar_rotation', p_funnel,
          jsonb_build_object('new_lot', v_new_lot, 'count', v_added));

  RETURN json_build_object('ok', TRUE, 'lot', v_new_lot, 'added', v_added);
END;
$$;
REVOKE ALL ON FUNCTION public.start_new_rotation_lot(TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_new_rotation_lot(TEXT, TEXT[]) TO authenticated;

-- set_emergency_link: per-funnel fallback code. Empty/null clears it.
CREATE OR REPLACE FUNCTION public.set_emergency_link(p_funnel TEXT, p_code TEXT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_norm TEXT;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_funnel NOT IN ('immigration', 'tiktok') THEN
    RAISE EXCEPTION 'INVALID_FUNNEL: %', p_funnel;
  END IF;

  IF btrim(COALESCE(p_code, '')) = '' THEN
    v_norm := NULL;
  ELSE
    v_norm := public.wa_rotation_normalize_code(p_code);
  END IF;

  INSERT INTO public.webinar_rotation_state (funnel, emergency_code)
  VALUES (p_funnel, v_norm)
  ON CONFLICT (funnel) DO UPDATE
    SET emergency_code = EXCLUDED.emergency_code, updated_at = now();

  INSERT INTO public.admin_audit_logs (admin_user_id, action_type, target_type, target_id, metadata)
  VALUES (v_uid, 'webinar_rotation_emergency_set', 'webinar_rotation', p_funnel,
          jsonb_build_object('has_code', v_norm IS NOT NULL));

  RETURN json_build_object('ok', TRUE, 'code', v_norm);
END;
$$;
REVOKE ALL ON FUNCTION public.set_emergency_link(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_emergency_link(TEXT, TEXT) TO authenticated;

COMMENT ON TABLE public.webinar_rotation_links IS
  'WhatsApp group links in the round-robin rotation for the immigration + tiktok funnels. Managed by admins via SECURITY DEFINER RPCs; read by the webinar-rotate edge function (service_role).';
COMMENT ON TABLE public.webinar_rotation_state IS
  'Per-funnel rotation state: current lot, round-robin counter, emergency fallback code, all-full alert flag.';
COMMENT ON TABLE public.webinar_rotation_stickies IS
  'Hashed-IP → assigned group memory (7-day TTL). A returning IP within 7 days reaches the same group and is never re-counted. Never exposed to the browser.';

COMMIT;
