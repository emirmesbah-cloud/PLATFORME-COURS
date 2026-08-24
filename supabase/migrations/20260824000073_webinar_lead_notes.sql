-- The CRM UI has exposed a free-text prospect note since the operational UI
-- rollout, but the database column was never added. Keep it separate from
-- latest_call_note, which belongs to a specific call activity.

BEGIN;

ALTER TABLE public.webinar_leads
  ADD COLUMN IF NOT EXISTS note text;

DO $$ BEGIN
  ALTER TABLE public.webinar_leads
    ADD CONSTRAINT webinar_leads_note_length_check
    CHECK (note IS NULL OR char_length(note) <= 2000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
