-- Checklist sub-items + additional members linked to the same task.
-- Run after member_tasks.sql.

ALTER TABLE public.member_tasks
  ADD COLUMN IF NOT EXISTS checklist jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.member_tasks
  ADD COLUMN IF NOT EXISTS related_member_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

COMMENT ON COLUMN public.member_tasks.checklist IS 'Array of { id, label, done } sub-tasks.';
COMMENT ON COLUMN public.member_tasks.related_member_ids IS 'Additional member UUIDs (same branch); primary is member_id.';
