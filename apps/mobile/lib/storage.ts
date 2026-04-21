import AsyncStorage from "@react-native-async-storage/async-storage";
import { getOfflineDb, getOfflineDbSizeBytes } from "./offline/db";

const TOKEN_KEY = "auth_token";
const REFRESH_TOKEN_KEY = "auth_refresh_token";
const BRANCH_KEY = "selected_branch_id";
const USER_KEY = "auth_user";
const ONBOARDING_KEY = "onboarding_completed_v1";
const DASH_LAST_SEEN_KEY = "dashboard_last_seen_counts_v1";
const SEARCH_HISTORY_KEY = "global_search_history_v1";
const THEME_PREFERENCE_KEY = "theme_preference_v1";
const FACE_RECOGNITION_OPT_IN_KEY = "face_recognition_opt_in_v1";
const DASHBOARD_LAST_UPDATED_AT_KEY = "dashboard_last_updated_at_v1";
const OFFLINE_RESOURCE_CACHE_PREFIX = "offline_resource_cache_v1:";
const OFFLINE_BOOTSTRAP_DONE_KEY = "offline_bootstrap_done_v1";
const OFFLINE_META_PREFIX = "offline_meta_v1:";
const SEARCH_HISTORY_MAX = 12;

export async function getToken() {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function setToken(value: string | null) {
  if (!value) {
    await AsyncStorage.removeItem(TOKEN_KEY);
    return;
  }
  await AsyncStorage.setItem(TOKEN_KEY, value);
}

export async function getRefreshToken() {
  return AsyncStorage.getItem(REFRESH_TOKEN_KEY);
}

export async function setRefreshToken(value: string | null) {
  if (!value) {
    await AsyncStorage.removeItem(REFRESH_TOKEN_KEY);
    return;
  }
  await AsyncStorage.setItem(REFRESH_TOKEN_KEY, value);
}

export async function getSelectedBranchId() {
  return AsyncStorage.getItem(BRANCH_KEY);
}

export async function setSelectedBranchId(value: string | null) {
  if (!value) {
    await AsyncStorage.removeItem(BRANCH_KEY);
    return;
  }
  await AsyncStorage.setItem(BRANCH_KEY, value);
}

export async function getStoredUserJson() {
  return AsyncStorage.getItem(USER_KEY);
}

export async function setStoredUserJson(value: string | null) {
  if (!value) {
    await AsyncStorage.removeItem(USER_KEY);
    return;
  }
  await AsyncStorage.setItem(USER_KEY, value);
}

export async function getOnboardingCompleted(): Promise<boolean> {
  const v = await AsyncStorage.getItem(ONBOARDING_KEY);
  return v === "1";
}

export async function setOnboardingCompleted(completed: boolean) {
  if (completed) {
    await AsyncStorage.setItem(ONBOARDING_KEY, "1");
  } else {
    await AsyncStorage.removeItem(ONBOARDING_KEY);
  }
}

export type DashboardLastSeenCounts = {
  groupRequests?: number;
  memberRequests?: number;
  pendingTasks?: number;
};

export async function getDashboardLastSeenCounts(): Promise<DashboardLastSeenCounts> {
  const raw = await AsyncStorage.getItem(DASH_LAST_SEEN_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as DashboardLastSeenCounts;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function setDashboardLastSeenCounts(updates: Partial<DashboardLastSeenCounts>) {
  const prev = await getDashboardLastSeenCounts();
  await AsyncStorage.setItem(DASH_LAST_SEEN_KEY, JSON.stringify({ ...prev, ...updates }));
}

export async function getSearchHistory(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(SEARCH_HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function prependSearchHistory(query: string) {
  const q = query.trim();
  if (!q) return;
  const prev = await getSearchHistory();
  const next = [q, ...prev.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, SEARCH_HISTORY_MAX);
  await AsyncStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
}

export type ThemePreference = "light" | "dark" | "system";

export async function getThemePreference(): Promise<ThemePreference> {
  const raw = await AsyncStorage.getItem(THEME_PREFERENCE_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

export async function setThemePreference(preference: ThemePreference) {
  await AsyncStorage.setItem(THEME_PREFERENCE_KEY, preference);
}

/** Local preference for device biometric unlock. */
export async function getFaceRecognitionOptIn(): Promise<boolean> {
  const v = await AsyncStorage.getItem(FACE_RECOGNITION_OPT_IN_KEY);
  return v === "1";
}

export async function setFaceRecognitionOptIn(enabled: boolean) {
  await AsyncStorage.setItem(FACE_RECOGNITION_OPT_IN_KEY, enabled ? "1" : "0");
}

export async function getBiometricUnlockEnabled(): Promise<boolean> {
  return getFaceRecognitionOptIn();
}

export async function setBiometricUnlockEnabled(enabled: boolean) {
  await setFaceRecognitionOptIn(enabled);
}

export async function getDashboardLastUpdatedAt(): Promise<string | null> {
  return AsyncStorage.getItem(DASHBOARD_LAST_UPDATED_AT_KEY);
}

export async function setDashboardLastUpdatedAt(ts: string | null) {
  if (!ts) {
    await AsyncStorage.removeItem(DASHBOARD_LAST_UPDATED_AT_KEY);
    return;
  }
  await AsyncStorage.setItem(DASHBOARD_LAST_UPDATED_AT_KEY, ts);
}

type OfflineCacheEnvelope<T> = {
  updated_at: string;
  data: T;
};

function offlineResourceKey(key: string): string {
  return `${OFFLINE_RESOURCE_CACHE_PREFIX}${key}`;
}

export async function getOfflineResourceCache<T>(key: string): Promise<OfflineCacheEnvelope<T> | null> {
  const db = await getOfflineDb();
  const row = await db.getFirstAsync<{ updated_at: string; payload_json: string }>(
    "SELECT updated_at, payload_json FROM offline_resource_cache WHERE cache_key = ? LIMIT 1;",
    [key]
  );
  if (row?.payload_json) {
    try {
      return {
        updated_at: row.updated_at,
        data: JSON.parse(row.payload_json) as T,
      };
    } catch {
      return null;
    }
  }

  // Fallback for legacy AsyncStorage data, then hydrate SQLite.
  const raw = await AsyncStorage.getItem(offlineResourceKey(key));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as OfflineCacheEnvelope<T>;
    if (!parsed || typeof parsed !== "object" || !("data" in parsed)) return null;
    await db.runAsync(
      "INSERT OR REPLACE INTO offline_resource_cache (cache_key, updated_at, payload_json) VALUES (?, ?, ?);",
      [key, String(parsed.updated_at || new Date().toISOString()), JSON.stringify(parsed.data)]
    );
    return parsed;
  } catch {
    return null;
  }
}

export async function setOfflineResourceCache<T>(key: string, data: T): Promise<void> {
  const envelope: OfflineCacheEnvelope<T> = {
    updated_at: new Date().toISOString(),
    data,
  };
  const db = await getOfflineDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO offline_resource_cache (cache_key, updated_at, payload_json) VALUES (?, ?, ?);",
    [key, envelope.updated_at, JSON.stringify(envelope.data)]
  );
  // Keep writing legacy key during transition for compatibility.
  await AsyncStorage.setItem(offlineResourceKey(key), JSON.stringify(envelope));
}

export async function getOfflineBootstrapDone(): Promise<boolean> {
  const db = await getOfflineDb();
  const row = await db.getFirstAsync<{ meta_value: string }>(
    "SELECT meta_value FROM offline_meta WHERE meta_key = ? LIMIT 1;",
    [OFFLINE_BOOTSTRAP_DONE_KEY]
  );
  if (row?.meta_value) return row.meta_value === "1";
  const raw = await AsyncStorage.getItem(OFFLINE_BOOTSTRAP_DONE_KEY);
  return raw === "1";
}

export async function setOfflineBootstrapDone(done: boolean): Promise<void> {
  const db = await getOfflineDb();
  if (!done) {
    await db.runAsync("DELETE FROM offline_meta WHERE meta_key = ?;", [OFFLINE_BOOTSTRAP_DONE_KEY]);
    await AsyncStorage.removeItem(OFFLINE_BOOTSTRAP_DONE_KEY);
    return;
  }
  await db.runAsync(
    "INSERT OR REPLACE INTO offline_meta (meta_key, meta_value) VALUES (?, ?);",
    [OFFLINE_BOOTSTRAP_DONE_KEY, "1"]
  );
  await AsyncStorage.setItem(OFFLINE_BOOTSTRAP_DONE_KEY, "1");
}

export async function clearOfflineResourceCaches(): Promise<void> {
  const db = await getOfflineDb();
  await db.execAsync(`
    DELETE FROM offline_resource_cache;
    DELETE FROM offline_meta;
  `);
  const keys = await AsyncStorage.getAllKeys();
  const offlineKeys = keys.filter((k) =>
    k.startsWith(OFFLINE_RESOURCE_CACHE_PREFIX) ||
    k.startsWith(OFFLINE_META_PREFIX) ||
    k === OFFLINE_BOOTSTRAP_DONE_KEY
  );
  if (offlineKeys.length > 0) {
    await AsyncStorage.multiRemove(offlineKeys);
  }
}

export type OfflineCacheSizeEstimate = {
  bytes: number;
  keys: number;
};

export async function getOfflineCacheSizeEstimate(): Promise<OfflineCacheSizeEstimate> {
  const db = await getOfflineDb();
  const countRow = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM offline_resource_cache;"
  );
  const sqliteBytes = await getOfflineDbSizeBytes();
  const keys = await AsyncStorage.getAllKeys();
  const offlineKeys = keys.filter((k) =>
    k.startsWith(OFFLINE_RESOURCE_CACHE_PREFIX) ||
    k.startsWith(OFFLINE_META_PREFIX) ||
    k === OFFLINE_BOOTSTRAP_DONE_KEY
  );
  if (offlineKeys.length === 0) {
    return { bytes: sqliteBytes, keys: Number(countRow?.count ?? 0) };
  }
  const entries = await AsyncStorage.multiGet(offlineKeys);
  let bytes = 0;
  for (const [key, value] of entries) {
    // JS strings are UTF-16; this is an estimate for storage footprint.
    bytes += key.length * 2;
    if (value) bytes += value.length * 2;
  }
  return {
    bytes: Math.max(sqliteBytes, bytes),
    keys: Math.max(Number(countRow?.count ?? 0), offlineKeys.length),
  };
}

function offlineMetaKey(key: string): string {
  return `${OFFLINE_META_PREFIX}${key}`;
}

export async function getOfflineMeta(key: string): Promise<string | null> {
  const db = await getOfflineDb();
  const row = await db.getFirstAsync<{ meta_value: string }>(
    "SELECT meta_value FROM offline_meta WHERE meta_key = ? LIMIT 1;",
    [offlineMetaKey(key)]
  );
  if (row?.meta_value != null) return row.meta_value;
  return AsyncStorage.getItem(offlineMetaKey(key));
}

export async function setOfflineMeta(key: string, value: string | null): Promise<void> {
  const db = await getOfflineDb();
  const fullKey = offlineMetaKey(key);
  if (value == null) {
    await db.runAsync("DELETE FROM offline_meta WHERE meta_key = ?;", [fullKey]);
    await AsyncStorage.removeItem(fullKey);
    return;
  }
  await db.runAsync(
    "INSERT OR REPLACE INTO offline_meta (meta_key, meta_value) VALUES (?, ?);",
    [fullKey, value]
  );
  await AsyncStorage.setItem(fullKey, value);
}
