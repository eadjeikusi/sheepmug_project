-- Matches docs/app_database strucure.txt — group_requests uses dob (date), not date_of_birth.
-- Run only if your table is missing columns (safe to re-run).

alter table group_requests add column if not exists first_name text;
alter table group_requests add column if not exists last_name text;
alter table group_requests add column if not exists dob date;
alter table group_requests add column if not exists requested_at timestamp with time zone;
alter table group_requests add column if not exists reviewer_id uuid;
alter table group_requests add column if not exists reviewed_at timestamp with time zone;
