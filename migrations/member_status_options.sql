-- Org-wide picklist for Settings + dropdowns. Does NOT replace members.status.
--
-- Data model:
--   • public.members.status  = actual value saved on each member (see migrations/members_status_column.sql).
--   • public.member_status_options = rows like ("Active", color, sort_order) per organization_id.
--     When you choose "Active" in the UI, members.status is set to the label text "Active".
--
-- RBAC in Express (server.ts); service role for Supabase. Requires: public.organizations, public.members (for FK only if you add FKs later — currently no FK from members.status to this table).
--
-- If the app shows "member_status_options table not installed", run this file in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.member_status_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  label text NOT NULL,
  color text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_status_options_label_nonempty CHECK (length(trim(label)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_member_status_options_org_label_lower
  ON public.member_status_options (organization_id, lower(trim(label)));

CREATE INDEX IF NOT EXISTS idx_member_status_options_org_sort
  ON public.member_status_options (organization_id, sort_order, label);

COMMENT ON TABLE public.member_status_options IS 'Picklist for members.status; GET/CRUD via /api/member-status-options';
