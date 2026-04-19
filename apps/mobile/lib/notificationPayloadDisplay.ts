function strVal(v: unknown): string {
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

/** Secondary line: task / event / group / member labels from notification payload (server-enriched). */
export function notificationRichSubtitle(payload: Record<string, unknown> | null | undefined): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const parts: string[] = [];
  for (const k of ["task_title", "event_display_name", "group_display_name", "member_display_name"]) {
    const s = strVal(payload[k]);
    if (s) parts.push(s);
  }
  return parts.join(" · ");
}

export function notificationImageUri(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const u = strVal(payload.member_image_url) || strVal(payload.event_cover_image_url);
  return u || null;
}

/** Member photo on the far right (single assignee only; not multi-member bulk rows). */
export function rightAlignedMemberThumbnail(
  type: string,
  payload: Record<string, unknown> | null | undefined,
): boolean {
  if (type !== "member_assigned_group") return false;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const added = payload.added_member_ids;
  if (Array.isArray(added) && added.length > 1) return false;
  return Boolean(strVal(payload.member_image_url));
}
