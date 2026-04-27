/** Aligns with web `ReportGroupTreeModal` selection semantics. */

export type ReportGroupRow = { id: string; name: string; parent_group_id: string | null };

export function buildChildrenByParent(flat: ReportGroupRow[]): Map<string, string[]> {
  const byId = new Map(flat.map((g) => [g.id, g]));
  const m = new Map<string, string[]>();
  for (const g of flat) {
    const p = g.parent_group_id ? String(g.parent_group_id) : "";
    if (!p) continue;
    m.set(p, [...(m.get(p) || []), g.id]);
  }
  for (const arr of m.values()) {
    arr.sort((a, b) => String(byId.get(a)?.name || "").localeCompare(String(byId.get(b)?.name || ""), undefined, { sensitivity: "base" }));
  }
  return m;
}

/** Root = no parent, or parent not in this list (ministry scope). */
export function rootGroupsInScope(flat: ReportGroupRow[]): ReportGroupRow[] {
  const ids = new Set(flat.map((g) => g.id));
  return flat
    .filter((g) => {
      const p = g.parent_group_id != null && String(g.parent_group_id) ? String(g.parent_group_id) : "";
      return !p || !ids.has(p);
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function getDescendantIds(rootId: string, childrenByParent: Map<string, string[]>): string[] {
  const out: string[] = [];
  const queue = [...(childrenByParent.get(rootId) || [])];
  while (queue.length) {
    const c = String(queue.shift() || "");
    if (!c) continue;
    out.push(c);
    for (const x of childrenByParent.get(c) || []) queue.push(x);
  }
  return out;
}

/** Tapping a group adds/removes it and all descendants. */
export function toggleGroupSelection(id: string, selectedIds: string[], childrenByParent: Map<string, string[]>): string[] {
  const desc = getDescendantIds(id, childrenByParent);
  const block = [id, ...desc];
  const isOn = selectedIds.includes(id);
  if (isOn) return selectedIds.filter((x) => !block.includes(x));
  return [...new Set([...selectedIds, ...block])];
}
