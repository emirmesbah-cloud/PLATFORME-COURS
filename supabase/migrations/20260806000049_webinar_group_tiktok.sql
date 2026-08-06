-- Add the TikTok campaign destination to the admin-managed webinar groups.
-- The TikTok landing page (/webinartk/) sends traffic to its own WhatsApp group,
-- separate from the Meta/Immigration one, so it needs its own row.
--
-- RLS policies, grants and the audit trigger from migration 046 are table-wide,
-- so the new row inherits them: admins-only writes, every change audited.

ALTER TABLE public.webinar_groups
  DROP CONSTRAINT IF EXISTS webinar_groups_slug_check;

ALTER TABLE public.webinar_groups
  ADD CONSTRAINT webinar_groups_slug_check
  CHECK (slug IN ('immigration', 'pflege', 'tiktok'));

-- DO NOTHING on conflict: re-running this migration must never overwrite a code
-- the admin has since changed from the dashboard.
INSERT INTO public.webinar_groups (slug, whatsapp_group_code)
VALUES ('tiktok', 'DyKlXab1NCu5D2EaIbWrg3')
ON CONFLICT (slug) DO NOTHING;
