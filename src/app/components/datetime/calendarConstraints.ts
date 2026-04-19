/** Local calendar day at midnight (no time component drift). */
export function stripLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function isDayBefore(a: Date, b: Date): boolean {
  return stripLocalDay(a).getTime() < stripLocalDay(b).getTime();
}

export function isDayAfter(a: Date, b: Date): boolean {
  return stripLocalDay(a).getTime() > stripLocalDay(b).getTime();
}

/** Default range so react-day-picker month/year dropdowns are enabled. */
export const CALENDAR_FROM_FALLBACK = new Date(1900, 0, 1);
export const CALENDAR_TO_FALLBACK = new Date(2100, 11, 31);
