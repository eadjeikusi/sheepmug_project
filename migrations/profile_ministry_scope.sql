-- Ministry access for staff profiles (separate from staff_profile_groups bulk-role buckets).
-- Run on Supabase after existing groups/branches exist.

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS system_kind text NULL;

COMMENT ON COLUMN public.groups.is_system IS 'When true, row is managed by the app (e.g. All Members).';
COMMENT ON COLUMN public.groups.system_kind IS 'Optional: all_members = semantic full-branch access for assigned staff.';

CREATE TABLE IF NOT EXISTS public.profile_ministry_scope (
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (profile_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_ministry_scope_profile ON public.profile_ministry_scope (profile_id);
CREATE INDEX IF NOT EXISTS idx_profile_ministry_scope_group ON public.profile_ministry_scope (group_id);

COMMENT ON TABLE public.profile_ministry_scope IS 'Staff profile → ministry group visibility (many-to-many).';

-- One "All Members" system group per branch (not used in group_members for every person).
INSERT INTO public.groups (
  organization_id,
  branch_id,
  name,
  description,
  group_type,
  parent_group_id,
  public_website_enabled,
  join_link_enabled,
  public_link_slug,
  join_invite_token,
  is_system,
  system_kind,
  is_deleted
)
SELECT
  b.organization_id,
  b.id,
  'All Members',
  'System: full-branch visibility for staff assigned here. Do not add members to this group.',
  'ministry',
  NULL,
  false,
  false,
  'all-members-' || b.id::text,
  encode(gen_random_bytes(16), 'hex'),
  true,
  'all_members',
  false
FROM public.branches b
WHERE NOT EXISTS (
  SELECT 1
  FROM public.groups g
  WHERE g.branch_id = b.id
    AND g.system_kind = 'all_members'
);

-- Backfill: every active (non-deleted) branch member belongs to branch "All Members".
INSERT INTO public.group_members (
  group_id,
  member_id,
  role_in_group,
  organization_id,
  branch_id
)
SELECT
  g.id,
  m.id,
  'member',
  m.organization_id,
  m.branch_id
FROM public.members m
JOIN public.groups g
  ON g.organization_id = m.organization_id
 AND g.branch_id = m.branch_id
 AND g.system_kind = 'all_members'
WHERE COALESCE(m.is_deleted, false) = false
  AND NOT EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = g.id
      AND gm.member_id = m.id
      AND gm.organization_id = m.organization_id
  );
