-- Branch-scoped picklist for `groups.group_type` labels (Settings + add/edit group UIs).
-- Run in Supabase SQL Editor after deploy.

CREATE TABLE IF NOT EXISTS public.group_type_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches (id) ON DELETE CASCADE,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_type_options_label_nonempty CHECK (length(trim(label)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_group_type_options_org_branch_label_lower
  ON public.group_type_options (organization_id, branch_id, lower(trim(label)));

CREATE INDEX IF NOT EXISTS idx_group_type_options_org_branch_sort
  ON public.group_type_options (organization_id, branch_id, sort_order, label);

COMMENT ON TABLE public.group_type_options IS 'Picklist for groups.group_type; GET/CRUD via /api/group-type-options';
