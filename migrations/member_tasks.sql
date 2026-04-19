-- Member follow-up tasks (assigned to leader profiles, about a member).
-- Enforced primarily in Express (service role). Run in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.member_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches (id) ON DELETE SET NULL,
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pending',
  assignee_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_tasks_status_check CHECK (
    status IN ('pending', 'in_progress', 'completed', 'cancelled')
  )
);

CREATE INDEX IF NOT EXISTS idx_member_tasks_assignee_status
  ON public.member_tasks (assignee_profile_id, status);

CREATE INDEX IF NOT EXISTS idx_member_tasks_member_id ON public.member_tasks (member_id);
CREATE INDEX IF NOT EXISTS idx_member_tasks_organization_id ON public.member_tasks (organization_id);

COMMENT ON TABLE public.member_tasks IS 'Leader todos about a member; RBAC in API.';
