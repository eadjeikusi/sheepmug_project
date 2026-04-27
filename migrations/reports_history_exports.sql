-- Reports history/export enhancements and branch-report removal.
-- Safe to re-run.

ALTER TABLE public.report_definitions
  ADD COLUMN IF NOT EXISTS description text NULL;

ALTER TABLE public.report_runs
  ADD COLUMN IF NOT EXISTS report_name text NULL,
  ADD COLUMN IF NOT EXISTS report_description text NULL,
  ADD COLUMN IF NOT EXISTS filters_summary text NULL;

ALTER TABLE public.report_exports
  ADD COLUMN IF NOT EXISTS file_url text NULL,
  ADD COLUMN IF NOT EXISTS storage_path text NULL,
  ADD COLUMN IF NOT EXISTS file_size bigint NULL,
  ADD COLUMN IF NOT EXISTS mime_type text NULL,
  ADD COLUMN IF NOT EXISTS file_content text NULL;

ALTER TABLE public.report_exports
  DROP CONSTRAINT IF EXISTS report_exports_export_format_check;
ALTER TABLE public.report_exports
  ADD CONSTRAINT report_exports_export_format_check
  CHECK (export_format IN ('csv', 'pdf', 'graph'));

ALTER TABLE public.report_definitions
  DROP CONSTRAINT IF EXISTS report_definitions_report_type_check;
ALTER TABLE public.report_definitions
  ADD CONSTRAINT report_definitions_report_type_check
  CHECK (report_type IN ('group', 'membership', 'leader'));

ALTER TABLE public.report_runs
  DROP CONSTRAINT IF EXISTS report_runs_report_type_check;
ALTER TABLE public.report_runs
  ADD CONSTRAINT report_runs_report_type_check
  CHECK (report_type IN ('group', 'membership', 'leader'));

CREATE INDEX IF NOT EXISTS idx_report_exports_file_url
  ON public.report_exports (file_url);

