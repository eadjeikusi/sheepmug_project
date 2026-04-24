import type { Href } from "expo-router";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: string): boolean {
  return UUID_RE.test(String(v || "").trim());
}

/**
 * Expo/FCM push `data` must be string values; server sends `payload_json` plus flat `member_id` / `entity_*`.
 * Merge into a single payload for `notificationHrefFromActionPath`.
 */
export function parseExpoPushNotificationData(raw: Record<string, unknown>): {
  actionPath: string | null;
  payload: Record<string, unknown>;
} {
  const ap = raw.action_path;
  const actionPath =
    typeof ap === "string" && ap.trim().length > 0 ? ap.trim() : typeof ap === "number" ? String(ap) : null;

  let payload: Record<string, unknown> = {};
  const rPayload = raw.payload;
  if (rPayload && typeof rPayload === "object" && !Array.isArray(rPayload)) {
    payload = { ...(rPayload as Record<string, unknown>) };
  } else if (typeof rPayload === "string" && rPayload.trim()) {
    try {
      const p = JSON.parse(rPayload) as unknown;
      if (p && typeof p === "object" && !Array.isArray(p)) payload = { ...(p as Record<string, unknown>) };
    } catch {
      /* ignore */
    }
  }
  const pj = raw.payload_json;
  if (typeof pj === "string" && pj.trim()) {
    try {
      const p = JSON.parse(pj) as unknown;
      if (p && typeof p === "object" && !Array.isArray(p)) {
        payload = { ...payload, ...(p as Record<string, unknown>) };
      }
    } catch {
      /* ignore */
    }
  }

  const et = raw.entity_type;
  const eid = raw.entity_id;
  if (typeof et === "string" && et.trim()) payload.entity_type = et.trim();
  if (typeof eid === "string" && eid.trim()) payload.entity_id = eid.trim();

  const flatMid = raw.member_id;
  if (typeof flatMid === "string" && flatMid.trim() && !payload.member_id) payload.member_id = flatMid.trim();
  const flatOpen = raw.openMemberId;
  if (typeof flatOpen === "string" && flatOpen.trim() && !payload.openMemberId) {
    payload.openMemberId = flatOpen.trim();
  }

  if (
    String(payload.entity_type || "").toLowerCase() === "member" &&
    typeof payload.entity_id === "string" &&
    isUuid(payload.entity_id.trim()) &&
    !payload.member_id
  ) {
    payload.member_id = payload.entity_id.trim();
  }

  return { actionPath, payload };
}

/** Deep link: open member join requests with review sheet for this request id (push + in-app). */
function memberJoinRequestsHref(queryStr: string, p: Record<string, unknown>): Href {
  const sp = new URLSearchParams(queryStr);
  const qId = String(sp.get("openRequestId") || sp.get("requestId") || "").trim();
  const fromQuery = qId && isUuid(qId) ? qId : "";
  const fromPayload =
    typeof p.member_request_id === "string" && isUuid(p.member_request_id.trim())
      ? p.member_request_id.trim()
      : typeof p.entity_id === "string" &&
          String(p.entity_type || "").toLowerCase() === "member_request" &&
          isUuid(p.entity_id.trim())
        ? p.entity_id.trim()
        : "";
  const openRequestId = fromQuery || fromPayload;
  if (openRequestId) {
    return { pathname: "/member-join-requests", params: { openRequestId } };
  }
  return "/member-join-requests";
}

/** Deep link: open group join requests list or ministry requests tab for this request id. */
function groupJoinRequestsHref(queryStr: string, p: Record<string, unknown>): Href {
  const sp = new URLSearchParams(queryStr);
  const qId = String(sp.get("openRequestId") || "").trim();
  const fromQuery = qId && isUuid(qId) ? qId : "";
  const fromPayload =
    typeof p.group_request_id === "string" && isUuid(p.group_request_id.trim())
      ? p.group_request_id.trim()
      : typeof p.entity_id === "string" &&
          String(p.entity_type || "").toLowerCase() === "group_request" &&
          isUuid(p.entity_id.trim())
        ? p.entity_id.trim()
        : "";
  const openRequestId = fromQuery || fromPayload;
  const gid =
    typeof p.group_id === "string" && isUuid(p.group_id.trim()) ? p.group_id.trim() : "";
  if (gid && openRequestId) {
    return { pathname: "/ministry/[id]", params: { id: gid, tab: "requests", openRequestId } };
  }
  if (openRequestId) {
    return { pathname: "/group-join-requests", params: { openRequestId } };
  }
  return "/group-join-requests";
}

/**
 * Map web-style `action_path` from the API to Expo Router targets.
 */
export function notificationHrefFromActionPath(
  actionPath: string | null | undefined,
  payload: Record<string, unknown> | null | undefined,
): Href {
  const full = String(actionPath || "").trim();
  const qIdx = full.indexOf("?");
  const path = qIdx >= 0 ? full.slice(0, qIdx) : full;
  const queryStr = qIdx >= 0 ? full.slice(qIdx + 1) : "";
  const p = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};

  let openMemberId =
    typeof p.openMemberId === "string" && isUuid(p.openMemberId.trim())
      ? p.openMemberId.trim()
      : typeof p.member_id === "string" && isUuid(p.member_id.trim())
        ? p.member_id.trim()
        : "";
  if (
    !openMemberId &&
    String(p.entity_type || "").toLowerCase() === "member" &&
    typeof p.entity_id === "string" &&
    isUuid(p.entity_id.trim())
  ) {
    openMemberId = p.entity_id.trim();
  }

  /** Push may omit action_path; still deep-link to the member when entity/payload has id. */
  if (!path && openMemberId) {
    return `/member/${encodeURIComponent(openMemberId)}` as Href;
  }

  /** Ministry scope updates: open a specific group or the ministries list (no access / multiple groups). */
  if (p.ministry_scope_updated === true) {
    const rawIds = p.ministry_scope_group_ids;
    const ids = Array.isArray(rawIds)
      ? rawIds.filter((x): x is string => typeof x === "string" && isUuid(x.trim()))
      : [];
    if (ids.length === 1) {
      return { pathname: "/ministry/[id]", params: { id: ids[0].trim() } };
    }
    return "/(tabs)/ministries";
  }

  const ev = /^\/events\/([^/?#]+)$/i.exec(path);
  if (ev?.[1] && isUuid(ev[1])) {
    const sp = new URLSearchParams(queryStr);
    const tabRaw = String(sp.get("tab") || "").trim().toLowerCase();
    if (tabRaw === "attendance") {
      return { pathname: "/event/[id]", params: { id: ev[1], tab: "attendance" } };
    }
    return { pathname: "/event/[id]", params: { id: ev[1] } };
  }

  const mem = /^\/members\/([^/?#]+)$/i.exec(path);
  if (mem?.[1] && isUuid(mem[1])) {
    return `/member/${encodeURIComponent(mem[1])}` as Href;
  }

  if (path === "/tasks" || path.startsWith("/tasks?")) {
    if (openMemberId) return `/member/${encodeURIComponent(openMemberId)}` as Href;
    return "/(tabs)/task";
  }

  const grp = /^\/groups\/([^/?#]+)$/i.exec(path);
  if (grp?.[1] && isUuid(grp[1])) {
    const params: { id: string; highlight?: string; tab?: string; openRequestId?: string } = { id: grp[1] };
    if (queryStr) {
      const sp = new URLSearchParams(queryStr);
      const h = sp.get("highlight");
      if (h) params.highlight = h;
      const tab = sp.get("tab");
      if (tab) params.tab = tab;
      const orq = sp.get("openRequestId");
      if (orq && isUuid(orq.trim())) params.openRequestId = orq.trim();
    }
    return { pathname: "/ministry/[id]", params };
  }
  if (path === "/member-join-requests" || path.startsWith("/member-join-requests?")) {
    return memberJoinRequestsHref(queryStr, p);
  }
  if (path === "/group-join-requests" || path.startsWith("/group-join-requests?")) {
    return groupJoinRequestsHref(queryStr, p);
  }
  if (path === "/members" || path.startsWith("/members?")) {
    const sp = new URLSearchParams(queryStr);
    if (sp.get("tab") === "requests") return memberJoinRequestsHref(queryStr, p);
  }
  if (path === "/groups") {
    return "/(tabs)/ministries";
  }

  if (path === "/members" && openMemberId) {
    return `/member/${encodeURIComponent(openMemberId)}` as Href;
  }

  if (path === "/profile" || path.startsWith("/settings")) {
    return "/profile-details";
  }

  if (path.startsWith("/events")) {
    return "/(tabs)/event";
  }

  if (path.startsWith("/members")) {
    return "/(tabs)/members";
  }

  return "/notifications";
}

export function navigateFromNotificationAction(
  router: { push: (href: Href) => void },
  actionPath: string | null | undefined,
  payload: Record<string, unknown> | null | undefined,
): void {
  router.push(notificationHrefFromActionPath(actionPath, payload));
}
