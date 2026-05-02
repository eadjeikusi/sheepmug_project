import type { EventItem } from "@sheepmug/shared-api";
import type { api } from "./api";

type ApiClient = typeof api;

/** Loads every page from GET /api/events (server max 100 per page). */
export async function fetchAllEventsPaged(client: ApiClient): Promise<EventItem[]> {
  const out: EventItem[] = [];
  const seen = new Set<string>();
  let offset = 0;
  const limit = 100;
  for (;;) {
    const { events } = await client.events.list({ limit, offset });
    if (events.length === 0) break;
    for (const e of events) {
      const id = String((e as { id?: string }).id ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(e);
    }
    if (events.length < limit) break;
    offset += limit;
  }
  return out;
}
