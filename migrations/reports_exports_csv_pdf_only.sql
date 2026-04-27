-- Drop graph as a stored export format; normalize any legacy rows.
UPDATE public.report_exports SET export_format = 'csv' WHERE export_format = 'graph';

ALTER TABLE public.report_exports
  DROP CONSTRAINT IF EXISTS report_exports_export_format_check;
ALTER TABLE public.report_exports
  ADD CONSTRAINT report_exports_export_format_check
  CHECK (export_format IN ('csv', 'pdf'));
