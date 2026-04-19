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
