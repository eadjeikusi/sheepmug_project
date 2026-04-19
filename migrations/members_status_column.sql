-- Per-member membership status (source of truth for UI + API).
-- Used by POST/PUT /api/members in server.ts as column `status`.
-- Run this if your `members` table was created before this field existed.

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS status text;

COMMENT ON COLUMN public.members.status IS
  'Membership label stored on the member row (e.g. Active, Deceased). '
  'Optional table member_status_options lists org-defined choices for Settings/dropdowns; '
  'values should match option labels when using the picklist.';
