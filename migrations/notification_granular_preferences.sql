alter table if exists public.notification_preferences
  add column if not exists granular_preferences jsonb not null default '{}'::jsonb;
