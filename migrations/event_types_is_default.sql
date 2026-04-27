-- Default event type per branch scope: used when deleting a type (reassign FKs and event slugs).
-- Run in Supabase SQL Editor (or your migration runner).

ALTER TABLE public.event_types
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- One default per (organization_id, branch_id) including legacy NULL branch_id as its own group.
UPDATE public.event_types SET is_default = false;

UPDATE public.event_types et
SET is_default = true
FROM (
  SELECT DISTINCT ON (organization_id, branch_id)
    id
  FROM public.event_types
  ORDER BY organization_id, branch_id NULLS FIRST, id ASC
) pick
WHERE et.id = pick.id;
