-- Closer workflow hardening and reporting cut-over (26 August 2026).
--
-- Closers may update only their assigned prospect's operational status/note.
-- They may mark a prospect "confirmed", but they cannot mark it delivered,
-- create a delivery order, or count it as a sale. Delivery/order operations
-- remain admin-only. Every status change is written to the shared activity
-- stream with its note so admins see the same information.

BEGIN;

-- RPC-only writes for closers. Removes the legacy direct UPDATE escape hatch.
DROP POLICY IF EXISTS "Closers update assigned lead status and note" ON public.webinar_leads;

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
  v_is_admin boolean;
  v_status public.webinar_lead_status_enum;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 2000), '');
  v_updated integer := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_webinar_lead(v_uid, p_lead_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  v_is_admin := public.is_admin(v_uid);

  IF p_status IS NOT NULL THEN
    IF v_is_admin THEN
      IF p_status NOT IN ('to_call', 'nrp', 'callback', 'not_interested', 'confirmed', 'in_delivery', 'delivered', 'returned') THEN
        RAISE EXCEPTION 'STATUS_NOT_ALLOWED: %', p_status;
      END IF;
    ELSE
      -- A closer can confirm a customer/package, but only an admin or the
      -- trusted E-com synchronization may establish the delivered outcome.
      IF p_status NOT IN ('to_call', 'nrp', 'callback', 'not_interested', 'confirmed', 'returned') THEN
        RAISE EXCEPTION 'STATUS_NOT_ALLOWED: %', p_status;
      END IF;
    END IF;
    v_status := p_status::public.webinar_lead_status_enum;
  END IF;

  IF char_length(coalesce(p_note, '')) > 2000 THEN RAISE EXCEPTION 'NOTE_TOO_LONG'; END IF;

  UPDATE public.webinar_leads
  SET status = CASE WHEN p_status IS NULL THEN status ELSE v_status END,
      note = CASE WHEN p_update_note THEN v_note ELSE note END,
      latest_call_note = CASE WHEN p_status IS NOT NULL AND v_note IS NOT NULL THEN v_note ELSE latest_call_note END,
      last_call_at = CASE WHEN p_status IS NOT NULL THEN now() ELSE last_call_at END,
      updated_at = now()
  WHERE id = p_lead_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF p_status IS NOT NULL THEN
    INSERT INTO public.webinar_lead_activities(lead_id, activity_type, status, note, metadata, created_by)
    VALUES (
      p_lead_id, 'status', v_status, v_note,
      jsonb_build_object('scoped_rpc', true, 'actor', CASE WHEN v_is_admin THEN 'admin' ELSE 'closer' END),
      v_uid
    );
  END IF;
  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;
REVOKE ALL ON FUNCTION public.staff_update_webinar_lead(uuid, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_update_webinar_lead(uuid, text, text, boolean) TO authenticated;

-- Bulk status changes are an admin operation. In particular, a closer cannot
-- use the RPC directly to set delivered after the UI hides that option.
CREATE OR REPLACE FUNCTION public.admin_bulk_set_lead_status(p_lead_ids uuid[], p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status public.webinar_lead_status_enum;
  v_count integer := 0;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_lead_ids IS NULL OR array_length(p_lead_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'updated', 0);
  END IF;
  IF p_status NOT IN ('to_call', 'nrp', 'callback', 'not_interested', 'confirmed', 'in_delivery', 'delivered', 'returned') THEN
    RAISE EXCEPTION 'STATUS_NOT_ALLOWED: %', p_status;
  END IF;
  v_status := p_status::public.webinar_lead_status_enum;

  UPDATE public.webinar_leads SET status = v_status, updated_at = now() WHERE id = ANY(p_lead_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public.webinar_lead_activities(lead_id, activity_type, status, metadata, created_by)
  SELECT id, 'status', v_status, jsonb_build_object('bulk', true, 'actor', 'admin'), auth.uid()
  FROM public.webinar_leads WHERE id = ANY(p_lead_ids);
  RETURN jsonb_build_object('ok', true, 'updated', v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_bulk_set_lead_status(uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_bulk_set_lead_status(uuid[], text) TO authenticated;

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
  IF NOT public.is_admin(v_uid) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_lead_ids IS NULL OR array_length(p_lead_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'created', 0, 'skipped', 0);
  END IF;

  FOR v_lead IN SELECT * FROM public.webinar_leads WHERE id = ANY(p_lead_ids) FOR UPDATE
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
    VALUES (v_lead.id, 'delivery', 'in_delivery', jsonb_build_object('bulk', true, 'actor', 'admin'), v_uid);
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'created', v_created, 'skipped', v_skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_bulk_create_orders(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_bulk_create_orders(uuid[]) TO authenticated;

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
  v_lead public.webinar_leads%ROWTYPE;
  v_order_id uuid;
  v_created boolean := false;
  v_closer uuid;
  v_closer_name text;
BEGIN
  IF NOT public.is_admin(v_uid) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO v_lead FROM public.webinar_leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;

  SELECT auth_user_id, btrim(first_name || ' ' || last_name)
    INTO v_closer, v_closer_name
  FROM public.staff_members
  WHERE is_active AND lower(btrim(first_name || ' ' || last_name)) = lower(btrim(p_closer_name))
  LIMIT 1;
  v_closer := coalesce(v_closer, v_lead.closer_user_id);
  v_closer_name := coalesce(nullif(v_closer_name, ''), nullif(btrim(p_closer_name), ''), v_lead.closer_name);

  UPDATE public.webinar_leads
  SET status = p_status, closer_name = v_closer_name, closer_user_id = v_closer,
      call_count = call_count + 1, last_call_at = now(), next_follow_up_at = p_next_follow_up_at,
      latest_call_note = nullif(left(btrim(coalesce(p_note, '')), 2000), ''), updated_at = now()
  WHERE id = p_lead_id;
  INSERT INTO public.webinar_lead_activities(lead_id, activity_type, status, note, metadata, created_by)
  VALUES (
    p_lead_id, 'call', p_status, nullif(left(btrim(coalesce(p_note, '')), 2000), ''),
    jsonb_build_object('closer_name', v_closer_name, 'next_follow_up_at', p_next_follow_up_at, 'actor', 'admin'), v_uid
  );

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

-- Reporting starts at the agreed operational cut-over. A "confirmed" package
-- is kept separate from a sale; delivered is the only sale truth.
CREATE OR REPLACE FUNCTION public.admin_get_closer_performance()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_rows jsonb;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  WITH lead_stats AS (
    SELECT btrim(closer_name) AS closer, count(*)::int AS assigned,
           coalesce(sum(call_count), 0)::int AS calls
    FROM public.webinar_leads
    WHERE closer_name IS NOT NULL AND btrim(closer_name) <> ''
      AND created_at >= timestamptz '2026-08-26 00:00:00+01'
    GROUP BY btrim(closer_name)
  ), order_stats AS (
    SELECT btrim(l.closer_name) AS closer,
           count(DISTINCT o.webinar_lead_id)::int AS confirmed,
           count(*) FILTER (WHERE l.status = 'delivered')::int AS delivered,
           count(*) FILTER (WHERE l.status = 'returned')::int AS returned,
           coalesce(sum(o.cod_amount), 0) AS cod_confirmed,
           coalesce(sum(o.cod_amount) FILTER (WHERE l.status = 'delivered'), 0) AS cod_delivered
    FROM public.delivery_orders o
    JOIN public.webinar_leads l ON l.id = o.webinar_lead_id
    WHERE l.closer_name IS NOT NULL AND btrim(l.closer_name) <> ''
      AND l.created_at >= timestamptz '2026-08-26 00:00:00+01'
    GROUP BY btrim(l.closer_name)
  )
  SELECT coalesce(jsonb_agg(row ORDER BY (row->>'cod_delivered')::numeric DESC, (row->>'delivered')::int DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'closer_name', ls.closer, 'assigned', ls.assigned, 'calls', ls.calls,
      'confirmed', coalesce(os.confirmed, 0), 'delivered', coalesce(os.delivered, 0),
      'returned', coalesce(os.returned, 0), 'cod_confirmed', coalesce(os.cod_confirmed, 0),
      'cod_delivered', coalesce(os.cod_delivered, 0),
      'confirmation_rate', CASE WHEN ls.assigned = 0 THEN 0 ELSE round(coalesce(os.confirmed, 0)::numeric * 100 / ls.assigned, 1) END,
      'delivery_rate', CASE WHEN coalesce(os.confirmed, 0) = 0 THEN 0 ELSE round(coalesce(os.delivered, 0)::numeric * 100 / os.confirmed, 1) END
    ) AS row FROM lead_stats ls LEFT JOIN order_stats os ON os.closer = ls.closer
  ) t;

  RETURN jsonb_build_object(
    'ok', true, 'from_date', '2026-08-26', 'closers', v_rows,
    'totals', jsonb_build_object(
      'closers', (SELECT count(*)::int FROM (SELECT 1 FROM public.webinar_leads WHERE closer_name IS NOT NULL AND btrim(closer_name) <> '' AND created_at >= timestamptz '2026-08-26 00:00:00+01' GROUP BY btrim(closer_name)) c),
      'assigned', (SELECT count(*)::int FROM public.webinar_leads WHERE closer_name IS NOT NULL AND btrim(closer_name) <> '' AND created_at >= timestamptz '2026-08-26 00:00:00+01'),
      'calls', (SELECT coalesce(sum(call_count),0)::int FROM public.webinar_leads WHERE closer_name IS NOT NULL AND btrim(closer_name) <> '' AND created_at >= timestamptz '2026-08-26 00:00:00+01'),
      'confirmed', (SELECT count(DISTINCT o.webinar_lead_id)::int FROM public.delivery_orders o JOIN public.webinar_leads l ON l.id = o.webinar_lead_id WHERE l.closer_name IS NOT NULL AND btrim(l.closer_name) <> '' AND l.created_at >= timestamptz '2026-08-26 00:00:00+01'),
      'delivered', (SELECT count(*)::int FROM public.delivery_orders o JOIN public.webinar_leads l ON l.id = o.webinar_lead_id WHERE l.closer_name IS NOT NULL AND btrim(l.closer_name) <> '' AND l.created_at >= timestamptz '2026-08-26 00:00:00+01' AND l.status = 'delivered'),
      'cod_delivered', (SELECT coalesce(sum(o.cod_amount) FILTER (WHERE l.status = 'delivered'),0) FROM public.delivery_orders o JOIN public.webinar_leads l ON l.id = o.webinar_lead_id WHERE l.closer_name IS NOT NULL AND btrim(l.closer_name) <> '' AND l.created_at >= timestamptz '2026-08-26 00:00:00+01')
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_closer_performance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_closer_performance() TO authenticated;

COMMIT;
