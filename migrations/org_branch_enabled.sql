-- Platform-level enable/disable for organizations and branches (Super Admin).
-- When disabled, non–super-admin users cannot use tenant APIs (enforced in server.ts).

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.organizations.is_enabled IS 'When false, organization access is blocked for staff (super admins exempt).';
COMMENT ON COLUMN public.branches.is_enabled IS 'When false, staff assigned to this branch are blocked (org owners exempt).';

CREATE INDEX IF NOT EXISTS idx_organizations_is_enabled ON public.organizations (is_enabled);
CREATE INDEX IF NOT EXISTS idx_branches_is_enabled ON public.branches (is_enabled);
