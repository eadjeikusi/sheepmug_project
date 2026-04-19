-- Platform super-admin flag (SheepMug operators). Only these users may call /api/superadmin/*.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_super_admin IS 'When true, may access SuperAdmin APIs (cross-tenant).';
