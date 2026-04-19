-- One-off: randomly set members.status from that org's member_status_options.label
-- (one random label per member, uniform over all options in the same organization).
--
-- Prerequisites:
--   • public.member_status_options populated (Settings → Member statuses).
--   • public.members.status exists (see members_status_column.sql if needed).
--
-- Skips:
--   • Members whose organization has zero rows in member_status_options (status unchanged).
--
-- Run in Supabase SQL Editor (or psql).
-- If your members table has no is_deleted column, remove the WHERE line inside the CTE.

WITH pick AS (
  SELECT DISTINCT ON (m.id)
    m.id AS member_id,
    o.label AS status_label
  FROM public.members m
  INNER JOIN public.member_status_options o
    ON o.organization_id = m.organization_id
  WHERE COALESCE(m.is_deleted, false) = false
  ORDER BY m.id, random()
)
UPDATE public.members m
SET
  status = pick.status_label,
  updated_at = now()
FROM pick
WHERE m.id = pick.member_id;

-- Optional: verify distribution (uncomment)
-- SELECT status, count(*) FROM public.members WHERE COALESCE(is_deleted, false) = false GROUP BY 1 ORDER BY 2 DESC;
