-- Public ministry pages on by default (opt-out only via explicit false).
-- Run after groups_public_site.sql. Safe to re-run.

ALTER TABLE public.groups ALTER COLUMN public_website_enabled SET DEFAULT true;

UPDATE public.groups
SET public_website_enabled = true
WHERE public_website_enabled IS NULL;

-- Auto-generate a slug from the group name for any group that doesn't have one yet.
UPDATE public.groups
SET public_link_slug = lower(
  regexp_replace(
    regexp_replace(
      left(name, 72),
      '[^a-zA-Z0-9]+', '-', 'g'
    ),
    '^-|-$', '', 'g'
  )
)
WHERE (public_link_slug IS NULL OR btrim(public_link_slug) = '')
  AND name IS NOT NULL
  AND btrim(name) <> '';
