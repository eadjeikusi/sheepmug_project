/**
 * Attendance may be recorded at earliest 5 minutes before the event's scheduled start.
 * (Aligned with web + server validation.)
 */
export const ATTENDANCE_EARLY_OPEN_MS = 5 * 60 * 1000;

export function eventStartMsFromRow(
  row: { start_time?: string | null; start_date?: string | null } | null | undefined,
): number | null {
  const raw = row?.start_time || row?.start_date;
  if (raw == null || String(raw).trim() === "") return null;
  const t = new Date(String(raw));
  const ms = t.getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function attendanceRecordingOpensAtMs(eventStartMs: number): number {
  return eventStartMs - ATTENDANCE_EARLY_OPEN_MS;
}

export type AttendanceRecordingGateResult =
  | { allowed: true; opensAtMs: number }
  | { allowed: false; opensAtMs: number; userMessage: string };

/**
 * @param nowMs - pass `Date.now()` or a test clock. When `eventStartMs` is null, recording is **allowed**
 *  (legacy events with no start — the 5‑minute rule cannot apply).
 */
export function gateAttendanceRecording(
  eventStartMs: number | null,
  nowMs: number = Date.now(),
): AttendanceRecordingGateResult {
  if (eventStartMs == null) {
    return { allowed: true, opensAtMs: nowMs };
  }
  const opensAtMs = attendanceRecordingOpensAtMs(eventStartMs);
  if (nowMs < opensAtMs) {
    return {
      allowed: false,
      opensAtMs,
      userMessage: `Attendance opens 5 minutes before the scheduled start (${new Date(opensAtMs).toLocaleString()}).`,
    };
  }
  return { allowed: true, opensAtMs };
}
