-- Member-scoped important dates (custom title/description + date + optional time).
-- Enforced in Express API using service role.

CREATE TABLE IF NOT EXISTS public.member_important_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches (id) ON DELETE SET NULL,
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  date_value date NOT NULL,
  time_value time,
  created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_important_dates_org_member
  ON public.member_important_dates (organization_id, member_id);

CREATE INDEX IF NOT EXISTS idx_member_important_dates_member_date_time
  ON public.member_important_dates (member_id, date_value, time_value);

COMMENT ON TABLE public.member_important_dates IS 'Custom important dates per member (title, description, date, optional time).';
