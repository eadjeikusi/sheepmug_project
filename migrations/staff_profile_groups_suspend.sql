-- Suspend entire staff access groups (runtime check on login/me).
ALTER TABLE staff_profile_groups
  ADD COLUMN IF NOT EXISTS suspended boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN staff_profile_groups.suspended IS 'When true, members of this group cannot access the app until cleared (org owner exempt).';

-- profiles.is_active: when false, staff cannot access the platform (enforced in /api/auth/login and /api/auth/me). Org owners are exempt.
