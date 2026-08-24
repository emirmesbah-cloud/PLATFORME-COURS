-- ============================================================================
-- Aurel Academy — Sherlock security/reliability hardening
-- ============================================================================
-- 1. Closers are read-only through RLS; every write goes through scoped RPCs.
-- 2. Security-definer CRM RPCs verify ownership for non-admin closers.
-- 3. New/open leads are distributed automatically across active closers.
-- 4. Public form throttling and duplicate detection become atomic.
-- 5. Admin student statistics exclude staff accounts.
-- ============================================================================

BEGIN;

-- ── Lead authorization helper ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_manage_webinar_lead(p_user_id uuid, p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_admin(p_user_id)
    OR (
      public.has_staff_permission(p_user_id, 'prospects')
      AND EXISTS (
        SELECT 1 FROM public.webinar_leads l
        WHERE l.id = p_lead_id AND l.closer_user_id = p_user_id
      )
    );
$$;
REVOKE ALL ON FUNCTION public.can_manage_webinar_lead(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_webinar_lead(uuid, uuid) TO authenticated;

-- Closers may SELECT their assigned rows. They cannot directly INSERT, UPDATE
-- or DELETE a lead, which prevents changing closer_user_id or protected fields
-- through PostgREST. Scoped RPCs below expose only the intended operations.
DROP POLICY IF EXISTS "Staff prospect access" ON public.webinar_leads;
DROP POLICY IF EXISTS "Admin full webinar leads" ON public.webinar_leads;
DROP POLICY IF EXISTS "Admins manage webinar leads" ON public.webinar_leads;
DROP POLICY IF EXISTS "Closers read assigned webinar leads" ON public.webinar_leads;

CREATE POLICY "Admins manage webinar leads"
  ON public.webinar_leads FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Closers read assigned webinar leads"
  ON public.webinar_leads FOR SELECT TO authenticated
  USING (
    public.has_staff_permission(auth.uid(), 'prospects')
    AND closer_user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Staff add webinar lead activities" ON public.webinar_lead_activities;
DROP POLICY IF EXISTS "Admin add webinar lead activities" ON public.webinar_lead_activities;
CREATE POLICY "Admins add webinar lead activities"
  ON public.webinar_lead_activities FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()) AND created_by = auth.uid());

-- ── Narrow single-row update RPC ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.staff_update_webinar_lead(
  p_lead_id uuid,
  p_status text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_update_note boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status public.webinar_lead_status_enum;
  v_updated integer := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_webinar_lead(v_uid, p_lead_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_status IS NOT NULL THEN
    IF p_status NOT IN ('to_call', 'nrp', 'callback', 'not_interested', 'delivered', 'returned') THEN
      RAISE EXCEPTION 'STATUS_NOT_ALLOWED: %', p_status;
    END IF;
    v_status := p_status::public.webinar_lead_status_enum;
  END IF;
  IF p_update_note AND char_length(coalesce(p_note, '')) > 2000 THEN
    RAISE EXCEPTION 'NOTE_TOO_LONG';
  END IF;

  UPDATE public.webinar_leads
  SET status = CASE WHEN p_status IS NULL THEN status ELSE v_status END,
      note = CASE WHEN p_update_note THEN nullif(btrim(coalesce(p_note, '')), '') ELSE note END,
      updated_at = now()
  WHERE id = p_lead_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF p_status IS NOT NULL THEN
    INSERT INTO public.webinar_lead_activities(lead_id, activity_type, status, metadata, created_by)
    VALUES (p_lead_id, 'status', v_status, jsonb_build_object('scoped_rpc', true), v_uid);
  END IF;
  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;
REVOKE ALL ON FUNCTION public.staff_update_webinar_lead(uuid, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_update_webinar_lead(uuid, text, text, boolean) TO authenticated;

-- ── Scoped bulk status update ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_bulk_set_lead_status(p_lead_ids uuid[], p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status public.webinar_lead_status_enum;
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.has_staff_permission(v_uid, 'prospects') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_lead_ids IS NULL OR array_length(p_lead_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'updated', 0);
  END IF;
  IF p_status NOT IN ('to_call', 'nrp', 'callback', 'not_interested', 'delivered', 'returned') THEN
    RAISE EXCEPTION 'STATUS_NOT_ALLOWED: %', p_status;
  END IF;
  v_status := p_status::public.webinar_lead_status_enum;

  IF NOT public.is_admin(v_uid) AND EXISTS (
    SELECT 1 FROM unnest(p_lead_ids) requested(id)
    WHERE NOT public.can_manage_webinar_lead(v_uid, requested.id)
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  UPDATE public.webinar_leads
  SET status = v_status, updated_at = now()
  WHERE id = ANY(p_lead_ids)
    AND public.can_manage_webinar_lead(v_uid, id);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.webinar_lead_activities(lead_id, activity_type, status, metadata, created_by)
  SELECT id, 'status', v_status, jsonb_build_object('bulk', true, 'scoped_rpc', true), v_uid
  FROM public.webinar_leads
  WHERE id = ANY(p_lead_ids) AND public.can_manage_webinar_lead(v_uid, id);

  RETURN jsonb_build_object('ok', true, 'updated', v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_bulk_set_lead_status(uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_bulk_set_lead_status(uuid[], text) TO authenticated;

-- ── Scoped bulk order creation ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_bulk_create_orders(p_lead_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lead public.webinar_leads%ROWTYPE;
  v_order uuid;
  v_created integer := 0;
  v_skipped integer := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.has_staff_permission(v_uid, 'prospects') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_lead_ids IS NULL OR array_length(p_lead_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'created', 0, 'skipped', 0);
  END IF;
  IF NOT public.is_admin(v_uid) AND EXISTS (
    SELECT 1 FROM unnest(p_lead_ids) requested(id)
    WHERE NOT public.can_manage_webinar_lead(v_uid, requested.id)
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  FOR v_lead IN
    SELECT * FROM public.webinar_leads
    WHERE id = ANY(p_lead_ids) AND public.can_manage_webinar_lead(v_uid, id)
    FOR UPDATE
  LOOP
    SELECT id INTO v_order FROM public.delivery_orders WHERE webinar_lead_id = v_lead.id LIMIT 1;
    IF v_order IS NOT NULL THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    INSERT INTO public.delivery_orders(
      customer_name, mobile_1, wilaya_id, wilaya_name, commune, delivery_mode,
      address, course, article, quantity, cod_amount, supplier_notes,
      webinar_lead_id, created_by
    ) VALUES (
      left(btrim(v_lead.full_name), 60), v_lead.phone_normalized,
      v_lead.wilaya_id, v_lead.wilaya_name, v_lead.commune, 'domicile',
      nullif(left(btrim(coalesce(v_lead.address, '')), 100), ''),
      'immigration', 'Programme Aurel Academy — Immigration', 1, 38000,
      'Interdiction d''ouvrir le colis', v_lead.id, v_uid
    );
    v_created := v_created + 1;

    UPDATE public.webinar_leads SET status = 'in_delivery', updated_at = now() WHERE id = v_lead.id;
    INSERT INTO public.webinar_lead_activities(lead_id, activity_type, status, metadata, created_by)
    VALUES (v_lead.id, 'delivery', 'in_delivery', jsonb_build_object('bulk', true, 'scoped_rpc', true), v_uid);
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'created', v_created, 'skipped', v_skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_bulk_create_orders(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_bulk_create_orders(uuid[]) TO authenticated;

-- ── Scoped call + order workflow ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_log_webinar_call_with_order(
  p_lead_id uuid,
  p_status public.webinar_lead_status_enum,
  p_closer_name text,
  p_note text DEFAULT NULL,
  p_next_follow_up_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_lead public.webinar_leads%ROWTYPE;
  v_order_id uuid;
  v_created boolean := false;
  v_closer uuid;
  v_closer_name text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_staff_permission(v_uid, 'prospects') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  v_is_admin := public.is_admin(v_uid);
  SELECT * INTO v_lead FROM public.webinar_leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  IF NOT v_is_admin AND v_lead.closer_user_id IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  IF v_is_admin THEN
    SELECT auth_user_id, btrim(first_name || ' ' || last_name)
      INTO v_closer, v_closer_name
    FROM public.staff_members
    WHERE is_active AND lower(btrim(first_name || ' ' || last_name)) = lower(btrim(p_closer_name))
    LIMIT 1;
    v_closer := coalesce(v_closer, v_lead.closer_user_id);
    v_closer_name := coalesce(nullif(v_closer_name, ''), nullif(btrim(p_closer_name), ''), v_lead.closer_name);
  ELSE
    v_closer := v_uid;
    SELECT nullif(btrim(first_name || ' ' || last_name), '') INTO v_closer_name
    FROM public.profiles WHERE id = v_uid;
    v_closer_name := coalesce(v_closer_name, v_lead.closer_name, 'Closer');
  END IF;

  UPDATE public.webinar_leads
  SET status = p_status,
      closer_name = v_closer_name,
      closer_user_id = v_closer,
      call_count = call_count + 1,
      last_call_at = now(),
      next_follow_up_at = p_next_follow_up_at,
      latest_call_note = nullif(left(btrim(coalesce(p_note, '')), 2000), ''),
      updated_at = now()
  WHERE id = p_lead_id;

  INSERT INTO public.webinar_lead_activities(lead_id, activity_type, status, note, metadata, created_by)
  VALUES (p_lead_id, 'call', p_status, nullif(left(btrim(coalesce(p_note, '')), 2000), ''),
    jsonb_build_object('closer_name', v_closer_name, 'next_follow_up_at', p_next_follow_up_at, 'scoped_rpc', true), v_uid);

  SELECT id INTO v_order_id FROM public.delivery_orders WHERE webinar_lead_id = p_lead_id LIMIT 1;
  IF v_order_id IS NULL THEN
    INSERT INTO public.delivery_orders(
      customer_name, mobile_1, wilaya_id, wilaya_name, commune, delivery_mode,
      address, course, article, quantity, cod_amount, supplier_notes,
      webinar_lead_id, created_by
    ) VALUES (
      left(btrim(v_lead.full_name), 60), v_lead.phone_normalized,
      v_lead.wilaya_id, v_lead.wilaya_name, v_lead.commune, 'domicile',
      nullif(left(btrim(coalesce(v_lead.address, '')), 100), ''),
      'immigration', 'Programme Aurel Academy — Immigration', 1, 38000,
      'Interdiction d''ouvrir le colis', p_lead_id, v_uid
    ) RETURNING id INTO v_order_id;
    v_created := true;
  END IF;
  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id, 'created', v_created);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_log_webinar_call_with_order(uuid, public.webinar_lead_status_enum, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_log_webinar_call_with_order(uuid, public.webinar_lead_status_enum, text, text, timestamptz) TO authenticated;

-- ── Automatic fair assignment ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_assign_webinar_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_staff public.staff_members%ROWTYPE;
BEGIN
  IF NEW.closer_user_id IS NOT NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('aurel:webinar:auto-assign'));
  SELECT s.* INTO v_staff
  FROM public.staff_members s
  LEFT JOIN public.webinar_leads l
    ON l.closer_user_id = s.auth_user_id
   AND l.status IN ('to_call', 'nrp', 'callback')
  WHERE s.is_active = true
    AND s.auth_user_id IS NOT NULL
    AND 'prospects' = ANY(s.permissions)
  GROUP BY s.id
  ORDER BY count(l.id), s.created_at, s.id
  LIMIT 1;
  IF FOUND THEN
    NEW.closer_user_id := v_staff.auth_user_id;
    NEW.closer_name := btrim(v_staff.first_name || ' ' || v_staff.last_name);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS webinar_leads_auto_assign ON public.webinar_leads;
CREATE TRIGGER webinar_leads_auto_assign
BEFORE INSERT ON public.webinar_leads
FOR EACH ROW EXECUTE FUNCTION public.auto_assign_webinar_lead();

-- Backfill only actionable, unassigned prospects. Delivered/returned/archive
-- rows remain historical and do not pollute closer work queues.
WITH active_staff AS (
  SELECT auth_user_id, btrim(first_name || ' ' || last_name) AS closer_name,
         row_number() OVER (ORDER BY created_at, id) AS rn,
         count(*) OVER () AS staff_count
  FROM public.staff_members
  WHERE is_active AND auth_user_id IS NOT NULL AND 'prospects' = ANY(permissions)
), open_leads AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM public.webinar_leads
  WHERE closer_user_id IS NULL AND status IN ('to_call', 'nrp', 'callback')
), assignments AS (
  SELECT l.id, s.auth_user_id, s.closer_name
  FROM open_leads l
  JOIN active_staff s ON s.rn = ((l.rn - 1) % s.staff_count) + 1
)
UPDATE public.webinar_leads l
SET closer_user_id = a.auth_user_id, closer_name = a.closer_name, updated_at = now()
FROM assignments a WHERE l.id = a.id;

-- ── Atomic public form controls ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.consume_webinar_lead_rate_limit(
  p_key_hash text,
  p_max_requests integer DEFAULT 30,
  p_window interval DEFAULT interval '1 hour'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_count integer;
BEGIN
  INSERT INTO public.webinar_lead_rate_limits(key_hash, window_started_at, request_count, updated_at)
  VALUES (p_key_hash, now(), 1, now())
  ON CONFLICT (key_hash) DO UPDATE
  SET request_count = CASE
        WHEN webinar_lead_rate_limits.window_started_at <= now() - p_window THEN 1
        ELSE webinar_lead_rate_limits.request_count + 1
      END,
      window_started_at = CASE
        WHEN webinar_lead_rate_limits.window_started_at <= now() - p_window THEN now()
        ELSE webinar_lead_rate_limits.window_started_at
      END,
      updated_at = now()
  RETURNING request_count INTO v_count;
  RETURN v_count <= greatest(1, p_max_requests);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_webinar_lead_rate_limit(text, integer, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_webinar_lead_rate_limit(text, integer, interval) TO service_role;

CREATE OR REPLACE FUNCTION public.service_insert_webinar_lead(
  p_full_name text,
  p_phone_raw text,
  p_phone_normalized text,
  p_email text,
  p_ready_to_pay boolean,
  p_wilaya_id integer,
  p_wilaya_name text,
  p_commune text,
  p_address text,
  p_extra_answers jsonb DEFAULT '{}'::jsonb,
  p_allow_duplicate boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid; v_created_at timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('aurel:webinar:phone:' || p_phone_normalized, 0));
  IF NOT p_allow_duplicate THEN
    SELECT id INTO v_id FROM public.webinar_leads
    WHERE phone_normalized = p_phone_normalized
    ORDER BY created_at DESC LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'duplicate', true, 'id', v_id);
    END IF;
  END IF;

  INSERT INTO public.webinar_leads(
    full_name, phone_raw, phone_normalized, email, ready_to_pay,
    wilaya_id, wilaya_name, commune, address, status, source, extra_answers
  ) VALUES (
    p_full_name, p_phone_raw, p_phone_normalized, p_email, p_ready_to_pay,
    p_wilaya_id, p_wilaya_name, p_commune, p_address, 'to_call', 'youtube_live',
    coalesce(p_extra_answers, '{}'::jsonb)
  ) RETURNING id, created_at INTO v_id, v_created_at;
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'id', v_id, 'created_at', v_created_at);
END;
$$;
REVOKE ALL ON FUNCTION public.service_insert_webinar_lead(text,text,text,text,boolean,integer,text,text,text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.service_insert_webinar_lead(text,text,text,text,boolean,integer,text,text,text,jsonb,boolean) TO service_role;

-- ── Accurate student-only dashboard stats ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_total_students integer;
  v_active_week integer;
  v_codes_total integer;
  v_codes_used integer;
  v_avg_completion numeric;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_ADMIN');
  END IF;

  SELECT count(*) INTO v_total_students
  FROM public.profiles
  WHERE is_admin = false AND staff_role = 'student' AND revoked_at IS NULL;

  SELECT count(*) INTO v_active_week
  FROM public.profiles p
  WHERE p.is_admin = false AND p.staff_role = 'student' AND p.revoked_at IS NULL
    AND (
      p.last_login_at > now() - interval '7 days'
      OR EXISTS (SELECT 1 FROM public.lesson_progress lp WHERE lp.user_id = p.id AND lp.updated_at > now() - interval '7 days')
      OR EXISTS (SELECT 1 FROM public.immigration_progress ip WHERE ip.user_id = p.id AND ip.updated_at > now() - interval '7 days')
    );

  SELECT count(*), count(*) FILTER (WHERE is_used = true)
  INTO v_codes_total, v_codes_used FROM public.activation_codes;

  SELECT coalesce(avg(progress_pct), 0) INTO v_avg_completion
  FROM (
    SELECT p.id,
      CASE WHEN p.course_access = 'immigration' THEN
        least(100, (SELECT count(*) FILTER (WHERE ip.completed)::numeric FROM public.immigration_progress ip WHERE ip.user_id = p.id) * 100 / 61)
      ELSE
        least(100, (SELECT count(*) FILTER (WHERE lp.completed)::numeric FROM public.lesson_progress lp WHERE lp.user_id = p.id) * 100 /
          greatest(1, (SELECT count(*) FROM public.lessons WHERE is_published = true)))
      END AS progress_pct
    FROM public.profiles p
    WHERE p.is_admin = false AND p.staff_role = 'student' AND p.revoked_at IS NULL
  ) student_progress;

  RETURN json_build_object(
    'ok', true,
    'total_students', v_total_students,
    'active_week', v_active_week,
    'codes_total', v_codes_total,
    'codes_used', v_codes_used,
    'codes_available', v_codes_total - v_codes_used,
    'avg_completion', round(v_avg_completion, 1)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_stats() TO authenticated;

COMMIT;
