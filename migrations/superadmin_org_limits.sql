-- SuperAdmin: per-org resource limits + Hubtel placeholder
-- Run against your Supabase SQL editor or psql.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS hubtel_subscription_id text NULL,
  ADD COLUMN IF NOT EXISTS max_members integer NULL,
  ADD COLUMN IF NOT EXISTS max_groups integer NULL,
  ADD COLUMN IF NOT EXISTS max_branches integer NULL,
  ADD COLUMN IF NOT EXISTS max_events_per_month integer NULL,
  ADD COLUMN IF NOT EXISTS max_staff integer NULL;

COMMENT ON COLUMN public.organizations.max_members IS 'Override member cap; NULL = use plan default from subscription_tier';
COMMENT ON COLUMN public.organizations.max_groups IS 'Override ministry/group cap; NULL = use plan default';
COMMENT ON COLUMN public.organizations.max_branches IS 'Override branch cap; NULL = use plan default';
COMMENT ON COLUMN public.organizations.max_events_per_month IS 'Override monthly event creation cap; NULL = use plan default';
COMMENT ON COLUMN public.organizations.max_staff IS 'Override staff profile cap; NULL = use plan default';
