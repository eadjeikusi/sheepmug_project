-- Pending paid signups: account is created only after Paystack charge succeeds.

CREATE TABLE IF NOT EXISTS public.pending_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_encrypted text NOT NULL,
  organization_name text NOT NULL,
  full_name text NOT NULL,
  billing_plan_id text NOT NULL,
  paystack_reference text NOT NULL UNIQUE,
  consumed_at timestamptz,
  created_user_id uuid,
  created_org_id uuid,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_signups_email_unconsumed
  ON public.pending_signups (lower(email))
  WHERE consumed_at IS NULL;

COMMENT ON TABLE public.pending_signups IS 'Pre-payment signup intent; rows are consumed when Paystack charge succeeds.';
