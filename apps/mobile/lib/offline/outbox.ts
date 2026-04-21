import AsyncStorage from "@react-native-async-storage/async-storage";
import type { OfflineQueueItem, OfflineQueueStatus, QueueCreateInput } from "./types";

const OFFLINE_OUTBOX_KEY = "offline_outbox_v1";
const OFFLINE_LAST_SYNC_AT_KEY = "offline_last_sync_at_v1";

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeArray(raw: string | null): OfflineQueueItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as OfflineQueueItem[]) : [];
  } catch {
    return [];
  }
}

export async function getOutboxItems(): Promise<OfflineQueueItem[]> {
  const raw = await AsyncStorage.getItem(OFFLINE_OUTBOX_KEY);
  const items = safeArray(raw);
  return items.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

async function setOutboxItems(items: OfflineQueueItem[]): Promise<void> {
  await AsyncStorage.setItem(OFFLINE_OUTBOX_KEY, JSON.stringify(items));
}

export async function enqueueOutboxItem(input: QueueCreateInput): Promise<OfflineQueueItem> {
  const items = await getOutboxItems();
  const ts = nowIso();
  const item: OfflineQueueItem = {
    id: randomId(),
    operation: input.operation,
    created_at: ts,
    updated_at: ts,
    synced_at: null,
    status: "pending",
    retry_count: 0,
    last_error: null,
    branch_id: input.branch_id,
    user_id: input.user_id,
    client_mutation_id: input.client_mutation_id || randomId(),
    payload: input.payload,
    result: null,
  };
  await setOutboxItems([...items, item]);
  return item;
}

export async function updateOutboxItem(
  id: string,
  patch: Partial<OfflineQueueItem>
): Promise<OfflineQueueItem | null> {
  const items = await getOutboxItems();
  let updated: OfflineQueueItem | null = null;
  const next = items.map((item) => {
    if (item.id !== id) return item;
    updated = {
      ...item,
      ...patch,
      updated_at: nowIso(),
    };
    return updated;
  });
  await setOutboxItems(next);
  return updated;
}

export async function removeOutboxItem(id: string): Promise<void> {
  const items = await getOutboxItems();
  await setOutboxItems(items.filter((x) => x.id !== id));
}

export async function resetOutboxStatus(id: string): Promise<OfflineQueueItem | null> {
  return updateOutboxItem(id, {
    status: "pending",
    last_error: null,
  });
}

export async function countOutboxByStatus(status: OfflineQueueStatus): Promise<number> {
  const items = await getOutboxItems();
  return items.filter((x) => x.status === status).length;
}

export async function markLastSyncAt(ts?: string | null): Promise<void> {
  if (!ts) {
    await AsyncStorage.removeItem(OFFLINE_LAST_SYNC_AT_KEY);
    return;
  }
  await AsyncStorage.setItem(OFFLINE_LAST_SYNC_AT_KEY, ts);
}

export async function getLastSyncAt(): Promise<string | null> {
  return AsyncStorage.getItem(OFFLINE_LAST_SYNC_AT_KEY);
}
