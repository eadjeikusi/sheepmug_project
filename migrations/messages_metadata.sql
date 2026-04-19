-- Optional enrichment for bulk SMS rows (Hubtel integration will read metadata + status).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN messages.metadata IS 'JSON: channel, group_ids, include_subgroups, recipient_count, recurrence, member_id, recipient_label, etc.';
