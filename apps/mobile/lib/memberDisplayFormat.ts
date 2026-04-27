const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function ordinalDay(n: number): string {
  const j = n % 10;
  const k = n % 100;
  if (k >= 11 && k <= 13) return `${n}th`;
  if (j === 1) return `${n}st`;
  if (j === 2) return `${n}nd`;
  if (j === 3) return `${n}rd`;
  return `${n}th`;
}

/** Parse YYYY-MM-DD as local calendar date to avoid UTC off-by-one. */
function parseLocalDateString(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    const dt = new Date(y, mo, d);
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  const dt = new Date(raw);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/**
 * e.g. "Friday 12th June, 2024"
 */
export function formatLongWeekdayDate(input: string | Date | null | undefined): string {
  if (input == null || input === "") return "";
  const d = input instanceof Date ? input : parseLocalDateString(String(input));
  if (!d || Number.isNaN(d.getTime())) return "";
  const weekday = WEEKDAYS[d.getDay()];
  const day = ordinalDay(d.getDate());
  const month = MONTHS_LONG[d.getMonth()];
  const year = d.getFullYear();
  return `${weekday} ${day} ${month}, ${year}`;
}

/** e.g. "Fri 12th Jun, 2024" — compact label for split date/time rows */
export function formatCompactWeekdayDate(input: string | Date | null | undefined): string {
  if (input == null || input === "") return "";
  const d = input instanceof Date ? input : parseLocalDateString(String(input));
  if (!d || Number.isNaN(d.getTime())) return "";
  const weekday = WEEKDAYS_SHORT[d.getDay()];
  const day = ordinalDay(d.getDate());
  const month = MONTHS_SHORT[d.getMonth()];
  const year = d.getFullYear();
  return `${weekday} ${day} ${month}, ${year}`;
}

export function formatLongWeekdayDateTime(iso: string | null | undefined): string {
  if (!iso || !String(iso).trim()) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const datePart = formatLongWeekdayDate(d);
  const timePart = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${datePart} at ${timePart}`;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function calendarDaysFromToday(target: Date): number {
  const today = startOfLocalDay(new Date());
  const day = startOfLocalDay(target);
  return Math.round((day.getTime() - today.getTime()) / 86400000);
}

function pluralUnit(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** "2 days to go", "3 weeks to go", "1 month to go", "Today", or "2 days ago", … */
export function formatCalendarCountdown(isoOrDate: string | Date | null | undefined): string {
  if (isoOrDate == null || isoOrDate === "") return "";
  const target = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(target.getTime())) return "";
  const diffDays = calendarDaysFromToday(target);

  if (diffDays === 0) return "Today";
  if (diffDays > 0) {
    if (diffDays < 7) {
      return `${diffDays} ${pluralUnit(diffDays, "day", "days")} to go`;
    }
    if (diffDays < 28) {
      const w = Math.floor(diffDays / 7);
      return `${w} ${pluralUnit(w, "week", "weeks")} to go`;
    }
    const m = Math.max(1, Math.floor(diffDays / 30));
    return `${m} ${pluralUnit(m, "month", "months")} to go`;
  }
  const abs = Math.abs(diffDays);
  if (abs < 7) {
    return `${abs} ${pluralUnit(abs, "day", "days")} ago`;
  }
  if (abs < 28) {
    const w = Math.floor(abs / 7);
    return `${w} ${pluralUnit(w, "week", "weeks")} ago`;
  }
  const m = Math.max(1, Math.floor(abs / 30));
  return `${m} ${pluralUnit(m, "month", "months")} ago`;
}

function isLikelyEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function isLikelyPhone(s: string): boolean {
  const digits = s.replace(/\D/g, "");
  if (digits.length < 7) return false;
  return /^[\d\s+().-]+$/.test(s.trim());
}

/**
 * Title-case each word for API-sourced labels (names, titles, statuses, short descriptions).
 * Leaves email and phone-like strings unchanged (aside from email lowercasing).
 */
export function displayMemberWords(s: string): string {
  const t = s.trim();
  if (!t) return t;
  if (t === "—" || t === "-" || t === "N/A") return t;
  if (isLikelyEmail(t)) return t.toLowerCase();
  if (isLikelyPhone(t)) return t;
  return t
    .split(/\s+/)
    .map((w) => {
      if (!w) return w;
      if (/^\d/.test(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

/** Uppercase only the first character; use for longer API text where per-word title case is wrong. */
export function capitalizeLeadingChar(s: string): string {
  const t = String(s || "").trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Title-style caps for each word (report cards, table cells). */
export function toTitleCaseWords(input: string): string {
  const t = String(input || "").trim();
  if (!t) return t;
  return t.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/** For placeholders like "—" / "N/A", return as-is; otherwise format words. */
export function displayMemberField(raw: string, emptyPlaceholder: string): string {
  const t = raw.trim();
  if (!t || t === "—" || t === "N/A" || t === "-") return emptyPlaceholder;
  return displayMemberWords(t);
}
