import type { Group } from "@sheepmug/shared-api";
import { API_BASE_URL } from "./api";

function trimOrigin(s: string): string {
  return s.replace(/\/$/, "");
}

/** Base URL of the web app (Vite) where `/public/groups/` and `/join-group/` are served. */
export function getWebOrigin(): string {
  const env = (process.env.EXPO_PUBLIC_WEB_ORIGIN || "").trim();
  if (env) return trimOrigin(env);
  try {
    return trimOrigin(new URL(API_BASE_URL).origin);
  } catch {
    return "http://localhost:5173";
  }
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
