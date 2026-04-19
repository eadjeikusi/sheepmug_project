-- Soft delete / trash for ministries (groups). Required by GET /api/groups filters and DELETE /api/groups.
-- Run in Supabase SQL editor (or your migration runner) if you see: column groups.is_deleted does not exist

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS groups_org_branch_deleted_idx
  ON public.groups (organization_id, branch_id)
  WHERE is_deleted = true;

COMMENT ON COLUMN public.groups.is_deleted IS 'When true, group is in trash; hidden from normal list until restored or purged.';
COMMENT ON COLUMN public.groups.deleted_at IS 'Timestamp when the group was moved to trash.';
