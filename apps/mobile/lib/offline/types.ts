export type OfflineOperationType =
  | "member_create"
  | "attendance_update"
  | "task_patch"
  | "member_note_create"
  | "member_note_update"
  | "member_note_delete";

export type OfflineQueueStatus = "pending" | "syncing" | "synced" | "failed";

export type OfflineQueueItem = {
  id: string;
  operation: OfflineOperationType;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
  status: OfflineQueueStatus;
  retry_count: number;
  last_error: string | null;
  branch_id: string | null;
  user_id: string | null;
  client_mutation_id: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
};

export type QueueCreateInput = {
  operation: OfflineOperationType;
  payload: Record<string, unknown>;
  branch_id: string | null;
  user_id: string | null;
  client_mutation_id?: string;
};

export type SyncRunStats = {
  attempted: number;
  synced: number;
  failed: number;
  stopped_offline: boolean;
};
