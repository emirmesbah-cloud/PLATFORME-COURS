-- Aurel Academy — progression, staff-role and CRM order safety hardening.
-- Quizzes remain available for learning, but never gate the next lesson/module.

BEGIN;

-- staff_role/staff_permissions were added after the original immutable-field
-- guard. They are privileged just like is_admin and course_access.
CREATE OR REPLACE FUNCTION public.protect_profile_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.tier IS DISTINCT FROM OLD.tier THEN RAISE EXCEPTION 'Modification du tier interdite'; END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN RAISE EXCEPTION 'Modification de l''email interdite (passe par auth.users)'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'Modification de l''id interdite'; END IF;
  IF NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN RAISE EXCEPTION 'Modification de activated_at interdite'; END IF;
  IF NEW.email_opt_out_token IS DISTINCT FROM OLD.email_opt_out_token THEN
    RAISE EXCEPTION 'Modification de email_opt_out_token interdite';
  END IF;

  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Modification de is_admin interdite';
  END IF;
  IF NEW.course_access IS DISTINCT FROM OLD.course_access AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Modification de course_access interdite';
  END IF;
  IF (
    NEW.staff_role IS DISTINCT FROM OLD.staff_role
    OR NEW.staff_permissions IS DISTINCT FROM OLD.staff_permissions
  ) AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Modification du rôle staff interdite';
  END IF;
  IF (
    NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
    OR NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason
    OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by
  ) AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Modification de revoked_* interdite';
  END IF;

  RETURN NEW;
END;
$$;

-- Pflege: only the previous watched/completed lesson gates the next lesson.
CREATE OR REPLACE FUNCTION public.is_lesson_unlocked(p_user_id uuid, p_lesson_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_num integer;
  v_prev_id uuid;
  v_prev_done boolean;
BEGIN
  IF p_user_id IS NULL OR p_lesson_id IS NULL THEN RETURN false; END IF;
  IF public.is_admin(p_user_id) THEN RETURN true; END IF;

  SELECT lesson_number INTO v_target_num FROM public.lessons WHERE id = p_lesson_id;
  IF v_target_num IS NULL THEN RETURN false; END IF;
  IF v_target_num <= 1 THEN RETURN true; END IF;

  SELECT id INTO v_prev_id FROM public.lessons WHERE lesson_number = v_target_num - 1;
  IF v_prev_id IS NULL THEN RETURN true; END IF;

  SELECT completed INTO v_prev_done
  FROM public.lesson_progress
  WHERE user_id = p_user_id AND lesson_id = v_prev_id;
  RETURN coalesce(v_prev_done, false);
END;
$$;
REVOKE ALL ON FUNCTION public.is_lesson_unlocked(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_lesson_unlocked(uuid, uuid) TO authenticated;

-- Immigration: every lesson in the previous module must be marked completed.
-- Quiz attempts are intentionally excluded from the access decision.
CREATE OR REPLACE FUNCTION public.can_access_immigration_lesson(p_lesson_slug text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_module text;
  v_module_number integer;
  v_previous_module text;
  v_expected_count integer := 0;
  v_all_completed boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  IF public.is_admin(v_uid) THEN RETURN true; END IF;
  IF NOT public.has_course('immigration') THEN RETURN false; END IF;

  v_module := public.immigration_lesson_module(p_lesson_slug);
  IF v_module IS NULL THEN RETURN false; END IF;
  IF v_module IN ('module-0', 'niches', 'tutos') THEN RETURN true; END IF;
  IF v_module !~ '^module-[1-9][0-9]*$' THEN RETURN false; END IF;

  v_module_number := substring(v_module FROM '^module-([0-9]+)$')::integer;
  v_previous_module := 'module-' || (v_module_number - 1)::text;

  WITH expected AS (
    SELECT DISTINCT q.lesson_slug
    FROM public.immigration_quiz_questions q
    WHERE q.module_slug = v_previous_module
    UNION
    SELECT DISTINCT l.lesson_slug
    FROM public.immigration_lessons l
    WHERE l.lesson_slug ~ ('^' || (v_module_number - 1)::text || '-')
  ), completion AS (
    SELECT e.lesson_slug, EXISTS (
      SELECT 1
      FROM public.immigration_progress p
      WHERE p.user_id = v_uid
        AND p.lesson_slug = e.lesson_slug
        AND p.completed = true
    ) AS completed
    FROM expected e
  )
  SELECT count(*), coalesce(bool_and(completed), false)
  INTO v_expected_count, v_all_completed
  FROM completion;

  RETURN v_expected_count > 0 AND v_all_completed;
END;
$$;
REVOKE ALL ON FUNCTION public.can_access_immigration_lesson(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_immigration_lesson(text) TO authenticated;

-- Legacy admin follow-up remains compatible but can no longer create an order.
-- Orders are created only by admin_bulk_create_orders for Confirmé prospects.
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
  v_closer uuid;
  v_closer_name text;
BEGIN
  IF NOT public.is_admin(v_uid) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO v_lead FROM public.webinar_leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;

  SELECT auth_user_id, btrim(first_name || ' ' || last_name)
  INTO v_closer, v_closer_name
  FROM public.staff_members
  WHERE is_active
    AND lower(btrim(first_name || ' ' || last_name)) = lower(btrim(p_closer_name))
  LIMIT 1;
  v_closer := coalesce(v_closer, v_lead.closer_user_id);
  v_closer_name := coalesce(nullif(v_closer_name, ''), nullif(btrim(p_closer_name), ''), v_lead.closer_name);

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
  VALUES (
    p_lead_id, 'call', p_status,
    nullif(left(btrim(coalesce(p_note, '')), 2000), ''),
    jsonb_build_object('closer_name', v_closer_name, 'next_follow_up_at', p_next_follow_up_at, 'actor', 'admin', 'order_created', false),
    v_uid
  );

  SELECT id INTO v_order_id FROM public.delivery_orders WHERE webinar_lead_id = p_lead_id LIMIT 1;
  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id, 'created', false);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_log_webinar_call_with_order(uuid, public.webinar_lead_status_enum, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_log_webinar_call_with_order(uuid, public.webinar_lead_status_enum, text, text, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
