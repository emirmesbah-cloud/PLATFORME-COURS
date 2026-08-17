-- Admin operations suite: durable dossier references, closers, configurable
-- webinar form, custom lessons and E-com deletion evidence.

BEGIN;

-- PDF dossier references are independent from activation codes. The previous
-- printed batch ended at 0057, therefore the next generated code receives 0058.
CREATE SEQUENCE IF NOT EXISTS public.activation_dossier_reference_seq
  AS BIGINT START WITH 58 INCREMENT BY 1 MINVALUE 58;

ALTER TABLE public.activation_codes
  ADD COLUMN IF NOT EXISTS document_reference_number BIGINT;
ALTER TABLE public.activation_codes
  ALTER COLUMN document_reference_number
  SET DEFAULT nextval('public.activation_dossier_reference_seq');
CREATE UNIQUE INDEX IF NOT EXISTS activation_codes_document_reference_unique
  ON public.activation_codes(document_reference_number)
  WHERE document_reference_number IS NOT NULL;

-- Staff access. Admins keep full access; closers are restricted to the CRM.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS staff_role TEXT NOT NULL DEFAULT 'student',
  ADD COLUMN IF NOT EXISTS staff_permissions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_staff_role_check
    CHECK (staff_role IN ('student', 'closer', 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE public.profiles
SET staff_role = 'admin', staff_permissions = ARRAY['*']::TEXT[]
WHERE is_admin = TRUE;

CREATE TABLE IF NOT EXISTS public.staff_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL CHECK (char_length(btrim(first_name)) BETWEEN 1 AND 60),
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL UNIQUE,
  whatsapp TEXT,
  role TEXT NOT NULL DEFAULT 'closer' CHECK (role IN ('closer')),
  permissions TEXT[] NOT NULL DEFAULT ARRAY['prospects']::TEXT[],
  tasks TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.staff_members(first_name, last_name, email, permissions)
VALUES
  ('Rym', '', 'messyryma@gmail.com', ARRAY['prospects']::TEXT[]),
  ('Djihane', '', 'djihanesedour@gmail.com', ARRAY['prospects']::TEXT[]),
  ('Hana', '', 'hanabenabderrahim0@gmail.com', ARRAY['prospects']::TEXT[])
ON CONFLICT (email) DO UPDATE SET
  first_name = EXCLUDED.first_name,
  permissions = EXCLUDED.permissions,
  is_active = TRUE,
  updated_at = now();

-- Link already-existing accounts, and automatically link a future invited
-- closer as soon as their profile is created.
UPDATE public.staff_members s
SET auth_user_id = p.id, updated_at = now()
FROM public.profiles p
WHERE lower(p.email) = lower(s.email) AND s.auth_user_id IS NULL;

UPDATE public.profiles p
SET staff_role = 'closer', staff_permissions = s.permissions
FROM public.staff_members s
WHERE s.auth_user_id = p.id AND s.is_active AND p.is_admin = FALSE;

CREATE OR REPLACE FUNCTION public.sync_staff_profile()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_staff public.staff_members%ROWTYPE;
BEGIN
  SELECT * INTO v_staff FROM public.staff_members
  WHERE lower(email) = lower(NEW.email) AND is_active LIMIT 1;
  IF FOUND AND NEW.is_admin = FALSE THEN
    UPDATE public.staff_members SET auth_user_id = NEW.id, updated_at = now() WHERE id = v_staff.id;
    NEW.staff_role := 'closer';
    NEW.staff_permissions := v_staff.permissions;
  ELSIF NEW.is_admin THEN
    NEW.staff_role := 'admin';
    NEW.staff_permissions := ARRAY['*']::TEXT[];
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_sync_staff ON public.profiles;
CREATE TRIGGER profiles_sync_staff BEFORE INSERT OR UPDATE OF email, is_admin
ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.sync_staff_profile();

CREATE OR REPLACE FUNCTION public.has_staff_permission(user_id UUID, permission_name TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT COALESCE((
    SELECT revoked_at IS NULL AND (
      is_admin = TRUE OR
      (staff_role = 'closer' AND permission_name = ANY(staff_permissions))
    ) FROM public.profiles WHERE id = user_id
  ), FALSE);
$$;
REVOKE ALL ON FUNCTION public.has_staff_permission(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_staff_permission(UUID, TEXT) TO authenticated;

ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage staff" ON public.staff_members;
CREATE POLICY "Admins manage staff" ON public.staff_members FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- Closers can only work in Prospects. Delivery creation remains encapsulated
-- in the security-definer CRM function; they cannot browse Commandes.
DROP POLICY IF EXISTS "Admin full webinar leads" ON public.webinar_leads;
CREATE POLICY "Staff prospect access" ON public.webinar_leads FOR ALL TO authenticated
  USING (public.has_staff_permission(auth.uid(), 'prospects'))
  WITH CHECK (public.has_staff_permission(auth.uid(), 'prospects'));
DROP POLICY IF EXISTS "Admin read webinar lead activities" ON public.webinar_lead_activities;
CREATE POLICY "Staff read webinar lead activities" ON public.webinar_lead_activities FOR SELECT TO authenticated
  USING (public.has_staff_permission(auth.uid(), 'prospects'));
DROP POLICY IF EXISTS "Admin add webinar lead activities" ON public.webinar_lead_activities;
CREATE POLICY "Staff add webinar lead activities" ON public.webinar_lead_activities FOR INSERT TO authenticated
  WITH CHECK (public.has_staff_permission(auth.uid(), 'prospects') AND created_by = auth.uid());

-- Webinar form configuration and dynamic fields. The backup webhook is read
-- only by the service-role Edge Function and admins, never by public clients.
CREATE TABLE IF NOT EXISTS public.webinar_form_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  eyebrow TEXT NOT NULL DEFAULT 'Formulaire après le webinar',
  title TEXT NOT NULL DEFAULT 'Tes informations',
  description TEXT NOT NULL DEFAULT 'Simple et rapide — environ 1 minute.',
  image_url TEXT,
  sections JSONB NOT NULL DEFAULT '[]'::JSONB,
  extra_fields JSONB NOT NULL DEFAULT '[]'::JSONB,
  google_sheet_url TEXT,
  backup_webhook_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
INSERT INTO public.webinar_form_settings(id) VALUES(TRUE) ON CONFLICT DO NOTHING;
UPDATE public.webinar_form_settings
SET google_sheet_url = 'https://docs.google.com/spreadsheets/d/1MAu0aZbbcyHQpWrYd7kb2K_6Y8EyRUQCKJTRExgRrNQ/edit'
WHERE id = TRUE AND google_sheet_url IS NULL;
ALTER TABLE public.webinar_form_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage webinar form" ON public.webinar_form_settings;
CREATE POLICY "Admins manage webinar form" ON public.webinar_form_settings FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

ALTER TABLE public.webinar_leads
  ADD COLUMN IF NOT EXISTS extra_answers JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS sheet_backup_status TEXT,
  ADD COLUMN IF NOT EXISTS sheet_backup_at TIMESTAMPTZ;

-- Custom Immigration lessons are stored in the same media table so VDOCipher
-- authorization and publication rules remain centralized.
ALTER TABLE public.immigration_lessons
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS module_slug TEXT,
  ADD COLUMN IF NOT EXISTS lesson_number_label TEXT,
  ADD COLUMN IF NOT EXISTS duration_label TEXT,
  ADD COLUMN IF NOT EXISTS order_index INT,
  ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT FALSE;

-- Preserve an order when E-com reports that it was deleted externally.
ALTER TABLE public.delivery_orders
  ADD COLUMN IF NOT EXISTS deleted_from_ecom_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_from_ecom_event_id TEXT;

-- Recreate the closer workflow with the staff permission gate. It remains a
-- security-definer operation so a closer can create the internal draft without
-- gaining read access to the Commandes table.
CREATE OR REPLACE FUNCTION public.admin_log_webinar_call_with_order(
  p_lead_id uuid,
  p_status public.webinar_lead_status_enum,
  p_closer_name text,
  p_note text DEFAULT NULL,
  p_next_follow_up_at timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_lead public.webinar_leads%ROWTYPE; v_order_id uuid; v_created boolean := false;
BEGIN
  IF NOT public.has_staff_permission(auth.uid(), 'prospects') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO v_lead FROM public.webinar_leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;

  UPDATE public.webinar_leads SET status = p_status, closer_name = btrim(p_closer_name),
    call_count = call_count + 1, last_call_at = now(), next_follow_up_at = p_next_follow_up_at,
    latest_call_note = nullif(btrim(coalesce(p_note, '')), '')
  WHERE id = p_lead_id;
  INSERT INTO public.webinar_lead_activities(lead_id, activity_type, status, note, metadata, created_by)
  VALUES(p_lead_id, 'call', p_status, nullif(btrim(coalesce(p_note,'')), ''),
    jsonb_build_object('closer_name', btrim(p_closer_name), 'next_follow_up_at', p_next_follow_up_at), auth.uid());

  SELECT id INTO v_order_id FROM public.delivery_orders WHERE webinar_lead_id = p_lead_id LIMIT 1;
  IF v_order_id IS NULL THEN
    INSERT INTO public.delivery_orders(customer_name,mobile_1,wilaya_id,wilaya_name,commune,delivery_mode,address,course,article,quantity,cod_amount,supplier_notes,webinar_lead_id,created_by)
    VALUES(left(btrim(v_lead.full_name),60),v_lead.phone_normalized,v_lead.wilaya_id,v_lead.wilaya_name,v_lead.commune,'domicile',nullif(left(btrim(v_lead.address),100),''),'immigration','Programme Aurel Academy — Immigration',1,38000,'Interdiction d''ouvrir le colis',p_lead_id,auth.uid())
    RETURNING id INTO v_order_id;
    v_created := true;
  END IF;
  UPDATE public.webinar_leads SET status = p_status, updated_at = now() WHERE id = p_lead_id;
  RETURN jsonb_build_object('ok',true,'order_id',v_order_id,'created',v_created);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_log_webinar_call_with_order(uuid,public.webinar_lead_status_enum,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_log_webinar_call_with_order(uuid,public.webinar_lead_status_enum,text,text,timestamptz) TO authenticated;

COMMIT;
