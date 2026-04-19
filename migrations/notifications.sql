create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid references public.branches (id) on delete set null,
  recipient_profile_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  category text not null,
  title text not null,
  message text not null,
  severity text not null default 'medium',
  entity_type text,
  entity_id uuid,
  action_path text,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notifications_severity_check check (severity in ('low', 'medium', 'high'))
);

create index if not exists idx_notifications_recipient_created
  on public.notifications (recipient_profile_id, created_at desc);

create index if not exists idx_notifications_recipient_unread
  on public.notifications (recipient_profile_id, read_at, created_at desc);

create index if not exists idx_notifications_org_branch
  on public.notifications (organization_id, branch_id, created_at desc);

create table if not exists public.notification_preferences (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid references public.branches (id) on delete set null,
  mute_all boolean not null default false,
  tasks_enabled boolean not null default true,
  attendance_enabled boolean not null default true,
  events_enabled boolean not null default true,
  requests_enabled boolean not null default true,
  assignments_enabled boolean not null default true,
  permissions_enabled boolean not null default true,
  member_care_enabled boolean not null default true,
  leader_updates_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_notification_preferences_org_branch
  on public.notification_preferences (organization_id, branch_id, profile_id);

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
