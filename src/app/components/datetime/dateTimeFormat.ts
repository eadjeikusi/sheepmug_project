import { format, parse, isValid } from "date-fns";
import { formatCompactWeekdayDate, formatLongWeekdayDate } from "../../utils/dateDisplayFormat";

/** `YYYY-MM-DD` */
export function parseIsoDateOnly(s: string): Date | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const d = parse(t, "yyyy-MM-dd", new Date());
  return isValid(d) ? d : undefined;
}

/** `YYYY-MM-DDTHH:mm` (same as `datetime-local` value shape; optional seconds stripped) */
export function parseDateTimeLocalValue(s: string): { date: Date; timeHHmm: string } | null {
  const t = s.trim();
  if (!t) return null;
  const m = t.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?/);
  if (!m) return null;
  const d = parse(`${m[1]} ${m[2]}`, "yyyy-MM-dd HH:mm", new Date());
  return isValid(d) ? { date: d, timeHHmm: m[2] } : null;
}

export function toDateTimeLocalString(date: Date, timeHHmm: string): string {
  const [hh, mm] = timeHHmm.split(":").map((x) => parseInt(x, 10));
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const da = String(date.getDate()).padStart(2, "0");
  const h = Number.isFinite(hh) ? String(hh).padStart(2, "0") : "00";
  const mi = Number.isFinite(mm) ? String(mm).padStart(2, "0") : "00";
  return `${y}-${mo}-${da}T${h}:${mi}`;
}

export function toIsoDateOnly(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const da = String(date.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

export function formatDateLong(date: Date): string {
  return formatLongWeekdayDate(date);
}

/** Compact date for `DateTimePickerField` triggers — fits narrow split controls. */
export function formatDateCompactPicker(date: Date): string {
  return formatCompactWeekdayDate(date);
}

export function formatTime12h(timeHHmm: string): string {
  const t = timeHHmm.trim();
  if (!t) return "";
  const d = parse(`2000-01-01 ${t}`, "yyyy-MM-dd HH:mm", new Date());
  return isValid(d) ? format(d, "h:mm a") : t;
}

/** `YYYY-MM` month key */
export function parseYearMonth(s: string): Date | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const d = parse(t + "-01", "yyyy-MM-dd", new Date());
  return isValid(d) ? d : undefined;
}

export function toYearMonthString(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${mo}`;
}

export function formatMonthYear(date: Date): string {
  return format(date, "MMMM yyyy");
}
