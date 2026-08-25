-- Strict, lead-by-lead closer rotation.
--
-- The previous assignment selected the closer with the smallest actionable
-- workload.  That was fair by volume, but it was not a predictable
-- A -> B -> C -> A rotation.  A locked singleton counter now assigns every
-- new, unassigned webinar lead to the next eligible closer.

CREATE TABLE IF NOT EXISTS public.webinar_lead_assignment_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  assign_counter bigint NOT NULL DEFAULT 0 CHECK (assign_counter >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.webinar_lead_assignment_state(singleton, assign_counter)
VALUES (true, 0)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.webinar_lead_assignment_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.webinar_lead_assignment_state FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.webinar_lead_assignment_state IS
  'Private singleton counter used to assign new webinar leads to eligible closers in strict rotation.';

CREATE OR REPLACE FUNCTION public.auto_assign_webinar_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_staff public.staff_members%ROWTYPE;
  v_staff_count bigint;
  v_counter bigint;
BEGIN
  -- An explicit admin/import assignment always wins and does not consume a
  -- turn in the automatic rotation.
  IF NEW.closer_user_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.webinar_lead_assignment_state(singleton, assign_counter)
  VALUES (true, 0)
  ON CONFLICT (singleton) DO NOTHING;

  -- The row lock serializes simultaneous form submissions. Two leads cannot
  -- read the same turn, even when they arrive in the same millisecond.
  SELECT assign_counter
  INTO v_counter
  FROM public.webinar_lead_assignment_state
  WHERE singleton = true
  FOR UPDATE;

  SELECT count(*)
  INTO v_staff_count
  FROM public.staff_members s
  WHERE s.is_active = true
    AND s.auth_user_id IS NOT NULL
    AND 'prospects' = ANY(s.permissions);

  IF v_staff_count = 0 THEN
    RETURN NEW;
  END IF;

  SELECT s.*
  INTO v_staff
  FROM public.staff_members s
  WHERE s.is_active = true
    AND s.auth_user_id IS NOT NULL
    AND 'prospects' = ANY(s.permissions)
  ORDER BY s.created_at, s.id
  OFFSET mod(v_counter, v_staff_count)
  LIMIT 1;

  UPDATE public.webinar_lead_assignment_state
  SET assign_counter = assign_counter + 1,
      updated_at = now()
  WHERE singleton = true;

  NEW.closer_user_id := v_staff.auth_user_id;
  NEW.closer_name := btrim(v_staff.first_name || ' ' || v_staff.last_name);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_assign_webinar_lead() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.auto_assign_webinar_lead() IS
  'Assigns each new unassigned webinar lead to the next active prospects closer using an atomic round-robin counter.';

