import type { Group } from "@sheepmug/shared-api";
import { API_BASE_URL } from "./api";

function trimOrigin(s: string): string {
  return s.replace(/\/$/, "");
}

function trimPath(s: string): string {
  return s.replace(/\/+$/, "");
}

const DEFAULT_LIVE_WEB_ORIGIN = "https://www.sheepmug.com";

/**
 * Base web URL where CMS public/join/register pages are served.
 * Accepts EXPO_PUBLIC_WEB_ORIGIN as full origin (or origin + optional path).
 */
function getWebBaseUrl(): string {
  const env = (process.env.EXPO_PUBLIC_WEB_ORIGIN || "").trim();
  if (env) return trimPath(env);
  try {
    const apiUrl = new URL(API_BASE_URL);
    const host = apiUrl.hostname.replace(/^api\./i, "");
    const derived = `${apiUrl.protocol}//${host}`;
    return trimOrigin(derived);
  } catch {
    return DEFAULT_LIVE_WEB_ORIGIN;
  }
}

function getCmsBasePath(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    const currentPath = trimPath(parsed.pathname);
    if (currentPath.toLowerCase().endsWith("/cms")) {
      return trimPath(`${parsed.origin}${currentPath}`);
    }
    return `${trimOrigin(parsed.origin)}/cms`;
  } catch {
    const raw = trimPath(baseUrl);
    return raw.toLowerCase().endsWith("/cms") ? raw : `${raw}/cms`;
  }
}

/** Base URL of the CMS app where `/public/groups/` and `/join-group/` are served. */
export function getWebOrigin(): string {
  return getCmsBasePath(getWebBaseUrl());
}

/** Public mini-site is on by default; only explicit false turns it off (matches web MinistryDetail). */
export function isPublicWebsiteExplicitlyOff(v: unknown): boolean {
  if (v === false || v === 0) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "false" || s === "f" || s === "0" || s === "no" || s === "off";
  }
  return false;
}

function publicWebsiteLive(v: unknown): boolean {
  return !isPublicWebsiteExplicitlyOff(v);
}

/**
 * Public ministry page and self-serve join URLs, matching web `MinistryDetail` URL logic.
 */
export function getGroupShareUrls(group: Group | null): { publicPageUrl: string; joinPageUrl: string } {
  if (!group) return { publicPageUrl: "", joinPageUrl: "" };
  const origin = getWebOrigin();
  const slug = String(group.public_link_slug ?? "").trim();
  const pubOn = group.public_website_enabled;
  const publicOk = publicWebsiteLive(pubOn);
  const publicPageUrl = slug && publicOk ? `${origin}/public/groups/${slug}` : "";

  const joinEnabled = Boolean(group.join_link_enabled);
  const token = String((group as { join_invite_token?: string | null }).join_invite_token || "").trim() || String(group.id);
  const joinPageUrl = joinEnabled && group.id ? `${origin}/join-group/${token}` : "";

  return { publicPageUrl, joinPageUrl };
}
