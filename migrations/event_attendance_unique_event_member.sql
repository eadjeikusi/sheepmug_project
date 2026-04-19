-- One attendance row per (event_id, member_id), required for upsert/ON CONFLICT and data integrity.
-- Safe to re-run: uses IF NOT EXISTS.

-- Remove duplicate rows (keep lowest ctid per pair).
DELETE FROM public.event_attendance a
WHERE EXISTS (
  SELECT 1
  FROM public.event_attendance b
  WHERE b.event_id = a.event_id
    AND b.member_id = a.member_id
    AND b.ctid < a.ctid
);

CREATE UNIQUE INDEX IF NOT EXISTS event_attendance_event_id_member_id_key
  ON public.event_attendance (event_id, member_id);
