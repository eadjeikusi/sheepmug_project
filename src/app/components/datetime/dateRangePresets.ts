import { inclusiveLocalDayCount, toIsoDateOnly, parseIsoDateOnly } from "./dateTimeFormat";

export type PresetId =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "last90"
  | "thisMonth"
  | "lastMonth"
  | "thisYear"
  | "last365";


/** Inclusive [start, end] in local YYYY-MM-DD. */
export function computePresetRange(id: PresetId): { start: string; end: string } {
  const today = new Date();
  const tYmd = toIsoDateOnly(today);
  const s = (d: Date) => toIsoDateOnly(d);

  switch (id) {
    case "today":
      return { start: tYmd, end: tYmd };
    case "yesterday": {
      const d = new Date(today);
      d.setDate(d.getDate() - 1);
      return { start: s(d), end: s(d) };
    }
    case "last7": {
      const st = new Date(today);
      st.setDate(st.getDate() - 6);
      return { start: s(st), end: tYmd };
    }
    case "last30": {
      const st = new Date(today);
      st.setDate(st.getDate() - 29);
      return { start: s(st), end: tYmd };
    }
    case "last90": {
      const st = new Date(today);
      st.setDate(st.getDate() - 89);
      return { start: s(st), end: tYmd };
    }
    case "thisMonth": {
      const st = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: s(st), end: tYmd };
    }
    case "lastMonth": {
      const e = new Date(today.getFullYear(), today.getMonth(), 0);
      const st = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return { start: s(st), end: s(e) };
    }
    case "thisYear": {
      const st = new Date(today.getFullYear(), 0, 1);
      return { start: s(st), end: tYmd };
    }
    case "last365": {
      const st = new Date(today);
      st.setDate(st.getDate() - 364);
      return { start: s(st), end: tYmd };
    }
    default:
      return { start: tYmd, end: tYmd };
  }
}

export type PresetDef = { id: PresetId; label: string };

export const ALL_PRESETS: PresetDef[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last7", label: "Last 7 days" },
  { id: "last30", label: "Last 30 days" },
  { id: "last90", label: "Last 90 days" },
  { id: "thisMonth", label: "This month" },
  { id: "lastMonth", label: "Last month" },
  { id: "thisYear", label: "Year to date" },
  { id: "last365", label: "Last 365 days" },
];

/**
 * Presets whose inclusive span (local days) is within [minSpan, maxSpan].
 * Used to hide e.g. “Today” when the form requires at least 7 days.
 */
export function presetsWithinSpan(minSpan: number, maxSpan: number): PresetDef[] {
  return ALL_PRESETS.filter((p) => {
    const { start, end } = computePresetRange(p.id);
    const n = inclusiveLocalDayCount(start, end);
    if (n < 1) return false;
    return n >= minSpan && n <= maxSpan;
  });
}

/**
 * If the range is from a known preset, return its id; otherwise "custom" for UI.
 */
export function matchPresetId(start: string, end: string): PresetId | "custom" {
  for (const p of ALL_PRESETS) {
    const r = computePresetRange(p.id);
    if (r.start === start && r.end === end) return p.id;
  }
  return "custom";
}

export function ymdToDate(ymd: string): Date | null {
  return parseIsoDateOnly(ymd.trim()) ?? null;
}
