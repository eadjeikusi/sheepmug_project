-- Remove retired atomic permission id send_notifications from role JSON arrays.
-- App code no longer defines this id; expandStoredPermissionIds maps it to nothing via LEGACY_PERMISSION_ALIASES.

UPDATE public.roles r
SET permissions = (
  SELECT coalesce(jsonb_agg(elem), '[]'::jsonb)
  FROM jsonb_array_elements_text(r.permissions::jsonb) AS t(elem)
  WHERE t.elem <> 'send_notifications'
)
WHERE r.permissions::text LIKE '%send_notifications%';
