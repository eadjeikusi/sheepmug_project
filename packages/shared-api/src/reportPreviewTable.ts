/**
 * Preview table helpers: merge count + percent columns into one cell (e.g. 4/44%).
 */

export const COUNT_PCT_COMBINED_PREFIX = "__cp::";

/** Membership report: preferred column order (web + mobile preview). */
export const MEMBERSHIP_PREVIEW_COLUMN_ORDER: string[] = [
  "member_id",
  "member_name",
  "status",
  "profile_past_12m_rate_pct",
  "profile_past_12m_present",
  "profile_past_12m_past_event_total",
  "tasks_pending",
  "tasks_completed",
  "tasks_all",
  "ministries_joined",
  "attendance_present",
  "attendance_absent",
  "attendance_unsure",
  "attendance_not_marked",
  "attendance_total",
  "attendance_present_pct",
  "attendance_absent_pct",
  "attendance_unsure_pct",
  "attendance_not_marked_pct",
  "attendance_rate_pct",
];

export function orderPreviewTableColumns(
  reportType: "group" | "membership" | "leader",
  keys: string[],
): string[] {
  if (reportType !== "membership") return keys;
  const rank = (k: string) => {
    const i = MEMBERSHIP_PREVIEW_COLUMN_ORDER.indexOf(k);
    return i === -1 ? 1_000 + k.charCodeAt(0) : i;
  };
  return [...keys].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

const GROUP_COUNT_PCT_PAIRS: Array<{ count: string; pct: string }> = [
  { count: "present", pct: "present_pct" },
  { count: "absent", pct: "absent_pct" },
  { count: "unsure", pct: "unsure_pct" },
  { count: "not_marked", pct: "not_marked_pct" },
];

const MEMBERSHIP_COUNT_PCT_PAIRS: Array<{ count: string; pct: string }> = [
  { count: "attendance_present", pct: "attendance_present_pct" },
  { count: "attendance_absent", pct: "attendance_absent_pct" },
  { count: "attendance_unsure", pct: "attendance_unsure_pct" },
  { count: "attendance_not_marked", pct: "attendance_not_marked_pct" },
];

export function getCountPctPairs(
  reportType: "group" | "membership" | "leader",
): Array<{ count: string; pct: string }> {
  if (reportType === "group") return GROUP_COUNT_PCT_PAIRS;
  if (reportType === "membership") return MEMBERSHIP_COUNT_PCT_PAIRS;
  return [];
}

/** True if this column id is a merged count+percent key. */
export function isCountPctCombinedColumn(key: string): boolean {
  return key.startsWith(COUNT_PCT_COMBINED_PREFIX);
}

/** Returns the underlying count field name, or null if not a merged column id. */
export function parseCountPctCombinedKey(key: string): string | null {
  if (!isCountPctCombinedColumn(key)) return null;
  const s = key.slice(COUNT_PCT_COMBINED_PREFIX.length);
  return s.length > 0 ? s : null;
}

export function findPairForCountKey(
  reportType: "group" | "membership" | "leader",
  countKey: string,
): { count: string; pct: string } | undefined {
  return getCountPctPairs(reportType).find((p) => p.count === countKey);
}

/**
 * Insert a single column at the first index of each (count, pct) pair; drop the two originals.
 */
export function mergeCountPctColumns(
  columns: string[],
  reportType: "group" | "membership" | "leader",
): string[] {
  const pairs = getCountPctPairs(reportType);
  if (pairs.length === 0) return columns;

  const toRemove = new Set<string>();
  const combinedAtIndex = new Map<number, string>();

  for (const p of pairs) {
    const i = columns.indexOf(p.count);
    const j = columns.indexOf(p.pct);
    if (i === -1 || j === -1) continue;
    toRemove.add(p.count);
    toRemove.add(p.pct);
    const at = Math.min(i, j);
    combinedAtIndex.set(at, `${COUNT_PCT_COMBINED_PREFIX}${p.count}`);
  }

  const out: string[] = [];
  for (let i = 0; i < columns.length; i++) {
    if (combinedAtIndex.has(i)) {
      out.push(combinedAtIndex.get(i)!);
    }
    const c = columns[i];
    if (toRemove.has(c)) continue;
    out.push(c);
  }
  return out;
}

/** Format as `4/44%` (no space). */
export function formatCountAndPct(count: unknown, pct: unknown): string {
  const c =
    count === null || count === undefined
      ? "—"
      : typeof count === "number" && Number.isFinite(count)
        ? String(count)
        : String(count);

  if (pct === null || pct === undefined) {
    return `${c}/—`;
  }
  if (typeof pct === "number" && Number.isFinite(pct)) {
    return `${c}/${pct}%`;
  }
  const n = Number(pct);
  if (Number.isFinite(n)) {
    return `${c}/${n}%`;
  }
  return `${c}/—`;
}

export function formatPreviewCountPctCell(
  row: Record<string, unknown>,
  columnKey: string,
  reportType: "group" | "membership" | "leader",
): string | null {
  const countKey = parseCountPctCombinedKey(columnKey);
  if (!countKey) return null;
  const pair = findPairForCountKey(reportType, countKey);
  if (!pair) return null;
  return formatCountAndPct(row[pair.count], row[pair.pct]);
}

export function humanizeCountPctCombinedHeader(
  countKey: string,
  reportType: "group" | "membership" | "leader",
  membershipHeaderByCountKey?: Record<string, string>,
): string {
  if (reportType === "membership" && membershipHeaderByCountKey?.[countKey]) {
    return membershipHeaderByCountKey[countKey]!;
  }
  return String(countKey)
    .replace(/_/g, " ")
    .replace(/\bpct\b/gi, "%")
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}
