import * as Notifications from "expo-notifications";
import { getOfflineResourceCache } from "./storage";
import { devWarn } from "./devLog";

const LOCAL_REMINDER_SOURCE = "local_task_reminder_v1";
const MAX_SCHEDULED_REMINDERS = 40;
const UPCOMING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_FIRE_OFFSET_MS = 60 * 1000;
const REMINDER_LEAD_MS = 60 * 60 * 1000;

type TaskReminderCandidate = {
  id: string;
  title: string;
  dueAtMs: number;
  memberId: string | null;
};

type CachedTasksPayload = {
  tasks?: unknown[];
};

function parseUuidLike(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s.length > 0 ? s : null;
}

function normalizeTaskRow(row: unknown): TaskReminderCandidate | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const rec = row as Record<string, unknown>;
  const id = parseUuidLike(rec.id);
  if (!id) return null;
  const status = String(rec.status ?? "").trim().toLowerCase();
  if (status === "done" || status === "completed" || status === "cancelled") return null;
  const dueAtRaw = String(rec.due_at ?? "").trim();
  if (!dueAtRaw) return null;
  const dueAtMs = new Date(dueAtRaw).getTime();
  if (!Number.isFinite(dueAtMs)) return null;
  const title = String(rec.title ?? "Task").trim() || "Task";
  const memberId = parseUuidLike(rec.member_id);
  return { id, title, dueAtMs, memberId };
}

function formatDueLabel(dueAtMs: number): string {
  try {
    return new Date(dueAtMs).toLocaleString();
  } catch {
    return "soon";
  }
}

async function getCachedTasks(): Promise<TaskReminderCandidate[]> {
  const keys = ["tasks:list", "tasks:list:bootstrap", "tasks:list:mine:all::::::all"];
  for (const key of keys) {
    const cache = await getOfflineResourceCache<CachedTasksPayload>(key);
    const rows = Array.isArray(cache?.data?.tasks) ? cache?.data?.tasks : [];
    if (rows.length === 0) continue;
    const normalized = rows.map(normalizeTaskRow).filter((x): x is TaskReminderCandidate => Boolean(x));
    if (normalized.length > 0) return normalized;
  }
  return [];
}

function buildReminderCandidates(tasks: TaskReminderCandidate[]): TaskReminderCandidate[] {
  const now = Date.now();
  const dedup = new Map<string, TaskReminderCandidate>();
  for (const task of tasks) {
    if (task.dueAtMs < now - 24 * 60 * 60 * 1000) continue;
    if (task.dueAtMs > now + UPCOMING_WINDOW_MS) continue;
    const prev = dedup.get(task.id);
    if (!prev || task.dueAtMs < prev.dueAtMs) dedup.set(task.id, task);
  }
  return [...dedup.values()].sort((a, b) => a.dueAtMs - b.dueAtMs).slice(0, MAX_SCHEDULED_REMINDERS);
}

function buildTriggerDate(dueAtMs: number): Date {
  const now = Date.now();
  const reminderAt = dueAtMs - REMINDER_LEAD_MS;
  const triggerMs = Math.max(reminderAt, now + MIN_FIRE_OFFSET_MS);
  return new Date(triggerMs);
}

async function clearScheduledLocalTaskReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const ours = scheduled.filter((n) => {
    const data = (n.content.data || {}) as Record<string, unknown>;
    return String(data.reminder_source || "") === LOCAL_REMINDER_SOURCE;
  });
  await Promise.all(ours.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
}

export async function cancelLocalTaskReminders(): Promise<void> {
  try {
    await clearScheduledLocalTaskReminders();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    devWarn("local reminders: cancel failed", msg);
  }
}

export async function rescheduleLocalTaskRemindersFromCache(): Promise<void> {
  try {
    const perms = await Notifications.getPermissionsAsync();
    let status = perms.status;
    if (status !== "granted") {
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }
    if (status !== "granted") return;

    const cached = await getCachedTasks();
    const tasks = buildReminderCandidates(cached);

    await clearScheduledLocalTaskReminders();
    await Promise.all(
      tasks.map((task) =>
        Notifications.scheduleNotificationAsync({
          content: {
            title: "Task reminder",
            body: `${task.title} is due ${formatDueLabel(task.dueAtMs)}.`,
            sound: true,
            data: {
              reminder_source: LOCAL_REMINDER_SOURCE,
              action_path: task.memberId ? `/members/${task.memberId}` : "/tasks",
              payload: {
                task_id: task.id,
                task_title: task.title,
                due_at: new Date(task.dueAtMs).toISOString(),
                member_id: task.memberId,
                entity_type: "task",
                entity_id: task.id,
              },
            },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: buildTriggerDate(task.dueAtMs),
          },
        })
      )
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    devWarn("local reminders: reschedule failed", msg);
  }
}
