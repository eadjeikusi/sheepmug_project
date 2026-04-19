-- Public ministry mini-site columns on `groups`.
-- Run in Supabase SQL editor (safe to re-run).

ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS public_link_slug text;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS public_website_enabled boolean DEFAULT true;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS cover_image_url text;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS contact_phone text;

-- Use ADD COLUMN only when missing; existing jsonb/text columns are left as-is.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'groups' AND column_name = 'announcements_content'
  ) THEN
    ALTER TABLE public.groups ADD COLUMN announcements_content text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'groups' AND column_name = 'program_outline_content'
  ) THEN
    ALTER TABLE public.groups ADD COLUMN program_outline_content text;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS groups_public_link_slug_unique
  ON public.groups (public_link_slug)
  WHERE public_link_slug IS NOT NULL AND btrim(public_link_slug) <> '';
