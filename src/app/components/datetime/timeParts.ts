/** Parse `HH:mm` to 12h clock + AM/PM for picker UI. */
export function hhmmToParts(hhmm: string): { hour12: number; minute: number; isPm: boolean } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  const hh = m ? Math.min(23, Math.max(0, parseInt(m[1], 10))) : 0;
  const minute = m ? Math.min(59, Math.max(0, parseInt(m[2], 10))) : 0;
  const isPm = hh >= 12;
  let hour12 = hh % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour12, minute, isPm };
}

/** Build `HH:mm` from 12h clock (1–12) + AM/PM. */
export function partsToHHmm(hour12: number, minute: number, isPm: boolean): string {
  let h24 = hour12 % 12;
  if (isPm) h24 += 12;
  return `${String(h24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
