import { createApiClient } from "@sheepmug/shared-api";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { devLog, devWarn } from "./devLog";
import { getRefreshToken, getSelectedBranchId, getToken, setRefreshToken, setToken } from "./storage";

/** Android emulator: host machine loopback (Metro often still exposes a LAN IP via hostUri). */
const ANDROID_EMULATOR_LOOPBACK = "10.0.2.2";

/** Expo tunnel / edge hosts — nothing is listening for your API on :3000 here. */
function isTunnelOrRemoteExpoHost(hostname: string): boolean {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === ANDROID_EMULATOR_LOOPBACK) return false;
  if (h.includes("exp.direct") || h.endsWith(".exp.direct")) return true;
  if (h.endsWith(".exp.host") || h.endsWith(".e2b.app")) return true;
  return false;
}

function isPrivateOrLocalDevHost(hostname: string): boolean {
  if (!hostname) return false;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === ANDROID_EMULATOR_LOOPBACK) return true;
  if (/[.]local$/i.test(hostname)) return true;
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
}

function tryParseReachableHostFromUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const candidate = /^\w+:\/\//.test(raw) ? raw : `http://${raw}`;
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return null;
  }
  const h = u.hostname;
  if (!h) return null;
  if (isTunnelOrRemoteExpoHost(h)) return null;
  if (isPrivateOrLocalDevHost(h)) return h;
  return null;
}

function getDebuggerHostnameFromExpoManifest(): string | null {
  const c = Constants as typeof Constants & {
    __unsafeNoWarnManifest?: { debuggerHost?: string } | null;
    manifest?: { debuggerHost?: string } | null;
  };
  const raw = c.__unsafeNoWarnManifest?.debuggerHost ?? c.manifest?.debuggerHost;
  if (!raw || typeof raw !== "string") return null;
  const host = raw.split(":")[0]?.trim() ?? "";
  if (!host) return null;
  if (isTunnelOrRemoteExpoHost(host)) return null;
  if (isPrivateOrLocalDevHost(host)) return host;
  return null;
}

/**
 * Picks a host for the dev API when EXPO_PUBLIC_API_BASE_URL is unset.
 * `hostUri` in tunnel mode often points at *.exp.direct (Metro only) — we must not use that for the API.
 */
function resolveUnconfiguredApiHostname(detectedFromHostUri: string): string {
  const detected = detectedFromHostUri.split(":")[0] || "";
  if (detected && !isTunnelOrRemoteExpoHost(detected)) {
    return detected;
  }
  const fromDebugger = getDebuggerHostnameFromExpoManifest();
  if (fromDebugger) return fromDebugger;
  const fromLinking = tryParseReachableHostFromUrl(Constants.linkingUri);
  if (fromLinking) return fromLinking;
  const fromExp = tryParseReachableHostFromUrl(Constants.experienceUrl);
  if (fromExp) return fromExp;

  if (!Device.isDevice) {
    return Platform.OS === "android" ? ANDROID_EMULATOR_LOOPBACK : "localhost";
  }

  if (__DEV__) {
    devWarn(
      "api: using localhost for API base; on a physical device with Expo tunnel, set EXPO_PUBLIC_API_BASE_URL to http://<your-PC-LAN-IP>:3000 so login can reach the dev server."
    );
  }
  return "localhost";
}

function normalizeDevApiBaseUrl(raw?: string): string {
  const fallback = "http://localhost:3000";
  const configured = (raw || "").trim();
  const hostUri = Constants.expoConfig?.hostUri || "";
  const detectedHost = hostUri.split(":")[0] || "";

  if (!configured) {
    const host = resolveUnconfiguredApiHostname(detectedHost);
    return `http://${host}:3000`;
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    return configured;
  }

  const isLocalHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  const isPrivateIp = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(parsed.hostname);
  const useDetectedHost = detectedHost && !isTunnelOrRemoteExpoHost(detectedHost);
  // In development, keep API host aligned with the current Expo host IP.
  // This prevents stale LAN IPs in .env from breaking login after network changes.
  if (__DEV__ && useDetectedHost && (isLocalHost || isPrivateIp) && parsed.hostname !== detectedHost) {
    parsed.hostname = detectedHost;
    if (!parsed.port) parsed.port = "3000";
    return parsed.toString().replace(/\/$/, "");
  }

  // Android emulator: localhost in .env does not reach the host; 10.0.2.2 does when hostUri is missing or tunnel.
  if (__DEV__ && isLocalHost && Platform.OS === "android" && (!detectedHost || isTunnelOrRemoteExpoHost(detectedHost))) {
    parsed.hostname = ANDROID_EMULATOR_LOOPBACK;
    if (!parsed.port) parsed.port = "3000";
    return parsed.toString().replace(/\/$/, "");
  }

  return parsed.toString().replace(/\/$/, "");
}

export const API_BASE_URL = normalizeDevApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL);

if (__DEV__) {
  const hostUri = Constants.expoConfig?.hostUri ?? "";
  const detectedFromUri = hostUri.split(":")[0] || "";
  devLog("api init", {
    API_BASE_URL,
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL || "(unset)",
    expoHostUri: hostUri || "(none)",
    expoHostIsTunnel: detectedFromUri ? isTunnelOrRemoteExpoHost(detectedFromUri) : false,
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
