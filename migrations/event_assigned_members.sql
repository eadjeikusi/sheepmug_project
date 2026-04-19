-- Optional subset of members for an event attendance roster (branch-validated in API).
-- Run: Supabase SQL editor or your migration runner.

CREATE TABLE IF NOT EXISTS public.event_assigned_members (
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  created_at timestamptz NULL DEFAULT now(),
  CONSTRAINT event_assigned_members_pkey PRIMARY KEY (event_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_event_assigned_members_org
  ON public.event_assigned_members (organization_id);

CREATE INDEX IF NOT EXISTS idx_event_assigned_members_member
  ON public.event_assigned_members (member_id);
