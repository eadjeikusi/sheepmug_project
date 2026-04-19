import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, ArchiveRestore, Inbox } from 'lucide-react';
import AddMinistryModal from '../modals/AddMinistryModal';
import DeletedGroupsTrashModal from '../modals/DeletedGroupsTrashModal';
import GroupJoinRequestsScopeModal from '../modals/GroupJoinRequestsScopeModal';
import { usePermissions } from '@/hooks/usePermissions';
import { Group } from '@/types';
import { toast } from 'sonner';
import MinistryCard from '../cards/MinistryCard'; // Will create this component
import { withBranchScope } from '@/utils/branchScopeHeaders';
import { useGroupTypeOptions } from '@/hooks/useGroupTypeOptions';

const PAGE_SIZE = 10;

const Ministries: React.FC = () => {
  const { token, authLoading } = useAuth();
  const { selectedBranch } = useBranch();
  const { can } = usePermissions();
  const canSeeGroupJoinRequests = can('view_group_requests') || can('approve_group_requests');
  const { options: groupTypeFilterOpts } = useGroupTypeOptions(true);
  const sortedGroupTypeLabels = useMemo(
    () =>
      [...groupTypeFilterOpts].sort(
        (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label),
      ),
    [groupTypeFilterOpts],
  );
  const [filterGroupType, setFilterGroupType] = useState('');
  const [ministries, setMinistries] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddMinistryModalOpen, setIsAddMinistryModalOpen] = useState(false);
  const [ministryToEdit, setMinistryToEdit] = useState<Group | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [groupJoinRequestsOpen, setGroupJoinRequestsOpen] = useState(false);
  const [trashCount, setTrashCount] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadedMinistriesCountRef = useRef(0);

  useEffect(() => {
    loadedMinistriesCountRef.current = ministries.length;
  }, [ministries.length]);

  const fetchTrashCount = useCallback(async () => {
    if (!token || authLoading) {
      setTrashCount(null);
      return;
    }
    try {
      let total = 0;
      let offset = 0;
      while (true) {
        const url = new URL('/api/groups', window.location.origin);
        if (selectedBranch) {
          url.searchParams.append('branch_id', selectedBranch.id);
        }
        url.searchParams.set('deleted_only', '1');
        url.searchParams.set('offset', String(offset));
        url.searchParams.set('limit', '100');
        const response = await fetch(url.toString(), {
          headers: withBranchScope(selectedBranch?.id, {
            Authorization: `Bearer ${token}`,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setTrashCount(null);
          return;
        }
        const batch = Array.isArray(data) ? data : Array.isArray(data?.groups) ? data.groups : [];
        total += batch.length;
        if (batch.length < 100) break;
        offset += batch.length;
      }
      setTrashCount(total);
    } catch {
      setTrashCount(null);
    }
  }, [token, authLoading, selectedBranch]);

  const fetchMinistries = useCallback(async (reset = true) => {
    if (!token || authLoading) {
      setIsLoading(false);
      return;
    }
    if (reset) {
      setIsLoading(true);
      setError(null);
      setHasMore(true);
    } else {
      setLoadingMore(true);
    }
    try {
      const offset = reset ? 0 : loadedMinistriesCountRef.current;
      const url = new URL('/api/groups', window.location.origin);
      if (selectedBranch) {
        url.searchParams.append('branch_id', selectedBranch.id);
      }
      if (filterGroupType.trim()) {
        url.searchParams.set('group_type', filterGroupType.trim());
      }
      url.searchParams.set('offset', String(offset));
      url.searchParams.set('limit', String(PAGE_SIZE));
      const response = await fetch(url.toString(), {
        headers: withBranchScope(selectedBranch?.id, {
          'Authorization': `Bearer ${token}`
        })
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as { error?: string };
        const detail = errorBody?.error || response.statusText;
        throw new Error(`Failed to fetch ministries: ${detail}`);
      }
      const data = await response.json();
      const rows = Array.isArray(data) ? data : Array.isArray(data?.groups) ? data.groups : [];
      setMinistries((prev) => (reset ? rows : [...prev, ...rows]));
      setHasMore(rows.length === PAGE_SIZE);
    } catch (err: any) {
      if (reset) {
        setError(err.message);
        toast.error('Failed to load ministries');
      }
    } finally {
      if (reset) {
        setIsLoading(false);
      } else {
        setLoadingMore(false);
      }
    }
  }, [token, authLoading, selectedBranch, filterGroupType]);

  useEffect(() => {
    fetchMinistries();
  }, [fetchMinistries]);

  useEffect(() => {
    if (loadingMore || isLoading || !hasMore) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          void fetchMinistries(false);
        }
      },
      { rootMargin: '220px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchMinistries, loadingMore, isLoading, hasMore]);

  useEffect(() => {
    void fetchTrashCount();
  }, [fetchTrashCount]);

  if (isLoading) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-4 text-gray-600">Loading ministries...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center text-red-600">
        <p>Error: {error}</p>
        <Button onClick={fetchMinistries} className="mt-4">Retry</Button>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col flex-1 p-6">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Ministries Management</h1>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 mr-2">
              <label htmlFor="ministry-type-filter" className="text-sm text-gray-600 whitespace-nowrap">
                Group Type
              </label>
              <select
                id="ministry-type-filter"
                value={filterGroupType}
                onChange={(e) => setFilterGroupType(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">All</option>
                {sortedGroupTypeLabels.map((o) => (
                  <option key={o.id} value={o.label}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <Button variant="outline" onClick={() => setTrashOpen(true)}>
              <ArchiveRestore className="mr-2 h-4 w-4" />
              Deleted Ministries
              {trashCount !== null ? (
                <span className="tabular-nums text-muted-foreground">({trashCount})</span>
              ) : null}
            </Button>
            {canSeeGroupJoinRequests ? (
              <Button variant="outline" onClick={() => setGroupJoinRequestsOpen(true)}>
                <Inbox className="mr-2 h-4 w-4" />
                Group join requests
              </Button>
            ) : null}
            <Button onClick={() => { setMinistryToEdit(null); setIsAddMinistryModalOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" />
              Create New Ministry
            </Button>
          </div>
        </div>
        <p className="mt-2 text-gray-600">Manage all ministries and their subgroups within your organization.</p>

        {ministries.length === 0 ? (
          <div className="flex flex-col flex-1 items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-8 mt-8">
            <p className="text-lg text-gray-500">No ministries found.</p>
            <p className="text-gray-500">Click "Create New Ministry" to add your first ministry.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
            {ministries.map(ministry => (
              <MinistryCard
                key={ministry.id}
                ministry={ministry}
                onEdit={
                  ministry.system_kind === 'all_members'
                    ? undefined
                    : (m) => {
                        setMinistryToEdit(m);
                        setIsAddMinistryModalOpen(true);
                      }
                }
              />
            ))}
          </div>
        )}
        {!isLoading && hasMore ? <div ref={sentinelRef} className="h-6" /> : null}
        {loadingMore ? (
          <div className="flex items-center justify-center py-2 text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading more ministries...
          </div>
        ) : null}
      </div>

      <AddMinistryModal
        isOpen={isAddMinistryModalOpen}
        onClose={() => setIsAddMinistryModalOpen(false)}
        onSave={fetchMinistries}
        ministryToEdit={ministryToEdit}
      />

      <DeletedGroupsTrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        onRestored={() => {
          void fetchMinistries();
          void fetchTrashCount();
        }}
      />

      <GroupJoinRequestsScopeModal open={groupJoinRequestsOpen} onClose={() => setGroupJoinRequestsOpen(false)} />
    </>
  );
};

export default Ministries;
