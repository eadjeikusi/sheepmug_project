/**
 * Single source of truth for report column display names: preview, CSV, and PDF.
 */

import { displayMemberWords } from "./displayMemberWords";
import {
  humanizeCountPctCombinedHeader,
  orderPreviewTableColumns,
  parseCountPctCombinedKey,
} from "./reportPreviewTable";

/** Cell values that are free text in the preview table (title-case per word). */
const PREVIEW_WORD_CASE_KEYS = new Set<string>([
  "event_name",
  "event_type",
  "group_name",
  "member_name",
  "status",
  "note",
  "ministries_joined",
]);

export const GROUP_REPORT_COLUMN_LABELS: Record<string, string> = {
  total_attendance: "Total",
  event_id: "Event ID",
  event_name: "Event name",
  event_type: "Event type",
  group_id: "Group ID",
  group_name: "Group name",
  member_count: "Member count",
  events_in_range: "Events in range",
  present: "Present",
  present_pct: "Present %",
  absent: "Absent",
  absent_pct: "Absent %",
  unsure: "Unsure",
  unsure_pct: "Unsure %",
  not_marked: "Not marked",
  not_marked_pct: "Not marked %",
  note: "Note",
};

export const MEMBERSHIP_REPORT_COLUMN_LABELS: Record<string, string> = {
  profile_past_12m_rate_pct: "Use this to match profile: 12 mo. past rate",
  profile_past_12m_present: "12 mo. past — present count",
  profile_past_12m_past_event_total: "12 mo. past — past event count",
  attendance_rate_pct: "Not profile card: % for selected report dates only",
  attendance_total: "Report date range — attendance rows counted",
  attendance_present: "Report date range — present",
  attendance_absent: "Report date range — absent",
  attendance_unsure: "Report date range — unsure",
  attendance_not_marked: "Report date range — not marked",
  member_id: "Member ID",
  member_name: "Member name",
  status: "Status",
  tasks_pending: "Tasks pending",
  tasks_completed: "Tasks completed",
  tasks_all: "Tasks all",
  ministries_joined: "Ministries joined",
  attendance_present_pct: "Present %",
  attendance_absent_pct: "Absent %",
  attendance_unsure_pct: "Unsure %",
  attendance_not_marked_pct: "Not marked %",
};

export const LEADER_REPORT_COLUMN_LABELS: Record<string, string> = {
  leader_id: "Leader ID",
  group_id: "Group ID",
  group_name: "Group name",
  member_count: "Member count",
  group_tasks_pending: "Group tasks pending",
  group_tasks_completed: "Group tasks completed",
  group_tasks_all: "Group tasks all",
};

export function defaultHumanizeReportKey(key: string): string {
  return String(key)
    .replace(/_/g, " ")
    .replace(/\bpct\b/gi, "%")
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

const GROUP_KEY_ORDER: string[] = [
  "event_id",
  "event_name",
  "event_type",
  "group_id",
  "group_name",
  "member_count",
  "events_in_range",
  "total_attendance",
  "present",
  "present_pct",
  "absent",
  "absent_pct",
  "unsure",
  "unsure_pct",
  "not_marked",
  "not_marked_pct",
  "note",
];

const LEADER_KEY_ORDER: string[] = [
  "leader_id",
  "group_id",
  "group_name",
  "member_count",
  "group_tasks_pending",
  "group_tasks_completed",
  "group_tasks_all",
];

function rankInOrder(key: string, order: string[]): number {
  const i = order.indexOf(key);
  return i === -1 ? 10_000 + key.charCodeAt(0) : i;
}

/**
 * Stabilize column order for exports (match preview / logical field order, then the rest A–Z).
 */
export function orderKeysForReportExport(
  allKeys: string[],
  reportType: "group" | "membership" | "leader",
): string[] {
  if (reportType === "membership") {
    return orderPreviewTableColumns("membership", allKeys);
  }
  if (reportType === "group") {
    return [...allKeys].sort(
      (a, b) => rankInOrder(a, GROUP_KEY_ORDER) - rankInOrder(b, GROUP_KEY_ORDER) || a.localeCompare(b),
    );
  }
  if (reportType === "leader") {
    return [...allKeys].sort(
      (a, b) => rankInOrder(a, LEADER_KEY_ORDER) - rankInOrder(b, LEADER_KEY_ORDER) || a.localeCompare(b),
    );
  }
  return [...allKeys].sort((a, b) => a.localeCompare(b));
}

/**
 * One label for preview table headers, CSV header row, and PDF table head.
 */
export function getReportTableColumnLabel(
  key: string,
  reportType: "group" | "membership" | "leader",
): string {
  const ck = parseCountPctCombinedKey(key);
  if (ck) {
    return humanizeCountPctCombinedHeader(ck, reportType, MEMBERSHIP_REPORT_COLUMN_LABELS);
  }
  if (reportType === "group" && GROUP_REPORT_COLUMN_LABELS[key]) {
    return GROUP_REPORT_COLUMN_LABELS[key]!;
  }
  if (reportType === "leader" && LEADER_REPORT_COLUMN_LABELS[key]) {
    return LEADER_REPORT_COLUMN_LABELS[key]!;
  }
  if (reportType === "membership" && MEMBERSHIP_REPORT_COLUMN_LABELS[key]) {
    return MEMBERSHIP_REPORT_COLUMN_LABELS[key]!;
  }
  return defaultHumanizeReportKey(key);
}

/**
 * Text value for exported CSV / PDF (blank for null; % suffix for pct / rate-pct number columns).
 */
export function formatReportExportCellValue(value: unknown, key: string): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((v) => (v === null || v === undefined ? "" : String(v))).join("; ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  if (
    key &&
    /(_pct|_rate_pct)$/i.test(key) &&
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return `${value}%`;
  }
  return String(value);
}

/** In-app preview / modal table: null → em dash, same % rules as export. */
export function formatReportTableCellValueForPreview(value: unknown, key?: string): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    if (key === "ministries_joined") {
      return value
        .map((v) => (v == null || String(v).trim() === "" ? null : displayMemberWords(String(v))))
        .filter((s): s is string => s != null && s !== "")
        .join(", ");
    }
    return value.join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  if (
    key &&
    /(_pct|_rate_pct)$/i.test(key) &&
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return `${value}%`;
  }
  const out = String(value);
  if (
    key &&
    PREVIEW_WORD_CASE_KEYS.has(key) &&
    out.trim() !== "" &&
    out !== "—" &&
    /[a-zA-Z]/.test(out)
  ) {
    if (key.endsWith("_id") && /^[0-9a-f-]{36}$/i.test(out.trim())) return out;
    return displayMemberWords(out);
  }
  return out;
}

export function parseReportType(input: unknown): "group" | "membership" | "leader" {
  const s = String(input || "").toLowerCase();
  if (s === "membership" || s === "leader" || s === "group") return s;
  return "group";
}

export function formatReportDocumentTitle(
  reportType: unknown,
  name?: string | null,
): string {
  const t = String(name || "").trim();
  if (t) return t;
  return formatReportTypeLabel(parseReportType(reportType));
}

export function formatReportTypeLabel(
  reportType: "group" | "membership" | "leader",
): string {
  if (reportType === "group") return "Group report";
  if (reportType === "membership") return "Membership report";
  if (reportType === "leader") return "Leaders report";
  return "Report";
}
