/** Local calendar day at midnight. */
export function stripLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function compareDay(a: Date, b: Date): number {
  return stripLocalDay(a).getTime() - stripLocalDay(b).getTime();
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export type CalendarCell = { date: Date; inCurrentMonth: boolean };

/** Weeks for `monthIndex` (0–11), Sunday-first rows, including outside-month padding. */
export function buildMonthGrid(year: number, monthIndex: number): CalendarCell[] {
  const first = new Date(year, monthIndex, 1);
  const startPad = first.getDay();
  const dim = daysInMonth(year, monthIndex);
  const out: CalendarCell[] = [];
  for (let i = 0; i < startPad; i++) {
    const d = new Date(year, monthIndex, 1 - startPad + i);
    out.push({ date: d, inCurrentMonth: false });
  }
  for (let day = 1; day <= dim; day++) {
    out.push({ date: new Date(year, monthIndex, day), inCurrentMonth: true });
  }
  while (out.length % 7 !== 0) {
    const last = out[out.length - 1]!.date;
    const d = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
    out.push({ date: d, inCurrentMonth: false });
  }
  return out;
}
