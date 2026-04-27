/** `YYYY-MM-DD` from a local calendar date. */
export function toYmd(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** Parse leading `YYYY-MM-DD` as local date at noon (stable for pickers). */
export function parseYmdToLocalDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Inclusive number of local calendar days between two `YYYY-MM-DD` strings. 0 if invalid. */
export function inclusiveLocalDayCount(ymdA: string, ymdB: string): number {
  const a = parseYmdToLocalDate(ymdA);
  const b = parseYmdToLocalDate(ymdB);
  if (!a || !b) return 0;
  const d0 = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const d1 = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  if (d1.getTime() < d0.getTime()) return 0;
  return Math.floor((d1.getTime() - d0.getTime()) / (24 * 60 * 60 * 1000)) + 1;
}

export function newDefaultReportDateRangeYmd() {
  const e = new Date();
  const s = new Date();
  s.setDate(s.getDate() - 90);
  return { start: toYmd(s), end: toYmd(e) };
}

/** Quick ranges (inclusive), aligned with web report builder presets. */
export type ReportDatePresetId = "last7" | "last30" | "last90" | "thisMonth" | "ytd";

export function applyReportDatePreset(preset: ReportDatePresetId): { start: string; end: string } {
  const end = new Date();
  end.setHours(12, 0, 0, 0);
  const start = new Date(end);
  if (preset === "last7") {
    start.setDate(start.getDate() - 6);
  } else if (preset === "last30") {
    start.setDate(start.getDate() - 29);
  } else if (preset === "last90") {
    start.setDate(start.getDate() - 89);
  } else if (preset === "thisMonth") {
    start.setDate(1);
  } else {
    start.setMonth(0, 1);
  }
  if (start.getTime() > end.getTime()) return { start: toYmd(end), end: toYmd(end) };
  return { start: toYmd(start), end: toYmd(end) };
}

/** Inclusive local [start, end] as ISO instants for the API (aligns with web report). */
export function localDayBoundsToIso(ymdStart: string, ymdEnd: string): { start: string; end: string } | null {
  const a = parseYmdToLocalDate(ymdStart);
  const b = parseYmdToLocalDate(ymdEnd);
  if (!a || !b) return null;
  const s = new Date(a.getFullYear(), a.getMonth(), a.getDate(), 0, 0, 0, 0);
  const e = new Date(b.getFullYear(), b.getMonth(), b.getDate(), 23, 59, 59, 999);
  return { start: s.toISOString(), end: e.toISOString() };
}

/** Due date as ISO at local noon (matches member task create flow). */
export function ymdToDueAtIso(ymd: string): string | null {
  const d = parseYmdToLocalDate(ymd.trim());
  if (!d) return null;
  return d.toISOString();
}

/** `HH:mm` 24h from a Date's local clock. */
export function toHHmm(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function formatTime12h(timeHHmm: string): string {
  const t = timeHHmm.trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return t;
  let h = parseInt(m[1], 10) % 24;
  const mi = parseInt(m[2], 10);
  if (!Number.isFinite(mi) || mi > 59) return t;
  const am = h < 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(mi).padStart(2, "0")} ${am ? "AM" : "PM"}`;
}

/**
 * Parse ISO or datetime-local-shaped strings into local calendar date + `HH:mm`.
 */
export function parseFlexibleDateTime(raw: string): { calDate: Date; timeHHmm: string } | null {
  const t = raw.trim();
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  const calDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return { calDate, timeHHmm: toHHmm(d) };
}

/** `YYYY-MM-DDTHH:mm` interpreted as local wall time (no timezone suffix). */
export function toLocalDateTimeString(calDate: Date, timeHHmm: string): string {
  const parts = timeHHmm.trim().split(":");
  const hh = parseInt(parts[0] ?? "", 10);
  const mm = parseInt(parts[1] ?? "", 10);
  const dt = new Date(
    calDate.getFullYear(),
    calDate.getMonth(),
    calDate.getDate(),
    Number.isFinite(hh) ? hh : 0,
    Number.isFinite(mm) ? mm : 0,
    0,
    0
  );
  const y = dt.getFullYear();
  const mo = String(dt.getMonth() + 1).padStart(2, "0");
  const da = String(dt.getDate()).padStart(2, "0");
  const h = String(dt.getHours()).padStart(2, "0");
  const mi = String(dt.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${da}T${h}:${mi}`;
}
