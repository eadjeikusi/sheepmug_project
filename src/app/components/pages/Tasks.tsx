import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Link } from 'react-router';
import {
  ListTodo,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  LayoutGrid,
  Users,
  Building2,
  Calendar,
  CalendarClock,
  User,
  PenLine,
  RefreshCw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import { notifyMemberTasksChanged } from '@/hooks/useMyOpenTaskCount';
import { formatLongWeekdayDateTime, formatCalendarCountdown } from '@/utils/dateDisplayFormat';
import { usePermissions } from '@/hooks/usePermissions';
import type { Member } from '@/types';
import AssignTaskModal from '../modals/AssignTaskModal';
import AssignGroupTaskModal from '../modals/AssignGroupTaskModal';
import {
  DateTimePickerField,
  MonthPickerField,
  formatMonthYear,
  parseDateTimeLocalValue,
  parseYearMonth,
} from '@/components/datetime';
import { FilterResultChips, type FilterChipItem } from '../FilterResultChips';
import { TaskListSkeleton } from '@/components/skeletons/data-skeletons';
import { capitalizeSentencesForUi } from '@/utils/sentenceCaseDisplay';
import { displayTitleWords } from '@/utils/displayText';

/** Stable empty array for AssignTaskModal initial members (avoids new [] each render). */
const ASSIGN_TASK_NO_INITIAL_MEMBERS: string[] = [];

type TaskMemberRef = { id: string; first_name: string | null; last_name: string | null };

type TaskGroupRef = { id: string; name: string | null };

type ChecklistItem = { id: string; label: string; done: boolean };
type ChecklistLineEdit = { key: string; id?: string; label: string; done: boolean };

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  /** Present for member follow-up tasks */
  member_id?: string;
  /** Present for group follow-up tasks */
  group_id?: string;
  task_type?: 'member' | 'group';
  assignee_profile_id: string;
  assignee_profile_ids?: string[];
  created_by_profile_id: string;
  checklist: ChecklistItem[];
  related_member_ids: string[];
  related_group_ids?: string[];
  members: TaskMemberRef[];
  groups?: TaskGroupRef[];
};

type BranchTaskRow = TaskRow & {
  assignee_name: string;
  created_by_name: string;
};

type MineTaskRow = TaskRow & {
  assignee_name: string;
  created_by_name: string;
};

type StaffOpt = { id: string; email: string | null; first_name: string | null; last_name: string | null };

/** How many task cards to mount at once; scroll loads the next batch. */
const TASK_LIST_PAGE_SIZE = 5;
const TASK_SERVER_PAGE_SIZE = 100;

function membersLine(ms: TaskMemberRef[]) {
  if (!ms.length) return 'Member';
  const names = ms.map((m) => [m.first_name, m.last_name].filter(Boolean).join(' ').trim()).filter(Boolean);
  return names.length ? names.join(', ') : 'Member';
}

function groupsLine(gs: TaskGroupRef[] | undefined) {
  if (!gs?.length) return '';
  return gs.map((g) => g.name || 'Group').filter(Boolean).join(', ');
}

function isGroupTask(t: Pick<TaskRow, 'task_type' | 'group_id' | 'member_id'>): boolean {
  if (t.task_type === 'group') return true;
  if (t.task_type === 'member') return false;
  return Boolean(t.group_id);
}

function taskApiPath(id: string, t: Pick<TaskRow, 'task_type' | 'group_id' | 'member_id'>): string {
  return isGroupTask(t) ? `/api/group-tasks/${encodeURIComponent(id)}` : `/api/member-tasks/${encodeURIComponent(id)}`;
}

function isMemberDbId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id).trim());
}

function isChecklistLineId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id).trim());
}

function leaderIdsFromTaskRow(t: Pick<TaskRow, 'assignee_profile_id' | 'assignee_profile_ids'>): string[] {
  if (Array.isArray(t.assignee_profile_ids) && t.assignee_profile_ids.length > 0) {
    return [...new Set(t.assignee_profile_ids.filter((id) => isMemberDbId(id)))];
  }
  return t.assignee_profile_id ? [t.assignee_profile_id] : [];
}

function isTaskCreatorRow(t: Pick<TaskRow, 'created_by_profile_id'>, userId: string | undefined): boolean {
  return Boolean(userId && t.created_by_profile_id === userId);
}

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusPillClass(status: string) {
  if (status === 'completed') return 'bg-blue-50 text-blue-800';
  if (status === 'in_progress') return 'bg-blue-50 text-blue-800';
  if (status === 'cancelled') return 'bg-gray-100 text-gray-600';
  return 'bg-amber-50 text-amber-900';
}

function taskMatchesQuery(
  t: TaskRow | BranchTaskRow | MineTaskRow,
  q: string,
): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  if (t.title.toLowerCase().includes(s)) return true;
  if (t.description?.toLowerCase().includes(s)) return true;
  const members = Array.isArray(t.members) ? t.members : [];
  for (const m of members) {
    const name = [m.first_name, m.last_name].filter(Boolean).join(' ').toLowerCase();
    if (name.includes(s)) return true;
  }
  const groups = Array.isArray(t.groups) ? t.groups : [];
  for (const g of groups) {
    if ((g.name || '').toLowerCase().includes(s)) return true;
  }
  if ('assignee_name' in t && t.assignee_name?.toLowerCase().includes(s)) return true;
  if ('created_by_name' in t && t.created_by_name?.toLowerCase().includes(s)) return true;
  return false;
}

export default function Tasks() {
  const { token, user, loading: authLoading } = useAuth();
  const { selectedBranch } = useBranch();
  const { can } = usePermissions();
  /** Legacy sessions omit `permissions`; usePermissions treats that as allow-all. Do not hide the task UI forever once auth has finished loading. */
  const permissionsResolved =
    !user ||
    user.is_org_owner === true ||
    user.is_super_admin === true ||
    user.permissions !== undefined ||
    !authLoading;
  const canViewMine = can('view_member_tasks') || can('view_group_tasks');
  const canManageMember =
    can('add_member_tasks') ||
    can('edit_member_tasks') ||
    can('delete_member_tasks') ||
    can('edit_member_task_checklist') ||
    can('complete_member_task_checklist');
  const canManageGroup =
    can('add_group_tasks') ||
    can('edit_group_tasks') ||
    can('delete_group_tasks') ||
    can('edit_group_task_checklist') ||
    can('complete_group_task_checklist');
  const canEditChecklistMember = canManageMember;
  const canEditChecklistGroup = canManageGroup;
  const isElevatedTaskViewer = user?.is_org_owner === true || user?.is_super_admin === true;
  const canBranch = isElevatedTaskViewer;
  const canManageBranchTask = (t: TaskRow | BranchTaskRow | MineTaskRow) =>
    isGroupTask(t) ? canManageGroup : canManageMember;

  const [mineTasks, setMineTasks] = useState<MineTaskRow[]>([]);
  const [mineLoading, setMineLoading] = useState(true);
  const [mineServerHasMore, setMineServerHasMore] = useState(true);
  const [mineLoadingMore, setMineLoadingMore] = useState(false);
  const [mineTotalCount, setMineTotalCount] = useState<number | null>(null);
  const mineLoadedRef = useRef(0);

  const [branchStatus, setBranchStatus] = useState<'open' | 'all'>('open');
  const [branchMonth, setBranchMonth] = useState('');
  const [branchDueFrom, setBranchDueFrom] = useState('');
  const [branchDueTo, setBranchDueTo] = useState('');
  const [branchAssigneeId, setBranchAssigneeId] = useState('');
  const [branchCreatedById, setBranchCreatedById] = useState('');
  const [branchTasks, setBranchTasks] = useState<BranchTaskRow[]>([]);
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchServerHasMore, setBranchServerHasMore] = useState(true);
  const [branchLoadingMore, setBranchLoadingMore] = useState(false);
  const [branchTotalCount, setBranchTotalCount] = useState<number | null>(null);
  const branchLoadedRef = useRef(0);

  const [staffOptions, setStaffOptions] = useState<StaffOpt[]>([]);
  const [membersForModal, setMembersForModal] = useState<Member[]>([]);
  const [createMemberOpen, setCreateMemberOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const createMenuRef = useRef<HTMLDivElement>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDue, setEditDue] = useState('');
  const [editAssigneeIds, setEditAssigneeIds] = useState<Set<string>>(() => new Set());
  const [editChecklistLines, setEditChecklistLines] = useState<ChecklistLineEdit[]>([]);
  const [editSaving, setEditSaving] = useState(false);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [branchSearch, setBranchSearch] = useState('');
  const [branchSearchFocus, setBranchSearchFocus] = useState(false);
  const [branchTaskTypeFilter, setBranchTaskTypeFilter] = useState<'all' | 'member' | 'group'>('all');
  const [branchFiltersOpen, setBranchFiltersOpen] = useState(false);

  const [mineSearch, setMineSearch] = useState('');
  const [mineSearchFocus, setMineSearchFocus] = useState(false);
  const [mineTaskTypeFilter, setMineTaskTypeFilter] = useState<'all' | 'member' | 'group'>('all');
  const [mineFiltersOpen, setMineFiltersOpen] = useState(false);
  const [branchLoadError, setBranchLoadError] = useState<string | null>(null);
  const [mineLoadError, setMineLoadError] = useState<string | null>(null);

  const branchFiltered = useMemo(() => {
    let list = branchTasks.filter((t) => taskMatchesQuery(t, branchSearch));
    if (branchTaskTypeFilter === 'member') list = list.filter((t) => !isGroupTask(t));
    if (branchTaskTypeFilter === 'group') list = list.filter((t) => isGroupTask(t));
    return list;
  }, [branchTasks, branchSearch, branchTaskTypeFilter]);

  const mineFiltered = useMemo(() => {
    let list = mineTasks.filter((t) => taskMatchesQuery(t, mineSearch));
    if (mineTaskTypeFilter === 'member') list = list.filter((t) => !isGroupTask(t));
    if (mineTaskTypeFilter === 'group') list = list.filter((t) => isGroupTask(t));
    return list;
  }, [mineTasks, mineSearch, mineTaskTypeFilter]);

  const [branchVisibleCount, setBranchVisibleCount] = useState(TASK_LIST_PAGE_SIZE);
  const [mineVisibleCount, setMineVisibleCount] = useState(TASK_LIST_PAGE_SIZE);
  const branchSentinelRef = useRef<HTMLDivElement | null>(null);
  const mineSentinelRef = useRef<HTMLDivElement | null>(null);
  const branchLoadThrottle = useRef(0);
  const mineLoadThrottle = useRef(0);

  useEffect(() => {
    setBranchVisibleCount(TASK_LIST_PAGE_SIZE);
  }, [branchSearch, branchTaskTypeFilter, branchTasks.length, branchLoading]);

  useEffect(() => {
    setMineVisibleCount(TASK_LIST_PAGE_SIZE);
  }, [mineFiltered.length, mineLoading, mineSearch, mineTaskTypeFilter]);

  const branchPaged = useMemo(
    () => branchFiltered.slice(0, branchVisibleCount),
    [branchFiltered, branchVisibleCount],
  );
  const minePaged = useMemo(
    () => mineFiltered.slice(0, mineVisibleCount),
    [mineFiltered, mineVisibleCount],
  );
  const branchHasMore = branchVisibleCount < branchFiltered.length;
  const mineHasMore = mineVisibleCount < mineFiltered.length;

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const fetchMinePage = useCallback(async (offset: number, reset: boolean) => {
    const res = await fetch(
      `/api/tasks/mine?status=open&offset=${offset}&limit=${TASK_SERVER_PAGE_SIZE}`,
      { headers: withBranchScope(selectedBranch?.id ?? null, { Authorization: `Bearer ${token}` }) },
    );
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof raw?.error === 'string' ? raw.error : 'Could not load your tasks');
    }
    const list = (raw as { tasks?: MineTaskRow[]; total_count?: number }).tasks;
    const rows = Array.isArray(list) ? list : [];
    const total = typeof raw.total_count === 'number' ? raw.total_count : null;
    setMineTasks((prev) => (reset ? rows : [...prev, ...rows]));
    mineLoadedRef.current = reset ? rows.length : mineLoadedRef.current + rows.length;
    setMineServerHasMore(rows.length >= TASK_SERVER_PAGE_SIZE);
    setMineTotalCount(total);
    setMineLoadError(null);
  }, [token, selectedBranch?.id]);

  const loadMine = useCallback(async () => {
    if (!token || !canViewMine || isElevatedTaskViewer) {
      setMineTasks([]);
      setMineLoading(false);
      return;
    }
    setMineLoading(true);
    try {
      mineLoadedRef.current = 0;
      await fetchMinePage(0, true);
    } catch {
      setMineTasks([]);
      setMineLoadError('Could not load your tasks');
    } finally {
      setMineLoading(false);
    }
  }, [token, canViewMine, isElevatedTaskViewer, fetchMinePage]);

  const loadMoreMine = useCallback(async () => {
    if (!token || mineLoading || mineLoadingMore || !mineServerHasMore) return;
    setMineLoadingMore(true);
    try {
      await fetchMinePage(mineLoadedRef.current, false);
    } catch { /* keep existing data */ }
    finally { setMineLoadingMore(false); }
  }, [token, mineLoading, mineLoadingMore, mineServerHasMore, fetchMinePage]);

  const branchQueryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set('status', branchStatus === 'open' ? 'open' : 'all');
    if (isElevatedTaskViewer) p.set('org_wide', '1');
    if (branchMonth.trim()) p.set('month', branchMonth.trim());
    if (branchDueFrom.trim()) p.set('due_from', new Date(branchDueFrom).toISOString());
    if (branchDueTo.trim()) p.set('due_to', new Date(branchDueTo).toISOString());
    if (branchAssigneeId.trim() && isMemberDbId(branchAssigneeId)) p.set('assignee_profile_id', branchAssigneeId.trim());
    if (branchCreatedById.trim() && isMemberDbId(branchCreatedById))
      p.set('created_by_profile_id', branchCreatedById.trim());
    return p.toString();
  }, [branchStatus, branchMonth, branchDueFrom, branchDueTo, branchAssigneeId, branchCreatedById, isElevatedTaskViewer]);

  const fetchBranchPage = useCallback(async (offset: number, reset: boolean) => {
    const qp = branchQueryString ? `${branchQueryString}&` : '';
    const res = await fetch(
      `/api/tasks/branch?${qp}offset=${offset}&limit=${TASK_SERVER_PAGE_SIZE}`,
      { headers: withBranchScope(selectedBranch?.id ?? null, { Authorization: `Bearer ${token}` }) },
    );
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof raw?.error === 'string' ? raw.error : 'Could not load follow-up tasks');
    }
    const list = (raw as { tasks?: BranchTaskRow[]; total_count?: number }).tasks;
    const rows = Array.isArray(list) ? list : [];
    const total = typeof raw.total_count === 'number' ? raw.total_count : null;
    setBranchTasks((prev) => (reset ? rows : [...prev, ...rows]));
    branchLoadedRef.current = reset ? rows.length : branchLoadedRef.current + rows.length;
    setBranchServerHasMore(rows.length >= TASK_SERVER_PAGE_SIZE);
    setBranchTotalCount(total);
    setBranchLoadError(null);
  }, [token, branchQueryString, selectedBranch?.id]);

  const loadBranch = useCallback(async () => {
    if (!token || !canBranch) {
      setBranchTasks([]);
      return;
    }
    setBranchLoading(true);
    try {
      branchLoadedRef.current = 0;
      await fetchBranchPage(0, true);
    } catch {
      setBranchTasks([]);
      setBranchLoadError('Could not load follow-up tasks');
    } finally {
      setBranchLoading(false);
    }
  }, [token, canBranch, fetchBranchPage]);

  const loadMoreBranch = useCallback(async () => {
    if (!token || branchLoading || branchLoadingMore || !branchServerHasMore) return;
    setBranchLoadingMore(true);
    try {
      await fetchBranchPage(branchLoadedRef.current, false);
    } catch { /* keep existing data */ }
    finally { setBranchLoadingMore(false); }
  }, [token, branchLoading, branchLoadingMore, branchServerHasMore, fetchBranchPage]);

  useEffect(() => {
    const el = branchSentinelRef.current;
    const canShowMore = branchHasMore || branchServerHasMore;
    if (!el || !canShowMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        const now = Date.now();
        if (now - branchLoadThrottle.current < 280) return;
        branchLoadThrottle.current = now;
        if (branchHasMore) {
          setBranchVisibleCount((c) => Math.min(c + TASK_LIST_PAGE_SIZE, branchFiltered.length));
        } else if (branchServerHasMore) {
          void loadMoreBranch();
        }
      },
      { root: null, rootMargin: '320px 0px', threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [branchHasMore, branchServerHasMore, branchFiltered.length, branchVisibleCount, loadMoreBranch]);

  useEffect(() => {
    const el = mineSentinelRef.current;
    const canShowMore = mineHasMore || mineServerHasMore;
    if (!el || !canShowMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        const now = Date.now();
        if (now - mineLoadThrottle.current < 280) return;
        mineLoadThrottle.current = now;
        if (mineHasMore) {
          setMineVisibleCount((c) => Math.min(c + TASK_LIST_PAGE_SIZE, mineFiltered.length));
        } else if (mineServerHasMore) {
          void loadMoreMine();
        }
      },
      { root: null, rootMargin: '320px 0px', threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [mineHasMore, mineServerHasMore, mineFiltered.length, mineVisibleCount, loadMoreMine]);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  useEffect(() => {
    void loadBranch();
  }, [loadBranch]);

  useEffect(() => {
    const needStaffForBranch = canBranch;
    const needStaffForMine = canViewMine && !isElevatedTaskViewer;
    if (!token || (!needStaffForBranch && !needStaffForMine)) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/org/staff', {
          headers: withBranchScope(selectedBranch?.id ?? null, { Authorization: `Bearer ${token}` }),
        });
        const raw = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        const staff = (raw as { staff?: StaffOpt[] }).staff;
        setStaffOptions(Array.isArray(staff) ? staff : []);
      } catch {
        if (!cancelled) setStaffOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, canBranch, canViewMine, isElevatedTaskViewer, selectedBranch?.id]);

  useEffect(() => {
    if (!token || !canManageMember || !createMemberOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const url = new URL('/api/members', window.location.origin);
        url.searchParams.set('include_deleted', 'false');
        if (selectedBranch?.id) url.searchParams.set('branch_id', selectedBranch.id);
        const res = await fetch(url.toString(), {
          headers: withBranchScope(selectedBranch?.id ?? null, { Authorization: `Bearer ${token}` }),
        });
        if (!res.ok || cancelled) return;
        const data: unknown = await res.json().catch(() => ({}));
        const arr = Array.isArray(data) ? data : Array.isArray((data as any)?.members) ? (data as any).members : [];
        const mapped: Member[] = arr.map((m: Record<string, unknown>) => ({
          ...(m as Member),
          fullName: `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim(),
        })) as Member[];
        if (!cancelled) setMembersForModal(mapped);
      } catch {
        if (!cancelled) setMembersForModal([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, canManageMember, createMemberOpen, selectedBranch?.id]);

  useEffect(() => {
    if (!createMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = createMenuRef.current;
      if (el && !el.contains(e.target as Node)) setCreateMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [createMenuOpen]);

  useEffect(() => {
    if (!branchFiltersOpen) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBranchFiltersOpen(false);
    };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [branchFiltersOpen]);

  useEffect(() => {
    if (!mineFiltersOpen) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMineFiltersOpen(false);
    };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [mineFiltersOpen]);

  const clearAllBranchFilters = useCallback(() => {
    setBranchTaskTypeFilter('all');
    setBranchSearch('');
    setBranchStatus('open');
    setBranchMonth('');
    setBranchDueFrom('');
    setBranchDueTo('');
    setBranchAssigneeId('');
    setBranchCreatedById('');
  }, []);

  const branchFilterChips = useMemo((): FilterChipItem[] => {
    const staffLabel = (id: string) => {
      const s = staffOptions.find((x) => x.id === id);
      if (!s) return id.slice(0, 8);
      return [s.first_name, s.last_name].filter(Boolean).join(' ') || s.email || id.slice(0, 8);
    };
    const chips: FilterChipItem[] = [];
    if (branchTaskTypeFilter !== 'all') {
      chips.push({
        id: 'type',
        label: `Type: ${branchTaskTypeFilter === 'member' ? 'Member' : 'Group'}`,
        onRemove: () => setBranchTaskTypeFilter('all'),
      });
    }
    const bq = branchSearch.trim();
    if (bq) {
      chips.push({
        id: 'search',
        label: `Search: "${bq.length > 48 ? `${bq.slice(0, 48)}…` : bq}"`,
        onRemove: () => setBranchSearch(''),
      });
    }
    if (branchStatus === 'all') {
      chips.push({
        id: 'status',
        label: 'Status: All',
        onRemove: () => setBranchStatus('open'),
      });
    }
    if (branchMonth.trim()) {
      const d = parseYearMonth(branchMonth.trim());
      chips.push({
        id: 'month',
        label: d ? `Due month: ${formatMonthYear(d)}` : `Due month: ${branchMonth.trim()}`,
        onRemove: () => setBranchMonth(''),
      });
    }
    if (branchDueFrom.trim()) {
      const p = parseDateTimeLocalValue(branchDueFrom);
      chips.push({
        id: 'dueFrom',
        label: p ? `Due from: ${format(p.date, 'MMM d, yyyy h:mm a')}` : `Due from: ${branchDueFrom}`,
        onRemove: () => setBranchDueFrom(''),
      });
    }
    if (branchDueTo.trim()) {
      const p = parseDateTimeLocalValue(branchDueTo);
      chips.push({
        id: 'dueTo',
        label: p ? `Due to: ${format(p.date, 'MMM d, yyyy h:mm a')}` : `Due to: ${branchDueTo}`,
        onRemove: () => setBranchDueTo(''),
      });
    }
    if (branchAssigneeId.trim()) {
      chips.push({
        id: 'assignee',
        label: `Assignee: ${staffLabel(branchAssigneeId.trim())}`,
        onRemove: () => setBranchAssigneeId(''),
      });
    }
    if (branchCreatedById.trim()) {
      chips.push({
        id: 'createdBy',
        label: `Assigned by: ${staffLabel(branchCreatedById.trim())}`,
        onRemove: () => setBranchCreatedById(''),
      });
    }
    return chips;
  }, [
    branchTaskTypeFilter,
    branchSearch,
    branchStatus,
    branchMonth,
    branchDueFrom,
    branchDueTo,
    branchAssigneeId,
    branchCreatedById,
    staffOptions,
  ]);

  const clearAllMineFilters = useCallback(() => {
    setMineTaskTypeFilter('all');
    setMineSearch('');
  }, []);

  const mineFilterChips = useMemo((): FilterChipItem[] => {
    const chips: FilterChipItem[] = [];
    if (mineTaskTypeFilter !== 'all') {
      chips.push({
        id: 'type',
        label: `Type: ${mineTaskTypeFilter === 'member' ? 'Member' : 'Group'}`,
        onRemove: () => setMineTaskTypeFilter('all'),
      });
    }
    const mq = mineSearch.trim();
    if (mq) {
      chips.push({
        id: 'search',
        label: `Search: "${mq.length > 48 ? `${mq.slice(0, 48)}…` : mq}"`,
        onRemove: () => setMineSearch(''),
      });
    }
    return chips;
  }, [mineTaskTypeFilter, mineSearch]);

  const mergeTaskUpdate = <T extends MineTaskRow | BranchTaskRow>(x: T, updated: TaskRow): T =>
    ({
      ...x,
      ...updated,
      task_type: x.task_type ?? updated.task_type ?? (updated.group_id ? 'group' : 'member'),
      member_id: updated.member_id ?? x.member_id,
      group_id: updated.group_id ?? x.group_id,
      checklist: updated.checklist !== undefined ? updated.checklist : x.checklist,
      related_member_ids:
        updated.related_member_ids !== undefined ? updated.related_member_ids : x.related_member_ids,
      related_group_ids:
        updated.related_group_ids !== undefined ? updated.related_group_ids : x.related_group_ids,
      assignee_profile_ids:
        updated.assignee_profile_ids !== undefined ? updated.assignee_profile_ids : x.assignee_profile_ids,
      assignee_name: x.assignee_name,
      created_by_name: x.created_by_name,
      members: updated.members ?? x.members,
      groups: updated.groups ?? x.groups,
    }) as T;

  const patchChecklistItem = async (
    taskId: string,
    itemId: string,
    done: boolean,
    reload: 'mine' | 'branch',
    task?: TaskRow | BranchTaskRow,
  ) => {
    if (!token || !user?.id) return;
    if (!task) return;
    try {
      const canEditStruct = isGroupTask(task) ? canEditChecklistGroup : canEditChecklistMember;
      let body: Record<string, unknown>;
      if (canEditStruct) {
        const full = (task.checklist ?? []).map((c) => (c.id === itemId ? { ...c, done } : c));
        body = { checklist: full.map((c) => ({ id: c.id, label: c.label, done: c.done })) };
      } else {
        body = { checklist: [{ id: itemId, done }] };
      }
      const path = taskApiPath(taskId, task);
      const res = await fetch(path, {
        method: 'PATCH',
        headers: withBranchScope(selectedBranch?.id ?? null, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(body),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof raw?.error === 'string' ? raw.error : 'Could not update checklist');
        return;
      }
      const updated = (raw as { task?: TaskRow }).task;
      if (updated) {
        if (reload === 'mine') {
          setMineTasks((prev) =>
            prev.map((x) => (x.id === taskId ? mergeTaskUpdate(x, updated) : x)),
          );
        } else {
          setBranchTasks((prev) =>
            prev.map((x) => (x.id === taskId ? mergeTaskUpdate(x, updated) : x)),
          );
        }
      } else {
        if (reload === 'mine') void loadMine();
        else void loadBranch();
      }
      notifyMemberTasksChanged();
    } catch {
      toast.error('Could not update checklist');
    }
  };

  const startEdit = (t: BranchTaskRow | MineTaskRow) => {
    if (!user?.id) return;
    if (!isTaskCreatorRow(t, user.id) && !isElevatedTaskViewer) return;
    setEditingId(t.id);
    setEditTitle(t.title);
    setEditDescription(t.description ?? '');
    setEditDue(toDatetimeLocalValue(t.due_at));
    setEditAssigneeIds(new Set(leaderIdsFromTaskRow(t)));
    setEditChecklistLines((t.checklist ?? []).map((c) => ({ key: c.id, id: c.id, label: c.label, done: c.done })));
  };

  const findTaskListById = (id: string): { row: BranchTaskRow | MineTaskRow; list: 'mine' | 'branch' } | null => {
    const m = mineTasks.find((x) => x.id === id);
    if (m) return { row: m, list: 'mine' };
    const b = branchTasks.find((x) => x.id === id);
    if (b) return { row: b, list: 'branch' };
    return null;
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditSaving(false);
    setEditChecklistLines([]);
  };

  const saveEdit = async () => {
    const found = editingId ? findTaskListById(editingId) : null;
    if (!token || !editingId || !found || !user?.id) return;
    if (!isTaskCreatorRow(found.row, user.id) && !isElevatedTaskViewer) return;
    const title = editTitle.trim();
    if (!title) {
      toast.error('Enter a title');
      return;
    }
    const groupTaskRow = isGroupTask(found.row);
    if (!groupTaskRow && editAssigneeIds.size === 0) {
      toast.error('Choose at least one assignee');
      return;
    }
    setEditSaving(true);
    try {
      const body: Record<string, unknown> = {
        title,
        description: editDescription.trim() || null,
      };
      if (!groupTaskRow) {
        body.assignee_profile_ids = [...editAssigneeIds];
      }
      body.checklist = editChecklistLines
        .filter((line) => line.label.trim())
        .map((line) => {
          const label = line.label.trim();
          if (line.id && isChecklistLineId(line.id)) {
            return { id: line.id, label, done: line.done };
          }
          return { label, done: line.done };
        });
      if (editDue.trim()) body.due_at = new Date(editDue).toISOString();
      else body.due_at = null;
      const path = taskApiPath(editingId, found.row);
      const res = await fetch(path, {
        method: 'PATCH',
        headers: withBranchScope(selectedBranch?.id ?? null, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(body),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof raw?.error === 'string' ? raw.error : 'Could not save');
      cancelEdit();
      notifyMemberTasksChanged();
      if (found.list === 'mine') void loadMine();
      else void loadBranch();
      toast.success('Task updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setEditSaving(false);
    }
  };

  const deleteBranchTask = async (id: string) => {
    const found = findTaskListById(id);
    if (!token || !found || !user?.id) return;
    if (!isTaskCreatorRow(found.row, user.id) && !isElevatedTaskViewer) return;
    const row = found.row;
    if (
      !window.confirm(
        'Delete this task permanently? Checklist progress and linked members will be lost. This cannot be undone.',
      )
    ) {
      return;
    }
    try {
      const path = taskApiPath(id, row);
      const res = await fetch(path, {
        method: 'DELETE',
        headers: withBranchScope(selectedBranch?.id ?? null, { Authorization: `Bearer ${token}` }),
      });
      if (!res.ok) {
        const raw = await res.json().catch(() => ({}));
        throw new Error(typeof raw?.error === 'string' ? raw.error : 'Could not delete');
      }
      if (editingId === id) cancelEdit();
      notifyMemberTasksChanged();
      if (found.list === 'mine') void loadMine();
      else void loadBranch();
      toast.success('Task removed');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete');
    }
  };

  const renderTaskCard = (
    t: TaskRow | BranchTaskRow | MineTaskRow,
    opts: {
      reload: 'mine' | 'branch';
      showAssignee?: boolean;
      includeManageButtons?: boolean;
    },
  ) => {
    const checklist = Array.isArray(t.checklist) ? t.checklist : [];
    const linked = Array.isArray(t.members) && t.members.length > 0 ? t.members : [];
    const groupTask = isGroupTask(t);
    const rawAssigneeName = 'assignee_name' in t ? t.assignee_name : undefined;
    const rawCreatedByName = 'created_by_name' in t ? t.created_by_name : undefined;
    const selfId = user?.id;
    const assigneeName = rawAssigneeName
      ? leaderIdsFromTaskRow(t).length === 1 && selfId && leaderIdsFromTaskRow(t)[0] === selfId
        ? 'Self'
        : rawAssigneeName.split(', ').map((n, i) => {
            const ids = leaderIdsFromTaskRow(t);
            return selfId && ids[i] === selfId ? 'Self' : n;
          }).join(', ')
      : undefined;
    const createdByName = selfId && t.created_by_profile_id === selfId ? 'Self' : rawCreatedByName;
    const isCreator = isTaskCreatorRow(t, user?.id);
    const assigneeIdList = leaderIdsFromTaskRow(t);
    const expanded = expandedIds.has(t.id);
    const dueCountdown = t.due_at ? formatCalendarCountdown(t.due_at) : '';
    const canEditStructForTask = groupTask ? canEditChecklistGroup : canEditChecklistMember;
    const canToggleCheck =
      t.status !== 'cancelled' &&
      t.status !== 'completed' &&
      !!user?.id &&
      (assigneeIdList.includes(user.id) || canEditStructForTask);

    const actionOpacityClass =
      'opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100';

    return (
      <div
        className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 group cursor-pointer"
        onClick={(e) => {
          const el = e.target as HTMLElement;
          if (el.closest('button, a, input, textarea, select, label')) return;
          toggleExpanded(t.id);
        }}
      >
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <div className="w-full text-left rounded-lg -mx-1 px-1 py-0.5 hover:bg-gray-50/80 transition-colors">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-gray-400 shrink-0 group-hover:text-gray-600" aria-hidden>
                  {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-gray-900">{displayTitleWords(t.title)}</p>
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        groupTask ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {groupTask ? 'Group' : 'Member'}
                    </span>
                  </div>
                  {!expanded && (
                    <p className="text-xs text-gray-500 mt-1">
                      {checklist.length === 0
                        ? 'No checklist steps — click to expand'
                        : `${checklist.length} checklist items — click to expand`}
                    </p>
                  )}
                </div>
              </div>
            </div>
            {t.description ? (
              <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap pl-7">
                {capitalizeSentencesForUi(t.description)}
              </p>
            ) : null}
            <p className="text-xs text-gray-500 mt-1 pl-7">
              {groupTask ? (
                <>
                  About groups:{' '}
                  <span className="text-gray-700">
                    {groupsLine(t.groups) || '—'}
                    {t.group_id ? (
                      <>
                        {' '}
                        (
                        <Link
                          to={`/groups/${t.group_id}`}
                          className="text-blue-600 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          open
                        </Link>
                        )
                      </>
                    ) : null}
                  </span>
                </>
              ) : (
                <>
                  About: <span className="text-gray-700">{membersLine(linked)}</span>
                </>
              )}
              {opts.showAssignee && !groupTask && assigneeName ? (
                <>
                  {' '}
                  · Assignees: <span className="text-gray-700">{assigneeName}</span>
                </>
              ) : null}
              {createdByName ? (
                <>
                  {' '}
                  · Assigned by: <span className="text-gray-700">{createdByName}</span>
                </>
              ) : null}
              {t.due_at && (
                <>
                  {' '}
                  · Due {formatLongWeekdayDateTime(t.due_at)}
                  {dueCountdown ? <> · {dueCountdown}</> : null}
                </>
              )}
            </p>
            <span
              className={`inline-block mt-2 ml-7 text-xs font-medium px-2 py-0.5 rounded-md ${statusPillClass(t.status)}`}
            >
              {t.status.replace('_', ' ')}
            </span>
          </div>
          {expanded &&
            (checklist.length === 0 ? (
              <p
                className={`text-sm text-gray-500 ml-5 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 px-3 py-2 ${
                  t.status === 'completed' ? 'opacity-60' : ''
                }`}
              >
                No checklist steps for this task.
              </p>
            ) : (
              <ul
                className={`rounded-lg border border-gray-100 bg-gray-50/80 p-3 space-y-2 ml-5 ${
                  t.status === 'completed' ? 'opacity-60 text-gray-500 pointer-events-none' : ''
                }`}
              >
                {checklist.map((item) => (
                  <li key={item.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={item.done}
                      disabled={!canToggleCheck}
                      onChange={(e) =>
                        void patchChecklistItem(t.id, item.id, e.target.checked, opts.reload, t)
                      }
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5 rounded border-gray-300"
                    />
                    <span className={item.done ? 'text-gray-500 line-through' : 'text-gray-800'}>
                      {item.label}
                    </span>
                  </li>
                ))}
              </ul>
            ))}
        </div>
        <div className={`flex flex-wrap gap-1.5 shrink-0 items-start justify-end ${actionOpacityClass}`}>
          {opts.includeManageButtons && (isCreator || (opts.reload === 'branch' && isElevatedTaskViewer)) && (
            <>
              <button
                type="button"
                title="Edit task"
                onClick={(e) => {
                  e.stopPropagation();
                  startEdit(t as BranchTaskRow);
                }}
                className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                type="button"
                title="Delete task"
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteBranchTask(t.id);
                }}
                className="p-2 rounded-lg text-red-600 border border-red-100 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full min-w-0 max-w-4xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
          <ListTodo className="w-7 h-7 text-blue-600" />
          Tasks
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {isElevatedTaskViewer
            ? 'As organization owner, you see all follow-up tasks across every branch. Filter by type, status, dates, and people.'
            : 'Your assignments and follow-ups for the selected branch (based on your permissions).'}
        </p>
      </div>

      {!permissionsResolved && user && (
        <p className="text-sm text-gray-500">Loading permissions…</p>
      )}

      {permissionsResolved && canBranch && (
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {isElevatedTaskViewer ? 'All organization tasks' : 'Follow-ups in this branch'}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {isElevatedTaskViewer
                  ? 'Every branch — filter by member vs group, status, dates, assignee, and creator.'
                  : `Filter by status, dates, assignee, and type${
                      canManageMember || canManageGroup ? '' : ' (read-only)'
                    }.`}
              </p>
            </div>
            <div
              className="relative flex w-full min-w-0 flex-col gap-2 sm:shrink-0 sm:ml-0 sm:w-auto sm:flex sm:flex-row sm:flex-wrap sm:items-center sm:gap-2"
              ref={createMenuRef}
            >
                <div className="relative flex min-h-11 w-full min-w-0 flex-1 items-center rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm sm:min-w-[16rem] md:min-w-[20rem]">
                  <motion.span
                    animate={branchSearchFocus ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                    transition={{ duration: 0.45, repeat: branchSearchFocus ? Infinity : 0, repeatDelay: 1.2 }}
                    className="text-gray-400 shrink-0 mr-2"
                  >
                    <Search className="w-4 h-4" aria-hidden />
                  </motion.span>
                  <input
                    type="search"
                    placeholder="Search tasks..."
                    value={branchSearch}
                    onChange={(e) => setBranchSearch(e.target.value)}
                    onFocus={() => setBranchSearchFocus(true)}
                    onBlur={() => setBranchSearchFocus(false)}
                    className="min-w-0 flex-1 text-base sm:text-sm bg-transparent border-0 outline-none placeholder:text-gray-400"
                    aria-label="Search tasks"
                  />
                </div>
              <button
                type="button"
                onClick={() => setBranchFiltersOpen((v) => !v)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-xl border transition-colors ${
                  branchFiltersOpen
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <SlidersHorizontal className="w-4 h-4" />
                Filters
              </button>
                {(canManageMember || canManageGroup) && (
                  <>
                    <button
                      type="button"
                      onClick={() => setCreateMenuOpen((o) => !o)}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700"
                      aria-expanded={createMenuOpen}
                      aria-haspopup="menu"
                    >
                      <Plus className="w-4 h-4" />
                      Create task
                      <ChevronDown className="w-4 h-4 opacity-90" aria-hidden />
                    </button>
                    {createMenuOpen ? (
                      <div
                        className="absolute right-0 top-full z-20 mt-1.5 min-w-[13rem] rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
                        role="menu"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          disabled={!canManageMember}
                          title={!canManageMember ? 'No permission to create member tasks' : undefined}
                          onClick={() => {
                            if (!canManageMember) return;
                            setCreateMemberOpen(true);
                            setCreateMenuOpen(false);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Users className="w-4 h-4 text-slate-500 shrink-0" aria-hidden />
                          Member task
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={!canManageGroup}
                          title={!canManageGroup ? 'No permission to create group tasks' : undefined}
                          onClick={() => {
                            if (!canManageGroup) return;
                            setCreateGroupOpen(true);
                            setCreateMenuOpen(false);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Building2 className="w-4 h-4 text-blue-600 shrink-0" aria-hidden />
                          Group task
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
          </div>

          {branchFiltersOpen && (
            <div className="relative z-10 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-blue-600" />
                  Filters
                </p>
                <button
                  type="button"
                  onClick={() => setBranchFiltersOpen(false)}
                  className="inline-flex items-center justify-center rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50"
                  aria-label="Close filters"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <div
                  className="inline-flex rounded-xl border border-gray-200 bg-white p-0.5 shadow-sm"
                  role="group"
                  aria-label="Task type"
                >
                  {(
                    [
                      { id: 'all' as const, label: 'All', Icon: LayoutGrid },
                      { id: 'member' as const, label: 'Member', Icon: Users },
                      { id: 'group' as const, label: 'Group', Icon: Building2 },
                    ] as const
                  ).map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setBranchTaskTypeFilter(id)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        branchTaskTypeFilter === id
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                      aria-pressed={branchTaskTypeFilter === id}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-3 items-end">
              <div>
                <span className="text-xs font-medium text-gray-500 flex items-center gap-1.5 mb-1.5">
                  <ListTodo className="w-3.5 h-3.5 text-gray-400" aria-hidden />
                  Status
                </span>
                <div className="flex rounded-xl border border-gray-200 p-0.5 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => setBranchStatus('open')}
                    className={
                      branchStatus === 'open'
                        ? 'px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-900'
                        : 'px-3 py-1.5 text-xs font-medium rounded-lg text-gray-600 hover:bg-gray-50'
                    }
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    onClick={() => setBranchStatus('all')}
                    className={
                      branchStatus === 'all'
                        ? 'px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-900'
                        : 'px-3 py-1.5 text-xs font-medium rounded-lg text-gray-600 hover:bg-gray-50'
                    }
                  >
                    All
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 flex items-center gap-1.5 mb-1.5">
                  <Calendar className="w-3.5 h-3.5 text-gray-400" aria-hidden />
                  Due month
                </label>
                <MonthPickerField
                  value={branchMonth}
                  onChange={setBranchMonth}
                  placeholder="Due month"
                  triggerClassName="h-auto min-h-0 rounded-xl border-gray-200 bg-white px-2.5 py-2 text-sm text-gray-900 shadow-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 flex items-center gap-1.5 mb-1.5">
                  <CalendarClock className="w-3.5 h-3.5 text-gray-400" aria-hidden />
                  Due from
                </label>
                <DateTimePickerField
                  value={branchDueFrom}
                  onChange={setBranchDueFrom}
                  datePlaceholder="From date"
                  timePlaceholder="From time"
                  splitClassName="rounded-xl border-gray-200 bg-white shadow-sm"
                  triggerClassName="min-h-0 px-2.5 py-2 text-sm text-gray-900"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 flex items-center gap-1.5 mb-1.5">
                  <CalendarClock className="w-3.5 h-3.5 text-gray-400" aria-hidden />
                  Due to
                </label>
                <DateTimePickerField
                  value={branchDueTo}
                  onChange={setBranchDueTo}
                  datePlaceholder="To date"
                  timePlaceholder="To time"
                  splitClassName="rounded-xl border-gray-200 bg-white shadow-sm"
                  triggerClassName="min-h-0 px-2.5 py-2 text-sm text-gray-900"
                />
              </div>
              <div className="min-w-[11rem] flex-1 sm:flex-initial">
                <label className="text-xs font-medium text-gray-500 flex items-center gap-1.5 mb-1.5">
                  <User className="w-3.5 h-3.5 text-gray-400" aria-hidden />
                  Assignee
                </label>
                <select
                  value={branchAssigneeId}
                  onChange={(e) => setBranchAssigneeId(e.target.value)}
                  className="w-full px-2.5 py-2 text-sm border border-gray-200 rounded-xl bg-white shadow-sm"
                >
                  <option value="">Anyone</option>
                  {staffOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {[s.first_name, s.last_name].filter(Boolean).join(' ') || s.email || s.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-[11rem] flex-1 sm:flex-initial">
                <label className="text-xs font-medium text-gray-500 flex items-center gap-1.5 mb-1.5">
                  <PenLine className="w-3.5 h-3.5 text-gray-400" aria-hidden />
                  Assigned by
                </label>
                <select
                  value={branchCreatedById}
                  onChange={(e) => setBranchCreatedById(e.target.value)}
                  className="w-full px-2.5 py-2 text-sm border border-gray-200 rounded-xl bg-white shadow-sm"
                >
                  <option value="">Anyone</option>
                  {staffOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {[s.first_name, s.last_name].filter(Boolean).join(' ') || s.email || s.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => void loadBranch()}
                title="Reload list"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl border border-gray-200 bg-white shadow-sm hover:bg-gray-50 text-gray-700"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden />
                Refresh
              </button>
              </div>
              <p className="text-[11px] text-gray-400">
                Month and due range narrow results together. Clear month to use only the date range.
              </p>
            </div>
          )}

          {branchFilterChips.length > 0 ? (
            <FilterResultChips chips={branchFilterChips} onClearAll={clearAllBranchFilters} />
          ) : null}

          {branchLoading ? (
            <TaskListSkeleton rows={6} />
          ) : branchLoadError ? (
            <p className="text-sm text-red-600">{branchLoadError}</p>
          ) : branchTasks.length === 0 ? (
            <p className="text-sm text-gray-400">No follow-up tasks in this view.</p>
          ) : branchFiltered.length === 0 ? (
            <p className="text-sm text-gray-400">No tasks match your search or filters.</p>
          ) : (
            <>
            <ul className="space-y-3 list-none p-0 m-0">
              {branchPaged.map((t) => {
                const isEditing = editingId === t.id;

                return (
                  <li key={t.id} className="space-y-3">
                    {isEditing && (isTaskCreatorRow(t, user?.id) || isElevatedTaskViewer) ? (
                      <div className="space-y-3 p-3 rounded-lg border border-blue-200 bg-blue-50/40">
                        <p className="text-xs font-semibold text-blue-900">Edit task</p>
                        <label className="text-xs text-gray-500 block -mb-2">Title</label>
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          placeholder="Task title"
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                        />
                        <label className="text-xs text-gray-500 block -mb-2">Description</label>
                        <textarea
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          rows={2}
                          placeholder="Task description"
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none"
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {!isGroupTask(t) ? (
                            <div className="sm:col-span-2">
                              <label className="text-xs text-gray-500 block mb-1">Assign to (leaders)</label>
                              <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100 bg-white">
                                {staffOptions.map((s) => (
                                  <label
                                    key={s.id}
                                    className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50 cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={editAssigneeIds.has(s.id)}
                                      onChange={(e) => {
                                        setEditAssigneeIds((prev) => {
                                          const next = new Set(prev);
                                          if (e.target.checked) next.add(s.id);
                                          else next.delete(s.id);
                                          return next;
                                        });
                                      }}
                                    />
                                    <span>
                                      {[s.first_name, s.last_name].filter(Boolean).join(' ') ||
                                        s.email ||
                                        s.id.slice(0, 8)}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          <div>
                            <label className="text-xs text-gray-500 block mb-1">Due</label>
                            <DateTimePickerField
                              value={editDue}
                              onChange={setEditDue}
                              datePlaceholder="Due date"
                              timePlaceholder="Due time"
                              splitClassName="rounded-lg border-gray-200 bg-white"
                              triggerClassName="text-sm text-gray-900"
                            />
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-gray-700 mb-1">To-do items</p>
                          <div className="space-y-2">
                            {editChecklistLines.map((line) => (
                              <div key={line.key} className="flex gap-2 items-center">
                                <input
                                  type="checkbox"
                                  checked={line.done}
                                  onChange={(e) =>
                                    setEditChecklistLines((prev) =>
                                      prev.map((x) => (x.key === line.key ? { ...x, done: e.target.checked } : x)),
                                    )
                                  }
                                  className="rounded border-gray-300"
                                />
                                <input
                                  type="text"
                                  value={line.label}
                                  onChange={(e) =>
                                    setEditChecklistLines((prev) =>
                                      prev.map((x) => (x.key === line.key ? { ...x, label: e.target.value } : x)),
                                    )
                                  }
                                  placeholder="To-do item"
                                  className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditChecklistLines((prev) => prev.filter((x) => x.key !== line.key))
                                  }
                                  className="p-1 text-gray-400 hover:text-red-600"
                                  title="Remove to-do item"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() =>
                                setEditChecklistLines((prev) => [
                                  ...prev,
                                  { key: `e-${Date.now()}-${prev.length}`, label: '', done: false },
                                ])
                              }
                              className="text-xs font-medium text-blue-600"
                            >
                              + Add to-do item
                            </button>
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-white"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={editSaving}
                            onClick={() => void saveEdit()}
                            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg disabled:opacity-50"
                          >
                            {editSaving ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      renderTaskCard(t, {
                        reload: 'branch',
                        showAssignee: true,
                        includeManageButtons: true,
                      })
                    )}
                  </li>
                );
              })}
            </ul>
            {branchHasMore ? (
              <div
                ref={branchSentinelRef}
                className="flex justify-center py-3 border-t border-dashed border-gray-200 bg-gray-50/50 rounded-b-xl"
                aria-hidden
              >
                <span className="text-xs text-gray-500">Scroll for more ({branchPaged.length} of {branchFiltered.length})</span>
              </div>
            ) : branchFiltered.length > TASK_LIST_PAGE_SIZE ? (
              <p className="text-[11px] text-gray-400 text-center pt-2">Showing all {branchFiltered.length} follow-ups</p>
            ) : null}
            </>
          )}
        </section>
      )}

      {permissionsResolved && canViewMine && !isElevatedTaskViewer && (
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <User className="w-5 h-5 text-blue-500" />
              Your open tasks
            </h2>
            <div className="relative shrink-0 flex items-center gap-2 flex-wrap justify-end" ref={createMenuRef}>
              {(canManageMember || canManageGroup) && (
                <>
                  <button
                    type="button"
                    onClick={() => setCreateMenuOpen((o) => !o)}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700"
                    aria-expanded={createMenuOpen}
                    aria-haspopup="menu"
                  >
                    <Plus className="w-4 h-4" />
                    Create task
                    <ChevronDown className="w-4 h-4 opacity-90" aria-hidden />
                  </button>
                  {createMenuOpen ? (
                    <div
                      className="absolute right-0 top-full z-20 mt-1.5 min-w-[13rem] rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
                      role="menu"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!canManageMember}
                        title={!canManageMember ? 'No permission to create member tasks' : undefined}
                        onClick={() => {
                          if (!canManageMember) return;
                          setCreateMemberOpen(true);
                          setCreateMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Users className="w-4 h-4 text-slate-500 shrink-0" aria-hidden />
                        Member task
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!canManageGroup}
                        title={!canManageGroup ? 'No permission to create group tasks' : undefined}
                        onClick={() => {
                          if (!canManageGroup) return;
                          setCreateGroupOpen(true);
                          setCreateMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Building2 className="w-4 h-4 text-blue-600 shrink-0" aria-hidden />
                        Group task
                      </button>
                    </div>
                  ) : null}
                </>
              )}
              <button
                type="button"
                onClick={() => setMineFiltersOpen((v) => !v)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-xl border transition-colors ${
                  mineFiltersOpen
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <SlidersHorizontal className="w-4 h-4" />
                Filters
              </button>
            </div>
          </div>
          {mineFiltersOpen && (
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <div
                  className="inline-flex rounded-xl border border-gray-200 bg-white p-0.5 shadow-sm"
                  role="group"
                  aria-label="Your task type"
                >
                  {(
                    [
                      { id: 'all' as const, label: 'All', Icon: LayoutGrid },
                      { id: 'member' as const, label: 'Member', Icon: Users },
                      { id: 'group' as const, label: 'Group', Icon: Building2 },
                    ] as const
                  ).map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setMineTaskTypeFilter(id)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        mineTaskTypeFilter === id
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                      aria-pressed={mineTaskTypeFilter === id}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
                      {label}
                    </button>
                  ))}
                </div>
                <div className="relative flex min-h-11 w-full min-w-0 max-w-md flex-1 items-center rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
                  <motion.span
                    animate={mineSearchFocus ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                    transition={{ duration: 0.45, repeat: mineSearchFocus ? Infinity : 0, repeatDelay: 1.2 }}
                    className="text-gray-400 shrink-0 mr-2"
                  >
                    <Search className="w-4 h-4" aria-hidden />
                  </motion.span>
                  <input
                    type="search"
                    placeholder="Search your tasks…"
                    value={mineSearch}
                    onChange={(e) => setMineSearch(e.target.value)}
                    onFocus={() => setMineSearchFocus(true)}
                    onBlur={() => setMineSearchFocus(false)}
                    className="min-w-0 flex-1 text-base sm:text-sm bg-transparent border-0 outline-none placeholder:text-gray-400"
                    aria-label="Search your tasks"
                  />
                </div>
              </div>
            </div>
          )}
          {mineFilterChips.length > 0 ? (
            <FilterResultChips chips={mineFilterChips} onClearAll={clearAllMineFilters} />
          ) : null}
          {mineLoading ? (
            <TaskListSkeleton rows={6} />
          ) : mineLoadError ? (
            <p className="text-sm text-red-600">{mineLoadError}</p>
          ) : mineTasks.length === 0 ? (
            <p className="text-sm text-gray-400">No tasks assigned to you or created by you right now.</p>
          ) : mineFiltered.length === 0 ? (
            <p className="text-sm text-gray-400">No tasks match your search or type filter.</p>
          ) : (
            <>
            <ul className="space-y-3 list-none p-0 m-0">
              {minePaged.map((t) => {
                const isEditingMine = editingId === t.id;
                return (
                  <li key={t.id} className="space-y-3">
                    {isEditingMine && isTaskCreatorRow(t, user?.id) ? (
                      <div className="space-y-3 p-3 rounded-lg border border-blue-200 bg-blue-50/40">
                        <p className="text-xs font-semibold text-blue-900">Edit task</p>
                        <label className="text-xs text-gray-500 block -mb-2">Title</label>
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          placeholder="Task title"
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                        />
                        <label className="text-xs text-gray-500 block -mb-2">Description</label>
                        <textarea
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          rows={2}
                          placeholder="Task description"
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none"
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {!isGroupTask(t) ? (
                            <div className="sm:col-span-2">
                              <label className="text-xs text-gray-500 block mb-1">Assign to (leaders)</label>
                              <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100 bg-white">
                                {staffOptions.map((s) => (
                                  <label
                                    key={s.id}
                                    className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50 cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={editAssigneeIds.has(s.id)}
                                      onChange={(e) => {
                                        setEditAssigneeIds((prev) => {
                                          const next = new Set(prev);
                                          if (e.target.checked) next.add(s.id);
                                          else next.delete(s.id);
                                          return next;
                                        });
                                      }}
                                    />
                                    <span>
                                      {[s.first_name, s.last_name].filter(Boolean).join(' ') ||
                                        s.email ||
                                        s.id.slice(0, 8)}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          <div>
                            <label className="text-xs text-gray-500 block mb-1">Due</label>
                            <DateTimePickerField
                              value={editDue}
                              onChange={setEditDue}
                              datePlaceholder="Due date"
                              timePlaceholder="Due time"
                              splitClassName="rounded-lg border-gray-200 bg-white"
                              triggerClassName="text-sm text-gray-900"
                            />
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-gray-700 mb-1">To-do items</p>
                          <div className="space-y-2">
                            {editChecklistLines.map((line) => (
                              <div key={line.key} className="flex gap-2 items-center">
                                <input
                                  type="checkbox"
                                  checked={line.done}
                                  onChange={(e) =>
                                    setEditChecklistLines((prev) =>
                                      prev.map((x) => (x.key === line.key ? { ...x, done: e.target.checked } : x)),
                                    )
                                  }
                                  className="rounded border-gray-300"
                                />
                                <input
                                  type="text"
                                  value={line.label}
                                  onChange={(e) =>
                                    setEditChecklistLines((prev) =>
                                      prev.map((x) => (x.key === line.key ? { ...x, label: e.target.value } : x)),
                                    )
                                  }
                                  placeholder="To-do item"
                                  className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditChecklistLines((prev) => prev.filter((x) => x.key !== line.key))
                                  }
                                  className="p-1 text-gray-400 hover:text-red-600"
                                  title="Remove to-do item"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() =>
                                setEditChecklistLines((prev) => [
                                  ...prev,
                                  { key: `e-${Date.now()}-${prev.length}`, label: '', done: false },
                                ])
                              }
                              className="text-xs font-medium text-blue-600"
                            >
                              + Add to-do item
                            </button>
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-white"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={editSaving}
                            onClick={() => void saveEdit()}
                            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg disabled:opacity-50"
                          >
                            {editSaving ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      renderTaskCard(t, {
                        reload: 'mine',
                        showAssignee: true,
                        includeManageButtons: true,
                      })
                    )}
                  </li>
                );
              })}
            </ul>
            {mineHasMore ? (
              <div
                ref={mineSentinelRef}
                className="flex justify-center py-3 border-t border-dashed border-gray-200 bg-gray-50/50 rounded-b-xl"
                aria-hidden
              >
                <span className="text-xs text-gray-500">Scroll for more ({minePaged.length} of {mineFiltered.length})</span>
              </div>
            ) : mineFiltered.length > TASK_LIST_PAGE_SIZE ? (
              <p className="text-[11px] text-gray-400 text-center pt-2">Showing all {mineFiltered.length} tasks</p>
            ) : null}
            </>
          )}
        </section>
      )}

      <AssignTaskModal
        isOpen={createMemberOpen}
        onClose={() => setCreateMemberOpen(false)}
        token={token}
        branchId={selectedBranch?.id}
        initialSelectedMemberIds={ASSIGN_TASK_NO_INITIAL_MEMBERS}
        allMembers={membersForModal}
        onSuccess={() => {
          void loadBranch();
          void loadMine();
        }}
      />
      <AssignGroupTaskModal
        isOpen={createGroupOpen}
        onClose={() => setCreateGroupOpen(false)}
        token={token}
        branchId={selectedBranch?.id}
        groupId={null}
        groupSelectionMode="free"
        onSuccess={() => {
          void loadBranch();
          void loadMine();
        }}
      />
    </div>
  );
}
