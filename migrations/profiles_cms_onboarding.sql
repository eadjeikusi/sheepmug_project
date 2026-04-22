-- Track completion of the in-browser CMS onboarding tour (separate from mobile).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS cms_onboarding_completed_at timestamptz;

COMMENT ON COLUMN profiles.cms_onboarding_completed_at IS 'When the user finished or skipped the web CMS onboarding modal.';
