import { useState, useEffect, useMemo, Fragment } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch } from '../../contexts/BranchContext';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import { toast } from 'sonner';
import { X, Search, Check, Users, GitFork, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { Member } from '@/types';
import type { Group } from '@/types';

interface AssignToGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedMemberIds: string[];
  members: Member[];
  onAssignmentComplete: () => void;
}

type TreeNode = Group & { children: TreeNode[] };

function buildTree(flat: Group[]): TreeNode[] {
  const byParent = new Map<string | null, Group[]>();
  for (const g of flat) {
    const p = g.parent_group_id ?? null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(g);
  }
  const sortFn = (a: Group, b: Group) =>
    (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });

  function nest(parentId: string | null): TreeNode[] {
    const list = (byParent.get(parentId) || []).slice().sort(sortFn);
    return list.map((g) => ({
      ...g,
      children: nest(g.id),
    }));
  }
  return nest(null);
}

function filterTreeBySearch(nodes: TreeNode[], q: string): TreeNode[] {
  const ql = q.trim().toLowerCase();
  if (!ql) return nodes;
  const out: TreeNode[] = [];
  for (const n of nodes) {
    const name = (n.name || '').toLowerCase();
    const desc = (n.description || '').toLowerCase();
    const t = (n.group_type || '').toLowerCase();
    const selfMatch = name.includes(ql) || desc.includes(ql) || t.includes(ql);
    const childFiltered = filterTreeBySearch(n.children, q);
    if (selfMatch) {
      out.push({ ...n, children: n.children });
    } else if (childFiltered.length > 0) {
      out.push({ ...n, children: childFiltered });
    }
  }
  return out;
}

function collectExpandedIdsForTree(nodes: TreeNode[]): Set<string> {
  const s = new Set<string>();
  const walk = (arr: TreeNode[]) => {
    for (const n of arr) {
      s.add(n.id);
      walk(n.children);
    }
  };
  walk(nodes);
  return s;
}

/** For each selected group, include all ancestors (parent chain). Does not add descendants. */
function expandSelectionWithAncestors(selected: Set<string>, byId: Map<string, Group>): string[] {
  const out = new Set<string>();
  for (const gid of selected) {
    out.add(gid);
    let cur = byId.get(gid);
    while (cur?.parent_group_id) {
      const pid = cur.parent_group_id;
      out.add(pid);
      cur = byId.get(pid);
    }
  }
  return [...out];
}

function AssignToGroupModal({
  isOpen,
  onClose,
  selectedMemberIds,
  members,
  onAssignmentComplete,
}: AssignToGroupModalProps) {
  const { token } = useAuth();
  const { selectedBranch } = useBranch();
  const [availableGroups, setAvailableGroups] = useState<Group[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedMembersList = members.filter((m) => selectedMemberIds.includes(m.id));

  const groupById = useMemo(() => {
    const m = new Map<string, Group>();
    for (const g of availableGroups) m.set(g.id, g);
    return m;
  }, [availableGroups]);

  const treeRoots = useMemo(() => buildTree(availableGroups), [availableGroups]);
  const displayTree = useMemo(
    () => filterTreeBySearch(treeRoots, searchQuery),
    [treeRoots, searchQuery]
  );

  useEffect(() => {
    if (!isOpen || !token) return;

    const fetchAvailableGroups = async () => {
      setLoading(true);
      setError(null);
      try {
        const url = new URL('/api/groups', window.location.origin);
        url.searchParams.set('tree', '1');
        url.searchParams.set('include_system', '1');
        if (selectedBranch?.id) {
          url.searchParams.set('branch_id', selectedBranch.id);
        }
        const response = await fetch(url.toString(), {
          headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to fetch available groups');
        }
        const raw = await response.json();
        const allGroups = Array.isArray(raw) ? raw : Array.isArray(raw?.groups) ? raw.groups : [];
        setAvailableGroups(allGroups as Group[]);
      } catch (err: any) {
        setError(err.message);
        toast.error(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchAvailableGroups();
  }, [isOpen, token, selectedBranch?.id]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedGroups(new Set());
      setSearchQuery('');
      setError(null);
      setExpandedIds(new Set());
      return;
    }
    if (!availableGroups.length) return;

    const roots = availableGroups.filter((g) => !g.parent_group_id).map((g) => g.id);
    if (!searchQuery.trim()) {
      setExpandedIds(new Set(roots));
    } else {
      setExpandedIds(collectExpandedIdsForTree(displayTree));
    }
  }, [isOpen, availableGroups, searchQuery, displayTree]);

  const toggleExpand = (groupId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const toggleSelect = (groupId: string) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const handleAssignToGroups = async () => {
    if (selectedGroups.size === 0) {
      toast.info('Please select at least one group.');
      return;
    }
    if (!token || selectedMemberIds.length === 0) return;

    const groupIdsToAssign = expandSelectionWithAncestors(selectedGroups, groupById);

    setIsSubmitting(true);
    try {
      let added = 0;
      let alreadyInGroup = 0;

      for (const groupId of groupIdsToAssign) {
        const response = await fetch(`/api/group-members/bulk`, {
          method: 'POST',
          headers: withBranchScope(selectedBranch?.id, {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          }),
          body: JSON.stringify({
            group_id: groupId,
            member_ids: [...selectedMemberIds],
            role_in_group: 'member',
          }),
        });
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 409 || (errorData as { code?: string }).code === 'ALREADY_GROUP_MEMBER') {
          alreadyInGroup += selectedMemberIds.length;
          continue;
        }
        if (!response.ok) {
          throw new Error(
            (errorData as { error?: string }).error ||
              `Failed to assign members to group ${groupId}`
          );
        }
        const payload = errorData as {
          added?: string[];
          skipped?: { reason?: string }[];
          inserted_count?: number;
        };
        added += payload.inserted_count ?? payload.added?.length ?? 0;
        const skipped = payload.skipped?.filter((s) => s.reason === 'already_in_group').length ?? 0;
        alreadyInGroup += skipped;
      }

      if (alreadyInGroup > 0) {
        toast.info(
          alreadyInGroup === 1
            ? 'One membership was skipped — already in that group.'
            : `${alreadyInGroup} memberships were skipped (already in group).`,
          { duration: 5000 }
        );
      }
      if (added > 0) {
        toast.success(`${added} membership${added === 1 ? '' : 's'} added.`);
        onAssignmentComplete();
        onClose();
      } else if (alreadyInGroup > 0) {
        onAssignmentComplete();
        onClose();
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const count = selectedMemberIds.length;

  const renderTree = (nodes: TreeNode[], depth: number) =>
    nodes.map((node) => {
      const hasChildren = node.children.length > 0;
      const isExpanded = expandedIds.has(node.id);
      const isSelected = selectedGroups.has(node.id);
      const memberCount = node.member_count ?? 0;

      return (
        <Fragment key={node.id}>
          <div
            className="flex items-stretch gap-1 rounded-lg border border-transparent hover:border-gray-200 hover:bg-gray-50/80 transition-colors"
            style={{ paddingLeft: Math.max(0, depth) * 14 }}
          >
            <div className="flex w-7 shrink-0 items-center justify-center">
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => toggleExpand(node.id)}
                  className="p-1 rounded-md text-gray-500 hover:bg-gray-200/80 hover:text-gray-800"
                  aria-expanded={isExpanded}
                  aria-label={isExpanded ? 'Collapse' : 'Expand'}
                >
                  <ChevronRight
                    className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  />
                </button>
              ) : (
                <span className="w-4" />
              )}
            </div>
            <button
              type="button"
              onClick={() => toggleSelect(node.id)}
              className={`flex-1 flex items-center justify-between gap-2 p-2.5 rounded-lg border text-left min-w-0 ${
                isSelected
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center space-x-3 min-w-0">
                <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
                  <Users className="w-4 h-4 text-blue-600" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-sm text-gray-900 truncate">{node.name}</h3>
                  <p className="text-xs text-gray-500">
                    {depth === 0 ? 'Ministry / main group' : 'Subgroup'}
                    {node.group_type ? ` · ${node.group_type}` : ''}
                    {memberCount > 0 ? ` · ${memberCount} member${memberCount === 1 ? '' : 's'}` : ''}
                  </p>
                  {hasChildren && isSelected && (
                    <p className="text-[10px] text-blue-600 mt-0.5 font-medium">
                      Main group only — subgroups not included
                    </p>
                  )}
                  {!node.parent_group_id ? null : isSelected ? (
                    <p className="text-[10px] text-blue-700 mt-0.5">
                      Includes parent groups when you assign
                    </p>
                  ) : null}
                </div>
              </div>
              {isSelected && (
                <div className="w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3 text-white" />
                </div>
              )}
            </button>
          </div>
          {hasChildren && isExpanded && (
            <div className="space-y-1.5 mt-1">{renderTree(node.children, depth + 1)}</div>
          )}
        </Fragment>
      );
    });

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 z-50"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-8 py-6 border-b border-gray-100 shrink-0">
                <div className="flex items-center space-x-3 min-w-0">
                  <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center shrink-0">
                    <GitFork className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-2xl font-semibold text-gray-900">Assign to Group</h2>
                    <p className="text-sm text-gray-500 mt-0.5 truncate">
                      Select groups for {count} member{count !== 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-gray-400 mt-1 leading-snug">
                      Subgroups: member is added to that group and all parents. Main group only: not added to
                      subgroups.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-xl transition-all shrink-0"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex flex-col md:flex-row flex-1 min-h-0">
                <div className="w-full md:w-1/3 border-b md:border-b-0 md:border-r border-gray-100 bg-gray-50 p-6 overflow-y-auto max-h-[40vh] md:max-h-none">
                  <p className="text-sm font-medium text-gray-900 mb-4">
                    Selected members ({selectedMembersList.length})
                  </p>
                  <div className="space-y-2">
                    {selectedMembersList.length === 0 ? (
                      <p className="text-sm text-gray-500">No members in selection.</p>
                    ) : (
                      selectedMembersList.map((member) => (
                        <div
                          key={member.id}
                          className="flex items-center space-x-3 p-2 bg-white rounded-lg border border-gray-200"
                        >
                          <img
                            src={
                              member.profileImage ||
                              ''
                            }
                            alt=""
                            className="w-8 h-8 rounded-full object-cover bg-gray-100 shrink-0"
                            referrerPolicy="no-referrer"
                          />
                          <span className="text-sm font-medium text-gray-900 truncate">
                            {member.fullName || `${member.first_name} ${member.last_name}`}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="w-full md:w-2/3 flex flex-col min-h-0 flex-1">
                  <div className="p-4 border-b border-gray-100 shrink-0">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search groups, ministries, subgroups…"
                        className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-1.5 min-h-[200px] md:min-h-[280px]">
                    {loading ? (
                      <div className="flex items-center justify-center py-12 text-gray-500 text-sm">
                        Loading groups…
                      </div>
                    ) : error ? (
                      <div className="text-center py-8 text-sm text-red-600">{error}</div>
                    ) : displayTree.length === 0 ? (
                      <div className="text-center py-8 text-sm text-gray-500">
                        {availableGroups.length === 0
                          ? 'No groups available.'
                          : 'No groups match your search.'}
                      </div>
                    ) : (
                      renderTree(displayTree, 0)
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-3 px-8 py-4 border-t border-gray-100 bg-gray-50 shrink-0">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAssignToGroups}
                  disabled={
                    selectedGroups.size === 0 || loading || isSubmitting || selectedMemberIds.length === 0
                  }
                  className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Assigning…</span>
                    </>
                  ) : (
                    <span>Assign to selected groups</span>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default AssignToGroupModal;
