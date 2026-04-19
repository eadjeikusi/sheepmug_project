-- Multiple leader assignees per member_task / group_task.
-- assignee_profile_id remains the primary/representative; assignee_profile_ids lists all co-assignees.
-- Run in Supabase SQL editor after member_tasks.sql / group_tasks.sql.

ALTER TABLE public.member_tasks
  ADD COLUMN IF NOT EXISTS assignee_profile_ids uuid[];

UPDATE public.member_tasks
SET assignee_profile_ids = ARRAY[assignee_profile_id]
WHERE assignee_profile_ids IS NULL OR cardinality(assignee_profile_ids) = 0;

ALTER TABLE public.member_tasks
  ALTER COLUMN assignee_profile_ids SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_member_tasks_assignee_profile_ids_gin
  ON public.member_tasks USING GIN (assignee_profile_ids);

ALTER TABLE public.group_tasks
  ADD COLUMN IF NOT EXISTS assignee_profile_ids uuid[];

UPDATE public.group_tasks
SET assignee_profile_ids = ARRAY[assignee_profile_id]
WHERE assignee_profile_ids IS NULL OR cardinality(assignee_profile_ids) = 0;

ALTER TABLE public.group_tasks
  ALTER COLUMN assignee_profile_ids SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_group_tasks_assignee_profile_ids_gin
  ON public.group_tasks USING GIN (assignee_profile_ids);

COMMENT ON COLUMN public.member_tasks.assignee_profile_ids IS 'All leader assignees; assignee_profile_id is primary.';
COMMENT ON COLUMN public.group_tasks.assignee_profile_ids IS 'All leader assignees; assignee_profile_id is primary.';
