-- Branch-level timezone + default reminder time for important-date notifications.
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Africa/Accra';

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS important_dates_default_reminder_time time NOT NULL DEFAULT '08:00:00';

-- Important-date reminder metadata.
ALTER TABLE public.member_important_dates
  ADD COLUMN IF NOT EXISTS date_type text NOT NULL DEFAULT 'custom';

ALTER TABLE public.member_important_dates
  ADD COLUMN IF NOT EXISTS is_recurring_yearly boolean NOT NULL DEFAULT false;

ALTER TABLE public.member_important_dates
  ADD COLUMN IF NOT EXISTS reminder_offsets text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.member_important_dates
  ADD COLUMN IF NOT EXISTS default_alert_enabled boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  -- Keep known values constrained while allowing old rows to migrate safely.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'member_important_dates_date_type_check'
  ) THEN
    ALTER TABLE public.member_important_dates
      ADD CONSTRAINT member_important_dates_date_type_check
      CHECK (date_type IN ('birthday', 'anniversary', 'custom'));
  END IF;
END$$;

-- Backfill birthday semantics from existing rows named "birthday".
UPDATE public.member_important_dates
SET
  date_type = 'birthday',
  is_recurring_yearly = true,
  default_alert_enabled = true
WHERE lower(trim(title)) = 'birthday';
