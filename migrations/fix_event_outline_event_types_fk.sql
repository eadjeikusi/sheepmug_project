-- Supabase/PostgREST only exposes embeds like:
--   select('*, event_types(name, slug, color)')
-- when a FOREIGN KEY links event_outline.event_type_id -> event_types.id.
-- If you only added the column without REFERENCES, you get:
--   "Could not find a relationship between event_outline and event_types in the schema cache"

-- Ensure column exists (references optional on IF NOT EXISTS add)
alter table public.event_outline
  add column if not exists event_type_id uuid;

-- Add named FK if missing (fails if any row has event_type_id not in event_types — clean data first)
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'event_outline_event_type_id_fkey'
  ) then
    alter table public.event_outline
      add constraint event_outline_event_type_id_fkey
      foreign key (event_type_id)
      references public.event_types (id)
      on delete restrict;
  end if;
end $$;

create index if not exists event_outline_event_type_id_idx on public.event_outline (event_type_id);

-- After running: Supabase Dashboard → Settings → API → "Reload schema" (or wait a minute).
