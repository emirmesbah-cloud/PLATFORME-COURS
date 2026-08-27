-- Preserve notes written before the shared prospect timeline was introduced.
-- The NOT EXISTS checks make this migration idempotent and avoid duplicates.

BEGIN;

INSERT INTO public.webinar_lead_activities(
  lead_id, activity_type, status, note, metadata, created_by, created_at
)
SELECT
  l.id,
  'status',
  l.status,
  nullif(btrim(l.note), ''),
  jsonb_build_object('legacy_backfill', true, 'source', 'prospect_note'),
  NULL,
  coalesce(l.updated_at, l.created_at, now())
FROM public.webinar_leads l
WHERE nullif(btrim(l.note), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.webinar_lead_activities a
    WHERE a.lead_id = l.id
      AND a.note = nullif(btrim(l.note), '')
  );

INSERT INTO public.webinar_lead_activities(
  lead_id, activity_type, status, note, metadata, created_by, created_at
)
SELECT
  l.id,
  'call',
  l.status,
  nullif(btrim(l.latest_call_note), ''),
  jsonb_build_object('legacy_backfill', true, 'source', 'latest_call_note'),
  NULL,
  coalesce(l.last_call_at, l.updated_at, l.created_at, now())
FROM public.webinar_leads l
WHERE nullif(btrim(l.latest_call_note), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.webinar_lead_activities a
    WHERE a.lead_id = l.id
      AND a.note = nullif(btrim(l.latest_call_note), '')
  );

COMMIT;
