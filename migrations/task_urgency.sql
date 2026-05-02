-- Task urgency (Low / Urgent / High) for member_tasks and group_tasks.
-- Run in Supabase SQL editor after member_tasks.sql / group_tasks.sql.

ALTER TABLE public.member_tasks
  ADD COLUMN IF NOT EXISTS urgency text NOT NULL DEFAULT 'low';

ALTER TABLE public.group_tasks
  ADD COLUMN IF NOT EXISTS urgency text NOT NULL DEFAULT 'low';

ALTER TABLE public.member_tasks DROP CONSTRAINT IF EXISTS member_tasks_urgency_check;
ALTER TABLE public.member_tasks
  ADD CONSTRAINT member_tasks_urgency_check CHECK (urgency IN ('low', 'urgent', 'high'));

ALTER TABLE public.group_tasks DROP CONSTRAINT IF EXISTS group_tasks_urgency_check;
ALTER TABLE public.group_tasks
  ADD CONSTRAINT group_tasks_urgency_check CHECK (urgency IN ('low', 'urgent', 'high'));

CREATE INDEX IF NOT EXISTS idx_member_tasks_urgency ON public.member_tasks (urgency);
CREATE INDEX IF NOT EXISTS idx_group_tasks_urgency ON public.group_tasks (urgency);

COMMENT ON COLUMN public.member_tasks.urgency IS 'low | urgent | high — drives alerts when high.';
COMMENT ON COLUMN public.group_tasks.urgency IS 'low | urgent | high — drives alerts when high.';
