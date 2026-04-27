-- Reports builder persistence for saved definitions, runs, exports, and action logs.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.report_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  updated_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) > 0),
  report_type text NOT NULL CHECK (report_type IN ('branch', 'group', 'membership', 'leader')),
  filter_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_shared boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_definitions_org_branch
  ON public.report_definitions (organization_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_report_definitions_type
  ON public.report_definitions (report_type);
CREATE INDEX IF NOT EXISTS idx_report_definitions_created_by
  ON public.report_definitions (created_by);

CREATE TABLE IF NOT EXISTS public.report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  definition_id uuid NULL REFERENCES public.report_definitions(id) ON DELETE SET NULL,
  report_type text NOT NULL CHECK (report_type IN ('branch', 'group', 'membership', 'leader')),
  filter_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_runs_org_branch_generated
  ON public.report_runs (organization_id, branch_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_runs_definition
  ON public.report_runs (definition_id);

CREATE TABLE IF NOT EXISTS public.report_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  run_id uuid NULL REFERENCES public.report_runs(id) ON DELETE SET NULL,
  definition_id uuid NULL REFERENCES public.report_definitions(id) ON DELETE SET NULL,
  export_format text NOT NULL CHECK (export_format IN ('csv', 'pdf')),
  exported_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  exported_at timestamptz NOT NULL DEFAULT now(),
  export_meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_report_exports_org_branch_exported
  ON public.report_exports (organization_id, branch_id, exported_at DESC);

CREATE TABLE IF NOT EXISTS public.audit_action_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('added', 'edited', 'deleted')),
  target_type text NOT NULL,
  target_id uuid NULL,
  target_label text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_action_logs_org_branch_created
  ON public.audit_action_logs (organization_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action_logs_target
  ON public.audit_action_logs (target_type, target_id);

