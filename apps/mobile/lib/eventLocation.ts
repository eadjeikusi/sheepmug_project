export type CanonicalLocationType = "InPerson" | "Online" | "Hybrid";

export function normalizeLocationTypeInput(raw: string | null | undefined): CanonicalLocationType | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  if (t === "InPerson" || t === "Online" || t === "Hybrid") return t;
  const compact = t.toLowerCase().replace(/[\s_-]/g, "");
  if (compact === "inperson" || compact === "onsite" || compact === "physical") return "InPerson";
  if (compact === "online") return "Online";
  if (compact === "hybrid") return "Hybrid";
  return null;
}

export function locationModeDisplayLabel(mode: string | null | undefined): string {
  const n = normalizeLocationTypeInput(mode);
  if (n === "InPerson") return "In person";
  if (n === "Online") return "Online";
  if (n === "Hybrid") return "Hybrid";
  return "";
}

/** One-line summary for list cells and hero (mode + address + link; legacy `location` if nothing else). */
export function formatEventLocationSummary(ev: {
  location_type?: string | null;
  location_details?: string | null;
  online_meeting_url?: string | null;
  location?: string | null;
}): string {
  const mode = normalizeLocationTypeInput(ev.location_type);
  const bits: string[] = [];
  if (mode) bits.push(locationModeDisplayLabel(mode));
  if (ev.location_details?.trim()) bits.push(ev.location_details.trim());
  if (ev.online_meeting_url?.trim()) bits.push(ev.online_meeting_url.trim());
  if (bits.length === 0 && ev.location?.trim()) bits.push(ev.location.trim());
  return bits.join(" · ");
}
