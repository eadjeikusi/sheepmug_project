import type { EventTypeRow } from "@sheepmug/shared-api";
import { displayMemberWords } from "./memberDisplayFormat";

export function normalizeEventTypeSlug(raw: string | null | undefined): string {
  return String(raw || "").trim().toLowerCase();
}

export function eventTypeSlugFromEvent(e: { event_type?: string | null }): string | null {
  const t = e.event_type;
  if (typeof t !== "string" || !t.trim()) return null;
  return normalizeEventTypeSlug(t);
}

/** Display name from settings rows; if missing, title-case slug segments for legacy values. */
export function labelForEventTypeSlug(slug: string | null | undefined, rows: EventTypeRow[]): string | null {
  const s = normalizeEventTypeSlug(slug);
  if (!s) return null;
  const hit = rows.find((r) => normalizeEventTypeSlug(r.slug) === s);
  if (hit?.name) return displayMemberWords(String(hit.name));
  return displayMemberWords(s.replace(/-/g, " "));
}
