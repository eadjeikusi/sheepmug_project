/**
 * Canonical display: "Friday 12th June, 2024"
 * Date-time: same date + " at " + locale time (e.g. 3:45 pm).
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** Three-letter weekday for compact picker labels (Sun–Sat). */
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export function ordinalDay(n: number): string {
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

/** e.g. "Friday 12th June, 2024" */
export function formatLongWeekdayDate(input: string | Date | null | undefined): string {
  if (input == null || input === '') return '';
  const d = input instanceof Date ? input : parseLocalDateString(String(input));
  if (!d || Number.isNaN(d.getTime())) return '';
  const weekday = WEEKDAYS[d.getDay()];
  const day = ordinalDay(d.getDate());
  const month = MONTHS_LONG[d.getMonth()];
  const year = d.getFullYear();
  return `${weekday} ${day} ${month}, ${year}`;
}

/** e.g. "Fri 12th Jun, 2024" — shorter label for split date/time controls */
export function formatCompactWeekdayDate(input: string | Date | null | undefined): string {
  if (input == null || input === '') return '';
  const d = input instanceof Date ? input : parseLocalDateString(String(input));
  if (!d || Number.isNaN(d.getTime())) return '';
  const weekday = WEEKDAYS_SHORT[d.getDay()];
  const day = ordinalDay(d.getDate());
  const month = MONTHS_SHORT[d.getMonth()];
  const year = d.getFullYear();
  return `${weekday} ${day} ${month}, ${year}`;
}

/** ISO / full datetime string → long date + time */
export function formatLongWeekdayDateTime(iso: string | null | undefined): string {
  if (!iso || !String(iso).trim()) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const datePart = formatLongWeekdayDate(d);
  const timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${datePart} at ${timePart}`;
}

/** Range for event list: start → end (each with date+time in long form where applicable). */
export function formatEventRangeLabel(startIso: string, endIso?: string | null): string {
  const s = new Date(startIso);
  if (Number.isNaN(s.getTime())) return '—';
  if (!endIso) return formatLongWeekdayDateTime(startIso);
  const e = new Date(endIso);
  if (Number.isNaN(e.getTime())) return formatLongWeekdayDateTime(startIso);
  const sameDay =
    s.getFullYear() === e.getFullYear() &&
    s.getMonth() === e.getMonth() &&
    s.getDate() === e.getDate();
  if (sameDay) {
    const datePart = formatLongWeekdayDate(s);
    const t1 = s.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const t2 = e.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${datePart} · ${t1} – ${t2}`;
  }
  return `${formatLongWeekdayDateTime(startIso)} → ${formatLongWeekdayDateTime(endIso)}`;
}

/** Notifications / activity: date + time on one line */
export function formatNotificationDateTime(iso: string | null | undefined): string {
  return formatLongWeekdayDateTime(iso || '');
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole calendar days from "today" (local) to the target's calendar day. */
function calendarDaysFromToday(target: Date): number {
  const today = startOfLocalDay(new Date());
  const day = startOfLocalDay(target);
  return Math.round((day.getTime() - today.getTime()) / 86400000);
}

function pluralUnit(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Human countdown by calendar day: "2 days to go", "3 weeks to go", "1 month to go",
 * "Today", or past: "2 days ago", etc.
 */
export function formatCalendarCountdown(isoOrDate: string | Date | null | undefined): string {
  if (isoOrDate == null || isoOrDate === '') return '';
  const target = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(target.getTime())) return '';
  const diffDays = calendarDaysFromToday(target);

  if (diffDays === 0) return 'Today';
  if (diffDays > 0) {
    if (diffDays < 7) {
      return `${diffDays} ${pluralUnit(diffDays, 'day', 'days')} to go`;
    }
    if (diffDays < 28) {
      const w = Math.floor(diffDays / 7);
      return `${w} ${pluralUnit(w, 'week', 'weeks')} to go`;
    }
    const m = Math.max(1, Math.floor(diffDays / 30));
    return `${m} ${pluralUnit(m, 'month', 'months')} to go`;
  }
  const abs = Math.abs(diffDays);
  if (abs < 7) {
    return `${abs} ${pluralUnit(abs, 'day', 'days')} ago`;
  }
  if (abs < 28) {
    const w = Math.floor(abs / 7);
    return `${w} ${pluralUnit(w, 'week', 'weeks')} ago`;
  }
  const m = Math.max(1, Math.floor(abs / 30));
  return `${m} ${pluralUnit(m, 'month', 'months')} ago`;
}
