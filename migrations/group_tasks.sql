-- Group follow-up tasks (assigned to leader profiles, about a ministry/group).
-- Mirrors member_tasks. Enforced in Express (service role). Run in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.group_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches (id) ON DELETE SET NULL,
  group_id uuid NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pending',
  assignee_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  due_at timestamptz,
  completed_at timestamptz,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  related_group_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_tasks_status_check CHECK (
    status IN ('pending', 'in_progress', 'completed', 'cancelled')
  )
);

CREATE INDEX IF NOT EXISTS idx_group_tasks_assignee_status
  ON public.group_tasks (assignee_profile_id, status);

CREATE INDEX IF NOT EXISTS idx_group_tasks_group_id ON public.group_tasks (group_id);
CREATE INDEX IF NOT EXISTS idx_group_tasks_organization_id ON public.group_tasks (organization_id);

COMMENT ON TABLE public.group_tasks IS 'Leader todos about a group/ministry; RBAC in API.';
COMMENT ON COLUMN public.group_tasks.checklist IS 'Array of { id, label, done } sub-tasks.';
COMMENT ON COLUMN public.group_tasks.related_group_ids IS 'Additional group UUIDs (same branch); primary is group_id.';
