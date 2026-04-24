-- Run only if you previously applied group_leaders.sql and want to remove the table.
-- Safe to run when switching back to single groups.leader_id only.

DROP TABLE IF EXISTS public.group_leaders;
