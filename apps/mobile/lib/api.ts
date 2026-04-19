import { createApiClient } from "@sheepmug/shared-api";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { devLog } from "./devLog";
import { getRefreshToken, getSelectedBranchId, getToken, setRefreshToken, setToken } from "./storage";

/** Android emulator: host machine loopback (Metro often still exposes a LAN IP via hostUri). */
const ANDROID_EMULATOR_LOOPBACK = "10.0.2.2";

function normalizeDevApiBaseUrl(raw?: string): string {
  const fallback = "http://localhost:3000";
  const configured = (raw || "").trim();
  const hostUri = Constants.expoConfig?.hostUri || "";
  const detectedHost = hostUri.split(":")[0] || "";

  if (!configured) {
    if (detectedHost) return `http://${detectedHost}:3000`;
    if (__DEV__ && Platform.OS === "android") return `http://${ANDROID_EMULATOR_LOOPBACK}:3000`;
    return fallback;
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    return configured;
  }

  const isLocalHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  const isPrivateIp = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(parsed.hostname);

  // In development, keep API host aligned with the current Expo host IP (phone on same LAN as Metro).
  if (__DEV__ && detectedHost && (isLocalHost || isPrivateIp) && parsed.hostname !== detectedHost) {
    parsed.hostname = detectedHost;
    if (!parsed.port) parsed.port = "3000";
    return parsed.toString().replace(/\/$/, "");
  }

  // Android emulator: localhost in .env does not reach the host; 10.0.2.2 does when hostUri is missing.
  if (__DEV__ && isLocalHost && Platform.OS === "android" && !detectedHost) {
    parsed.hostname = ANDROID_EMULATOR_LOOPBACK;
    if (!parsed.port) parsed.port = "3000";
    return parsed.toString().replace(/\/$/, "");
  }

  return parsed.toString().replace(/\/$/, "");
}

export const API_BASE_URL = normalizeDevApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL);

if (__DEV__) {
  const hostUri = Constants.expoConfig?.hostUri ?? "";
  devLog("api init", {
    API_BASE_URL,
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL || "(unset)",
    expoHostUri: hostUri || "(none)",
    platform: Platform.OS,
  });
}

let authToken: string | null = null;
let authRefreshToken: string | null = null;
let selectedBranchId: string | null = null;
let authFailureHandler: (() => void) | null = null;

export async function hydrateApiState() {
  authToken = await getToken();
  authRefreshToken = await getRefreshToken();
  selectedBranchId = await getSelectedBranchId();
  devLog("hydrateApiState", {
    hasToken: !!authToken,
    hasRefreshToken: !!authRefreshToken,
    branchId: selectedBranchId ? `${selectedBranchId.slice(0, 8)}…` : null,
  });
}

export function setApiToken(token: string | null) {
  authToken = token;
}

export function setApiRefreshToken(refreshToken: string | null) {
  authRefreshToken = refreshToken;
}

export function setApiAuthSession(session: { token: string | null; refreshToken?: string | null }) {
  authToken = session.token;
  authRefreshToken = session.refreshToken ?? null;
}

export function setApiAuthFailureHandler(handler: (() => void) | null) {
  authFailureHandler = handler;
}

export function setApiBranchId(branchId: string | null) {
  selectedBranchId = branchId;
}

export const api = createApiClient({
  baseUrl: API_BASE_URL,
  getToken: () => authToken,
  getRefreshToken: () => authRefreshToken,
  onAuthTokens: async ({ token, refreshToken }) => {
    authToken = token;
    authRefreshToken = refreshToken ?? authRefreshToken;
    await setToken(token);
    await setRefreshToken(authRefreshToken);
  },
  onAuthFailure: async () => {
    authToken = null;
    authRefreshToken = null;
    await setToken(null);
    await setRefreshToken(null);
    authFailureHandler?.();
  },
  getBranchId: () => selectedBranchId,
});
