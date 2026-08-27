-- Durable CRM timelines, truthful closer performance, manual order handoff,
-- and realtime refresh for the prospect/order dashboards.

BEGIN;

-- Every closer status change is one follow-up event. The optional call attempt
-- (1..5) is stored on the immutable activity, while the lead keeps only the
-- latest status/note for fast list rendering.
DROP FUNCTION IF EXISTS public.staff_update_webinar_lead(uuid, text, text, boolean, timestamptz);
CREATE FUNCTION public.staff_update_webinar_lead(
  p_lead_id uuid,
  p_status text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_update_note boolean DEFAULT false,
  p_next_follow_up_at timestamptz DEFAULT NULL,
  p_call_attempt integer DEFAULT NULL
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

  IF char_length(coalesce(p_note, '')) > 2000 THEN RAISE EXCEPTION 'NOTE_TOO_LONG'; END IF;
  IF p_call_attempt IS NOT NULL AND (p_call_attempt < 1 OR p_call_attempt > 5) THEN
    RAISE EXCEPTION 'CALL_ATTEMPT_INVALID';
  END IF;

  IF p_status IS NOT NULL THEN
    IF v_is_admin THEN
      IF p_status NOT IN ('to_call', 'nrp', 'callback', 'not_interested', 'confirmed', 'in_delivery', 'delivered', 'returned') THEN
        RAISE EXCEPTION 'STATUS_NOT_ALLOWED: %', p_status;
      END IF;
    ELSE
      IF p_status NOT IN ('to_call', 'nrp', 'callback', 'not_interested', 'confirmed', 'returned') THEN
        RAISE EXCEPTION 'STATUS_NOT_ALLOWED: %', p_status;
      END IF;
      IF p_status <> 'confirmed' AND v_note IS NULL THEN RAISE EXCEPTION 'NOTE_REQUIRED'; END IF;
    END IF;
    IF p_status = 'callback' AND p_next_follow_up_at IS NULL THEN
      RAISE EXCEPTION 'FOLLOW_UP_DATE_REQUIRED';
    END IF;
    v_status := p_status::public.webinar_lead_status_enum;
  END IF;

  UPDATE public.webinar_leads
  SET status = CASE WHEN p_status IS NULL THEN status ELSE v_status END,
      note = CASE WHEN p_update_note THEN v_note ELSE note END,
      call_count = CASE WHEN p_status IS NOT NULL AND NOT v_is_admin THEN call_count + 1 ELSE call_count END,
      latest_call_note = CASE
        WHEN p_status IS NOT NULL AND v_note IS NOT NULL THEN v_note
        ELSE latest_call_note
      END,
      last_call_at = CASE WHEN p_status IS NOT NULL THEN now() ELSE last_call_at END,
      next_follow_up_at = CASE
        WHEN p_status = 'callback' THEN p_next_follow_up_at
        WHEN p_status IS NOT NULL THEN NULL
        ELSE next_follow_up_at
      END,
      updated_at = now()
  WHERE id = p_lead_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF p_status IS NOT NULL THEN
    INSERT INTO public.webinar_lead_activities(lead_id, activity_type, status, note, metadata, created_by)
    VALUES (
      p_lead_id,
      CASE WHEN v_is_admin THEN 'status' ELSE 'call' END,
      v_status,
      v_note,
      jsonb_build_object(
        'scoped_rpc', true,
        'actor', CASE WHEN v_is_admin THEN 'admin' ELSE 'closer' END,
        'call_attempt', CASE WHEN p_status = 'callback' THEN p_call_attempt ELSE NULL END,
        'next_follow_up_at', CASE WHEN p_status = 'callback' THEN p_next_follow_up_at ELSE NULL END
      ),
      v_uid
    );
  END IF;
  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;
REVOKE ALL ON FUNCTION public.staff_update_webinar_lead(uuid, text, text, boolean, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_update_webinar_lead(uuid, text, text, boolean, timestamptz, integer) TO authenticated;

-- One scoped RPC gives admins and the assigned closer the exact same immutable
-- timeline, including actor, note, reminder date and optional call number.
CREATE OR REPLACE FUNCTION public.staff_get_webinar_lead_history(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_history jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_webinar_lead(auth.uid(), p_lead_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'lead_id', a.lead_id,
    'activity_type', a.activity_type,
    'status', a.status,
    'note', a.note,
    'metadata', a.metadata,
    'created_by', a.created_by,
    'actor_name', coalesce(
      nullif(btrim(p.first_name || ' ' || p.last_name), ''),
      nullif(btrim(s.first_name || ' ' || s.last_name), ''),
      CASE WHEN a.created_by IS NULL THEN 'Système' ELSE 'Équipe Aurel' END
    ),
    'created_at', a.created_at
  ) ORDER BY a.created_at DESC), '[]'::jsonb)
  INTO v_history
  FROM public.webinar_lead_activities a
  LEFT JOIN public.profiles p ON p.id = a.created_by
  LEFT JOIN public.staff_members s ON s.auth_user_id = a.created_by
  WHERE a.lead_id = p_lead_id;

  RETURN v_history;
END;
$$;
REVOKE ALL ON FUNCTION public.staff_get_webinar_lead_history(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_get_webinar_lead_history(uuid) TO authenticated;

-- A prospect must first be Confirmé before an admin can create its order.
-- Creating the order still never rewrites the independent CRM status.
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
    IF v_lead.status <> 'confirmed' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    SELECT id INTO v_order FROM public.delivery_orders WHERE webinar_lead_id = v_lead.id LIMIT 1;
    IF v_order IS NOT NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

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

    INSERT INTO public.webinar_lead_activities(lead_id, activity_type, status, note, metadata, created_by)
    VALUES (
      v_lead.id, 'delivery', v_lead.status,
      'Commande interne créée sans modifier le statut CRM',
      jsonb_build_object('bulk', true, 'actor', 'admin', 'crm_status_preserved', true),
      v_uid
    );
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'created', v_created, 'skipped', v_skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_bulk_create_orders(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_bulk_create_orders(uuid[]) TO authenticated;

-- Performance is based on all manually assigned leads and the immutable call
-- timeline. Confirmations remain credited after delivery/return because the
-- confirmation event is historical rather than inferred from the current row.
CREATE OR REPLACE FUNCTION public.admin_get_closer_performance()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  WITH roster AS (
    SELECT btrim(first_name || ' ' || last_name) AS closer
    FROM public.staff_members WHERE role = 'closer' AND is_active
    UNION
    SELECT btrim(closer_name) FROM public.webinar_leads
    WHERE closer_name IS NOT NULL AND btrim(closer_name) <> ''
  ), event_rollup AS (
    SELECT l.id AS lead_id,
      count(a.id) FILTER (
        WHERE a.activity_type = 'call' OR a.metadata->>'actor' = 'closer'
      )::int AS timeline_calls,
      bool_or(
        a.status = 'confirmed' AND (
          a.created_by = l.closer_user_id
          OR a.metadata->>'actor' = 'closer'
          OR lower(btrim(coalesce(a.metadata->>'closer_name', ''))) = lower(btrim(coalesce(l.closer_name, '')))
        )
      ) AS closer_confirmed
    FROM public.webinar_leads l
    LEFT JOIN public.webinar_lead_activities a ON a.lead_id = l.id
    GROUP BY l.id
  ), lead_stats AS (
    SELECT btrim(l.closer_name) AS closer,
      count(*)::int AS assigned,
      coalesce(sum(greatest(l.call_count, coalesce(e.timeline_calls, 0))), 0)::int AS calls,
      count(*) FILTER (WHERE coalesce(e.closer_confirmed, false))::int AS confirmed,
      count(*) FILTER (WHERE l.status = 'delivered')::int AS delivered,
      count(*) FILTER (WHERE l.status = 'returned')::int AS returned
    FROM public.webinar_leads l
    LEFT JOIN event_rollup e ON e.lead_id = l.id
    WHERE l.closer_name IS NOT NULL AND btrim(l.closer_name) <> ''
    GROUP BY btrim(l.closer_name)
  ), order_stats AS (
    SELECT btrim(l.closer_name) AS closer,
      coalesce(sum(o.cod_amount), 0) AS cod_confirmed,
      coalesce(sum(o.cod_amount) FILTER (WHERE l.status = 'delivered'), 0) AS cod_delivered
    FROM public.delivery_orders o
    JOIN public.webinar_leads l ON l.id = o.webinar_lead_id
    WHERE l.closer_name IS NOT NULL AND btrim(l.closer_name) <> ''
    GROUP BY btrim(l.closer_name)
  ), rows AS (
    SELECT r.closer AS closer_name,
      coalesce(ls.assigned, 0)::int AS assigned,
      coalesce(ls.calls, 0)::int AS calls,
      coalesce(ls.confirmed, 0)::int AS confirmed,
      coalesce(ls.delivered, 0)::int AS delivered,
      coalesce(ls.returned, 0)::int AS returned,
      coalesce(os.cod_confirmed, 0) AS cod_confirmed,
      coalesce(os.cod_delivered, 0) AS cod_delivered,
      CASE WHEN coalesce(ls.assigned, 0) = 0 THEN 0
        ELSE round(coalesce(ls.confirmed, 0)::numeric * 100 / ls.assigned, 1) END AS confirmation_rate,
      CASE WHEN coalesce(ls.confirmed, 0) = 0 THEN 0
        ELSE round(coalesce(ls.delivered, 0)::numeric * 100 / ls.confirmed, 1) END AS delivery_rate
    FROM roster r
    LEFT JOIN lead_stats ls ON lower(ls.closer) = lower(r.closer)
    LEFT JOIN order_stats os ON lower(os.closer) = lower(r.closer)
  )
  SELECT jsonb_build_object(
    'ok', true,
    'closers', coalesce((SELECT jsonb_agg(to_jsonb(rows) ORDER BY cod_delivered DESC, delivered DESC, closer_name) FROM rows), '[]'::jsonb),
    'totals', jsonb_build_object(
      'closers', (SELECT count(*)::int FROM rows),
      'assigned', (SELECT coalesce(sum(assigned), 0)::int FROM rows),
      'calls', (SELECT coalesce(sum(calls), 0)::int FROM rows),
      'confirmed', (SELECT coalesce(sum(confirmed), 0)::int FROM rows),
      'delivered', (SELECT coalesce(sum(delivered), 0)::int FROM rows),
      'cod_delivered', (SELECT coalesce(sum(cod_delivered), 0) FROM rows)
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_closer_performance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_closer_performance() TO authenticated;

-- Ensure dashboard changes arrive immediately instead of waiting for polling.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'webinar_leads') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.webinar_leads;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'webinar_lead_activities') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.webinar_lead_activities;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'delivery_orders') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_orders;
  END IF;
END $$;

COMMIT;
