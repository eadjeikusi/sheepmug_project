import type { Group } from "@sheepmug/shared-api";

export type GroupTreeSelection = {
  /** All descendant group IDs for each group (transitive, not including self). */
  descendantsByGroupId: Map<string, string[]>;
  parentByChildId: Map<string, string>;
  childrenByParent: Map<string, string[]>;
};

/**
 * Build parent/child maps and transitive descendant lists for ministry hierarchy
 * (`parent_group_id` / `parent_id` on `Group` rows from `api.groups.list({ tree: true })`).
 */
export function buildGroupTreeSelection(groups: Group[]): GroupTreeSelection {
  const childrenByParent = new Map<string, string[]>();
  const parentByChildId = new Map<string, string>();
  for (const g of groups) {
    const cid = String(g.id);
    const r = g as Record<string, unknown>;
    const pr = r.parent_group_id ?? r.parent_id;
    const pid = pr != null && String(pr).length > 0 ? String(pr) : null;
    if (pid) {
      parentByChildId.set(cid, pid);
      if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
      childrenByParent.get(pid)!.push(cid);
    }
  }
  const descendantsByGroupId = new Map<string, string[]>();
  function collect(gid: string): string[] {
    if (descendantsByGroupId.has(gid)) return descendantsByGroupId.get(gid)!;
    const kids = childrenByParent.get(gid) || [];
    const out: string[] = [];
    for (const k of kids) {
      out.push(k, ...collect(k));
    }
    descendantsByGroupId.set(gid, out);
    return out;
  }
  for (const g of groups) collect(String(g.id));
  return { descendantsByGroupId, parentByChildId, childrenByParent };
}

export type MinistryTreeRow = {
  id: string;
  nodeKey: string;
  name: string;
  subtitle: string;
  searchBlob: string;
  depth: number;
  hasChildren: boolean;
  ancestorKeys: string[];
};

export function buildMinistryTreeRows(groups: Group[]): MinistryTreeRow[] {
  const byId = new Map<string, Group>();
  for (const g of groups) byId.set(String(g.id), g);

  const childrenByParent = new Map<string, Group[]>();
  const roots: Group[] = [];
  for (const g of groups) {
    const parentRaw = (g.parent_group_id ?? g.parent_id ?? null) as string | null;
    const parentId = parentRaw ? String(parentRaw) : "";
    if (!parentId || !byId.has(parentId)) {
      roots.push(g);
    } else {
      const arr = childrenByParent.get(parentId) || [];
      arr.push(g);
      childrenByParent.set(parentId, arr);
    }
  }

  const sortByName = (a: Group, b: Group) => String(a.name || "").localeCompare(String(b.name || ""));
  roots.sort(sortByName);
  for (const [, arr] of childrenByParent) arr.sort(sortByName);

  const memberCountLabel = (g: Group) => {
    const count = (g.member_count ?? g.members_count ?? null) as number | null;
    if (count != null) return `${count} member${count === 1 ? "" : "s"}`;
    return "";
  };
  const groupTypeLabel = (g: Group) => {
    const gt = String(g.group_type || "ministry").toLowerCase();
    return gt.charAt(0).toUpperCase() + gt.slice(1);
  };

  const flatRows: MinistryTreeRow[] = [];
  const walk = (node: Group, depth: number, ancestorKeys: string[]) => {
    const id = String(node.id);
    const nodeKey = `group:${id}`;
    const kids = childrenByParent.get(id) || [];
    const parentId = (node.parent_group_id ?? node.parent_id ?? null) as string | null;
    const parentName = parentId ? String(byId.get(String(parentId))?.name || "") : "";
    const isSubgroup = depth > 0;
    const parts: string[] = [];
    if (isSubgroup) {
      parts.push("Subgroup");
      if (parentName) parts.push(parentName);
    } else {
      parts.push(groupTypeLabel(node));
      parts.push("main group");
    }
    const mc = memberCountLabel(node);
    if (mc) parts.push(mc);
    const nameStr = String(node.name || "Ministry");
    const subtitleStr = parts.join(" · ");
    const descStr = String(node.description ?? "").trim();
    const typeRaw = String(node.group_type ?? "").trim();
    const searchBlob = `${nameStr} ${subtitleStr} ${descStr} ${typeRaw}`.toLowerCase();
    flatRows.push({
      id,
      nodeKey,
      name: nameStr,
      subtitle: subtitleStr,
      searchBlob,
      depth,
      hasChildren: kids.length > 0,
      ancestorKeys,
    });
    for (const child of kids) walk(child, depth + 1, [...ancestorKeys, nodeKey]);
  };
  for (const root of roots) walk(root, 0, []);
  return flatRows;
}

/** Rows to show in the tree: respect expand state and search (include ancestors of matches). */
export function filterVisibleMinistryTreeRows(
  ministryTreeRows: MinistryTreeRow[],
  expandedMinistryNodes: Set<string>,
  ministrySearchQuery: string
): MinistryTreeRow[] {
  const q = ministrySearchQuery.trim().toLowerCase();
  if (!q) {
    return ministryTreeRows.filter(
      (row) => row.depth === 0 || row.ancestorKeys.every((k) => expandedMinistryNodes.has(k))
    );
  }
  const includeKeys = new Set<string>();
  for (const row of ministryTreeRows) {
    if (row.searchBlob.includes(q)) {
      includeKeys.add(row.nodeKey);
      for (const k of row.ancestorKeys) includeKeys.add(k);
    }
  }
  return ministryTreeRows.filter((row) => includeKeys.has(row.nodeKey));
}

type ToggleRow = Pick<MinistryTreeRow, "id" | "hasChildren">;

/**
 * Hierarchical tri-state toggle: selecting a parent includes all descendants; deselecting a leaf
 * also deselects its parent (if any). When `allToken` is set (members filter), restoring "no specific
 * selection" should use that token instead of an empty set.
 */
export function toggleMinistryInSet(
  prev: Set<string>,
  row: ToggleRow,
  tree: GroupTreeSelection,
  opts: { allToken?: string }
): Set<string> {
  const { allToken } = opts;
  const id = row.id;
  const desc = tree.descendantsByGroupId.get(id) ?? [];

  const withoutAll = (s: Set<string>) => {
    if (allToken) s.delete(allToken);
    return s;
  };

  if (row.hasChildren) {
    const on = prev.has(id);
    const next = withoutAll(new Set(prev));
    const ids = [id, ...desc];
    if (on) ids.forEach((x) => next.delete(x));
    else ids.forEach((x) => next.add(x));
    if (allToken && next.size === 0) next.add(allToken);
    return next;
  }

  const next = withoutAll(new Set(prev));
  const on = next.has(id);
  if (on) {
    next.delete(id);
    const p = tree.parentByChildId.get(id);
    if (p) next.delete(p);
  } else {
    next.add(id);
  }
  if (allToken && next.size === 0) next.add(allToken);
  return next;
}
