-- Event file attachments: PDFs, documents, etc. (max 50 MB per file enforced in API upload).
-- Each element: { "storage_path" (preferred), optional legacy "url", "name", optional size_bytes, content_type, uploaded_at }.
-- Files live under member-images bucket path event-files/...; clients download via GET /api/download-event-file.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.events.attachments IS 'JSON array: storage_path?, url? (legacy), name, size_bytes?, content_type?, uploaded_at?';
