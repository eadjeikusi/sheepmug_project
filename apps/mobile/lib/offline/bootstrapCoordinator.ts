import { rescheduleLocalTaskRemindersFromCache } from "../localTaskReminders";
import { getOfflineBootstrapDone, setOfflineBootstrapDone } from "../storage";
import { runOfflineBootstrap, type OfflineBootstrapProgress } from "./bootstrap";
import { markLastSyncAt } from "./outbox";

const inflight = new Map<string, Promise<void>>();
const progressListeners = new Map<string, Set<(p: OfflineBootstrapProgress) => void>>();

function notifyProgress(userId: string, p: OfflineBootstrapProgress) {
  const set = progressListeners.get(userId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(p);
    } catch {
      /* ignore listener errors */
    }
  }
}

/** Subscribe to bootstrap progress for a user (e.g. UI). Unsubscribe when done. */
export function subscribeOfflineBootstrapProgress(
  userId: string,
  onProgress: (p: OfflineBootstrapProgress) => void
): () => void {
  let set = progressListeners.get(userId);
  if (!set) {
    set = new Set();
    progressListeners.set(userId, set);
  }
  set.add(onProgress);
  return () => {
    set!.delete(onProgress);
    if (set!.size === 0) progressListeners.delete(userId);
  };
}

/**
 * Runs full offline bootstrap once per user until success. Concurrent callers share the same work.
 * Does not set bootstrap-done if the run throws.
 */
export async function ensureOfflineBootstrap(
  userId: string,
  organizationId?: string | null
): Promise<void> {
  const id = String(userId || "").trim();
  if (!id) throw new Error("Missing user id");

  if (await getOfflineBootstrapDone(id)) return;

  const existing = inflight.get(id);
  if (existing) {
    await existing;
    return;
  }

  const promise = (async () => {
    await runOfflineBootstrap((p) => notifyProgress(id, p), {
      accountUserId: id,
      organizationId: organizationId ?? null,
    });
    await setOfflineBootstrapDone(id, true);
    const now = new Date().toISOString();
    await markLastSyncAt(now);
    await rescheduleLocalTaskRemindersFromCache();
  })().finally(() => {
    inflight.delete(id);
  });

  inflight.set(id, promise);
  await promise;
}
