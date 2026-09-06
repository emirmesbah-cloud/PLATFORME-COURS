-- One stock reference per programme. Never guess a reference or rewrite a parcel
-- already sent to E-com. This migration adds configuration without seeding SKUs.
BEGIN;

CREATE TABLE public.ecom_product_mappings (
  course text PRIMARY KEY CHECK (course IN ('immigration', 'pflege')),
  ref_article text NOT NULL CHECK (char_length(btrim(ref_article)) BETWEEN 1 AND 64),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ecom_product_mappings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ecom_product_mappings FROM anon, authenticated;
GRANT SELECT ON public.ecom_product_mappings TO authenticated;
GRANT ALL ON public.ecom_product_mappings TO service_role;
CREATE POLICY "Admins read E-com product mappings"
  ON public.ecom_product_mappings FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- Covers manual orders AND all prospect-to-order RPCs, including older clients.
CREATE FUNCTION public.fill_delivery_order_stock_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.ecom_tracking IS NOT NULL OR NEW.deleted_at IS NOT NULL
     OR NEW.sync_status = 'syncing' THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Changing the programme must not keep the previous programme's reference.
    -- An explicitly supplied different reference remains an admin override.
    IF NEW.course IS DISTINCT FROM OLD.course
       AND NEW.ecom_ref_article IS NOT DISTINCT FROM OLD.ecom_ref_article THEN
      NEW.ecom_ref_article := NULL;
    END IF;
  END IF;

  IF nullif(btrim(NEW.ecom_ref_article), '') IS NULL THEN
    SELECT ref_article INTO NEW.ecom_ref_article
    FROM public.ecom_product_mappings WHERE course = NEW.course;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fill_delivery_order_stock_reference() FROM PUBLIC;
CREATE TRIGGER delivery_order_stock_reference
  BEFORE INSERT OR UPDATE OF course, ecom_ref_article ON public.delivery_orders
  FOR EACH ROW EXECUTE FUNCTION public.fill_delivery_order_stock_reference();

-- Saving a mapping and repairing eligible drafts is one atomic operation.
-- Existing explicit references, sent, archived and in-flight orders are kept.
CREATE FUNCTION public.admin_save_ecom_product_mapping(p_course text, p_ref_article text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ref text := btrim(p_ref_article);
  v_updated integer;
BEGIN
  IF NOT coalesce(public.is_admin(auth.uid()), false)
     AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_course IS NULL OR p_course NOT IN ('immigration', 'pflege') THEN
    RAISE EXCEPTION 'COURSE_INVALID';
  END IF;
  IF v_ref IS NULL OR char_length(v_ref) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'ECOM_REF_ARTICLE_REQUIRED';
  END IF;

  INSERT INTO public.ecom_product_mappings(course, ref_article, updated_by)
  VALUES (p_course, v_ref, auth.uid())
  ON CONFLICT (course) DO UPDATE SET
    ref_article = EXCLUDED.ref_article,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

  UPDATE public.delivery_orders
  SET ecom_ref_article = v_ref,
      sync_status = CASE WHEN last_error = 'ECOM_REF_ARTICLE_REQUIRED' THEN 'draft' ELSE sync_status END,
      last_error = CASE WHEN last_error = 'ECOM_REF_ARTICLE_REQUIRED' THEN NULL ELSE last_error END
  WHERE course = p_course
    AND ecom_tracking IS NULL
    AND deleted_at IS NULL
    AND sync_status <> 'syncing'
    AND nullif(btrim(ecom_ref_article), '') IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public.admin_audit_logs(admin_user_id, action_type, target_type, metadata)
    VALUES (auth.uid(), 'ecom_product_mapping_saved', 'ecom_product_mapping',
      jsonb_build_object('course', p_course, 'ref_article', v_ref, 'updated_orders', v_updated));
  END IF;
  RETURN jsonb_build_object('ok', true, 'updated_orders', v_updated);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_save_ecom_product_mapping(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_ecom_product_mapping(text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
