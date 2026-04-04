-- Run in Supabase SQL editor if join requests fail with "member_id" / schema errors.
-- Directory-verified join links store the matched member id on the request.

alter table group_requests
  add column if not exists member_id uuid references public.members (id);

create index if not exists group_requests_member_id_idx on group_requests (member_id);
