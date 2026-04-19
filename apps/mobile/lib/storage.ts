import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "auth_token";
const REFRESH_TOKEN_KEY = "auth_refresh_token";
const BRANCH_KEY = "selected_branch_id";
const USER_KEY = "auth_user";
const ONBOARDING_KEY = "onboarding_completed_v1";
const DASH_LAST_SEEN_KEY = "dashboard_last_seen_counts_v1";
const SEARCH_HISTORY_KEY = "global_search_history_v1";
const THEME_PREFERENCE_KEY = "theme_preference_v1";
const FACE_RECOGNITION_OPT_IN_KEY = "face_recognition_opt_in_v1";
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

/** Local preference only; server enrollment will wire in when facial recognition ships. */
export async function getFaceRecognitionOptIn(): Promise<boolean> {
  const v = await AsyncStorage.getItem(FACE_RECOGNITION_OPT_IN_KEY);
  return v === "1";
}

export async function setFaceRecognitionOptIn(enabled: boolean) {
  await AsyncStorage.setItem(FACE_RECOGNITION_OPT_IN_KEY, enabled ? "1" : "0");
}
