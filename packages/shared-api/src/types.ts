export interface AuthUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  organization_id: string;
  /** Display name from GET /api/auth/me (organizations.name). */
  organization_name?: string | null;
  branch_id?: string | null;
  is_super_admin?: boolean;
  is_org_owner?: boolean;
  permissions?: string[];
  profile_image?: string | null;
}

export interface AuthSessionPayload {
  token: string;
  refresh_token?: string | null;
  user: AuthUser;
}

export interface Branch {
  id: string;
  name: string;
  location?: string | null;
  organization_id?: string;
  timezone?: string | null;
  important_dates_default_reminder_time?: string | null;
}

export interface Member {
  id: string;
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  status?: string | null;
  avatar_url?: string | null;
  member_url?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

/** Up to a few members for avatar stacks on group list cards (GET /api/groups). */
export interface GroupMemberPreviewFace {
  member_id: string;
  image_url: string | null;
  initials: string;
}

/** Org/branch picklist for `groups.group_type` (Settings → Group types). */
export interface GroupTypeOption {
  id: string;
  organization_id: string;
  branch_id?: string | null;
  label: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Group {
  id: string;
  name: string;
  description?: string | null;
  group_type?: string | null;
  member_count?: number | null;
  member_preview?: GroupMemberPreviewFace[] | null;
  [key: string]: unknown;
}

export interface Family {
  id: string;
  family_name?: string | null;
  branch_id?: string | null;
  [key: string]: unknown;
}

export interface EventItem {
  id: string;
  name: string;
  description?: string | null;
  /** Stored value is the event type slug from organization settings (see GET `/api/event-types`). */
  event_type?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  location?: string | null;
  status?: string | null;
  /** Public or API-relative URL for list/detail thumbnails (server: `cover_image_url`). */
  cover_image_url?: string | null;
  /** Canonical: InPerson | Online | Hybrid */
  location_type?: string | null;
  location_details?: string | null;
  /** Video or livestream URL for Online / Hybrid events. */
  online_meeting_url?: string | null;
  [key: string]: unknown;
}

/** Row from GET /api/event-types (organization settings). */
export interface EventTypeRow {
  id: string;
  name: string;
  slug: string;
  /** When deleting another type, events/templates are reassigned to the default. */
  is_default?: boolean;
  [key: string]: unknown;
}

export interface EventUpsertPayload {
  title: string;
  start_time: string;
  end_time?: string | null;
  event_type?: string | null;
  location_type?: string | null;
  location_details?: string | null;
  online_meeting_url?: string | null;
  notes?: string | null;
  cover_image_url?: string | null;
  group_scope?: "group";
  group_id?: string | null;
  group_ids?: string[];
  assigned_member_ids?: string[];
  /** Event file attachments (same shape as web `EventAttachmentItem`). */
  attachments?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface TaskItem {
  id: string;
  title: string;
  description?: string | null;
  due_date?: string | null;
  status?: string | null;
  priority?: string | null;
  [key: string]: unknown;
}

export interface MemberNote {
  id: string;
  content: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  audioUrl?: string | null;
  audioDuration?: number | null;
  [key: string]: unknown;
}

export interface MemberImportantDate {
  id: string;
  title: string;
  description?: string | null;
  date_value: string;
  time_value?: string | null;
  date_type?: "birthday" | "anniversary" | "custom";
  is_recurring_yearly?: boolean;
  reminder_offsets?: string[];
  default_alert_enabled?: boolean;
  [key: string]: unknown;
}

export interface UpcomingImportantDateItem {
  id: string;
  member_id: string;
  member_display_name: string;
  member_image_url?: string | null;
  title: string;
  description?: string | null;
  date_type: "birthday" | "anniversary" | "custom";
  occurs_on: string;
  time_value?: string | null;
  days_until: number;
  source: "member_important_date" | "member_birthday";
  default_alert_enabled?: boolean;
  reminder_offsets?: string[];
}

export interface MemberEventItem {
  id: string;
  title?: string;
  name?: string;
  event_type?: string | null;
  status?: string | null;
  start_time?: string | null;
  start_date?: string | null;
  end_time?: string | null;
  group_name?: string | null;
  attendance_status?: string | null;
  check_in_time?: string | null;
  /** Profile id who last recorded attendance for this member on this event. */
  attendance_recorded_by_user_id?: string | null;
  /** Display name of recorder (from profiles). */
  attendance_recorded_by_name?: string | null;
  attendance_updated_at?: string | null;
  [key: string]: unknown;
}

/** Matches GET /api/custom-field-definitions (member/event/group fields). */
export interface CustomFieldDefinition {
  id: string;
  organization_id: string;
  field_key: string;
  label: string;
  field_type: string;
  sort_order?: number;
  [key: string]: unknown;
}

/** Matches GET /api/member-status-options (labels + colors for status chips). */
export interface MemberStatusOption {
  id: string;
  label: string;
  color: string | null;
  sort_order?: number;
  [key: string]: unknown;
}

export interface GroupMemberItem {
  id: string;
  first_name?: string;
  last_name?: string;
  status?: string | null;
  avatar_url?: string | null;
  member_url?: string | null;
  [key: string]: unknown;
}

export interface GroupRequestItem {
  id: string;
  status?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  created_at?: string;
  requested_at?: string;
  member_id?: string | null;
  dob?: string | null;
  email?: string | null;
  /** From `groups(name)` join on GET /api/group-requests */
  groups?: { name?: string | null } | null;
  [key: string]: unknown;
}

export interface EventAttendanceRow {
  id: string;
  member_id: string;
  status: "not_marked" | "present" | "absent" | "unsure";
  notes?: string | null;
  [key: string]: unknown;
}

export interface AppNotification {
  id: string;
  type: string;
  category: string;
  title: string;
  message: string;
  severity: "low" | "medium" | "high";
  read_at: string | null;
  created_at: string;
  entity_type: string | null;
  entity_id: string | null;
  action_path: string | null;
  payload: Record<string, unknown> | null;
}

export interface NotificationPreferences {
  mute_all: boolean;
  tasks_enabled: boolean;
  attendance_enabled: boolean;
  events_enabled: boolean;
  requests_enabled: boolean;
  assignments_enabled: boolean;
  permissions_enabled: boolean;
  member_care_enabled: boolean;
  leader_updates_enabled: boolean;
  granular_preferences: Record<string, boolean>;
}

export interface ReportKpiSummary {
  total_members: number;
  active_members: number;
  active_groups: number;
  events_in_range: number;
  open_tasks: number;
}

export interface ReportTrendPoint {
  bucket: string;
  count: number;
}

export interface ReportBreakdownPoint {
  label: string;
  count: number;
}

export interface ReportGroupPoint {
  group_id: string;
  group_name: string;
  member_count: number;
}

export interface ReportDrilldownMember {
  member_id: string;
  member_name: string;
  status: string;
  created_at: string | null;
}

export interface ReportSummaryResponse {
  kpis: ReportKpiSummary;
  trend_members: ReportTrendPoint[];
  breakdown_member_status: ReportBreakdownPoint[];
  groups_top: ReportGroupPoint[];
  drilldown_members: ReportDrilldownMember[];
}

export type ReportType = "group" | "membership" | "leader";

export interface ReportFilterPayload {
  range_days?: number;
  /** Inclusive YYYY-MM-DD; when set with `range_end`, the API uses an explicit window instead of rolling `range_days`. */
  range_start?: string;
  range_end?: string;
  /**
   * Inclusive local calendar window as absolute instants (use with `range_start` + `range_end`).
   * When set, the server uses these for event/task filtering so the report matches the UI calendar.
   */
  range_start_utc?: string;
  range_end_utc?: string;
  /** Browser clock (ISO) so server can align rolling 12m profile metrics with the member UI. */
  client_clock_iso?: string;
  group_ids?: string[];
  member_ids?: string[];
  member_id?: string;
  leader_id?: string;
  event_types?: string[];
  event_ids?: string[];
  event_search?: string;
  select_all_members?: boolean;
  /** Lowercase member `status` values to include (membership report). */
  member_statuses?: string[];
  attendance_statuses?: Array<"present" | "absent" | "unsure" | "not_marked" | "all">;
}

export interface ReportGeneratedPayload extends ReportSummaryResponse {
  report_type: ReportType;
  filters_applied: {
    range_days: number;
    range_start?: string | null;
    range_end?: string | null;
    report_window_mode?: "local_iso" | "ymd_utc" | "rolling";
    event_range_start?: string;
    event_range_end?: string;
    group_ids: string[];
    member_ids: string[];
    event_types?: string[];
    member_statuses?: string[];
    leader_id: string | null;
    attendance_statuses: string[];
  };
  kpis: ReportKpiSummary & {
    completed_tasks: number;
    attendance_total: number;
    attendance_present: number;
    attendance_absent: number;
    attendance_unsure: number;
    attendance_not_marked: number;
    attendance_rate_pct: number;
    task_completion_rate_pct: number;
    action_logs_in_range: number;
  };
  takeaways: string[];
  raw_preview_rows?: Array<Record<string, unknown>>;
  member_ministries_joined?: Array<{ member_id: string; groups: string[] }>;
}

export interface ReportDefinition {
  id: string;
  organization_id: string;
  branch_id: string;
  created_by: string;
  updated_by: string;
  name: string;
  description?: string | null;
  report_type: ReportType;
  filter_payload: ReportFilterPayload;
  output_payload: Record<string, unknown>;
  is_shared: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReportRun {
  id: string;
  definition_id: string | null;
  report_type: string;
  report_name?: string | null;
  report_description?: string | null;
  filters_summary?: string | null;
  generated_at: string;
}

export interface ReportExportResponse {
  format: "csv" | "pdf";
  filename: string;
  content: string;
  message: string;
  file_url?: string;
}

export interface ReportHistoryTableRow {
  run_id: string;
  report_name: string;
  description: string;
  date: string | null;
  data_filtered: string;
  export: {
    csv_url: string | null;
    pdf_url: string | null;
    /** @deprecated No longer created; always null. */
    graph_url: string | null;
  };
}
