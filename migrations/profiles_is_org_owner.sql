-- Org creator gets full RBAC bypass via application logic (is_org_owner).
-- Run in Supabase SQL editor.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_org_owner boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_org_owner IS 'Account that created the organization; bypasses permission checks in API.';
