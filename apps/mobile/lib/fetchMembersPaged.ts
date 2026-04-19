import type { Member } from "@sheepmug/shared-api";
import type { api } from "./api";

type ApiClient = typeof api;

/** Loads every page from GET /api/members (server max 100 per page, ministry-scoped). */
export async function fetchAllMembersPaged(client: ApiClient): Promise<Member[]> {
  const out: Member[] = [];
  const seen = new Set<string>();
  let offset = 0;
  const limit = 100;
  for (;;) {
    const { members } = await client.members.list({ limit, offset });
    if (members.length === 0) break;
    for (const m of members) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        out.push(m);
      }
    }
    if (members.length < limit) break;
    offset += limit;
  }
  return out;
}
