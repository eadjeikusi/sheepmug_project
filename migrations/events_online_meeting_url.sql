-- Optional: run in Supabase SQL Editor (or your migration runner).
-- Adds a dedicated column for online / hybrid meeting links.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS online_meeting_url text NULL;

COMMENT ON COLUMN public.events.online_meeting_url IS 'Video or livestream URL for Online or Hybrid events';

-- Optional: normalize legacy location_type values to canonical slugs (safe to re-run).
UPDATE public.events
SET location_type = 'InPerson'
WHERE lower(trim(coalesce(location_type, ''))) IN ('on_site', 'in person', 'in-person', 'onsite', 'physical');

UPDATE public.events
SET location_type = 'Online'
WHERE lower(trim(coalesce(location_type, ''))) IN ('online');

UPDATE public.events
SET location_type = 'Hybrid'
WHERE lower(trim(coalesce(location_type, ''))) IN ('hybrid');
