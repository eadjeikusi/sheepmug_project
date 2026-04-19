-- Staff profile photo when there is no matching public.members row for the same email.
-- API still returns this URL as user.profile_image in JSON.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text NULL;

COMMENT ON COLUMN public.profiles.avatar_url IS 'Optional staff avatar URL; used if photo is not stored on a linked member row.';
