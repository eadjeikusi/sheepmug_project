-- Link reusable outline templates to a custom event type
alter table public.event_outline
  add column if not exists event_type_id uuid references public.event_types (id) on delete restrict;

create index if not exists event_outline_event_type_id_idx on public.event_outline (event_type_id);
