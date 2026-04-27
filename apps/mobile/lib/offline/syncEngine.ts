import { ApiError, gateAttendanceRecording, eventStartMsFromRow } from "@sheepmug/shared-api";
import { api } from "../api";
import { devLog, devWarn } from "../devLog";
import { runOfflineBootstrap } from "./bootstrap";
import { getOfflineManifest, patchOfflineManifest } from "./manifest";
import {
  getLastSyncAt,
  getOutboxItems,
  markLastSyncAt,
  updateOutboxItem,
} from "./outbox";
import type { OfflineQueueItem, SyncRunStats } from "./types";

function isLikelyOfflineError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const msg = error instanceof Error ? error.message : String(error || "");
  return /network|fetch|timed out|failed to connect|ECONNREFUSED|ENOTFOUND|aborted/i.test(msg);
}

function isForbiddenError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

function isChecklistOnlyTaskPatch(body: Record<string, unknown>): boolean {
  const keys = Object.keys(body);
  if (keys.length !== 1 || !keys.includes("checklist")) return false;
  const checklist = body.checklist;
  return Array.isArray(checklist);
}

async function runOne(item: OfflineQueueItem): Promise<Record<string, unknown>> {
  if (item.operation === "member_create") {
    const created = await api.members.create(item.payload);
    return {
      operation: item.operation,
      member_id: created?.id ?? null,
      member_name: `${String(created?.first_name || "")} ${String(created?.last_name || "")}`.trim(),
    };
  }

  if (item.operation === "attendance_update") {
    const eventId = String(item.payload.event_id || "").trim();
    const updates = Array.isArray(item.payload.updates)
      ? (item.payload.updates as Array<{
          member_id: string;
          status: "not_marked" | "present" | "absent" | "unsure";
        }>)
      : [];
    if (!eventId || updates.length === 0) throw new Error("Invalid attendance payload.");
    const startIso = typeof item.payload.event_start_iso === "string" ? item.payload.event_start_iso.trim() : null;
    const startMs = eventStartMsFromRow({ start_time: startIso, start_date: null });
    const g = gateAttendanceRecording(startMs, Date.now());
    if (!g.allowed) {
      throw new Error(g.userMessage);
    }
    const res = await api.events.attendance.update(eventId, updates);
    return {
      operation: item.operation,
      event_id: eventId,
      updated_count: Array.isArray(res.attendance) ? res.attendance.length : updates.length,
    };
  }

  if (item.operation === "task_patch") {
    const taskType = String(item.payload.task_type || "").trim();
    const taskId = String(item.payload.task_id || "").trim();
    const body =
      item.payload.body && typeof item.payload.body === "object"
        ? (item.payload.body as Record<string, unknown>)
        : null;
    if (!taskId || !body) throw new Error("Invalid task payload.");
    if (!isChecklistOnlyTaskPatch(body)) {
      throw new Error("Offline task edits only allow checklist updates.");
    }
    const res =
      taskType === "group"
        ? await api.groups.patchGroupTask(taskId, body)
        : await api.members.patchMemberTask(taskId, body);
    return {
      operation: item.operation,
      task_id: taskId,
      task_type: taskType || "member",
      status: String(res.task?.status || ""),
    };
  }

  if (item.operation === "member_note_create") {
    const memberId = String(item.payload.member_id || "").trim();
    const content = String(item.payload.content || "").trim();
    if (!memberId || !content) throw new Error("Invalid member note create payload.");
    const created = await api.members.notes.create(memberId, content);
    return {
      operation: item.operation,
      member_id: memberId,
      note_id: created?.note?.id ?? null,
    };
  }

  if (item.operation === "member_note_update") {
    const memberId = String(item.payload.member_id || "").trim();
    const noteId = String(item.payload.note_id || "").trim();
    const content = String(item.payload.content || "").trim();
    if (!memberId || !noteId || !content) throw new Error("Invalid member note update payload.");
    await api.members.notes.update(memberId, noteId, content);
    return {
      operation: item.operation,
      member_id: memberId,
      note_id: noteId,
    };
  }

  if (item.operation === "member_note_delete") {
    const memberId = String(item.payload.member_id || "").trim();
    const noteId = String(item.payload.note_id || "").trim();
    if (!memberId || !noteId) throw new Error("Invalid member note delete payload.");
    await api.members.notes.remove(memberId, noteId);
    return {
      operation: item.operation,
      member_id: memberId,
      note_id: noteId,
    };
  }

  throw new Error(`Unsupported offline operation: ${item.operation}`);
}

export async function runOfflineSync(
  isOnline: boolean
): Promise<{ stats: SyncRunStats; last_sync_at: string | null }> {
  const stats: SyncRunStats = {
    attempted: 0,
    synced: 0,
    failed: 0,
    stopped_offline: false,
  };
  if (!isOnline) {
    return { stats: { ...stats, stopped_offline: true }, last_sync_at: await getLastSyncAt() };
  }

  const queue = await getOutboxItems();
  const pending = queue.filter((x) => x.status === "pending" || x.status === "failed");
  if (pending.length === 0) {
    return { stats, last_sync_at: await getLastSyncAt() };
  }

  for (const item of pending) {
    stats.attempted += 1;
    await updateOutboxItem(item.id, { status: "syncing", last_error: null });
    try {
      const result = await runOne(item);
      const syncedAt = new Date().toISOString();
      await updateOutboxItem(item.id, {
        status: "synced",
        synced_at: syncedAt,
        result,
        last_error: null,
      });
      await markLastSyncAt(syncedAt);
      stats.synced += 1;
      devLog("offline sync: item synced", { id: item.id, operation: item.operation });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Sync failed";
      if (isLikelyOfflineError(error)) {
        await updateOutboxItem(item.id, { status: "pending", last_error: msg });
        stats.stopped_offline = true;
        devWarn("offline sync: stop, network unavailable", msg);
        break;
      }
      if (isForbiddenError(error)) {
        const detail = msg.trim() || "Permission denied (403)";
        await updateOutboxItem(item.id, {
          status: "failed",
          retry_count: item.retry_count + 1,
          last_error: detail,
        });
        stats.failed += 1;
        devWarn("offline sync: item failed (forbidden)", { id: item.id, operation: item.operation, msg: detail });
        continue;
      }
      await updateOutboxItem(item.id, {
        status: "failed",
        retry_count: item.retry_count + 1,
        last_error: msg,
      });
      stats.failed += 1;
      devWarn("offline sync: item failed", { id: item.id, operation: item.operation, msg });
    }
  }

  // Delta refresh strategy: until backend cursors land, refresh full caches online.
  try {
    const manifest = await getOfflineManifest();
    await runOfflineBootstrap();
    const nowIso = new Date().toISOString();
    await patchOfflineManifest({
      ...manifest,
      last_delta_at: nowIso,
      cursors: {
        ...manifest.cursors,
        members: nowIso,
        events: nowIso,
        tasks: nowIso,
        groups: nowIso,
        families: nowIso,
      },
    });
  } catch (error) {
    devWarn("offline delta refresh failed", error instanceof Error ? error.message : String(error));
  }

  return { stats, last_sync_at: await getLastSyncAt() };
}
