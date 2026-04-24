import * as Notifications from "expo-notifications";
import type { AuthUser, EventItem, Member, MemberEventItem } from "@sheepmug/shared-api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getOfflineResourceCache, getStoredUserJson } from "./storage";
import { devWarn } from "./devLog";
import { displayMemberWords } from "./memberDisplayFormat";

const ATTENDANCE_NUDGE_SOURCE = "local_attendance_nudge_v1";
const MISSED_STREAK_SOURCE = "local_missed_events_streak_v1";

const MAX_ATTENDANCE_NUDGES = 28;
const MAX_MISSED_STREAK_NUDGES = 24;
const MIN_FIRE_OFFSET_MS = 60 * 1000;
const NUDGE_AFTER_START_MS = 24 * 60 * 60 * 1000;
/** Do not schedule catch-up nudges for events that started longer ago than this. */
const ATTENDANCE_NUDGE_MAX_EVENT_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** Only schedule nudges up to this far ahead (event start + 24h). */
const ATTENDANCE_NUDGE_MAX_AHEAD_MS = 45 * 24 * 60 * 60 * 1000;
/** Avoid re-scheduling the same missed-streak local notification too often. */
const MISSED_STREAK_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function visitedStorageKey(userId: string, eventId: string): string {
  return `attendance_tab_visited_v1:${userId}:${eventId}`;
}

function missedStreakSentKey(userId: string, memberId: string): string {
  return `missed_streak_nudge_sent_v1:${userId}:${memberId}`;
}

function parseUuidLike(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s.length > 0 ? s : null;
}

function eventStartMs(ev: EventItem): number | null {
  const r = ev as EventItem & { start_time?: string | null };
  const raw = r.start_time ?? ev.start_date;
  if (!raw || !String(raw).trim()) return null;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? null : t;
}

function eventIsCancelled(ev: EventItem): boolean {
  const s = String(ev.status ?? "").trim().toLowerCase();
  return s === "cancelled" || s === "canceled";
}

function authUserFromStorageJson(raw: string | null): AuthUser | null {
  if (!raw || !raw.trim()) return null;
  try {
    const u = JSON.parse(raw) as AuthUser;
    if (u && typeof u === "object" && typeof u.id === "string" && u.id.trim()) return u;
  } catch {
    /* ignore */
  }
  return null;
}

function userCanTrackAttendance(user: AuthUser | null): boolean {
  if (!user) return false;
  if (user.is_super_admin || user.is_org_owner) return true;
  const perms = user.permissions;
  if (!Array.isArray(perms)) return false;
  return perms.some((p) => {
    const x = String(p).trim();
    return (
      x === "track_attendance" ||
      x === "view_event_attendance" ||
      x === "record_event_attendance"
    );
  });
}

function isPresentAttendance(status: string | null | undefined): boolean {
  return String(status || "").trim().toLowerCase() === "present";
}

function memberHasTwoConsecutiveMissedPastEvents(events: MemberEventItem[]): boolean {
  const now = Date.now();
  const dated = events
    .map((e) => ({ e, t: new Date(e.start_time || 0).getTime() }))
    .filter((x) => Number.isFinite(x.t) && x.t < now)
    .sort((a, b) => a.t - b.t);
  if (dated.length < 2) return false;
  const lastTwo = dated.slice(-2);
  return lastTwo.every((x) => !isPresentAttendance(x.e.attendance_status));
}

async function clearScheduledBySource(source: string): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const ours = scheduled.filter((n) => {
    const data = (n.content.data || {}) as Record<string, unknown>;
    return String(data.reminder_source || "") === source;
  });
  await Promise.all(ours.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
}

async function clearScheduledAttendanceNudgesForEvent(eventId: string): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const ours = scheduled.filter((n) => {
    const data = (n.content.data || {}) as Record<string, unknown>;
    if (String(data.reminder_source || "") !== ATTENDANCE_NUDGE_SOURCE) return false;
    return String(data.event_id || "") === eventId;
  });
  await Promise.all(ours.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
}

export async function cancelLocalAttendanceReminders(): Promise<void> {
  try {
    await clearScheduledBySource(ATTENDANCE_NUDGE_SOURCE);
    await clearScheduledBySource(MISSED_STREAK_SOURCE);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    devWarn("local attendance reminders: cancel failed", msg);
  }
}

/**
 * Call when the user opens the attendance tab on an event so we stop nudging for that event.
 */
export async function markAttendanceTabVisitedForEvent(eventId: string): Promise<void> {
  const id = String(eventId || "").trim();
  if (!id) return;
  try {
    const user = authUserFromStorageJson(await getStoredUserJson());
    const userId = user?.id?.trim();
    if (userId) {
      await AsyncStorage.setItem(visitedStorageKey(userId, id), "1");
    }
    await clearScheduledAttendanceNudgesForEvent(id);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    devWarn("local attendance reminders: mark visited failed", msg);
  }
}

async function hasAttendanceTabVisited(userId: string, eventId: string): Promise<boolean> {
  const v = await AsyncStorage.getItem(visitedStorageKey(userId, eventId));
  return v === "1";
}

type CachedEventsPayload = { events?: EventItem[] };
type CachedMembersPayload = { members?: Member[] };
type CachedMemberDetailPayload = { events?: MemberEventItem[]; member?: Member | null };

async function getCachedEventsList(): Promise<EventItem[]> {
  const keys = ["events:list"];
  for (const key of keys) {
    const cache = await getOfflineResourceCache<CachedEventsPayload>(key);
    const rows = Array.isArray(cache?.data?.events) ? cache!.data!.events! : [];
    if (rows.length > 0) return rows;
  }
  return [];
}

async function getCachedMemberIds(): Promise<string[]> {
  const cache = await getOfflineResourceCache<CachedMembersPayload>("members:list");
  const rows = Array.isArray(cache?.data?.members) ? cache!.data!.members! : [];
  const ids = rows.map((m) => parseUuidLike(m.id)).filter((x): x is string => Boolean(x));
  return [...new Set(ids)];
}

function memberDisplayName(m: Member | null | undefined): string {
  if (!m) return "Member";
  const raw = `${m.first_name || ""} ${m.last_name || ""}`.trim();
  return raw ? displayMemberWords(raw) : "Member";
}

export async function rescheduleLocalAttendanceRemindersFromCache(): Promise<void> {
  try {
    const user = authUserFromStorageJson(await getStoredUserJson());
    if (!userCanTrackAttendance(user)) return;

    const perms = await Notifications.getPermissionsAsync();
    let status = perms.status;
    if (status !== "granted") {
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }
    if (status !== "granted") return;

    const userId = String(user?.id || "").trim();
    if (!userId) return;

    const now = Date.now();

    await clearScheduledBySource(ATTENDANCE_NUDGE_SOURCE);

    const events = await getCachedEventsList();
    const attendanceNudgeAt: { eventId: string; title: string; fireAt: Date }[] = [];

    for (const ev of events) {
      const eventId = parseUuidLike(ev.id);
      if (!eventId || eventIsCancelled(ev)) continue;
      const startMs = eventStartMs(ev);
      if (startMs == null) continue;
      if (await hasAttendanceTabVisited(userId, eventId)) continue;

      const nudgeAtMs = startMs + NUDGE_AFTER_START_MS;
      if (nudgeAtMs > now + ATTENDANCE_NUDGE_MAX_AHEAD_MS) continue;

      if (nudgeAtMs <= now) {
        if (now - startMs > ATTENDANCE_NUDGE_MAX_EVENT_AGE_MS) continue;
      }

      const title = displayMemberWords(String((ev as EventItem & { title?: string }).title || ev.name || "Event"));
      const fireMs = Math.max(nudgeAtMs, now + MIN_FIRE_OFFSET_MS);
      attendanceNudgeAt.push({ eventId, title, fireAt: new Date(fireMs) });
    }

    attendanceNudgeAt.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
    const attendanceSlice = attendanceNudgeAt.slice(0, MAX_ATTENDANCE_NUDGES);

    await Promise.all(
      attendanceSlice.map((row) =>
        Notifications.scheduleNotificationAsync({
          content: {
            title: "Attendance reminder",
            body: `You have not opened attendance for "${row.title}". Tap to review or finish marking.`,
            sound: true,
            data: {
              reminder_source: ATTENDANCE_NUDGE_SOURCE,
              action_path: `/events/${row.eventId}?tab=attendance`,
              event_id: row.eventId,
              payload: {
                entity_type: "event",
                entity_id: row.eventId,
                event_id: row.eventId,
              },
            },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: row.fireAt,
          },
        })
      )
    );

    const memberIds = await getCachedMemberIds();
    const scheduledAll = await Notifications.getAllScheduledNotificationsAsync();
    const missedScheduled = scheduledAll.filter((n) => {
      const data = (n.content.data || {}) as Record<string, unknown>;
      return String(data.reminder_source || "") === MISSED_STREAK_SOURCE;
    });
    const scheduledMissedByMember = new Map<string, string>();
    for (const n of missedScheduled) {
      const data = (n.content.data || {}) as Record<string, unknown>;
      const p = data.payload;
      const mid =
        parseUuidLike(data.member_id) ||
        (p && typeof p === "object" && !Array.isArray(p)
          ? parseUuidLike((p as Record<string, unknown>).member_id)
          : null);
      if (mid) scheduledMissedByMember.set(mid, n.identifier);
    }

    const streakMemberIds: string[] = [];
    for (const memberId of memberIds) {
      const detail = await getOfflineResourceCache<CachedMemberDetailPayload>(`member:detail:${memberId}`);
      const evs = Array.isArray(detail?.data?.events) ? detail!.data!.events! : [];
      if (!memberHasTwoConsecutiveMissedPastEvents(evs)) continue;
      streakMemberIds.push(memberId);
    }
    streakMemberIds.sort();
    const wantedMissed = new Set(streakMemberIds.slice(0, MAX_MISSED_STREAK_NUDGES));

    for (const [memberId, identifier] of scheduledMissedByMember) {
      if (!wantedMissed.has(memberId)) {
        await Notifications.cancelScheduledNotificationAsync(identifier);
        await AsyncStorage.removeItem(missedStreakSentKey(userId, memberId));
      }
    }

    for (const memberId of wantedMissed) {
      if (scheduledMissedByMember.has(memberId)) continue;
      const sentRaw = await AsyncStorage.getItem(missedStreakSentKey(userId, memberId));
      if (sentRaw) {
        const sentMs = new Date(sentRaw).getTime();
        if (Number.isFinite(sentMs) && now - sentMs < MISSED_STREAK_COOLDOWN_MS) continue;
      }
      const detail = await getOfflineResourceCache<CachedMemberDetailPayload>(`member:detail:${memberId}`);
      const name = memberDisplayName(detail?.data?.member ?? null);
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Missed events",
          body: `${name} was not marked present for the last two events in a row. Tap to follow up.`,
          sound: true,
          data: {
            reminder_source: MISSED_STREAK_SOURCE,
            action_path: `/members/${memberId}`,
            member_id: memberId,
            payload: {
              entity_type: "member",
              entity_id: memberId,
              member_id: memberId,
            },
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(now + MIN_FIRE_OFFSET_MS),
        },
      });
      await AsyncStorage.setItem(missedStreakSentKey(userId, memberId), new Date().toISOString());
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    devWarn("local attendance reminders: reschedule failed", msg);
  }
}
