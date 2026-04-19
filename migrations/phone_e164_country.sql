-- E.164 storage: phone_number / emergency_contact_phone / contact_phone hold full international numbers.
-- ISO country columns remember the user's country selection for the phone UI (and default parsing).

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS phone_country_iso character varying(2),
  ADD COLUMN IF NOT EXISTS emergency_contact_phone_country_iso character varying(2);

COMMENT ON COLUMN public.members.phone_country_iso IS 'ISO 3166-1 alpha-2 for primary phone; phone_number stored as E.164';
COMMENT ON COLUMN public.members.emergency_contact_phone_country_iso IS 'ISO 3166-1 alpha-2 for emergency contact phone; emergency_contact_phone stored as E.164';

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS default_phone_country_iso character varying(2) DEFAULT 'US';

COMMENT ON COLUMN public.organizations.default_phone_country_iso IS 'Default country for national phone input when region is ambiguous (ISO 3166-1 alpha-2)';

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS contact_phone_country_iso character varying(2);

COMMENT ON COLUMN public.groups.contact_phone_country_iso IS 'ISO 3166-1 alpha-2 for public contact phone; contact_phone stored as E.164';
