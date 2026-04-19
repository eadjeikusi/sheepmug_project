-- Staff notes on a member (text and/or voice metadata).
-- RBAC is enforced in Express (`server.ts`); this table is used with the service role.
-- Requires: public.organizations, public.members, public.profiles (same as member_tasks).
-- Run in the Supabase SQL editor (or your migration runner).

CREATE TABLE IF NOT EXISTS public.member_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  content text,
  audio_url text,
  audio_duration integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT member_notes_has_content CHECK (
    (content IS NOT NULL AND length(trim(content)) > 0)
    OR (audio_url IS NOT NULL AND length(trim(audio_url)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_member_notes_member_org
  ON public.member_notes (member_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_member_notes_org_created
  ON public.member_notes (organization_id, created_at DESC);

COMMENT ON TABLE public.member_notes IS 'Member profile notes; endpoints: GET/POST /api/members/:id/notes';
