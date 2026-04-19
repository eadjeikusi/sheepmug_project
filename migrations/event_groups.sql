-- Junction: up to two ministries (groups) per event + optional event_assigned_members.
-- Run in Supabase SQL Editor, then reload API schema if needed.

CREATE TABLE IF NOT EXISTS public.event_groups (
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (event_id, group_id)
);

CREATE INDEX IF NOT EXISTS event_groups_org_event_idx ON public.event_groups (organization_id, event_id);

COMMENT ON TABLE public.event_groups IS 'Links events to 0–2 ministries; roster is union of group members and event_assigned_members.';

-- Allow members-only events (no primary ministry row).
ALTER TABLE public.events ALTER COLUMN group_id DROP NOT NULL;

INSERT INTO public.event_groups (event_id, group_id, organization_id)
SELECT e.id, e.group_id, e.organization_id
FROM public.events e
WHERE e.group_id IS NOT NULL
ON CONFLICT DO NOTHING;
