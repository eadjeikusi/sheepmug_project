-- Branch-scoped settings: event types, program templates, custom field definitions,
-- member status options, and permission roles. Legacy rows with NULL branch_id are
-- treated as belonging to the organization's oldest branch (see server getMainBranchIdForOrg).
-- Run once in Supabase SQL Editor after pulling this migration.

ALTER TABLE public.event_types ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches (id) ON DELETE SET NULL;
ALTER TABLE public.event_outline ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches (id) ON DELETE SET NULL;
ALTER TABLE public.custom_field_definitions ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches (id) ON DELETE CASCADE;
ALTER TABLE public.member_status_options ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches (id) ON DELETE CASCADE;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_event_types_org_branch ON public.event_types (organization_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_event_outline_org_branch ON public.event_outline (organization_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_custom_field_definitions_org_branch ON public.custom_field_definitions (organization_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_member_status_options_org_branch ON public.member_status_options (organization_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_roles_org_branch ON public.roles (organization_id, branch_id);

UPDATE public.event_types et
SET branch_id = (
  SELECT b.id FROM public.branches b WHERE b.organization_id = et.organization_id ORDER BY b.created_at ASC LIMIT 1
)
WHERE et.branch_id IS NULL;

UPDATE public.event_outline eo
SET branch_id = (
  SELECT b.id FROM public.branches b WHERE b.organization_id = eo.organization_id ORDER BY b.created_at ASC LIMIT 1
)
WHERE eo.branch_id IS NULL;

UPDATE public.custom_field_definitions cfd
SET branch_id = (
  SELECT b.id FROM public.branches b WHERE b.organization_id = cfd.organization_id ORDER BY b.created_at ASC LIMIT 1
)
WHERE cfd.branch_id IS NULL;

UPDATE public.member_status_options mso
SET branch_id = (
  SELECT b.id FROM public.branches b WHERE b.organization_id = mso.organization_id ORDER BY b.created_at ASC LIMIT 1
)
WHERE mso.branch_id IS NULL;

UPDATE public.roles r
SET branch_id = (
  SELECT b.id FROM public.branches b WHERE b.organization_id = r.organization_id ORDER BY b.created_at ASC LIMIT 1
)
WHERE r.branch_id IS NULL;

-- custom_field_definitions: uniqueness is per branch (same key allowed in different branches).
DROP INDEX IF EXISTS idx_custom_field_definitions_org_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_field_definitions_org_branch_key
  ON public.custom_field_definitions (organization_id, branch_id, field_key);

-- member_status_options: unique label per branch.
DROP INDEX IF EXISTS idx_member_status_options_org_label_lower;
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_status_options_org_branch_label_lower
  ON public.member_status_options (organization_id, branch_id, lower(trim(label)));
