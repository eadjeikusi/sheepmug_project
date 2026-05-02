import { useId, useMemo } from "react";
import { displayMemberWords } from "@sheepmug/shared-api";

export type GroupRow = { id: string; name: string; parent_group_id: string | null };

type Props = {
  open: boolean;
  onClose: () => void;
  groups: GroupRow[];
  selectedIds: string[];
  onChangeSelectedIds: (ids: string[]) => void;
};

function buildChildrenByParent(flat: GroupRow[]): Map<string, string[]> {
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

/** Root = no parent, or parent id not in this list (e.g. scoped out) — same as mobile ministry tree. */
function rootGroupsInScope(flat: GroupRow[]): GroupRow[] {
  const ids = new Set(flat.map((g) => g.id));
  return flat
    .filter((g) => {
      const p = g.parent_group_id != null && String(g.parent_group_id).length > 0 ? String(g.parent_group_id) : "";
      return !p || !ids.has(p);
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function getDescendantIds(rootId: string, childrenByParent: Map<string, string[]>): string[] {
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

function RowNode({
  node,
  groupsById,
  childrenByParent,
  selectedIds,
  onToggle,
  depth,
}: {
  node: GroupRow;
  groupsById: Map<string, GroupRow>;
  childrenByParent: Map<string, string[]>;
  selectedIds: string[];
  onToggle: (id: string) => void;
  depth: number;
}) {
  const kids = childrenByParent.get(node.id) || [];
  const nestedCount = getDescendantIds(node.id, childrenByParent).length;
  return (
    <div className={depth > 0 ? "ml-0 border-l border-violet-100 pl-2" : ""}>
      <label
        className="flex cursor-pointer items-start gap-2 py-1.5 text-sm text-gray-800"
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        <input
          type="checkbox"
          className="mt-0.5 rounded border-gray-300"
          checked={selectedIds.includes(node.id)}
          onChange={() => onToggle(node.id)}
        />
        <span className="min-w-0 flex-1">
          {nestedCount > 0 ? <span className="mr-1.5 text-violet-500" aria-hidden="true">›</span> : null}
          <span className="font-medium">{displayMemberWords(node.name || "Group")}</span>
          {nestedCount > 0 ? (
            <span className="ml-1.5 text-xs font-normal text-gray-500">
              ({nestedCount} nested group{nestedCount === 1 ? "" : "s"})
            </span>
          ) : null}
        </span>
      </label>
      {kids.map((cid) => {
        const ch = groupsById.get(cid);
        if (!ch) return null;
        return (
          <RowNode
            key={cid}
            node={ch}
            groupsById={groupsById}
            childrenByParent={childrenByParent}
            selectedIds={selectedIds}
            onToggle={onToggle}
            depth={depth + 1}
          />
        );
      })}
    </div>
  );
}

/**
 * Hierarchical group picker. Selecting a row selects that group and all nested child groups.
 */
export function ReportGroupTreeModal({ open, onClose, groups, selectedIds, onChangeSelectedIds }: Props) {
  const titleId = useId();
  const groupsById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const childrenByParent = useMemo(() => buildChildrenByParent(groups), [groups]);
  const roots = useMemo(() => rootGroupsInScope(groups), [groups]);

  const toggle = (id: string) => {
    const desc = getDescendantIds(id, childrenByParent);
    const block = [id, ...desc];
    const isOn = selectedIds.includes(id);
    if (isOn) {
      onChangeSelectedIds(selectedIds.filter((x) => !block.includes(x)));
    } else {
      onChangeSelectedIds([...new Set([...selectedIds, ...block])]);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="max-h-[min(80vh,560px)] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h4 id={titleId} className="text-sm font-semibold text-gray-900">
            Select groups
          </h4>
          <button
            type="button"
            className="rounded-lg px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            onClick={() => onClose()}
          >
            Done
          </button>
        </div>
        <p className="border-b border-gray-100 px-4 pb-3 text-xs text-gray-500">
          Selecting a main group also selects every nested subgroup in this list.
        </p>
        <div className="max-h-[min(70vh,480px)] overflow-y-auto px-2 py-2">
          {roots.length === 0 ? <p className="px-2 py-4 text-sm text-gray-500">No groups in your scope.</p> : null}
          {roots.map((r) => (
            <RowNode
              key={r.id}
              node={r}
              groupsById={groupsById}
              childrenByParent={childrenByParent}
              selectedIds={selectedIds}
              onToggle={toggle}
              depth={0}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
