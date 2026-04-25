-- Expand legacy bundled permission strings in public.roles.permissions to atomic IDs
-- (mirrors src/permissions/catalog.ts LEGACY_PERMISSION_ALIASES + expandStoredPermissionIds).
-- Safe to re-run: already-atomic values pass through; duplicates are removed; sorted.
--
-- Prereq: public.roles.permissions is json/jsonb (array of strings) or coercible via to_jsonb().
-- If your column is text[] only, use the alternate branch at the bottom.
--
-- Verify before:
--   SELECT id, name, permissions FROM public.roles WHERE permissions::text ~ 'manage_';
-- After (expect 0 rows from):
--   SELECT id, name, permissions FROM public.roles WHERE permissions::text ~ 'manage_|track_attendance';
--
-- Run in Supabase SQL editor or: psql $DATABASE_URL -f migrations/expand_legacy_role_permissions_to_atomic.sql

CREATE OR REPLACE FUNCTION public.expand_legacy_permission_token(p text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $f$
  SELECT CASE btrim(p)
    WHEN 'manage_member_notes' THEN
      ARRAY['view_member_notes','add_member_notes','edit_member_notes','delete_member_notes']::text[]
    WHEN 'manage_events' THEN
      ARRAY['add_events','edit_events','delete_events']::text[]
    WHEN 'manage_families' THEN
      ARRAY['add_families','edit_families','delete_families']::text[]
    WHEN 'manage_groups' THEN
      ARRAY['add_groups','edit_groups','archive_groups','restore_groups','purge_groups']::text[]
    WHEN 'manage_member_tasks' THEN
      ARRAY['add_member_tasks','edit_member_tasks','delete_member_tasks','edit_member_task_checklist','complete_member_task_checklist']::text[]
    WHEN 'manage_member_task_checklist' THEN
      ARRAY['edit_member_task_checklist','complete_member_task_checklist']::text[]
    WHEN 'manage_group_tasks' THEN
      ARRAY['add_group_tasks','edit_group_tasks','delete_group_tasks','edit_group_task_checklist','complete_group_task_checklist']::text[]
    WHEN 'manage_group_task_checklist' THEN
      ARRAY['edit_group_task_checklist','complete_group_task_checklist']::text[]
    WHEN 'manage_event_types' THEN
      ARRAY['view_event_types','add_event_types','edit_event_types','delete_event_types']::text[]
    WHEN 'manage_program_templates' THEN
      ARRAY['add_program_templates','edit_program_templates','delete_program_templates']::text[]
    WHEN 'track_attendance' THEN
      ARRAY['view_event_attendance','record_event_attendance']::text[]
    WHEN 'manage_notifications' THEN
      ARRAY['configure_notifications']::text[]
    WHEN 'manage_branches' THEN
      ARRAY['add_branches','edit_branches','delete_branches']::text[]
    WHEN 'manage_member_statuses' THEN
      ARRAY['add_member_status_options','edit_member_status_options','delete_member_status_options']::text[]
    WHEN 'manage_permissions' THEN
      ARRAY['view_roles','add_roles','edit_roles','delete_roles','assign_staff_roles']::text[]
    WHEN 'manage_staff' THEN
      ARRAY[
        'view_staff',
        'edit_staff_access',
        'view_staff_profile_groups',
        'add_staff_profile_groups',
        'edit_staff_profile_groups',
        'delete_staff_profile_groups',
        'assign_staff_profile_groups',
        'view_staff_ministry_scope',
        'edit_staff_ministry_scope',
        'assign_staff_roles'
      ]::text[]
    ELSE
      ARRAY[btrim(p)]::text[]
  END;
$f$;

CREATE OR REPLACE FUNCTION public.normalize_role_permissions_to_atomic_j(input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE
  tok text;
  piece text;
  out_arr text[] := ARRAY[]::text[];
BEGIN
  IF input IS NULL OR jsonb_typeof(input) <> 'array' THEN
    RETURN '[]'::jsonb;
  END IF;
  FOR tok IN SELECT t FROM jsonb_array_elements_text(input) AS t
  LOOP
    IF tok IS NULL OR btrim(tok) = '' THEN
      CONTINUE;
    END IF;
    FOREACH piece IN ARRAY public.expand_legacy_permission_token(tok)
    LOOP
      IF piece IS NOT NULL AND btrim(piece) <> '' THEN
        out_arr := array_append(out_arr, btrim(piece));
      END IF;
    END LOOP;
  END LOOP;
  RETURN coalesce(
    (SELECT to_jsonb(array_agg(DISTINCT u ORDER BY u)) FROM unnest(out_arr) AS u),
    '[]'::jsonb
  );
END;
$fn$;

-- Main update: jsonb / json array column
UPDATE public.roles r
SET permissions = public.normalize_role_permissions_to_atomic_j(to_jsonb(r.permissions))
WHERE r.permissions IS NOT NULL;

-- If permissions is not updated (wrong type), try casting catalog column to jsonb explicitly:
-- UPDATE public.roles r SET permissions = public.normalize_role_permissions_to_atomic_j(r.permissions::jsonb);

-- Optional: keep helpers for manual fixes / reporting
-- DROP FUNCTION IF EXISTS public.normalize_role_permissions_to_atomic_j(jsonb);
-- DROP FUNCTION IF EXISTS public.expand_legacy_permission_token(text);
