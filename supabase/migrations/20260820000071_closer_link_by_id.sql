-- ============================================================================
-- Aurel Academy — Attribution robuste : lier les prospects au closer par ID
-- ============================================================================
-- Le lien closer↔prospect était fait par NOM (lead.closer_name = nom du profil),
-- mais le menu "Attribuer" utilise le nom de la fiche staff_members, qui diffère
-- souvent du nom du profil (ex : staff "Rym" vs profil "rym bekkouche"). Résultat :
-- le closer ne voyait pas ses prospects attribués.
--
-- Fix : une colonne closer_user_id (l'ID du compte closer). L'attribution la
-- remplit, la RLS matche dessus. Insensible aux différences de nom.
-- ============================================================================

BEGIN;

ALTER TABLE public.webinar_leads
  ADD COLUMN IF NOT EXISTS closer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Backfill : lie les prospects déjà attribués via le nom staff → auth_user_id.
-- Fiable car closer_name a été posé à partir du nom staff_members.
UPDATE public.webinar_leads l
SET closer_user_id = s.auth_user_id
FROM public.staff_members s
WHERE l.closer_name IS NOT NULL
  AND s.auth_user_id IS NOT NULL
  AND lower(btrim(l.closer_name)) = lower(btrim(s.first_name || ' ' || s.last_name));

-- Attribution (admins uniquement) : résout le nom → l'ID du closer, pose les deux.
CREATE OR REPLACE FUNCTION public.admin_assign_leads_closer(p_lead_ids UUID[], p_closer_name TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_closer UUID;
  v_count  INT := 0;
BEGIN
  IF NOT public.is_admin(v_uid) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_lead_ids IS NULL OR array_length(p_lead_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'assigned', 0);
  END IF;

  SELECT auth_user_id INTO v_closer FROM public.staff_members
  WHERE is_active AND lower(btrim(first_name || ' ' || last_name)) = lower(btrim(p_closer_name))
  LIMIT 1;

  UPDATE public.webinar_leads
  SET closer_name = btrim(p_closer_name), closer_user_id = v_closer
  WHERE id = ANY(p_lead_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'assigned', v_count, 'linked', v_closer IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_assign_leads_closer(UUID[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_assign_leads_closer(UUID[], TEXT) TO authenticated;

-- Log d'appel : pose aussi closer_user_id (résolu depuis le nom choisi).
CREATE OR REPLACE FUNCTION public.admin_log_webinar_call_with_order(
  p_lead_id uuid,
  p_status public.webinar_lead_status_enum,
  p_closer_name text,
  p_note text DEFAULT NULL,
  p_next_follow_up_at timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_lead public.webinar_leads%ROWTYPE; v_order_id uuid; v_created boolean := false; v_closer uuid;
BEGIN
  IF NOT public.has_staff_permission(auth.uid(), 'prospects') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO v_lead FROM public.webinar_leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;

  SELECT auth_user_id INTO v_closer FROM public.staff_members
  WHERE is_active AND lower(btrim(first_name || ' ' || last_name)) = lower(btrim(p_closer_name)) LIMIT 1;

  UPDATE public.webinar_leads SET status = p_status, closer_name = btrim(p_closer_name),
    closer_user_id = coalesce(v_closer, closer_user_id),
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
  RETURN jsonb_build_object('ok',true,'order_id',v_order_id,'created',v_created);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_log_webinar_call_with_order(uuid,public.webinar_lead_status_enum,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_log_webinar_call_with_order(uuid,public.webinar_lead_status_enum,text,text,timestamptz) TO authenticated;

-- ── RLS now matches by ID (robust) ──────────────────────────────────────────
DROP POLICY IF EXISTS "Staff prospect access" ON public.webinar_leads;
CREATE POLICY "Staff prospect access" ON public.webinar_leads FOR ALL TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR (public.has_staff_permission(auth.uid(), 'prospects') AND closer_user_id = auth.uid())
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR (public.has_staff_permission(auth.uid(), 'prospects') AND closer_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Staff read webinar lead activities" ON public.webinar_lead_activities;
CREATE POLICY "Staff read webinar lead activities" ON public.webinar_lead_activities FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR (
      public.has_staff_permission(auth.uid(), 'prospects')
      AND EXISTS (SELECT 1 FROM public.webinar_leads l WHERE l.id = webinar_lead_activities.lead_id AND l.closer_user_id = auth.uid())
    )
  );

COMMIT;
