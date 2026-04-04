-- Per-group opaque join link token (still supports /join-group/:uuid).
alter table groups
  add column if not exists join_invite_token text;

create unique index if not exists groups_join_invite_token_uidx
  on groups (join_invite_token)
  where join_invite_token is not null;

-- Backfill existing rows (32-char hex, unique per row)
update groups
set join_invite_token = replace(gen_random_uuid()::text, '-', '')
where join_invite_token is null;
