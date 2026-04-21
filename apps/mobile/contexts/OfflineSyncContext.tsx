import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./AuthContext";
import { useBranch } from "./BranchContext";
import {
  enqueueOutboxItem,
  getLastSyncAt,
  getOutboxItems,
  markLastSyncAt,
  removeOutboxItem,
  resetOutboxStatus,
} from "../lib/offline/outbox";
import { probeApiOnline } from "../lib/offline/connectivity";
import { runOfflineSync } from "../lib/offline/syncEngine";
import type { OfflineQueueItem } from "../lib/offline/types";
import { devLog, devWarn } from "../lib/devLog";

type OfflineSyncState = {
  isOnline: boolean;
  checking: boolean;
  syncing: boolean;
  lastSyncAt: string | null;
  queueItems: OfflineQueueItem[];
  pendingCount: number;
  failedCount: number;
  refreshQueue: () => Promise<void>;
  checkConnectivity: () => Promise<boolean>;
  syncNow: () => Promise<void>;
  queueMemberCreate: (payload: Record<string, unknown>) => Promise<OfflineQueueItem>;
  queueAttendanceUpdate: (eventId: string, updates: Array<{ member_id: string; status: string }>) => Promise<OfflineQueueItem>;
  queueTaskPatch: (
    taskType: "group" | "member",
    taskId: string,
    body: Record<string, unknown>
  ) => Promise<OfflineQueueItem>;
  queueMemberNoteCreate: (memberId: string, content: string) => Promise<OfflineQueueItem>;
  queueMemberNoteUpdate: (
    memberId: string,
    noteId: string,
    content: string
  ) => Promise<OfflineQueueItem>;
  queueMemberNoteDelete: (memberId: string, noteId: string) => Promise<OfflineQueueItem>;
  retryItem: (id: string) => Promise<void>;
  discardItem: (id: string) => Promise<void>;
};

const OfflineSyncContext = createContext<OfflineSyncState | undefined>(undefined);

export function OfflineSyncProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { selectedBranch } = useBranch();

  const [isOnline, setIsOnline] = useState(true);
  const [checking, setChecking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [queueItems, setQueueItems] = useState<OfflineQueueItem[]>([]);

  const refreshQueue = useCallback(async () => {
    const items = await getOutboxItems();
    setQueueItems(items);
  }, []);

  const checkConnectivity = useCallback(async () => {
    setChecking(true);
    try {
      const next = await probeApiOnline();
      setIsOnline(next);
      return next;
    } finally {
      setChecking(false);
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const online = await checkConnectivity();
      if (!online) {
        await refreshQueue();
        return;
      }

      // Manual sync should stamp last_sync even when queue is empty.
      if (pendingCount === 0 && failedCount === 0) {
        const now = new Date().toISOString();
        await markLastSyncAt(now);
        setLastSyncAt(now);
        await refreshQueue();
        devLog("offline sync: heartbeat", { attempted: 0, synced: 0, failed: 0 });
        return;
      }

      const run = await runOfflineSync(online);
      if (run.last_sync_at) setLastSyncAt(run.last_sync_at);
      await refreshQueue();
      if (run.stats.attempted > 0 || run.stats.failed > 0 || run.stats.synced > 0) {
        devLog("offline sync: completed", run.stats);
      }
    } catch (error: unknown) {
      devWarn("offline sync: failed", error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(false);
    }
  }, [syncing, checkConnectivity, refreshQueue, pendingCount, failedCount]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const [syncAt] = await Promise.all([getLastSyncAt(), refreshQueue()]);
      if (!mounted) return;
      setLastSyncAt(syncAt);
      await checkConnectivity();
    })();
    return () => {
      mounted = false;
    };
  }, [refreshQueue, checkConnectivity]);

  useEffect(() => {
    const id = setInterval(() => {
      if (pendingCount === 0 && failedCount === 0) return;
      void checkConnectivity().then((online) => {
        if (online) void syncNow();
      });
    }, 20000);
    return () => clearInterval(id);
  }, [checkConnectivity, syncNow, pendingCount, failedCount]);

  const queueMemberCreate = useCallback(
    async (payload: Record<string, unknown>) => {
      const item = await enqueueOutboxItem({
        operation: "member_create",
        payload,
        branch_id: selectedBranch?.id ?? null,
        user_id: user?.id ?? null,
      });
      await refreshQueue();
      return item;
    },
    [selectedBranch?.id, user?.id, refreshQueue]
  );

  const queueAttendanceUpdate = useCallback(
    async (eventId: string, updates: Array<{ member_id: string; status: string }>) => {
      const item = await enqueueOutboxItem({
        operation: "attendance_update",
        payload: {
          event_id: eventId,
          updates,
        },
        branch_id: selectedBranch?.id ?? null,
        user_id: user?.id ?? null,
      });
      await refreshQueue();
      return item;
    },
    [selectedBranch?.id, user?.id, refreshQueue]
  );

  const queueTaskPatch = useCallback(
    async (
      taskType: "group" | "member",
      taskId: string,
      body: Record<string, unknown>
    ) => {
      const item = await enqueueOutboxItem({
        operation: "task_patch",
        payload: {
          task_type: taskType,
          task_id: taskId,
          body,
        },
        branch_id: selectedBranch?.id ?? null,
        user_id: user?.id ?? null,
      });
      await refreshQueue();
      return item;
    },
    [selectedBranch?.id, user?.id, refreshQueue]
  );

  const queueMemberNoteCreate = useCallback(
    async (memberId: string, content: string) => {
      const item = await enqueueOutboxItem({
        operation: "member_note_create",
        payload: {
          member_id: memberId,
          content,
        },
        branch_id: selectedBranch?.id ?? null,
        user_id: user?.id ?? null,
      });
      await refreshQueue();
      return item;
    },
    [selectedBranch?.id, user?.id, refreshQueue]
  );

  const queueMemberNoteUpdate = useCallback(
    async (memberId: string, noteId: string, content: string) => {
      const item = await enqueueOutboxItem({
        operation: "member_note_update",
        payload: {
          member_id: memberId,
          note_id: noteId,
          content,
        },
        branch_id: selectedBranch?.id ?? null,
        user_id: user?.id ?? null,
      });
      await refreshQueue();
      return item;
    },
    [selectedBranch?.id, user?.id, refreshQueue]
  );

  const queueMemberNoteDelete = useCallback(
    async (memberId: string, noteId: string) => {
      const item = await enqueueOutboxItem({
        operation: "member_note_delete",
        payload: {
          member_id: memberId,
          note_id: noteId,
        },
        branch_id: selectedBranch?.id ?? null,
        user_id: user?.id ?? null,
      });
      await refreshQueue();
      return item;
    },
    [selectedBranch?.id, user?.id, refreshQueue]
  );

  const retryItem = useCallback(async (id: string) => {
    await resetOutboxStatus(id);
    await refreshQueue();
  }, [refreshQueue]);

  const discardItem = useCallback(async (id: string) => {
    await removeOutboxItem(id);
    await refreshQueue();
  }, [refreshQueue]);

  const pendingCount = useMemo(
    () => queueItems.filter((x) => x.status === "pending" || x.status === "syncing").length,
    [queueItems]
  );
  const failedCount = useMemo(
    () => queueItems.filter((x) => x.status === "failed").length,
    [queueItems]
  );

  const value = useMemo<OfflineSyncState>(
    () => ({
      isOnline,
      checking,
      syncing,
      lastSyncAt,
      queueItems,
      pendingCount,
      failedCount,
      refreshQueue,
      checkConnectivity,
      syncNow,
      queueMemberCreate,
      queueAttendanceUpdate,
      queueTaskPatch,
      queueMemberNoteCreate,
      queueMemberNoteUpdate,
      queueMemberNoteDelete,
      retryItem,
      discardItem,
    }),
    [
      isOnline,
      checking,
      syncing,
      lastSyncAt,
      queueItems,
      pendingCount,
      failedCount,
      refreshQueue,
      checkConnectivity,
      syncNow,
      queueMemberCreate,
      queueAttendanceUpdate,
      queueTaskPatch,
      queueMemberNoteCreate,
      queueMemberNoteUpdate,
      queueMemberNoteDelete,
      retryItem,
      discardItem,
    ]
  );

  return <OfflineSyncContext.Provider value={value}>{children}</OfflineSyncContext.Provider>;
}

export function useOfflineSync() {
  const ctx = useContext(OfflineSyncContext);
  if (!ctx) throw new Error("useOfflineSync must be used inside OfflineSyncProvider");
  return ctx;
}
