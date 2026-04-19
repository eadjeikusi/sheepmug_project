-- Org-scoped custom field definitions + JSONB values on members, events, groups.
-- Run in Supabase SQL editor. RBAC in Express (server.ts); service role for Supabase.
--
-- If you see "column field_key does not exist", an older/partial table likely exists.
-- This file uses ADD COLUMN IF NOT EXISTS so re-running repairs missing columns.

CREATE TABLE IF NOT EXISTS public.custom_field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  field_key text NOT NULL,
  label text NOT NULL,
  field_type text NOT NULL,
  required boolean NOT NULL DEFAULT false,
  placeholder text,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_value text,
  sort_order integer NOT NULL DEFAULT 0,
  applies_to text[] NOT NULL,
  show_on_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custom_field_definitions_field_key_nonempty CHECK (length(trim(field_key)) > 0),
  CONSTRAINT custom_field_definitions_label_nonempty CHECK (length(trim(label)) > 0)
);

-- Drop legacy columns from older schema versions that conflict with the current design.
ALTER TABLE public.custom_field_definitions DROP COLUMN IF EXISTS entity_type;
ALTER TABLE public.custom_field_definitions DROP COLUMN IF EXISTS field_name;
ALTER TABLE public.custom_field_definitions DROP COLUMN IF EXISTS name;
ALTER TABLE public.custom_field_definitions DROP COLUMN IF EXISTS type;
-- branch_id is used for per-branch definitions (see migrations/branch_scoped_org_config.sql).

-- Repair: table may have been created empty or from an older partial run without these columns.
ALTER TABLE public.custom_field_definitions ADD COLUMN IF NOT EXISTS field_key text;
ALTER TABLE public.custom_field_definitions ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE public.custom_field_definitions ADD COLUMN IF NOT EXISTS field_type text;
ALTER TABLE public.custom_field_definitions ADD COLUMN IF NOT EXISTS required boolean NOT NULL DEFAULT false;
ALTER TABLE public.custom_field_definitions ADD COLUMN IF NOT EXISTS placeholder text;
ALTER TABLE public.custom_field_definitions ADD COLUMN IF NOT EXISTS options jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.custom_field_definitions ADD COLUMN IF NOT EXISTS default_value text;
ALTER TABLE public.custom_field_definitions ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE public.custom_field_definitions ADD COLUMN IF NOT EXISTS applies_to text[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE public.custom_field_definitions ADD COLUMN IF NOT EXISTS show_on_public boolean NOT NULL DEFAULT false;
ALTER TABLE public.custom_field_definitions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.custom_field_definitions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill field_key / label if rows exist with NULLs (needed before NOT NULL / unique index).
UPDATE public.custom_field_definitions
SET label = coalesce(nullif(trim(label), ''), 'Field')
WHERE label IS NULL OR trim(label) = '';

UPDATE public.custom_field_definitions
SET field_key = lower(regexp_replace(coalesce(nullif(trim(label), ''), 'field'), '[^a-zA-Z0-9]+', '_', 'g'))
WHERE field_key IS NULL OR trim(field_key) = '';

UPDATE public.custom_field_definitions
SET field_key = field_key || '_' || replace(id::text, '-', '')
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      row_number() OVER (PARTITION BY organization_id, field_key ORDER BY id) AS rn
    FROM public.custom_field_definitions
  ) t
  WHERE rn > 1
);

ALTER TABLE public.custom_field_definitions ALTER COLUMN field_key SET NOT NULL;
ALTER TABLE public.custom_field_definitions ALTER COLUMN label SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_field_definitions_org_key
  ON public.custom_field_definitions (organization_id, field_key);

CREATE INDEX IF NOT EXISTS idx_custom_field_definitions_org_sort
  ON public.custom_field_definitions (organization_id, sort_order, label);

COMMENT ON TABLE public.custom_field_definitions IS 'Custom fields for members/events/groups; CRUD via /api/custom-field-definitions';

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS custom_fields jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS custom_fields jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS custom_fields jsonb DEFAULT '{}'::jsonb;
