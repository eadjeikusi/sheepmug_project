-- Staff access groups: named collections of profiles with a shared role (not ministry groups).
-- Run in Supabase SQL editor or psql. Requires gen_random_uuid() (pgcrypto).

CREATE TABLE IF NOT EXISTS staff_profile_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id uuid,
  name text NOT NULL,
  role_id uuid REFERENCES roles(id) ON DELETE RESTRICT,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_profile_group_members (
  group_id uuid NOT NULL REFERENCES staff_profile_groups(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, profile_id),
  CONSTRAINT staff_profile_group_members_profile_unique UNIQUE (profile_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_profile_groups_org_branch ON staff_profile_groups (organization_id, branch_id);

COMMENT ON TABLE staff_profile_groups IS 'Named staff groups for bulk role assignment; org owner must not be a member.';
COMMENT ON TABLE staff_profile_group_members IS 'At most one staff group per profile (enforced by UNIQUE on profile_id).';
