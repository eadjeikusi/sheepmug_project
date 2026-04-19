-- Optional: document the `events.notes` column for admins / SQL clients.
-- Does not rename the column; the app still uses JSON key `notes` in API payloads.
COMMENT ON COLUMN public.events.notes IS 'About Event — user-facing description shown on event detail.';
