-- Add `report_view` to roles that already have legacy `view_analytics`.
-- Safe to re-run.
--
-- Run:
--   psql $DATABASE_URL -f migrations/add_report_view_permission.sql

UPDATE public.roles r
SET permissions = (
  SELECT to_jsonb(array_agg(DISTINCT p ORDER BY p))
  FROM (
    SELECT jsonb_array_elements_text(to_jsonb(r.permissions)) AS p
    UNION ALL
    SELECT 'report_view'::text
  ) q
)
WHERE to_jsonb(r.permissions) ? 'view_analytics'
  AND NOT (to_jsonb(r.permissions) ? 'report_view');

