-- Optional columns for voice notes on member profiles.
-- Canonical table per docs: public.notes (author_id, branch_id, member_id, organization_id, content, is_private, …).
-- Run in Supabase SQL editor if your export predates these columns.

ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS audio_url TEXT;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS audio_duration INTEGER;
