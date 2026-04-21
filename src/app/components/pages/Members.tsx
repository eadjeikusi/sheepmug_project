import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Plus, Search, MoreVertical, Edit2, Trash2, Download, Upload, Mic, Users as UsersIcon, Home, QrCode, Share2, ExternalLink, CheckSquare, Square, X, Clock, Check, Eye, XCircle, Copy, Loader2, RotateCcw, GitFork, ListTodo, Filter, UsersRound, CalendarDays } from 'lucide-react';
import { mockGroups } from '../../utils/mockData';
import { Member, Family } from '@/types';
import { familyApi, memberApi, memberFamiliesApi } from '../../utils/api';
import { motion, AnimatePresence } from 'motion/react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import MemberModal from '../modals/MemberModal';
import DeleteModal from '../modals/DeleteModal';
import AIVoiceNoteModal from '../modals/AIVoiceNoteModal';
import FamilyGroupModal from '../modals/FamilyGroupModal';
import FamilyGroupDetailModal from '../modals/FamilyGroupDetailModal';
import AssignMenuModal from '../modals/AssignMenuModal';
import AssignToFamilyModal from '../modals/AssignToFamilyModal';
import AssignMinistryModal from '../modals/AssignMinistryModal';
import MemberDetailPanel from '../panels/MemberDetailPanel';
import ExportModal from '../modals/ExportModal';
import MemberRegistrationFormModal from '../modals/MemberRegistrationFormModal';
import { toast } from 'sonner';
import AssignToGroupModal from '../modals/AssignToGroupModal';
import AssignTaskModal from '../modals/AssignTaskModal';
import MemberLinkModal from '../modals/MemberLinkModal';
import QRCodeLib from 'qrcode';
import { useBranch } from '../../contexts/BranchContext';
import { useAuth } from '../../contexts/AuthContext';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import { memberStatusBadgePair } from '../../utils/memberStatusBadge';
import { useMemberStatusOptions } from '../../hooks/useMemberStatusOptions';
import { usePermissions } from '@/hooks/usePermissions';
import { DatePickerField } from '@/components/datetime';
import { FilterResultChips, type FilterChipItem } from '../FilterResultChips';
import { formatLongWeekdayDate } from '@/utils/dateDisplayFormat';

function isMemberDbId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id).trim());
}

type ViewType = 'members' | 'families' | 'requests';

const STATUS_FILTER_NONE = '__none__';
const MEMBERS_PAGE_SIZE = 10;

type ImportIssue = {
  row: number;
  field: string;
  code: string;
  message: string;
  fix_hint: string;
};

type ImportPrecheckResponse = {
  preview_token: string;
  summary: {
    total_rows: number;
    valid_rows: number;
    duplicate_rows: number;
    invalid_rows: number;
  };
  duplicate_rows?: number[];
  issues: ImportIssue[];
  defaults?: {
    duplicate_action?: string;
  };
};

type ImportCommitResponse = {
  summary: {
    total_rows: number;
    created_rows: number;
    skipped_rows: number;
    failed_rows: number;
  };
  row_results: Array<{ row: number; status: 'created' | 'skipped' | 'failed'; message: string }>;
};

type ImportCommitStartResponse = {
  job_id: string;
  total_rows: number;
  started: boolean;
};

type ImportStatusResponse = {
  status: 'running' | 'done' | 'error';
  total_rows: number;
  processed_rows: number;
  created_rows: number;
  skipped_rows: number;
  failed_rows: number;
  error: string | null;
  row_results: Array<{ row: number; status: 'created' | 'skipped' | 'failed'; message: string }>;
};

type DuplicateAction = 'skip' | 'remove' | 'import';
type ImportCsvRow = Record<string, string>;

function parseCsvRows(csvText: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < csvText.length; i += 1) {
    const ch = csvText[i];
    if (ch === '"') {
      if (inQuotes && csvText[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch === ',') {
      row.push(cur);
      cur = '';
      continue;
    }
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && csvText[i + 1] === '\n') i += 1;
      row.push(cur);
      const hasAny = row.some((x) => String(x).trim().length > 0);
      if (hasAny) rows.push(row);
      row = [];
      cur = '';
      continue;
    }
    cur += ch;
  }
  row.push(cur);
  if (row.some((x) => String(x).trim().length > 0)) rows.push(row);
  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => String(h || '').trim());
  const dataRows = rows.slice(1);
  const ignoredColumns = new Set([
    'avatar_url',
    'profileimage',
    'memberimage_url',
    'member_url',
    'profile_image',
    'image',
    'image_url',
    'photo',
    'photo_url',
  ]);
  const out: Record<string, string>[] = [];
  for (const r of dataRows) {
    const item: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      const key = h.trim();
      const keyLower = key.toLowerCase();
      if (ignoredColumns.has(keyLower)) return;
      item[key] = String(r[idx] || '').trim();
    });
    if (Object.values(item).some((v) => String(v).trim().length > 0)) out.push(item);
  }
  return out;
}

function memberAgeFromDob(member: Member): number | null {
  const raw = (member.dob || (member as { dateOfBirth?: string | null }).dateOfBirth || '') as string;
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

export interface MemberRequest {
  id: string;
  // The form_data will contain original fields from MemberRegistration.tsx
  form_data: {
    firstName: string;
    lastName: string;
    email?: string;
    phoneNumber: string;
    location: string;
    emergencyContactName: string;
    emergencyContactPhone: string;
    dateOfBirth?: string;
    gender?: string;
    maritalStatus?: string;
    occupation?: string;
    dateJoined?: string;
    profileImage: string; // This will be the URL after upload
  };
  email: string;
  submittedDate: string;
  status: 'pending' | 'approved' | 'rejected';
  branch_id: string;
  organization_id: string;
}

// Mock pending member requests
const mockMemberRequests: MemberRequest[] = [
  {
    id: 'req1',
    fullName: 'David Johnson',
    email: 'david.johnson@email.com',
    phoneNumber: '+1 (555) 234-5678',
    location: 'Brooklyn, NY',
    emergencyContact: '+1 (555) 234-5679',
    submittedDate: '2024-03-02',
    status: 'pending',
    profileImage: '',
    notes: 'Interested in joining the youth ministry'
  },
  {
    id: 'req2',
    fullName: 'Emily Rodriguez',
    email: 'emily.rodriguez@email.com',
    phoneNumber: '+1 (555) 345-6789',
    location: 'Queens, NY',
    emergencyContact: '+1 (555) 345-6790',
    submittedDate: '2024-03-03',
    status: 'pending',
    profileImage: '',
    notes: 'Would like to volunteer in children\'s ministry'
  },
  {
    id: 'req3',
    fullName: 'Michael Chen',
    email: 'michael.chen@email.com',
    phoneNumber: '+1 (555) 456-7890',
    location: 'Manhattan, NY',
    emergencyContact: '+1 (555) 456-7891',
    submittedDate: '2024-03-04',
    status: 'pending',
    profileImage: '',
    notes: 'Moving to the area, looking for a church home'
  },
];

export default function Members() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedBranch, branches } = useBranch();
  const { user, token, loading: authLoading } = useAuth();
  const { can } = usePermissions();
  const { options: memberStatusPicklistForBadges } = useMemberStatusOptions(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMoreMembers, setLoadingMoreMembers] = useState(false);
  const [hasMoreMembers, setHasMoreMembers] = useState(true);
  const [familyGroups, setFamilyGroups] = useState<Family[]>([]);
  const [loadingFamilies, setLoadingFamilies] = useState(true);
  const [familyMembersCache, setFamilyMembersCache] = useState<Record<string, Member[]>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [memberStatusFilter, setMemberStatusFilter] = useState('');
  const [membersFilterPanelOpen, setMembersFilterPanelOpen] = useState(false);
  const [memberGroupFilterIds, setMemberGroupFilterIds] = useState<Set<string>>(new Set());
  const [memberAgeRangeFilter, setMemberAgeRangeFilter] = useState<'all' | 'u18' | '18_35' | '36_55' | '56p'>('all');
  const [memberPendingTaskOnly, setMemberPendingTaskOnly] = useState(false);
  const [viewType, setViewType] = useState<ViewType>(() => {
    const savedViewType = localStorage.getItem('viewType');
    const savedShowDeleted = localStorage.getItem('showDeletedMembers');
    if (savedViewType === 'members' && savedShowDeleted === 'true') {
      return 'members'; // If last view was deleted members, keep viewType as members
    }
    return savedViewType ? JSON.parse(savedViewType) : 'members';
  });
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isFamilyModalOpen, setIsFamilyModalOpen] = useState(false);
  const [viewingFamily, setViewingFamily] = useState<Family | undefined>();
  const [editingMember, setEditingMember] = useState<Member | undefined>();
  const [editingFamily, setEditingFamily] = useState<Family | undefined>();
  const [deletingMember, setDeletingMember] = useState<Member | undefined>();
  const [memberDeleteLoading, setMemberDeleteLoading] = useState(false);
  const [bulkPurgeLoading, setBulkPurgeLoading] = useState(false);
  const [deletingFamily, setDeletingFamily] = useState<Family | undefined>();
  const [memberToRemove, setMemberToRemove] = useState<{ member: Member, familyId: string } | undefined>();
  const [aiNoteMember, setAiNoteMember] = useState<Member | undefined>();
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [showRegistrationQR, setShowRegistrationQR] = useState(false);
  const [registrationQRCode, setRegistrationQRCode] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [selectedDeletedMembers, setSelectedDeletedMembers] = useState<Set<string>>(new Set());
  const [isAssignMenuModalOpen, setIsAssignMenuModalOpen] = useState(false);
  const [isAssignToFamilyModalOpen, setIsAssignToFamilyModalOpen] = useState(false);
  const [viewingMemberDetail, setViewingMemberDetail] = useState<Member | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [memberRequests, setMemberRequests] = useState<MemberRequest[]>([]); // Initialize empty, will fetch from API
  const [membersTotalCount, setMembersTotalCount] = useState<number | null>(null);
  const [deletedMembersTotalCount, setDeletedMembersTotalCount] = useState<number | null>(null);
  const [familiesTotalCount, setFamiliesTotalCount] = useState<number | null>(null);
  const [requestsTotalCount, setRequestsTotalCount] = useState<number | null>(null);
  const [memberPendingTaskIds, setMemberPendingTaskIds] = useState<Set<string>>(new Set());
  const [selectedRequests, setSelectedRequests] = useState<Set<string>>(new Set());
  const [reviewingRequest, setReviewingRequest] = useState<MemberRequest | null>(null);
  const [editingRequest, setEditingRequest] = useState<MemberRequest | null>(null);
  const [isMemberLinkModalOpen, setIsMemberLinkModalOpen] = useState(false);
  const [isRegistrationFormOpen, setIsRegistrationFormOpen] = useState(false);
  const [isAssignMinistryModalOpen, setIsAssignMinistryModalOpen] = useState(false);
  const [isAssignToGroupModalOpen, setIsAssignToGroupModalOpen] = useState(false);
  const [memberToAssign, setMemberToAssign] = useState<Member | null>(null);
  const [hoveredMemberId, setHoveredMemberId] = useState<string | null>(null);
  const [assignTaskModalOpen, setAssignTaskModalOpen] = useState(false);
  const [assignTaskInitialMemberIds, setAssignTaskInitialMemberIds] = useState<string[]>([]);
  const [assignTaskLockMemberSelection, setAssignTaskLockMemberSelection] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importCheckingOpen, setImportCheckingOpen] = useState(false);
  const [importSummaryOpen, setImportSummaryOpen] = useState(false);
  const [importPrecheck, setImportPrecheck] = useState<ImportPrecheckResponse | null>(null);
  const [importCommitting, setImportCommitting] = useState(false);
  const [importCommitResult, setImportCommitResult] = useState<ImportCommitResponse | null>(null);
  const [importHelpOpen, setImportHelpOpen] = useState(false);
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<{ processed: number; total: number }>({ processed: 0, total: 0 });
  const [duplicateAction, setDuplicateAction] = useState<DuplicateAction>('skip');
  const [importRows, setImportRows] = useState<ImportCsvRow[]>([]);
  const [showDuplicateEditor, setShowDuplicateEditor] = useState(false);
  const [duplicateDraftRows, setDuplicateDraftRows] = useState<ImportCsvRow[]>([]);
  const [duplicateRechecking, setDuplicateRechecking] = useState(false);
  const [familiesPickerOpen, setFamiliesPickerOpen] = useState(false);
  const membersSentinelRef = useRef<HTMLDivElement | null>(null);
  const membersLoadedCountRef = useRef(0);

  useEffect(() => {
    membersLoadedCountRef.current = members.length;
  }, [members.length]);

  const familyFilterId = useMemo(() => {
    const raw = searchParams.get('family');
    return raw && isMemberDbId(raw) ? raw : null;
  }, [searchParams]);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'requests') setViewType('requests');
  }, [searchParams]);

  const duplicateRowsList = useMemo(
    () => (Array.isArray(importPrecheck?.duplicate_rows) ? importPrecheck.duplicate_rows : []),
    [importPrecheck],
  );
  const effectiveImportCount = useMemo(() => {
    if (!importPrecheck) return 0;
    const baseTotal = importPrecheck.summary.total_rows;
    const invalid = importPrecheck.summary.invalid_rows;
    const dup = duplicateRowsList.length;
    if (duplicateAction === 'import') return Math.max(0, baseTotal - invalid);
    if (duplicateAction === 'remove') return Math.max(0, baseTotal - invalid - dup);
    return Math.max(0, baseTotal - invalid - dup);
  }, [importPrecheck, duplicateRowsList, duplicateAction]);

  const openAssignTaskModal = useCallback((selected: Member[]) => {
    const ids = selected.map((m) => m.id).filter((id) => isMemberDbId(id));
    if (ids.length === 0) {
      toast.error('This member record cannot be linked to tasks.');
      return;
    }
    setAssignTaskInitialMemberIds(ids);
    setAssignTaskLockMemberSelection(ids.length === 1);
    setAssignTaskModalOpen(true);
  }, []);

  useEffect(() => {
    localStorage.setItem('viewType', JSON.stringify(viewType));
  }, [viewType]);

  const fetchFamilyGroups = useCallback(async () => {
    if (!selectedBranch) return;
    setLoadingFamilies(true);
    try {
      const rows: any[] = [];
      let offset = 0;
      while (true) {
        const batch = await familyApi.getAll({
          branch_id: selectedBranch.id,
          offset,
          limit: 100,
        });
        const arr = Array.isArray(batch) ? batch : Array.isArray(batch?.families) ? batch.families : [];
        rows.push(...arr);
        if (arr.length < 100) break;
        offset += arr.length;
      }
      const data = rows;
      const mappedFamilies: Family[] = data.map((f: any) => ({
        id: f.id,
        familyName: f.family_name || 'Unnamed Family',
        headOfHousehold: f.head_of_household || '',
        memberIds: f.member_ids || [],
        address: f.address || '',
        phoneNumber: f.phone_number || '',
        churchId: f.branch_id,
        joinedDate: f.joined_date || '',
      }));
      setFamilyGroups(mappedFamilies);
      setFamilyMembersCache({});
    } catch (error) {
      toast.error('Failed to load family groups');
    } finally {
      setLoadingFamilies(false);
    }
  }, [selectedBranch]);

  useEffect(() => {
    if (!familyFilterId) return;
    if (loadingFamilies) return;
    if (familyGroups.some((f) => f.id === familyFilterId)) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('family');
      return next;
    });
  }, [familyFilterId, familyGroups, loadingFamilies, setSearchParams]);

  const [showDeletedMembers, setShowDeletedMembers] = useState(() => {
    const savedState = localStorage.getItem('showDeletedMembers');
    const initialState = savedState ? JSON.parse(savedState) : false;
    return initialState;
  });

  useEffect(() => {
    localStorage.setItem('showDeletedMembers', JSON.stringify(showDeletedMembers));
  }, [showDeletedMembers]);

  useEffect(() => {
    if (!can('view_deleted_members') && showDeletedMembers) {
      setShowDeletedMembers(false);
    }
  }, [can, showDeletedMembers]);

  useEffect(() => {
    if (!familyFilterId) return;
    setViewType('members');
    setShowDeletedMembers(false);
  }, [familyFilterId]);

  const fetchMembers = useCallback(async (reset = true) => {
    if (!token) {
      if (!authLoading) setIsLoading(false);
      return;
    }
    if (reset) {
      setIsLoading(true);
      setHasMoreMembers(true);
    } else {
      setLoadingMoreMembers(true);
    }
    try {
      const offset = reset ? 0 : membersLoadedCountRef.current;
      const url = new URL('/api/members', window.location.origin);
      url.searchParams.set('include_deleted', 'true');
      url.searchParams.set('offset', String(offset));
      url.searchParams.set('limit', String(MEMBERS_PAGE_SIZE));
      if (selectedBranch) {
        url.searchParams.append('branch_id', selectedBranch.id);
      }

      const response = await fetch(url.toString(), {
        headers: withBranchScope(selectedBranch?.id, {
          'Authorization': `Bearer ${token}`
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch members: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      const data = await response.json();
      const rows = Array.isArray(data)
        ? data
        : Array.isArray((data as { members?: unknown[] }).members)
          ? ((data as { members?: unknown[] }).members as unknown[])
          : [];
      // Map database fields to frontend Member type
      const mappedMembers: Member[] = rows.map((m: any) => ({
        ...m,
        fullName: `${m.first_name} ${m.last_name}`,
        phone: m.phone_number ?? m.phone ?? null,
        phoneNumber: m.phone_number || m.phone || '',
        phone_country_iso: m.phone_country_iso ?? null,
        location: m.address || '',
        emergencyContactName: m.emergency_contact_name || '',
        emergencyContactPhone: m.emergency_contact_phone || '',
        emergency_contact_phone_country_iso: m.emergency_contact_phone_country_iso ?? null,
        profileImage: m.avatar_url || m.memberimage_url || m.member_url || m.profile_image || '',
        memberUrl: m.member_url || '',
        churchId: m.branch_id,
        is_deleted: m.is_deleted || false,
        deleted_at: m.deleted_at || null,
      }));
      setMembers((prev) => {
        if (reset) return mappedMembers;
        const seen = new Set(prev.map((m) => m.id));
        const merged = [...prev];
        for (const item of mappedMembers) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          merged.push(item);
        }
        return merged;
      });
      setHasMoreMembers(mappedMembers.length === MEMBERS_PAGE_SIZE);
    } catch (error) {
      toast.error('Failed to load members');
    } finally {
      if (reset) {
        setIsLoading(false);
      } else {
        setLoadingMoreMembers(false);
      }
    }
  }, [token, selectedBranch, authLoading]);

  const handleAssignToGroupClick = useCallback((member: Member) => {
    setMemberToAssign(member);
    setIsAssignToGroupModalOpen(true);
  }, []);

  const handleAssignmentComplete = useCallback(() => {
    setIsAssignToGroupModalOpen(false);
    setMemberToAssign(null);
    fetchMembers(); // Re-fetch members to update their assigned groups
  }, [fetchMembers]);

  const fetchMemberRequests = useCallback(async () => {
    if (!token) {
      return;
    }
    if (!selectedBranch) {
      setMemberRequests([]);
      return;
    }

    try {
      const rows: any[] = [];
      let offset = 0;
      while (true) {
        const url = new URL('/api/member-requests', window.location.origin);
        url.searchParams.append('status', 'pending');
        url.searchParams.append('branch_id', selectedBranch.id);
        url.searchParams.append('offset', String(offset));
        url.searchParams.append('limit', '100');

        const response = await fetch(url.toString(), {
          headers: withBranchScope(selectedBranch?.id, {
            'Authorization': `Bearer ${token}`,
          }),
        });

        if (!response.ok) throw new Error('Failed to fetch member requests');
        const data = await response.json();
        const batch = Array.isArray(data) ? data : Array.isArray(data?.requests) ? data.requests : [];
        rows.push(...batch);
        if (batch.length < 100) break;
        offset += batch.length;
      }
      setMemberRequests(
        rows.map((req: any) => ({
          id: req.id,
          form_data: req.form_data ?? {},
          email: req.form_data?.email ?? '',
          submittedDate: req.created_at ?? req.submitted_at ?? '',
          status: req.status,
          branch_id: req.branch_id,
          organization_id: req.organization_id,
        }))
      );
      setRequestsTotalCount(rows.length);
    } catch (error) {
      toast.error('Failed to load member requests');
      setMemberRequests([]);
      setRequestsTotalCount(0);
    }
  }, [token, selectedBranch]);

  const fetchPendingTaskMembers = useCallback(async () => {
    if (!token || !selectedBranch) {
      setMemberPendingTaskIds(new Set());
      return;
    }
    try {
      const taskRows: unknown[] = [];
      let offset = 0;
      while (true) {
        const response = await fetch(`/api/tasks/mine?status=all&offset=${offset}&limit=100`, {
          headers: withBranchScope(selectedBranch?.id, {
            Authorization: `Bearer ${token}`,
          }),
        });
        if (!response.ok) {
          setMemberPendingTaskIds(new Set());
          return;
        }
        const raw = await response.json();
        const batch = Array.isArray(raw)
          ? raw
          : Array.isArray((raw as { tasks?: unknown[] })?.tasks)
            ? (raw as { tasks: unknown[] }).tasks
            : [];
        taskRows.push(...batch);
        if (batch.length < 100) break;
        offset += batch.length;
      }
      const ids = new Set<string>();
      for (const t of taskRows as Record<string, unknown>[]) {
        if (String(t.status || '').toLowerCase() !== 'pending') continue;
        if (String(t.task_type || '').toLowerCase() !== 'member') continue;
        if (typeof t.member_id === 'string' && t.member_id.trim()) {
          ids.add(t.member_id);
        }
      }
      setMemberPendingTaskIds(ids);
    } catch {
      setMemberPendingTaskIds(new Set());
    }
  }, [token, selectedBranch]);

  useEffect(() => {
    fetchFamilyGroups();

    if (selectedBranch && token) {
      fetchMemberRequests();
      fetchPendingTaskMembers();
    } else if (!selectedBranch) {
      setMemberRequests([]);
      setMemberPendingTaskIds(new Set());
    }

    if (viewType === 'members' && token && selectedBranch && !authLoading) {
      fetchMembers();
    }
  }, [fetchFamilyGroups, fetchMemberRequests, fetchPendingTaskMembers, fetchMembers, token, selectedBranch, authLoading, viewType]);

  useEffect(() => {
    if (!token || !selectedBranch) {
      setMembersTotalCount(null);
      setDeletedMembersTotalCount(null);
      setFamiliesTotalCount(null);
      setRequestsTotalCount(null);
      return;
    }
    let cancelled = false;
    const headers = withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` });

    const fetchAllMembersForTotals = async () => {
      const rows: any[] = [];
      let offset = 0;
      while (true) {
        const url = new URL('/api/members', window.location.origin);
        url.searchParams.set('include_deleted', 'true');
        url.searchParams.set('branch_id', selectedBranch.id);
        url.searchParams.set('offset', String(offset));
        url.searchParams.set('limit', '100');
        const response = await fetch(url.toString(), { headers });
        if (!response.ok) throw new Error('Failed to fetch member totals');
        const data = await response.json();
        const batch = Array.isArray(data)
          ? data
          : Array.isArray((data as { members?: unknown[] }).members)
            ? ((data as { members?: unknown[] }).members as unknown[])
            : [];
        rows.push(...batch);
        if (batch.length < 100) break;
        offset += batch.length;
      }
      return rows;
    };

    const fetchAllFamiliesForTotals = async () => {
      const rows: any[] = [];
      let offset = 0;
      while (true) {
        const batch = await familyApi.getAll({
          branch_id: selectedBranch.id,
          offset,
          limit: 100,
        });
        const arr = Array.isArray(batch) ? batch : Array.isArray(batch?.families) ? batch.families : [];
        rows.push(...arr);
        if (arr.length < 100) break;
        offset += arr.length;
      }
      return rows;
    };

    const fetchAllRequestsForTotals = async () => {
      const rows: any[] = [];
      let offset = 0;
      while (true) {
        const url = new URL('/api/member-requests', window.location.origin);
        url.searchParams.append('status', 'pending');
        url.searchParams.append('branch_id', selectedBranch.id);
        url.searchParams.append('offset', String(offset));
        url.searchParams.append('limit', '100');
        const response = await fetch(url.toString(), { headers });
        if (!response.ok) throw new Error('Failed to fetch request totals');
        const data = await response.json();
        const batch = Array.isArray(data) ? data : Array.isArray(data?.requests) ? data.requests : [];
        rows.push(...batch);
        if (batch.length < 100) break;
        offset += batch.length;
      }
      return rows;
    };

    void (async () => {
      try {
        const [memberRows, familyRows, requestRows] = await Promise.all([
          fetchAllMembersForTotals(),
          fetchAllFamiliesForTotals(),
          fetchAllRequestsForTotals(),
        ]);
        if (cancelled) return;
        const deletedCount = memberRows.filter((m) => Boolean((m as { is_deleted?: boolean }).is_deleted)).length;
        const activeCount = Math.max(0, memberRows.length - deletedCount);
        setMembersTotalCount(activeCount);
        setDeletedMembersTotalCount(deletedCount);
        setFamiliesTotalCount(familyRows.length);
        setRequestsTotalCount(requestRows.length);
      } catch {
        if (cancelled) return;
        setMembersTotalCount(null);
        setDeletedMembersTotalCount(null);
        setFamiliesTotalCount(null);
        setRequestsTotalCount(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, selectedBranch]);

  useEffect(() => {
    if (viewType !== 'members' || isLoading || loadingMoreMembers || !hasMoreMembers) return;
    const node = membersSentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          void fetchMembers(false);
        }
      },
      { rootMargin: '240px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [viewType, isLoading, loadingMoreMembers, hasMoreMembers, fetchMembers]);

  useEffect(() => {
    const routeState = (location.state ?? null) as { openMemberId?: string; openFamilyId?: string } | null;
    const targetId = routeState?.openMemberId;
    if (!targetId || members.length === 0) return;
    const match = members.find((m) => m.id === targetId);
    if (!match) return;

    if (viewType !== 'members') {
      setViewType('members');
    }
    setViewingMemberDetail(match);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, members, navigate, viewType]);

  useEffect(() => {
    const routeState = (location.state ?? null) as { openMemberId?: string; openFamilyId?: string } | null;
    const fid = routeState?.openFamilyId;
    if (!fid || !isMemberDbId(fid)) return;
    if (loadingFamilies) return;
    const match = familyGroups.find((f) => f.id === fid);
    if (!match) return;

    if (viewType !== 'families') {
      setViewType('families');
    }
    setViewingFamily(match);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, familyGroups, loadingFamilies, navigate, viewType]);

  const handleApproveRequest = useCallback(async (requestId: string) => {
    if (!token) {
      toast.error('Authentication session expired. Please log in again.');
      return;
    }
    try {
      const response = await fetch(`/api/member-requests/${requestId}/approve`, {
        method: 'POST',
        headers: withBranchScope(selectedBranch?.id, {
          'Authorization': `Bearer ${token}`,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to approve member request');
      }

      toast.success('Member request approved!');
      setReviewingRequest(null);
      setEditingRequest(null);
      fetchMemberRequests();
      fetchMembers();
    } catch (error: any) {
      toast.error(error.message || 'Failed to approve member request');
    }
  }, [token, fetchMemberRequests, fetchMembers]);

  const handleRejectRequest = useCallback(async (requestId: string) => {
    if (!token) {
      toast.error('Authentication session expired. Please log in again.');
      return;
    }
    try {
      const response = await fetch(`/api/member-requests/${requestId}/reject`, {
        method: 'POST',
        headers: withBranchScope(selectedBranch?.id, {
          'Authorization': `Bearer ${token}`,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to reject member request');
      }

      toast.success('Member request rejected!');
      setReviewingRequest(null);
      setEditingRequest(null);
      fetchMemberRequests();
    } catch (error: any) {
      toast.error(error.message || 'Failed to reject member request');
    }
  }, [token, fetchMemberRequests]);

  const handleBulkApproveRequests = useCallback(async () => {
    if (!token) {
      toast.error('Authentication session expired. Please log in again.');
      return;
    }
    const ids = Array.from(selectedRequests);
    if (ids.length === 0) return;
    const headers = withBranchScope(selectedBranch?.id, {
      Authorization: `Bearer ${token}`,
    });
    let ok = 0;
    let failed = 0;
    for (const requestId of ids) {
      try {
        const response = await fetch(`/api/member-requests/${requestId}/approve`, {
          method: 'POST',
          headers,
        });
        if (response.ok) ok += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    setSelectedRequests(new Set());
    await fetchMemberRequests();
    await fetchMembers();
    if (failed === 0) {
      toast.success(`${ok} request(s) approved.`);
    } else {
      toast.warning(`${ok} approved, ${failed} failed.`);
    }
  }, [token, selectedBranch, selectedRequests, fetchMemberRequests, fetchMembers]);

  const handleBulkRejectRequests = useCallback(async () => {
    if (!token) {
      toast.error('Authentication session expired. Please log in again.');
      return;
    }
    const ids = Array.from(selectedRequests);
    if (ids.length === 0) return;
    const headers = withBranchScope(selectedBranch?.id, {
      Authorization: `Bearer ${token}`,
    });
    let ok = 0;
    let failed = 0;
    for (const requestId of ids) {
      try {
        const response = await fetch(`/api/member-requests/${requestId}/reject`, {
          method: 'POST',
          headers,
        });
        if (response.ok) ok += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    setSelectedRequests(new Set());
    await fetchMemberRequests();
    if (failed === 0) {
      toast.success(`${ok} request(s) rejected.`);
    } else {
      toast.warning(`${ok} rejected, ${failed} failed.`);
    }
  }, [token, selectedBranch, selectedRequests, fetchMemberRequests]);

  const handleUpdateEditedRequest = useCallback(async () => {
    if (!token || !editingRequest) {
      toast.error('Authentication session expired or no request to edit.');
      return;
    }
    try {
      // Assuming there's an API endpoint to update member requests
      // This might be part of the approve/reject flow or a separate 'edit pending request' endpoint
      const response = await fetch(`/api/member-requests/${editingRequest.id}`, {
        method: 'PUT',
        headers: withBranchScope(selectedBranch?.id, {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        }),
        body: JSON.stringify({ form_data: editingRequest.form_data }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to update member request details');
      }

      const updated = await response.json();
      const mapped = {
        id: updated.id,
        form_data: updated.form_data ?? {},
        email: updated.form_data?.email ?? '',
        submittedDate: updated.created_at ?? '',
        status: updated.status,
        branch_id: updated.branch_id,
        organization_id: updated.organization_id,
      };
      toast.success('Member request details updated!');
      setMemberRequests((prev) => prev.map((r) => (r.id === mapped.id ? mapped : r)));
      setReviewingRequest(mapped);
      setEditingRequest(null);
      fetchMemberRequests();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update member request details');
    }
  }, [token, editingRequest, fetchMemberRequests]);

  const registrationCode = useMemo(() => {
    // Generate a simple code based on branch ID or a unique identifier
    // This should ideally come from the backend when a branch is created
    return selectedBranch ? selectedBranch.id : null;
  }, [selectedBranch]);

  const registrationLink = useMemo(
    () => (registrationCode ? `${window.location.origin}/register/member/${registrationCode}` : ''),
    [registrationCode]
  );

  useEffect(() => {
    setRegistrationQRCode('');
  }, [registrationLink]);

  // Generate QR code when panel is opened
  const handleShowRegistrationQR = async () => {
    if (!registrationQRCode && registrationLink) {
      const qrDataUrl = await QRCodeLib.toDataURL(registrationLink, { width: 300 });
      setRegistrationQRCode(qrDataUrl);
    }
    setShowRegistrationQR(!showRegistrationQR);
  };

  const downloadRegistrationQR = () => {
    if (!registrationQRCode) {
      toast.error('QR Code not generated yet.');
      return;
    }
    const link = document.createElement('a');
    link.href = registrationQRCode;
    link.download = 'member-registration-qr.png';
    link.click();
    toast.success('QR Code downloaded!');
  };

  const shareRegistrationLink = () => {
    if (!registrationLink) {
      toast.error('Select a branch to generate a registration link.');
      return;
    }
    navigator.clipboard.writeText(registrationLink);
    toast.success('Registration link copied to clipboard!');
  };

  const toggleMemberSelection = (memberId: string) => {
    const newSelection = new Set(selectedMembers);
    if (newSelection.has(memberId)) {
      newSelection.delete(memberId);
    } else {
      newSelection.add(memberId);
    }
    setSelectedMembers(newSelection);
  };

  const toggleRequestSelection = (requestId: string) => {
    const newSelection = new Set(selectedRequests);
    if (newSelection.has(requestId)) {
      newSelection.delete(requestId);
    } else {
      newSelection.add(requestId);
    }
    setSelectedRequests(newSelection);
  };

  const clearSelection = () => {
    setSelectedMembers(new Set());
    setSelectedRequests(new Set());
    setSelectedDeletedMembers(new Set());
  };

  const memberStatusFilterOptions = useMemo(() => {
    const pickSorted = [...memberStatusPicklistForBadges].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.label.localeCompare(b.label),
    );
    const labelsInOrder = pickSorted.map((o) => o.label).filter((l) => (l || '').trim().length > 0);
    const seen = new Set(labelsInOrder.map((l) => l.trim().toLowerCase()));
    const extras: string[] = [];
    for (const m of members) {
      const raw = (m.status || '').trim();
      if (!raw) continue;
      const key = raw.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        extras.push(raw);
      }
    }
    extras.sort((a, b) => a.localeCompare(b));
    return [...labelsInOrder, ...extras];
  }, [memberStatusPicklistForBadges, members]);

  const hasMembersWithoutStatus = useMemo(() => {
    return members.some((m) => {
      const matchBranch = !selectedBranch || m.churchId === selectedBranch.id;
      const matchDeleted = m.is_deleted === showDeletedMembers;
      return matchBranch && matchDeleted && !(m.status || '').trim();
    });
  }, [members, selectedBranch, showDeletedMembers]);

  // Filter members by selected branch first, then by search query
  const filteredMembers = useMemo(() => {
    if (isLoading || viewType !== 'members') {
      return [];
    }

    let currentMembers = members.filter(member => {
      const matchBranch = !selectedBranch || member.churchId === selectedBranch.id;
      return matchBranch;
    });

    currentMembers = currentMembers.filter(member => {
      const matchDeletedStatus = member.is_deleted === showDeletedMembers;
      return matchDeletedStatus;
    });

    if (memberStatusFilter === STATUS_FILTER_NONE) {
      currentMembers = currentMembers.filter((m) => !(m.status || '').trim());
    } else if (memberStatusFilter.trim()) {
      const target = memberStatusFilter.trim().toLowerCase();
      currentMembers = currentMembers.filter(
        (m) => (m.status || '').trim().toLowerCase() === target,
      );
    }

    if (familyFilterId) {
      currentMembers = currentMembers.filter((m) => (m.familyIds || []).includes(familyFilterId));
    }

    if (memberGroupFilterIds.size > 0) {
      currentMembers = currentMembers.filter((m) => {
        const groupIds = (m.groupIds || []).map((x) => String(x));
        return Array.from(memberGroupFilterIds).some((gid) => groupIds.includes(gid));
      });
    }

    if (memberAgeRangeFilter !== 'all') {
      currentMembers = currentMembers.filter((m) => {
        const age = memberAgeFromDob(m);
        if (age == null) return false;
        if (memberAgeRangeFilter === 'u18') return age < 18;
        if (memberAgeRangeFilter === '18_35') return age >= 18 && age <= 35;
        if (memberAgeRangeFilter === '36_55') return age >= 36 && age <= 55;
        return age >= 56;
      });
    }

    if (memberPendingTaskOnly) {
      currentMembers = currentMembers.filter((m) => memberPendingTaskIds.has(String(m.id)));
    }

    const searchStr = searchQuery.toLowerCase();
    return currentMembers.filter(member => {
      const matchSearch = (
        member.fullName?.toLowerCase().includes(searchStr) ||
        member.email?.toLowerCase().includes(searchStr) ||
        member.location?.toLowerCase().includes(searchStr) ||
        member.phone?.toLowerCase().includes(searchStr) ||
        member.phoneNumber?.toLowerCase().includes(searchStr) ||
        member.member_id_string?.toLowerCase().includes(searchStr)
      );
      return matchSearch;
    });
  }, [
    members,
    selectedBranch,
    searchQuery,
    isLoading,
    viewType,
    showDeletedMembers,
    memberStatusFilter,
    familyFilterId,
    memberGroupFilterIds,
    memberAgeRangeFilter,
    memberPendingTaskOnly,
    memberPendingTaskIds,
  ]);

  // Filter families by selected branch first, then by search query
  const filteredFamilies = useMemo(() => {
    return familyGroups
      .filter(family => !selectedBranch || family.churchId === selectedBranch.id)
      .filter(family =>
        family.familyName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        family.address?.toLowerCase().includes(searchQuery.toLowerCase())
      );
  }, [familyGroups, selectedBranch, searchQuery]);

  const filteredRequests = useMemo(() => {
    const searchStr = searchQuery.trim().toLowerCase();
    if (!searchStr) return memberRequests;
    return memberRequests.filter((request) => {
      const fd = request.form_data;
      if (!fd) return false;
      const haystack = [
        fd.firstName,
        fd.lastName,
        fd.email,
        fd.location,
        fd.phoneNumber,
      ]
        .map((v) => (v == null ? '' : String(v)).toLowerCase())
        .join(' ');
      return haystack.includes(searchStr);
    });
  }, [memberRequests, searchQuery]);

  const memberFilterChips = useMemo((): FilterChipItem[] => {
    if (viewType !== 'members') return [];
    const chips: FilterChipItem[] = [];
    const q = searchQuery.trim();
    if (q) {
      chips.push({
        id: 'search',
        label: `Search: "${q.length > 48 ? `${q.slice(0, 48)}…` : q}"`,
        onRemove: () => setSearchQuery(''),
      });
    }
    if (memberStatusFilter) {
      const label =
        memberStatusFilter === STATUS_FILTER_NONE
          ? 'Status: No status'
          : `Status: ${memberStatusFilter}`;
      chips.push({ id: 'status', label, onRemove: () => setMemberStatusFilter('') });
    }
    if (memberAgeRangeFilter !== 'all') {
      const map: Record<string, string> = {
        u18: 'Under 18',
        '18_35': '18–35',
        '36_55': '36–55',
        '56p': '56+',
      };
      chips.push({
        id: 'age',
        label: `Age: ${map[memberAgeRangeFilter] ?? memberAgeRangeFilter}`,
        onRemove: () => setMemberAgeRangeFilter('all'),
      });
    }
    for (const gid of memberGroupFilterIds) {
      const g = mockGroups.find((x) => String(x.id) === gid);
      chips.push({
        id: `group-${gid}`,
        label: `Group: ${g?.name ?? gid.slice(0, 8)}`,
        onRemove: () =>
          setMemberGroupFilterIds((prev) => {
            const next = new Set(prev);
            next.delete(gid);
            return next;
          }),
      });
    }
    if (memberPendingTaskOnly) {
      chips.push({
        id: 'pending',
        label: 'Pending task',
        onRemove: () => setMemberPendingTaskOnly(false),
      });
    }
    if (familyFilterId) {
      const famName = familyGroups.find((f) => f.id === familyFilterId)?.familyName || 'Family';
      chips.push({
        id: 'family',
        label: `Family: ${famName}`,
        onRemove: () => {
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete('family');
            return next;
          });
        },
      });
    }
    return chips;
  }, [
    viewType,
    searchQuery,
    memberStatusFilter,
    memberAgeRangeFilter,
    memberGroupFilterIds,
    memberPendingTaskOnly,
    familyFilterId,
    familyGroups,
    setSearchParams,
  ]);

  const clearAllMemberFilters = useCallback(() => {
    setSearchQuery('');
    setMemberStatusFilter('');
    setMemberAgeRangeFilter('all');
    setMemberGroupFilterIds(new Set());
    setMemberPendingTaskOnly(false);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('family');
      return next;
    });
  }, [setSearchParams]);

  const handleSaveMember = async (memberData: Partial<Member>) => {
    if (!token) {
      toast.error('Authentication session expired. Please log in again.');
      return;
    }

    const branchId = selectedBranch?.id || user?.branch_id || (branches.length > 0 ? branches[0].id : null);

    if (!branchId) {
      toast.error('Please select a branch first.');
      return;
    }
    
    try {
      const md = memberData as Member & Record<string, unknown>;
      const payload: Record<string, unknown> = {
        first_name: md.first_name ?? md.firstName,
        last_name: md.last_name ?? md.lastName,
        email: md.email,
        phone: md.phone ?? md.phoneNumber,
        phone_country_iso: md.phone_country_iso ?? undefined,
        address: md.address ?? md.location,
        emergency_contact_name: md.emergency_contact_name ?? md.emergencyContactName,
        emergency_contact_phone: md.emergency_contact_phone ?? md.emergencyContactPhone,
        emergency_contact_phone_country_iso: md.emergency_contact_phone_country_iso ?? undefined,
        member_url: md.member_url ?? md.profileImage,
        dob: md.dob ?? md.dateOfBirth,
        gender: md.gender,
        marital_status: md.marital_status ?? md.maritalStatus,
        occupation: md.occupation,
        date_joined: md.date_joined ?? md.dateJoined,
        member_id_string: md.member_id_string ?? md.memberIdString,
        status: typeof md.status === 'string' && md.status.trim() ? md.status.trim() : 'active',
        branch_id: branchId,
      };
      if (md.custom_fields !== undefined && md.custom_fields !== null) {
        const cf = md.custom_fields;
        if (typeof cf === 'object' && !Array.isArray(cf)) {
          payload.custom_fields = cf;
        }
      }

      const payloadStr = JSON.stringify(payload);

      const response = await fetch(editingMember ? `/api/members/${editingMember.id}` : '/api/members', {
        method: editingMember ? 'PUT' : 'POST',
        headers: withBranchScope(branchId, {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }),
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        if (response.status === 413) {
          toast.error('The image is too large. Please use a smaller image.');
          throw new Error('Image too large (413)');
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.message || 'Failed to save member');
      }

      toast.success(editingMember ? 'Member updated successfully!' : 'Member added successfully!');
      fetchMembers();
      setEditingMember(undefined);
      setIsAddModalOpen(false);
    } catch (error: any) {
      toast.error(error.message || 'Failed to save member');
    }
  };

  const handleDeleteMember = async () => {
    if (!deletingMember || !token) return;
    setMemberDeleteLoading(true);
    try {
      const response = await fetch(`/api/members/${deletingMember.id}`, {
        method: 'DELETE',
        headers: withBranchScope(selectedBranch?.id, {
          'Authorization': `Bearer ${token}`
        })
      });

      if (!response.ok) throw new Error('Failed to soft-delete member');

      const id = deletingMember.id;
      setMembers(prevMembers => prevMembers.map(m => 
        m.id === id ? { ...m, is_deleted: true, deleted_at: new Date().toISOString() } : m
      ));
      toast.success('Member soft-deleted successfully!');
    } catch (error) {
      toast.error('Failed to soft-delete member');
    } finally {
      setMemberDeleteLoading(false);
      setDeletingMember(undefined);
    }
  };

  const handleRestoreMember = async (memberIds: string[]) => {
    if (!token || memberIds.length === 0) return;

    try {
      // For bulk restore, iterate and send individual requests or create a new bulk API endpoint.
      // For now, sending individual requests as a simple approach.
      await Promise.all(memberIds.map(async (memberId) => {
        const response = await fetch(`/api/members/${memberId}/restore`, {
          method: 'POST',
          headers: withBranchScope(selectedBranch?.id, {
            'Authorization': `Bearer ${token}`
          })
        });

        if (!response.ok) throw new Error(`Failed to restore member ${memberId}`);
      }));

      setMembers(prevMembers => prevMembers.map(m => 
        memberIds.includes(m.id) ? { ...m, is_deleted: false, deleted_at: null } : m
      ));
      toast.success(`${memberIds.length} member(s) restored successfully!`);
    } catch (error) {
      toast.error('Failed to restore member(s)');
    }
  };

  const handleBulkPermanentPurge = useCallback(async () => {
    if (!token || !selectedBranch?.id) return;
    const ids = Array.from(selectedDeletedMembers).filter(isMemberDbId);
    if (ids.length === 0) {
      toast.error('Select at least one member to remove permanently.');
      return;
    }
    if (!window.confirm(`Permanently delete ${ids.length} member(s)? This cannot be undone.`)) return;
    setBulkPurgeLoading(true);
    try {
      const response = await fetch('/api/members/batch-purge', {
        method: 'POST',
        headers: withBranchScope(selectedBranch.id, {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        }),
        body: JSON.stringify({ ids }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((data as { error?: string }).error || 'Failed to permanently delete members');
      }
      const purged = (data as { purged?: number }).purged ?? 0;
      const errors = (data as { errors?: string[] }).errors || [];
      const removeSet = new Set(ids);
      setMembers((prev) => prev.filter((m) => !removeSet.has(m.id)));
      setSelectedDeletedMembers(new Set());
      setDeletedMembersTotalCount((c) => (typeof c === 'number' ? Math.max(0, c - purged) : c));
      if (errors.length > 0) {
        toast.warning(
          `${purged} removed. ${errors.length} failed: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? '…' : ''}`,
        );
      } else {
        toast.success(purged === 1 ? 'Member permanently removed.' : `${purged} members permanently removed.`);
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete members');
    } finally {
      setBulkPurgeLoading(false);
    }
  }, [token, selectedBranch?.id, selectedDeletedMembers]);

  const handleDeleteFamily = async () => {
    if (!deletingFamily || !token) return;
    try {
      const response = await fetch(`/api/families/${deletingFamily.id}`, {
        method: 'DELETE',
        headers: withBranchScope(selectedBranch?.id, { 'Authorization': `Bearer ${token}` })
      });
      if (!response.ok) throw new Error('Failed to delete family group');
      setFamilyGroups(familyGroups.filter(f => f.id !== deletingFamily.id));
      setViewingFamily(undefined);
      toast.success('Family group deleted successfully!');
    } catch (error) {
      toast.error('Failed to delete family group');
    } finally {
      setDeletingFamily(undefined);
    }
  };

  const handleSaveFamily = async (familyData: Partial<Family>) => {
    if (!token) {
      toast.error('You must be logged in to save family groups');
      return;
    }

    const branchId = selectedBranch?.id || user?.branch_id || (branches.length > 0 ? branches[0].id : null);

    if (!branchId) {
      toast.error('Please select a branch first.');
      return;
    }

    try {
      const url = editingFamily ? `/api/families/${editingFamily.id}` : '/api/families';
      const method = editingFamily ? 'PUT' : 'POST';
      
      const payload = {
        ...familyData,
        branch_id: branchId,
        churchId: branchId, // Keep for compatibility
      };

      const response = await fetch(url, {
        method,
        headers: withBranchScope(branchId, {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }),
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save family group');
      }

      const savedFamilyRaw = await response.json();
      const savedFamily: Family = {
        id: savedFamilyRaw.id,
        familyName: savedFamilyRaw.family_name || 'Unnamed Family',
        headOfHousehold: savedFamilyRaw.head_of_household || '',
        memberIds: savedFamilyRaw.member_ids || [],
        address: savedFamilyRaw.address || '',
        phoneNumber: savedFamilyRaw.phone_number || '',
        churchId: savedFamilyRaw.branch_id,
        joinedDate: savedFamilyRaw.joined_date || '',
      };
      
      if (editingFamily) {
        setFamilyGroups(familyGroups.map(f => f.id === savedFamily.id ? savedFamily : f));
        toast.success('Family group updated!');
      } else {
        setFamilyGroups([...familyGroups, savedFamily]);
        toast.success('Family group created!');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to save family group');
    } finally {
      setEditingFamily(undefined);
      setIsFamilyModalOpen(false);
    }
  };

  const handleExport = () => {
    toast.success(`Exporting ${viewType === 'members' ? 'members' : 'families'} to Excel...`);
  };

  const handleImport = () => {
    if (!can('import_members')) {
      toast.error('You do not have permission to import members.');
      return;
    }
    setImportHelpOpen(true);
  };

  const downloadImportTemplate = () => {
    const headers = [
      'first_name',
      'last_name',
      'phone',
      'phone_country_iso',
      'email',
      'dob',
      'gender',
      'marital_status',
      'occupation',
      'address',
      'emergency_contact_name',
      'emergency_contact_phone',
      'emergency_contact_phone_country_iso',
      'date_joined',
      'status',
    ];
    const sample = [
      'Kwame',
      'Mensah',
      '+233241234567',
      'GH',
      'kwame@example.com',
      '1990-06-20',
      'male',
      'single',
      'Teacher',
      'Accra',
      'Ama Mensah',
      '+233201112223',
      'GH',
      '2026-01-15',
      'active',
    ];
    const csv = `${headers.join(',')}\n${sample.join(',')}\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'members_import_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportFilePicked = async (file: File | null) => {
    if (!file) return;
    if (!token) {
      toast.error('Sign in required');
      return;
    }
    if (!selectedBranch?.id) {
      toast.error('Select a branch before importing.');
      return;
    }
    if (!/\.csv$/i.test(file.name)) {
      toast.error('Please upload a CSV file.');
      return;
    }
    try {
      setImportCheckingOpen(true);
      setImportSummaryOpen(false);
      setImportCommitResult(null);
      setImportPrecheck(null);

      const text = await file.text();
      const rows = parseCsvRows(text);
      if (rows.length === 0) {
        setImportCheckingOpen(false);
        toast.error('No data rows found in CSV.');
        return;
      }
      setImportRows(rows);
      setDuplicateDraftRows([]);
      setShowDuplicateEditor(false);
      const res = await fetch('/api/members/import/precheck', {
        method: 'POST',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ rows }),
      });
      const raw = (await res.json().catch(() => ({}))) as ImportPrecheckResponse & { error?: string };
      if (!res.ok) throw new Error(raw.error || 'Import precheck failed');
      setImportPrecheck(raw);
      setDuplicateAction('skip');
      setImportSummaryOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import precheck failed');
    } finally {
      setImportCheckingOpen(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const openDuplicateEditor = useCallback(() => {
    if (!importPrecheck || !importRows.length) return;
    const dupRows = new Set(Array.isArray(importPrecheck.duplicate_rows) ? importPrecheck.duplicate_rows : []);
    const draft = importRows.map((row) => ({ ...row }));
    if (dupRows.size > 0) {
      for (const rowNum of dupRows) {
        const idx = rowNum - 2;
        if (idx < 0 || idx >= draft.length) continue;
        draft[idx].first_name = String(draft[idx].first_name || '').trim();
        draft[idx].last_name = String(draft[idx].last_name || '').trim();
        draft[idx].dob = String(draft[idx].dob || '').trim();
      }
    }
    setDuplicateDraftRows(draft);
    setShowDuplicateEditor(true);
  }, [importPrecheck, importRows]);

  const updateDuplicateDraftCell = useCallback((rowNum: number, key: string, value: string) => {
    setDuplicateDraftRows((prev) => {
      if (!Array.isArray(prev) || prev.length === 0) return prev;
      const idx = rowNum - 2;
      if (idx < 0 || idx >= prev.length) return prev;
      const next = prev.map((r) => ({ ...r }));
      next[idx][key] = value;
      return next;
    });
  }, []);

  const recheckCorrectedRows = useCallback(async () => {
    if (!token || !selectedBranch?.id || duplicateDraftRows.length === 0) return;
    try {
      setDuplicateRechecking(true);
      const res = await fetch('/api/members/import/precheck', {
        method: 'POST',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ rows: duplicateDraftRows }),
      });
      const raw = (await res.json().catch(() => ({}))) as ImportPrecheckResponse & { error?: string };
      if (!res.ok) throw new Error(raw.error || 'Re-check failed');
      setImportRows(duplicateDraftRows.map((r) => ({ ...r })));
      setImportPrecheck(raw);
      setDuplicateAction('skip');
      setShowDuplicateEditor(false);
      toast.success('Duplicate check updated with your corrections.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to re-check corrected rows');
    } finally {
      setDuplicateRechecking(false);
    }
  }, [token, selectedBranch?.id, duplicateDraftRows]);

  const handleConfirmImportCommit = async () => {
    if (!importPrecheck?.preview_token || !token || !selectedBranch?.id) return;
    setImportCommitting(true);
    try {
      const duplicateRows = Array.isArray(importPrecheck.duplicate_rows) ? importPrecheck.duplicate_rows : [];
      const rowsRemoved = duplicateAction === 'remove' ? duplicateRows.length : 0;
      const totalAfterRemoval = Math.max(0, importPrecheck.summary.total_rows - rowsRemoved);
      const res = await fetch('/api/members/import/commit', {
        method: 'POST',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          preview_token: importPrecheck.preview_token,
          duplicate_action: duplicateAction === 'import' ? 'import' : 'skip',
          remove_duplicate_rows: duplicateAction === 'remove' ? duplicateRows : [],
        }),
      });
      const raw = (await res.json().catch(() => ({}))) as ImportCommitStartResponse & { error?: string };
      if (!res.ok) throw new Error(raw.error || 'Import commit failed');
      setImportJobId(raw.job_id);
      setImportProgress({ processed: 0, total: Number(raw.total_rows || totalAfterRemoval || 0) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
      setImportCommitting(false);
      setImportJobId(null);
    }
  };

  useEffect(() => {
    if (!importCommitting || !importJobId || !token || !selectedBranch?.id) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/members/import/status/${importJobId}`, {
          headers: withBranchScope(selectedBranch?.id, {
            Authorization: `Bearer ${token}`,
          }),
        });
        const raw = (await res.json().catch(() => ({}))) as ImportStatusResponse & { error?: string };
        if (!res.ok) throw new Error(raw.error || 'Failed to read import progress');
        if (cancelled) return;
        const total = Number(raw.total_rows || 0);
        const processed = Number(raw.processed_rows || 0);
        setImportProgress({ processed, total });
        if (raw.status === 'done') {
          const doneResult: ImportCommitResponse = {
            summary: {
              total_rows: total,
              created_rows: Number(raw.created_rows || 0),
              skipped_rows: Number(raw.skipped_rows || 0),
              failed_rows: Number(raw.failed_rows || 0),
            },
            row_results: Array.isArray(raw.row_results) ? raw.row_results : [],
          };
          setImportCommitResult(doneResult);
          setImportCommitting(false);
          setImportJobId(null);
          toast.success(`Import complete. Created ${doneResult.summary.created_rows} member(s).`);
          void fetchMembers();
          return;
        }
        if (raw.status === 'error') {
          throw new Error(raw.error || 'Import failed');
        }
      } catch (e) {
        if (cancelled) return;
        toast.error(e instanceof Error ? e.message : 'Import failed');
        setImportCommitting(false);
        setImportJobId(null);
      }
    };
    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, 700);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [importCommitting, importJobId, token, selectedBranch?.id, fetchMembers]);

  const fetchFamilyMembers = useCallback(async (familyId: string) => {
    try {
      const raw: any[] = await memberFamiliesApi.getByFamily(familyId);
      const mapped: Member[] = raw.map((m: any) => ({
        ...m,
        fullName: `${m.first_name || ''} ${m.last_name || ''}`.trim(),
        phone: m.phone_number ?? m.phone ?? null,
        phoneNumber: m.phone_number || m.phone || '',
        profileImage: m.avatar_url || m.memberimage_url || m.member_url || m.profile_image || '',
        location: m.address || '',
        is_deleted: m.is_deleted || false,
      }));
      setFamilyMembersCache((prev) => ({ ...prev, [familyId]: mapped }));
      return mapped;
    } catch {
      return [];
    }
  }, []);

  const getFamilyMembers = useCallback((familyId: string): Member[] => {
    return familyMembersCache[familyId] ?? [];
  }, [familyMembersCache]);

  useEffect(() => {
    if (familyGroups.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const fam of familyGroups) {
        if (cancelled) break;
        if (!familyMembersCache[fam.id]) {
          await fetchFamilyMembers(fam.id);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [familyGroups, fetchFamilyMembers, familyMembersCache]);

  const getHeadOfHousehold = (memberId: string) => {
    return members.find(m => m.id === memberId);
  };

  const handleAssignMinistry = async (ministryIds: string[]) => {
    const selectedMemberIds = Array.from(selectedMembers);
    try {
      await Promise.all(selectedMemberIds.map(async (memberId) => {
        const member = members.find(m => m.id === memberId);
        if (member) {
          const currentGroupIds = member.groupIds || [];
          const updatedGroupIds = Array.from(new Set([...currentGroupIds, ...ministryIds]));
          await memberApi.update(memberId, { groupIds: updatedGroupIds });
        }
      }));
      setMembers(members.map(m => {
        if (selectedMemberIds.includes(m.id)) {
          const currentGroupIds = m.groupIds || [];
          const updatedGroupIds = Array.from(new Set([...currentGroupIds, ...ministryIds]));
          return { ...m, groupIds: updatedGroupIds };
        }
        return m;
      }));
      toast.success(`${selectedMemberIds.length} member(s) assigned to ${ministryIds.length} ministry/ministries successfully!`);
      setSelectedMembers(new Set());
      setIsAssignMinistryModalOpen(false);
    } catch (error: any) {
      toast.error('Failed to assign members');
    }
  };

  const handleAssignFamilyGroup = async (familyIds: string[]) => {
    toast.info('Assigning members to family groups...');
    const selectedMemberIds = Array.from(selectedMembers);
    try {
      await Promise.all(
        selectedMemberIds.flatMap(memberId =>
          familyIds.map(familyId => memberFamiliesApi.assign(memberId, familyId))
        )
      );
      setMembers(members.map(m => {
        if (selectedMemberIds.includes(m.id)) {
          const newFamilyIds = [...new Set([...(m.familyIds || []), ...familyIds])];
          return { ...m, familyIds: newFamilyIds };
        }
        return m;
      }));
      for (const fid of familyIds) void fetchFamilyMembers(fid);
      toast.success(`${selectedMemberIds.length} member(s) assigned to ${familyIds.length} family group(s) successfully!`);
      setSelectedMembers(new Set());
      setIsAssignToFamilyModalOpen(false);
      // Redirect to member list page
      setViewType('members');
    } catch (error: any) {
      toast.error('Failed to assign members to family groups.');
    }
  };

  const handleUpdateFamilyName = async (id: string, name: string) => {
    try {
      await familyApi.update(id, { family_name: name });
      const updatedFamilyGroups = familyGroups.map(f => f.id === id ? { ...f, familyName: name } : f);
      setFamilyGroups(updatedFamilyGroups);
      if (viewingFamily && viewingFamily.id === id) {
        const updatedFamily = updatedFamilyGroups.find(f => f.id === id);
        setViewingFamily(updatedFamily);
      }
      toast.success('Family name updated!');
    } catch (error: any) {
      toast.error('Failed to update family name');
    }
  };

  const handleRemoveMemberFromFamily = async () => {
    if (!memberToRemove) return;
    try {
      await memberFamiliesApi.remove(memberToRemove.member.id, memberToRemove.familyId);
      setMembers(prev => prev.map(m => m.id === memberToRemove.member.id ? {
        ...m,
        familyIds: (m.familyIds || []).filter(id => id !== memberToRemove.familyId)
      } : m));
      void fetchFamilyMembers(memberToRemove.familyId);
      setMemberToRemove(undefined);
      toast.success('Member removed!');
    } catch (error: any) {
      toast.error('Failed to remove member');
    }
  };

  const handleDeleteFamilyFromModal = (family: Family) => {
    setDeletingFamily(family);
  };
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <input
        ref={importInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => void handleImportFilePicked(e.target.files?.[0] ?? null)}
      />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-gray-900 text-[20px]">Members & Families</h1>
          <p className="mt-2 text-gray-500 text-[12px]">Manage your church members and family groups</p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setFamiliesPickerOpen(true)}
            title="Families — browse by household"
            aria-label="Open families list"
            className="inline-flex items-center justify-center w-9 h-9 text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-all shadow-sm"
          >
            <UsersRound className="w-4 h-4" />
          </button>
          {viewType === 'members' && (
            <button
              onClick={async () => {
                if (!registrationLink) {
                  toast.error('Select a branch to generate a registration link.');
                  return;
                }
                if (!registrationQRCode) {
                  const qrDataUrl = await QRCodeLib.toDataURL(registrationLink, { width: 400 });
                  setRegistrationQRCode(qrDataUrl);
                }
                setIsMemberLinkModalOpen(true);
              }}
              title="Member Link"
              aria-label="Member Link"
              className="inline-flex items-center justify-center w-9 h-9 text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-all shadow-sm"
            >
              <QrCode className="w-4 h-4" />
            </button>
          )}
          {can('import_members') && (
            <button
              onClick={handleImport}
              title="Import"
              aria-label="Import"
              className="inline-flex items-center justify-center w-9 h-9 text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-50 transition-all shadow-sm"
            >
              <Upload className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setIsExportModalOpen(true)}
            title="Export"
            aria-label="Export"
            className="inline-flex items-center justify-center w-9 h-9 text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-50 transition-all shadow-sm"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={() => navigate('/important-dates')}
            title="All Important Dates"
            aria-label="All Important Dates"
            className="inline-flex items-center justify-center w-9 h-9 text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-50 transition-all shadow-sm"
          >
            <CalendarDays className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              viewType === 'members' ? setIsAddModalOpen(true) : setIsFamilyModalOpen(true);
            }}
            title={viewType === 'members' ? 'Add Member' : 'Add Family'}
            aria-label={viewType === 'members' ? 'Add Member' : 'Add Family'}
            className="inline-flex items-center justify-center w-9 h-9 text-white bg-blue-700 rounded-md hover:bg-blue-800 transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* View Toggle and Search */}
      <div className="flex items-center justify-between gap-4 mt-6 mb-6">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => {
              setViewType('members');
              setShowDeletedMembers(false);
            }}
            className={`flex items-center px-6 py-3 rounded-xl font-medium transition-all ${ viewType === 'members' && !showDeletedMembers ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50' } text-[14px]`}
          >
            <UsersIcon className="w-4 h-4 mr-2" />
            Members
            <span className={`ml-2 px-2.5 py-0.5 rounded-lg text-xs font-semibold ${
              viewType === 'members' && !showDeletedMembers
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-600'
            }`}>
              {membersTotalCount ?? members.filter(m => !m.is_deleted).length}
            </span>
          </button>
          <button
            onClick={() => setViewType('families')}
            className={`flex items-center px-6 py-3 rounded-xl font-medium transition-all ${ viewType === 'families' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50' } text-[14px]`}
          >
            <Home className="w-4 h-4 mr-2" />
            Family Groups
            <span className={`ml-2 px-2.5 py-0.5 rounded-lg text-xs font-semibold ${
              viewType === 'families'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-600'
            }`}>
              {familiesTotalCount ?? filteredFamilies.length}
            </span>
          </button>
          <button
            onClick={() => setViewType('requests')}
            className={`flex items-center px-6 py-3 rounded-xl font-medium transition-all ${ viewType === 'requests' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50' } text-[14px]`}
          >
            <Clock className="w-4 h-4 mr-2" />
            Requests
            <span className={`ml-2 px-2.5 py-0.5 rounded-lg text-xs font-semibold ${
              viewType === 'requests'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-600'
            }`}>
              {requestsTotalCount ?? memberRequests.length}
            </span>
          </button>
          {can('view_deleted_members') ? (
          <button
            onClick={() => {
              setViewType('members'); // Keep viewType as 'members' for consistent rendering of the table structure
              setShowDeletedMembers(true);
            }}
            className={`flex items-center px-6 py-3 rounded-xl font-medium transition-all ${ showDeletedMembers && viewType === 'members' ? 'bg-red-600 text-white shadow-sm' : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50' } text-[14px]`}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Deleted ({deletedMembersTotalCount ?? members.filter(m => m.is_deleted).length})
          </button>
          ) : null}
        </div>

        <div className="flex items-center gap-3 min-w-0 flex-1 justify-end">
          {viewType === 'members' && (
            <button
              type="button"
              onClick={() => setMembersFilterPanelOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-3 bg-white border border-gray-200 rounded-xl text-[14px] text-gray-900 hover:bg-gray-50 shadow-sm"
            >
              <Filter className="w-4 h-4 text-gray-500" />
              Filters
            </button>
          )}
          <div className="relative max-w-md w-full sm:w-auto sm:min-w-[200px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                viewType === 'members'
                  ? 'Search members...'
                  : viewType === 'requests'
                    ? 'Search requests...'
                    : 'Search families...'
              }
              className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
            />
          </div>
        </div>
      </div>

      {viewType === 'members' && memberFilterChips.length > 0 ? (
        <FilterResultChips chips={memberFilterChips} onClearAll={clearAllMemberFilters} className="mt-2" />
      ) : null}

      {/* Members View - Table Format */}
      {viewType === 'members' && (
        <div className="space-y-6">
          {/* Bulk Actions Header for Members */}
          <AnimatePresence>
            {selectedMembers.size > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="bg-blue-50 border border-blue-200 rounded-2xl p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-blue-600 text-white rounded-xl flex items-center justify-center font-semibold">
                      {selectedMembers.size}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">
                        {selectedMembers.size} {selectedMembers.size === 1 ? 'Member' : 'Members'} Selected
                      </p>
                      <p className="text-sm text-gray-600">Choose an action below</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={() => {
                        setIsAssignToGroupModalOpen(true);
                      }}
                      className="flex items-center px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-sm font-medium"
                    >
                      <GitFork className="w-4 h-4 mr-2" />
                      Assign to Group
                    </button>
                    <button
                      onClick={() => setIsAssignToFamilyModalOpen(true)}
                      className="flex items-center px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-sm font-medium"
                    >
                      <Home className="w-4 h-4 mr-2" />
                      Assign to Family
                    </button>
                    {can('manage_member_tasks') && (
                      <button
                        type="button"
                        onClick={() => {
                          const ordered = filteredMembers.filter((m) => selectedMembers.has(m.id) && isMemberDbId(m.id));
                          if (ordered.length === 0) {
                            toast.error('Select at least one member with a valid profile.');
                            return;
                          }
                          openAssignTaskModal(ordered);
                        }}
                        className="flex items-center px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-sm font-medium"
                      >
                        <ListTodo className="w-4 h-4 mr-2" />
                        Assign task
                      </button>
                    )}
                    <button
                      onClick={clearSelection}
                      className="p-2.5 text-gray-600 hover:text-gray-800 hover:bg-white rounded-xl transition-all"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {viewType === 'members' && showDeletedMembers && selectedDeletedMembers.size > 0 && can('delete_members') && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="bg-red-50 border border-red-200 rounded-2xl p-4"
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center space-x-4 min-w-0">
                    <div className="w-10 h-10 bg-red-600 text-white rounded-xl flex items-center justify-center font-semibold shrink-0">
                      {selectedDeletedMembers.size}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">
                        {selectedDeletedMembers.size}{' '}
                        {selectedDeletedMembers.size === 1 ? 'member' : 'members'} selected
                      </p>
                      <p className="text-sm text-gray-600">Remove from trash permanently</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <button
                      type="button"
                      disabled={bulkPurgeLoading}
                      onClick={() => void handleBulkPermanentPurge()}
                      className="flex items-center px-4 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-all shadow-sm font-medium disabled:opacity-60 disabled:pointer-events-none"
                    >
                      {bulkPurgeLoading ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin shrink-0" />
                      ) : (
                        <Trash2 className="w-4 h-4 mr-2 shrink-0" />
                      )}
                      {bulkPurgeLoading ? 'Deleting…' : 'Delete permanently'}
                    </button>
                    <button
                      type="button"
                      disabled={bulkPurgeLoading}
                      onClick={() => setSelectedDeletedMembers(new Set())}
                      className="p-2.5 text-gray-600 hover:text-gray-800 hover:bg-white rounded-xl transition-all disabled:opacity-50"
                      aria-label="Clear selection"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-6 py-4 w-16">
                    {viewType === 'members' && showDeletedMembers && filteredMembers.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (selectedDeletedMembers.size === filteredMembers.length) {
                            setSelectedDeletedMembers(new Set());
                          } else {
                            setSelectedDeletedMembers(new Set(filteredMembers.map(m => m.id)));
                          }
                        }}
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                          selectedDeletedMembers.size === filteredMembers.length && filteredMembers.length > 0
                            ? 'bg-red-600 border-red-600 text-white'
                            : 'bg-white border-gray-300 hover:border-red-400'
                        }`}
                      >
                        {selectedDeletedMembers.size === filteredMembers.length && filteredMembers.length > 0 && (
                          <CheckSquare className="w-3 h-3" />
                        )}
                      </button>
                    )}
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-500 px-6 py-4">Member</th>
                  <th className="text-left text-xs font-semibold text-gray-500 px-6 py-4">Phone</th>
                  <th className="text-left text-xs font-semibold text-gray-500 px-6 py-4">Email</th>
                  <th className="text-left text-xs font-semibold text-gray-500 px-6 py-4">Address</th>
                  {!showDeletedMembers && (
                    <th className="text-left text-xs font-semibold text-gray-500 px-6 py-4">Joined Date</th>
                  )}
                  {!showDeletedMembers && (
                    <th className="text-left text-xs font-semibold text-gray-500 px-6 py-4">Status</th>
                  )}
                  {!showDeletedMembers && (
                    <th className="text-center text-xs font-semibold text-gray-500 px-6 py-4 w-20">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center justify-center">
                        <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-2" />
                        <p className="text-gray-500 text-sm">Loading members...</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <AnimatePresence>
                    {filteredMembers.map((member, index) => (
                      <motion.tr
                        key={member.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ delay: index * 0.02 }}
                        onMouseEnter={() => setHoveredMemberId(member.id)}
                        onMouseLeave={() => setHoveredMemberId(null)}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('button')) return;
                          setViewingMemberDetail(member);
                        }}
                        className={`border-b border-gray-100 hover:bg-gray-50 transition-all cursor-pointer ${
                          (selectedMembers.has(member.id) && !showDeletedMembers) || (selectedDeletedMembers.has(member.id) && showDeletedMembers) ? 'bg-blue-50' : ''
                        } ${member.familyIds && member.familyIds.length > 0 ? 'opacity-50' : ''}`}
                      >
                        {/* Cell 1: Member (Flex Container with Image + Name) */}
                        <td className="px-6 py-4">
                          <div className="flex items-center space-x-3">
                            {/* Selection Checkbox */}
                            {(hoveredMemberId === member.id || selectedMembers.size > 0 || (showDeletedMembers && selectedDeletedMembers.size > 0)) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (showDeletedMembers) {
                                    const newSelection = new Set(selectedDeletedMembers);
                                    if (newSelection.has(member.id)) {
                                      newSelection.delete(member.id);
                                    } else {
                                      newSelection.add(member.id);
                                    }
                                    setSelectedDeletedMembers(newSelection);
                                  } else {
                                    toggleMemberSelection(member.id);
                                  }
                                }}
                                className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                                  (showDeletedMembers && selectedDeletedMembers.has(member.id))
                                    ? 'bg-red-600 border-red-600 text-white'
                                    : (selectedMembers.has(member.id)
                                      ? 'bg-blue-600 border-blue-600 text-white'
                                      : 'bg-white border-gray-300 hover:border-blue-400')
                                }`}
                              >
                                {(showDeletedMembers && selectedDeletedMembers.has(member.id)) && <CheckSquare className="w-3 h-3" />}
                                {(!showDeletedMembers && selectedMembers.has(member.id)) && <CheckSquare className="w-3 h-3" />}
                              </button>
                            )}

                            {/* Avatar */}
                            <img
                              src={member.profileImage}
                              alt={member.fullName}
                              className="w-10 h-10 rounded-full object-cover flex-shrink-0 bg-gray-100"
                              referrerPolicy="no-referrer"
                            />

                            {/* Name */}
                            <div className="flex flex-col min-w-0">
                              <span className="font-medium text-gray-900 truncate text-[14px]">{member.fullName}</span>
                            </div>
                          </div>
                        </td>

                        {/* Cell 3: Phone */}
                        <td className="px-6 py-4">
                          <span className="text-gray-900 text-[14px]">{member.phoneNumber || 'N/A'}</span>
                        </td>

                        {/* Cell 2: Email */}
                        <td className="px-6 py-4">
                          <span className="text-gray-900 truncate block text-[14px]">{member.email || 'N/A'}</span>
                        </td>

                        {/* Cell 4: Address */}
                        <td className="px-6 py-4">
                          <span className="text-gray-600 text-[14px]">{member.location || 'N/A'}</span>
                        </td>

                        {/* Conditional rendering for other cells */}
                        {!showDeletedMembers && (
                          <>
                            {/* Cell 5: Joined Date */}
                            <td className="px-6 py-4">
                              <span className="text-gray-600 text-[14px]">
                                N/A
                              </span>
                            </td>

                            {/* Cell 6: Status */}
                            <td className="px-6 py-4">
                              {(() => {
                                const { chipClass, dotClass, text } = memberStatusBadgePair(
                                  member.status,
                                  memberStatusPicklistForBadges,
                                );
                                return (
                                  <span
                                    className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${chipClass}`}
                                  >
                                    <span className={`w-1.5 h-1.5 rounded-full mr-1.5 shrink-0 ${dotClass}`} />
                                    {text}
                                  </span>
                                );
                              })()}
                            </td>

                            {/* Cell 7: Actions */}
                            <td className="px-6 py-4">
                              <div className="relative flex justify-center">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveMenu(activeMenu === member.id ? null : member.id);
                                  }}
                                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all"
                                >
                                  <MoreVertical className="w-4 h-4" />
                                </button>

                                {activeMenu === member.id && (
                                  <>
                                    <div
                                      className="fixed inset-0 z-10"
                                      onClick={() => setActiveMenu(null)}
                                    />
                                    <motion.div
                                      initial={{ opacity: 0, scale: 0.95 }}
                                      animate={{ opacity: 1, scale: 1 }}
                                      className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-20"
                                    >
                                      <button
                                        onClick={() => {
                                          setEditingMember(member);
                                          setActiveMenu(null);
                                        }}
                                        className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                      >
                                        <Edit2 className="w-4 h-4 mr-3" />
                                        Edit
                                      </button>
                                      <button
                                        onClick={() => {
                                          setAiNoteMember(member);
                                          setActiveMenu(null);
                                        }}
                                        className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                      >
                                        <Mic className="w-4 h-4 mr-3" />
                                        AI Voice Note
                                      </button>
                                      <button
                                        onClick={() => {
                                          handleAssignToGroupClick(member);
                                          setActiveMenu(null);
                                        }}
                                        className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                      >
                                        <GitFork className="w-4 h-4 mr-3" />
                                        Assign to Group
                                      </button>
                                      {can('manage_member_tasks') && (
                                        <button
                                          onClick={() => {
                                            openAssignTaskModal([member]);
                                            setActiveMenu(null);
                                          }}
                                          className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                        >
                                          <ListTodo className="w-4 h-4 mr-3" />
                                          Assign task
                                        </button>
                                      )}
                                      <div className="border-t border-gray-100 my-1"></div>
                                      <button
                                        onClick={() => {
                                          setDeletingMember(member);
                                          setActiveMenu(null);
                                        }}
                                        className="flex items-center w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                                      >
                                        <Trash2 className="w-4 h-4 mr-3" />
                                        Delete
                                      </button>
                                    </motion.div>
                                  </>
                                )}
                              </div>
                            </td>
                          </>
                        )}
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                )}
              </tbody>
            </table>
          </div>

          {!isLoading && hasMoreMembers && (
            <div ref={membersSentinelRef} className="h-6" />
          )}
          {!isLoading && loadingMoreMembers && (
            <div className="flex items-center justify-center gap-2 py-3 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading more members...
            </div>
          )}

          {!isLoading && filteredMembers.length === 0 && (
            <div className="text-center py-16">
              <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Search className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-500">
                {searchQuery.trim() || memberStatusFilter
                  ? 'No members match your current filters.'
                  : 'No members in this view.'}
              </p>
            </div>
          )}
        </div>
        </div>
      )}

      {/* Family Groups View */}
      {viewType === 'families' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <AnimatePresence>
            {filteredFamilies.map((family, index) => {
              const familyMembers = getFamilyMembers(family.id);
              const head = getHeadOfHousehold(family.headOfHousehold);

              return (
                <motion.div
                  key={family.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: index * 0.05 }}
                  whileHover={{ 
                    scale: 1.02,
                    y: -4,
                    transition: { duration: 0.2 }
                  }}
                  onClick={() => { void fetchFamilyMembers(family.id); setViewingFamily(family); }}
                  className="bg-white rounded-2xl p-6 shadow-sm border-2 border-gray-100 hover:shadow-xl hover:border-blue-400 hover:shadow-blue-100/50 transition-all relative group cursor-pointer"
                >
                  {/* Menu Button */}
                  <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setActiveMenu(activeMenu === family.id ? null : family.id)}
                      className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-all"
                    >
                      <MoreVertical className="w-5 h-5" />
                    </button>
                    
                    {activeMenu === family.id && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setActiveMenu(null)}
                        />
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-20"
                        >
                          <button
                            onClick={() => {
                              setEditingFamily(family);
                              setActiveMenu(null);
                            }}
                            className="flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            <Edit2 className="w-4 h-4 mr-3" />
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              setDeletingFamily(family);
                              setActiveMenu(null);
                            }}
                            className="flex items-center w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4 mr-3" />
                            Delete
                          </button>
                        </motion.div>
                      </>
                    )}
                  </div>

                  {/* Family Header */}
                  <div className="flex items-start space-x-4 mb-6">
                    <div className="w-16 h-16 bg-blue-50 rounded-xl flex items-center justify-center text-2xl">
                      🏠
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900">{family.familyName}</h3>
                      <p className="text-sm text-gray-500 mt-0.5">{familyMembers.length} members</p>
                      <div className="mt-2">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700">
                          Family Unit
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Head of Household */}
                  {head && (
                    <div className="mb-4 p-3 bg-gray-50 rounded-xl">
                      <p className="text-sm text-gray-500 mb-2">Head of Household</p>
                      <div className="flex items-center space-x-2">
                        <img
                          src={head.profileImage}
                          alt={head.fullName}
                          className="w-8 h-8 rounded-lg object-cover"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">{head.fullName}</p>
                          <p className="text-sm text-gray-500">{family.phoneNumber}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Family Members */}
                  <div className="space-y-2 mb-4">
                    <p className="text-sm text-gray-500 font-medium">Family Members</p>
                    <div className="flex -space-x-2">
                      {familyMembers.slice(0, 5).map((member) => (
                        <img
                          key={member.id}
                          src={member.profileImage}
                          alt={member.fullName}
                          title={member.fullName}
                          className="w-10 h-10 rounded-full border-2 border-white object-cover"
                        />
                      ))}
                      {familyMembers.length > 5 && (
                        <div className="w-10 h-10 rounded-full bg-gray-200 border-2 border-white flex items-center justify-center text-xs font-medium text-gray-600">
                          +{familyMembers.length - 5}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Address */}
                  <div className="pt-4 border-t border-gray-100">
                    <p className="text-sm text-gray-500 mb-1">Address</p>
                    <p className="text-sm text-gray-900">{family.address}</p>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {loadingFamilies ? (
            <div className="col-span-full text-center py-16">
              <p>Loading family groups...</p>
            </div>
          ) : filteredFamilies.length === 0 && (
            <div className="col-span-full text-center py-16">
              <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Home className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-500">No family groups found matching your search.</p>
            </div>
          )}
        </div>
      )}

      {/* Member Requests View */}
      {viewType === 'requests' && (
        <div className="space-y-6">
          {/* Bulk Actions Header */}
          <AnimatePresence>
            {selectedRequests.size > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="bg-blue-50 border border-blue-200 rounded-2xl p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-blue-600 text-white rounded-xl flex items-center justify-center font-semibold">
                      {selectedRequests.size}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">
                        {selectedRequests.size} {selectedRequests.size === 1 ? 'Request' : 'Requests'} Selected
                      </p>
                      <p className="text-sm text-gray-600">Choose an action below</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <button
                      type="button"
                      onClick={() => void handleBulkApproveRequests()}
                      className="flex items-center px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-sm font-medium"
                    >
                      <Check className="w-4 h-4 mr-2" />
                      Approve Selected
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleBulkRejectRequests()}
                      className="flex items-center px-4 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-all shadow-sm font-medium"
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      Reject Selected
                    </button>
                    <button
                      onClick={() => setSelectedRequests(new Set())}
                      className="p-2.5 text-gray-600 hover:text-gray-800 hover:bg-white rounded-xl transition-all"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Requests List Table */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {/* Table Header */}
            <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
              <div className="flex items-center">
                <div className="w-12 flex items-center justify-center">
                  <button
                    onClick={() => {
                      if (selectedRequests.size === filteredRequests.length) {
                        setSelectedRequests(new Set());
                      } else {
                        setSelectedRequests(new Set(filteredRequests.map(r => r.id)));
                      }
                    }}
                    className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${
                      selectedRequests.size === filteredRequests.length && filteredRequests.length > 0
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-white border-gray-300 hover:border-blue-400'
                    }`}
                  >
                    {selectedRequests.size === filteredRequests.length && filteredRequests.length > 0 && (
                      <CheckSquare className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <div className="flex-1 grid grid-cols-12 gap-4 text-xs font-semibold text-gray-500">
                  <div className="col-span-6">Applicant</div>
                  <div className="col-span-3">Submitted</div>
                  <div className="col-span-3 text-right">Actions</div>
                </div>
              </div>
            </div>

            {/* Table Body */}
            <div className="divide-y divide-gray-100">
              <AnimatePresence>
                {filteredRequests.map((request, index) => (
                  <motion.div
                    key={request.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: index * 0.02 }}
                    className={`px-6 py-4 hover:bg-gray-50 transition-all cursor-pointer ${
                      selectedRequests.has(request.id) ? 'bg-blue-50' : ''
                    }`}
                    onClick={() => setReviewingRequest(request)}
                  >
                    <div className="flex items-center">
                      <div className="w-12 flex items-center justify-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation(); // Prevent opening review panel
                            toggleRequestSelection(request.id);
                          }}
                          className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${
                            selectedRequests.has(request.id)
                              ? 'bg-blue-600 border-blue-600 text-white'
                              : 'bg-white border-gray-300 hover:border-blue-400'
                          }`}
                        >
                          {selectedRequests.has(request.id) && <CheckSquare className="w-4 h-4" />}
                        </button>
                      </div>

                      <div className="flex-1 grid grid-cols-12 gap-4 items-center">
                        {/* Applicant */}
                        <div className="col-span-6 flex items-center space-x-3 min-w-0">
                          <img
                            src={request.form_data.profileImage || ''}
                            alt={`${request.form_data.firstName} ${request.form_data.lastName}`}
                            className="w-9 h-9 rounded-full object-cover shrink-0"
                          />
                          <p className="font-medium text-gray-900 truncate">{request.form_data.firstName} {request.form_data.lastName}</p>
                        </div>

                        {/* Submitted */}
                        <div className="col-span-3 text-sm text-gray-700">
                          <div className="flex items-center space-x-1">
                            <Clock className="w-4 h-4 text-gray-400 shrink-0" />
                            <span>{formatLongWeekdayDate(String(request.submittedDate)) || '—'}</span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="col-span-3 flex items-center justify-end space-x-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setReviewingRequest(request);
                            }}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                            title="View Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleApproveRequest(request.id);
                            }}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                            title="Approve"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRejectRequest(request.id);
                            }}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-all"
                            title="Reject"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {filteredRequests.length === 0 && (
              <div className="text-center py-16">
                <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Clock className="w-8 h-8 text-gray-400" />
                </div>
                <p className="text-gray-500">
                  {memberRequests.length > 0 && searchQuery.trim()
                    ? 'No requests match your search. Clear the search box to see all pending requests.'
                    : 'No member requests found.'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <AnimatePresence>
        {membersFilterPanelOpen && viewType === 'members' && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMembersFilterPanelOpen(false)}
              className="fixed inset-0 bg-black/30 z-40"
            />
            <motion.div
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 30, opacity: 0 }}
              className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-3xl border border-gray-200 shadow-2xl max-h-[85vh] overflow-y-auto"
            >
              <div className="px-6 py-5 border-b border-dashed border-gray-200 flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Filter members</h3>
                  <p className="text-sm text-gray-500 mt-1">Group, subgroup, status, age range, and pending task</p>
                </div>
                <button
                  onClick={() => setMembersFilterPanelOpen(false)}
                  className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-6 py-5 space-y-5">
                <div>
                  <p className="text-sm font-semibold text-gray-900 mb-2">Status</p>
                  <select
                    value={memberStatusFilter}
                    onChange={(e) => setMemberStatusFilter(e.target.value)}
                    className="w-full px-3 py-3 border border-gray-200 rounded-xl bg-white text-sm"
                  >
                    <option value="">All statuses</option>
                    {hasMembersWithoutStatus && <option value={STATUS_FILTER_NONE}>No status</option>}
                    {memberStatusFilterOptions.map((label) => (
                      <option key={label} value={label}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 mb-2">Age range</p>
                  <select
                    value={memberAgeRangeFilter}
                    onChange={(e) => setMemberAgeRangeFilter(e.target.value as 'all' | 'u18' | '18_35' | '36_55' | '56p')}
                    className="w-full px-3 py-3 border border-gray-200 rounded-xl bg-white text-sm"
                  >
                    <option value="all">All ages</option>
                    <option value="u18">Under 18</option>
                    <option value="18_35">18-35</option>
                    <option value="36_55">36-55</option>
                    <option value="56p">56+</option>
                  </select>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 mb-2">Groups and subgroups</p>
                  <div className="flex flex-wrap gap-2">
                    {mockGroups.map((g) => {
                      const gid = String(g.id);
                      const active = memberGroupFilterIds.has(gid);
                      return (
                        <button
                          key={gid}
                          type="button"
                          onClick={() =>
                            setMemberGroupFilterIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(gid)) next.delete(gid);
                              else next.add(gid);
                              return next;
                            })
                          }
                          className={`px-3 py-2 rounded-full text-sm border ${
                            active ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-white text-gray-700 border-gray-200'
                          }`}
                        >
                          {g.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">With pending task</p>
                    <p className="text-xs text-gray-500">Only members with pending tasks</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMemberPendingTaskOnly((v) => !v)}
                    className={`w-12 h-7 rounded-full transition-colors ${memberPendingTaskOnly ? 'bg-blue-600' : 'bg-gray-300'}`}
                  >
                    <span
                      className={`block w-5 h-5 bg-white rounded-full transition-transform ${
                        memberPendingTaskOnly ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
              <div className="px-6 py-4 border-t border-dashed border-gray-200 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setMemberStatusFilter('');
                    setMemberAgeRangeFilter('all');
                    setMemberPendingTaskOnly(false);
                    setMemberGroupFilterIds(new Set());
                  }}
                  className="flex-1 px-4 py-3 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setMembersFilterPanelOpen(false)}
                  className="flex-1 px-4 py-3 rounded-xl bg-gray-900 text-white hover:bg-black"
                >
                  Apply
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Request Review/Edit Panel */}
      <AnimatePresence>
        {reviewingRequest && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setReviewingRequest(null);
                setEditingRequest(null);
              }}
              className="fixed inset-0 bg-black/30 z-40"
            />

            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-2xl bg-white shadow-2xl z-50 overflow-y-auto"
            >
              <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-blue-600 px-8 py-6 border-b border-gray-200 z-10">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-2xl font-semibold text-white">Review Application</h2>
                  <button
                    onClick={() => {
                      setReviewingRequest(null);
                      setEditingRequest(null);
                    }}
                    className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-all"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
                <div className="flex items-center space-x-3">
                  <span className="px-3 py-1 bg-yellow-400 text-yellow-900 rounded-lg text-sm font-semibold">
                    ⏳ Pending Review
                  </span>
                  <span className="text-sm text-white/90">
                    Submitted {formatLongWeekdayDate(String(reviewingRequest.submittedDate)) || '—'}
                  </span>
                </div>
              </div>

              <div className="p-8 space-y-6">
                <div className="flex items-start space-x-6 p-6 bg-gray-50 rounded-2xl">
                  <img
                    src={reviewingRequest.form_data.profileImage || ''}
                    alt={`${reviewingRequest.form_data.firstName} ${reviewingRequest.form_data.lastName}`}
                    className="w-24 h-24 rounded-2xl object-cover border-4 border-white shadow-lg"
                  />
                  <div className="flex-1">
                    <h3 className="text-2xl font-semibold text-gray-900 mb-2">{reviewingRequest.form_data.firstName} {reviewingRequest.form_data.lastName}</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-sm text-gray-500 mb-1">Gender</p>
                        <p className="text-sm font-medium text-gray-900">{reviewingRequest.form_data.gender || 'Not specified'}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-500 mb-1">Marital Status</p>
                        <p className="text-sm font-medium text-gray-900">{reviewingRequest.form_data.maritalStatus || 'Not specified'}</p>
                      </div>

                      <div>
                        <p className="text-sm text-gray-500 mb-1">Occupation</p>
                        <p className="text-sm font-medium text-gray-900">{reviewingRequest.form_data.occupation || 'Not specified'}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {editingRequest ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-lg font-semibold text-gray-900">Edit Application Details</h4>
                      <button
                        onClick={() => setEditingRequest(null)}
                        className="text-sm text-gray-600 hover:text-gray-800"
                      >
                        Cancel Edit
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">First Name</label>
                        <input
                          type="text"
                          value={editingRequest.form_data.firstName}
                          onChange={(e) => setEditingRequest({...editingRequest, form_data: {...editingRequest.form_data, firstName: e.target.value}})}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Last Name</label>
                        <input
                          type="text"
                          value={editingRequest.form_data.lastName}
                          onChange={(e) => setEditingRequest({...editingRequest, form_data: {...editingRequest.form_data, lastName: e.target.value}})}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                        <input
                          type="email"
                          value={editingRequest.form_data.email || ''}
                          onChange={(e) => setEditingRequest({...editingRequest, form_data: {...editingRequest.form_data, email: e.target.value}})}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Phone Number</label>
                        <input
                          type="tel"
                          value={editingRequest.form_data.phoneNumber}
                          onChange={(e) => setEditingRequest({...editingRequest, form_data: {...editingRequest.form_data, phoneNumber: e.target.value}})}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Location</label>
                        <input
                          type="text"
                          value={editingRequest.form_data.location}
                          onChange={(e) => setEditingRequest({...editingRequest, form_data: {...editingRequest.form_data, location: e.target.value}})}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Emergency Contact Name</label>
                        <input
                          type="text"
                          value={editingRequest.form_data.emergencyContactName}
                          onChange={(e) => setEditingRequest({...editingRequest, form_data: {...editingRequest.form_data, emergencyContactName: e.target.value}})}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Emergency Contact Phone</label>
                        <input
                          type="tel"
                          value={editingRequest.form_data.emergencyContactPhone}
                          onChange={(e) => setEditingRequest({...editingRequest, form_data: {...editingRequest.form_data, emergencyContactPhone: e.target.value}})}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Date of Birth</label>
                        <DatePickerField
                          value={editingRequest.form_data.dateOfBirth || ''}
                          onChange={(v) =>
                            setEditingRequest({
                              ...editingRequest,
                              form_data: { ...editingRequest.form_data, dateOfBirth: v },
                            })
                          }
                          placeholder="Date of birth"
                          triggerClassName="h-auto min-h-[42px] rounded-xl border-gray-200 bg-white px-4 py-2.5 text-gray-900 shadow-none focus-visible:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Gender</label>
                        <select
                          value={editingRequest.form_data.gender || ''}
                          onChange={(e) => setEditingRequest({...editingRequest, form_data: {...editingRequest.form_data, gender: e.target.value}})}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Select Gender</option>
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Marital Status</label>
                        <select
                          value={editingRequest.form_data.maritalStatus || ''}
                          onChange={(e) => setEditingRequest({...editingRequest, form_data: {...editingRequest.form_data, maritalStatus: e.target.value}})}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Select Status</option>
                          <option value="single">Single</option>
                          <option value="married">Married</option>
                          <option value="divorced">Divorced</option>
                          <option value="widowed">Widowed</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Occupation</label>
                        <input
                          type="text"
                          value={editingRequest.form_data.occupation || ''}
                          onChange={(e) => setEditingRequest({...editingRequest, form_data: {...editingRequest.form_data, occupation: e.target.value}})}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Date Joined</label>
                        <DatePickerField
                          value={editingRequest.form_data.dateJoined || ''}
                          onChange={(v) =>
                            setEditingRequest({
                              ...editingRequest,
                              form_data: { ...editingRequest.form_data, dateJoined: v },
                            })
                          }
                          placeholder="Date joined"
                          triggerClassName="h-auto min-h-[42px] rounded-xl border-gray-200 bg-white px-4 py-2.5 text-gray-900 shadow-none focus-visible:ring-blue-500"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-end space-x-3 mt-6">
                      <button
                        onClick={() => setEditingRequest(null)}
                        className="px-5 py-2.5 text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-all font-medium"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleUpdateEditedRequest}
                        className="px-5 py-2.5 text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all shadow-sm font-medium"
                      >
                        Save Changes
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-lg font-semibold text-gray-900">Contact Information</h4>
                        <button
                          onClick={() => setEditingRequest(reviewingRequest)}
                          className="flex items-center text-sm text-blue-600 hover:text-blue-700 font-medium"
                        >
                          <Edit2 className="w-4 h-4 mr-1" />
                          Edit Details
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-gray-50 rounded-xl">
                          <p className="text-sm text-gray-500 mb-2">Email Address</p>
                          <p className="text-sm font-medium text-gray-900">{reviewingRequest.form_data.email || 'N/A'}</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-xl">
                          <p className="text-sm text-gray-500 mb-2">Phone Number</p>
                          <p className="text-sm font-medium text-gray-900">{reviewingRequest.form_data.phoneNumber}</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-xl">
                          <p className="text-sm text-gray-500 mb-2">Location</p>
                          <p className="text-sm font-medium text-gray-900">{reviewingRequest.form_data.location}</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-xl">
                          <p className="text-sm text-gray-500 mb-2">Emergency Contact Name</p>
                          <p className="text-sm font-medium text-gray-900">{reviewingRequest.form_data.emergencyContactName}</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-xl">
                          <p className="text-sm text-gray-500 mb-2">Emergency Contact Phone</p>
                          <p className="text-sm font-medium text-gray-900">{reviewingRequest.form_data.emergencyContactPhone}</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-xl">
                          <p className="text-sm text-gray-500 mb-2">Date of Birth</p>
                          <p className="text-sm font-medium text-gray-900">{reviewingRequest.form_data.dateOfBirth || 'N/A'}</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-xl">
                          <p className="text-sm text-gray-500 mb-2">Date Joined</p>
                          <p className="text-sm font-medium text-gray-900">{reviewingRequest.form_data.dateJoined || 'N/A'}</p>
                        </div>
                      </div>
                    </div>

                    {reviewingRequest.form_data.notes && (
                      <div>
                        <h4 className="text-lg font-semibold text-gray-900 mb-3">Additional Notes</h4>
                        <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                          <p className="text-sm text-gray-700">{reviewingRequest.form_data.notes}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="sticky bottom-0 bg-white border-t border-gray-200 px-8 py-6 flex items-center justify-between">
                <button
                  onClick={() => handleRejectRequest(reviewingRequest!.id)}
                  className="flex items-center px-6 py-3 text-red-600 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-all font-medium"
                >
                  <XCircle className="w-5 h-5 mr-2" />
                  Reject Application
                </button>
                <button
                  onClick={() => handleApproveRequest(reviewingRequest!.id)}
                  className="flex items-center px-8 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-lg font-medium"
                >
                  <Check className="w-5 h-5 mr-2" />
                  Approve & Add Member
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Modals */}
      <MemberModal
        key={editingMember?.id ?? (isAddModalOpen ? 'add-member' : 'member-modal-closed')}
        isOpen={isAddModalOpen || !!editingMember}
        onClose={() => {
          setIsAddModalOpen(false);
          setEditingMember(undefined);
        }}
        member={editingMember}
        onSave={handleSaveMember}
      />

      <FamilyGroupModal
        isOpen={isFamilyModalOpen || !!editingFamily}
        onClose={() => {
          setIsFamilyModalOpen(false);
          setEditingFamily(undefined);
        }}
        familyGroup={editingFamily}
        onSave={handleSaveFamily}
      />

      <FamilyGroupDetailModal
        isOpen={!!viewingFamily}
        onClose={() => setViewingFamily(undefined)}
        familyGroup={viewingFamily!}
        members={viewingFamily ? getFamilyMembers(viewingFamily.id) : []}
        onUpdateFamilyName={handleUpdateFamilyName}
        onInitiateRemoveMember={(member, familyId) => setMemberToRemove({ member, familyId })}
        onInitiateDeleteFamily={handleDeleteFamilyFromModal}
      />

      <DeleteModal
        isOpen={!!memberToRemove}
        onClose={() => setMemberToRemove(undefined)}
        onConfirm={handleRemoveMemberFromFamily}
        title="Remove Member"
        message={`Are you sure you want to remove ${memberToRemove?.member.fullName} from this family? This action cannot be reversed.`}
      />

      <DeleteModal
        isOpen={!!deletingMember}
        onClose={() => {
          if (memberDeleteLoading) return;
          setDeletingMember(undefined);
        }}
        onConfirm={handleDeleteMember}
        isConfirming={memberDeleteLoading}
        closeOnConfirm={false}
        title="Delete Member"
        message={`Are you sure you want to delete ${deletingMember?.fullName}? This action cannot be undone.`}
      />

      <DeleteModal
        isOpen={!!deletingFamily}
        onClose={() => setDeletingFamily(undefined)}
        onConfirm={handleDeleteFamily}
        title="Delete Family Group"
        message={`Are you sure you want to delete ${deletingFamily?.familyName}? This action cannot be undone.`}
      />

      <AIVoiceNoteModal
        isOpen={!!aiNoteMember}
        onClose={() => setAiNoteMember(undefined)}
        memberName={aiNoteMember?.fullName || ''}
      />

      <AssignToFamilyModal
        isOpen={isAssignToFamilyModalOpen}
        onClose={() => setIsAssignToFamilyModalOpen(false)}
        members={members}
        familyGroups={familyGroups}
        selectedMembers={selectedMembers}
        onAssign={handleAssignFamilyGroup}
      />

      <AssignMinistryModal
        isOpen={isAssignMinistryModalOpen}
        onClose={() => setIsAssignMinistryModalOpen(false)}
        members={members}
        selectedMembers={selectedMembers}
        onAssign={handleAssignMinistry}
      />

      <AssignToGroupModal
        isOpen={isAssignToGroupModalOpen}
        onClose={() => {
          setIsAssignToGroupModalOpen(false);
          setMemberToAssign(null);
        }}
        members={members}
        selectedMemberIds={memberToAssign ? [memberToAssign.id] : Array.from(selectedMembers)}
        onAssignmentComplete={handleAssignmentComplete}
      />

      <AssignTaskModal
        isOpen={assignTaskModalOpen}
        onClose={() => {
          setAssignTaskModalOpen(false);
          setAssignTaskInitialMemberIds([]);
          setAssignTaskLockMemberSelection(false);
        }}
        token={token}
        branchId={selectedBranch?.id}
        initialSelectedMemberIds={assignTaskInitialMemberIds}
        allMembers={members as unknown as import('@/types').Member[]}
        lockMemberSelection={assignTaskLockMemberSelection}
      />

      <MemberLinkModal
        isOpen={isMemberLinkModalOpen}
        onClose={() => setIsMemberLinkModalOpen(false)}
        registrationLink={registrationLink}
        registrationQRCode={registrationQRCode}
        downloadQRCode={downloadRegistrationQR}
        shareLink={shareRegistrationLink}
      />

      <MemberDetailPanel
        isOpen={!!viewingMemberDetail}
        onClose={() => setViewingMemberDetail(null)}
        member={viewingMemberDetail as any}
        familyGroups={familyGroups as any}
        allMembers={members as any}
        onEdit={(updated) => {
          setMembers((prev) =>
            prev.map((m) => (m.id === updated.id ? { ...m, ...updated } as Member : m))
          );
          setViewingMemberDetail(updated as Member);
        }}
      />

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        token={token}
        branchId={selectedBranch?.id}
      />

      <AnimatePresence>
        {familiesPickerOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
            onClick={() => setFamiliesPickerOpen(false)}
          >
            <motion.div
              initial={{ y: 8, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 8, opacity: 0, scale: 0.98 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl bg-white border border-gray-200 shadow-2xl overflow-hidden flex flex-col max-h-[min(480px,85vh)]"
            >
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">Families</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Select a family to view its members</p>
                </div>
                <button
                  type="button"
                  onClick={() => setFamiliesPickerOpen(false)}
                  className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="overflow-y-auto flex-1 p-3">
                {loadingFamilies ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                  </div>
                ) : (
                  <>
                    {familyGroups
                      .filter((f) => !selectedBranch || f.churchId === selectedBranch.id)
                      .sort((a, b) =>
                        (a.familyName || '').localeCompare(b.familyName || '', undefined, { sensitivity: 'base' }),
                      )
                      .map((family) => {
                        const count = (familyMembersCache[family.id] || []).length;
                        return (
                          <button
                            key={family.id}
                            type="button"
                            onClick={() => {
                              setViewType('members');
                              setShowDeletedMembers(false);
                              setSearchParams((prev) => {
                                const next = new URLSearchParams(prev);
                                next.set('family', family.id);
                                return next;
                              });
                              setFamiliesPickerOpen(false);
                            }}
                            className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-gray-50 border border-transparent hover:border-gray-200 transition-colors mb-1"
                          >
                            <span className="font-medium text-gray-900 truncate min-w-0">{family.familyName}</span>
                            <span className="shrink-0 text-xs font-semibold tabular-nums px-2 py-0.5 rounded-lg bg-gray-100 text-gray-700">
                              {count} {count === 1 ? 'member' : 'members'}
                            </span>
                          </button>
                        );
                      })}
                    {familyGroups.filter((f) => !selectedBranch || f.churchId === selectedBranch.id).length === 0 &&
                      !loadingFamilies && (
                        <p className="text-sm text-gray-500 text-center py-10">No families in this branch yet.</p>
                      )}
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {importHelpOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[169] flex items-center justify-center bg-black/40 p-4"
          >
            <motion.div
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 8, opacity: 0 }}
              className="w-full max-w-xl rounded-2xl bg-white border border-gray-200 shadow-2xl overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-base font-semibold text-gray-900">Import Instructions</h3>
                <button
                  type="button"
                  onClick={() => setImportHelpOpen(false)}
                  className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-6 py-5 space-y-3 text-sm text-gray-700">
                <p className="font-medium text-gray-900">Before you import:</p>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li>Use the CSV template to keep the right column names.</li>
                  <li>Duplicates are checked by <span className="font-medium">first_name + last_name + dob</span> and skipped by default.</li>
                  <li>DOB should be in <span className="font-medium">YYYY-MM-DD</span> format.</li>
                  <li>Image/photo columns are ignored in this import flow.</li>
                </ul>
              </div>
              <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={downloadImportTemplate}
                  className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                >
                  Download CSV Template
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setImportHelpOpen(false);
                    importInputRef.current?.click();
                  }}
                  className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                >
                  Continue to Upload
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

      </AnimatePresence>

      <AnimatePresence>
        {importCheckingOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[170] flex items-center justify-center bg-black/40 p-4"
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="w-full max-w-md rounded-2xl bg-white border border-gray-200 shadow-2xl p-6 text-center"
            >
              <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-blue-50 flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
              </div>
              <h3 className="text-base font-semibold text-gray-900">Checking import file</h3>
              <p className="mt-2 text-sm text-gray-600">
                Validating rows, checking duplicates by first name + last name + date of birth, and preparing preview.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {importSummaryOpen && importPrecheck && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[171] flex items-center justify-center bg-black/45 p-4"
          >
            <motion.div
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 8, opacity: 0 }}
              className="w-full max-w-3xl rounded-2xl bg-white border border-gray-200 shadow-2xl overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-base font-semibold text-gray-900">Import pre-check results</h3>
                <button
                  type="button"
                  onClick={() => {
                    setImportSummaryOpen(false);
                    setImportPrecheck(null);
                    setImportCommitResult(null);
                    setImportCommitting(false);
                    setImportJobId(null);
                    setImportProgress({ processed: 0, total: 0 });
                    setDuplicateAction('skip');
                    setShowDuplicateEditor(false);
                    setDuplicateDraftRows([]);
                    setImportRows([]);
                  }}
                  className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-gray-200 p-3 bg-gray-50">
                    <p className="text-xs text-gray-500">Rows in file</p>
                    <p className="text-xl font-semibold text-gray-900">{importPrecheck.summary.total_rows}</p>
                  </div>
                  <div className="rounded-xl border border-blue-200 p-3 bg-blue-50">
                    <p className="text-xs text-blue-700">Ready to import</p>
                    <p className="text-xl font-semibold text-blue-700">{importPrecheck.summary.valid_rows}</p>
                  </div>
                  <div className="rounded-xl border border-amber-200 p-3 bg-amber-50">
                    <p className="text-xs text-amber-700">Duplicates found</p>
                    <p className="text-xl font-semibold text-amber-700">{importPrecheck.summary.duplicate_rows}</p>
                  </div>
                  <div className="rounded-xl border border-red-200 p-3 bg-red-50">
                    <p className="text-xs text-red-700">Invalid rows</p>
                    <p className="text-xl font-semibold text-red-700">{importPrecheck.summary.invalid_rows}</p>
                  </div>
                </div>

                {importPrecheck.issues.length > 0 ? (
                  <div className="rounded-xl border border-gray-200 overflow-hidden">
                    <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-sm font-medium text-gray-700">
                      Issues and how to fix
                    </div>
                    <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
                      {importPrecheck.issues.map((issue, idx) => (
                        <div key={`${issue.row}-${issue.field}-${idx}`} className="px-4 py-3 text-sm">
                          <p className="font-medium text-gray-900">
                            Row {issue.row} · {issue.field}
                          </p>
                          <p className="text-gray-700">{issue.message}</p>
                          <p className="text-xs text-gray-500 mt-1">Fix: {issue.fix_hint}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                    No blocking issues found. You can confirm import.
                  </div>
                )}

                {importPrecheck.summary.duplicate_rows > 0 && !importCommitResult ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                    <p className="text-sm font-semibold text-amber-900">Duplicate handling</p>
                    <p className="text-sm text-amber-800">
                      Existing members match by <span className="font-medium">first_name + last_name + dob</span>. Choose how to continue.
                    </p>
                    <p className="text-xs text-amber-700">Changing any one of those 3 fields will make it unique.</p>
                    <div className="grid gap-2">
                      <label className="flex items-start gap-2 text-sm text-gray-800">
                        <input
                          type="radio"
                          name="duplicate_action"
                          className="mt-0.5"
                          checked={duplicateAction === 'remove'}
                          onChange={() => setDuplicateAction('remove')}
                        />
                        <span>Remove duplicate rows from this import.</span>
                      </label>
                      <label className="flex items-start gap-2 text-sm text-gray-800">
                        <input
                          type="radio"
                          name="duplicate_action"
                          className="mt-0.5"
                          checked={duplicateAction === 'skip'}
                          onChange={() => setDuplicateAction('skip')}
                        />
                        <span>Ignore duplicates (skip during import).</span>
                      </label>
                      <label className="flex items-start gap-2 text-sm text-gray-800">
                        <input
                          type="radio"
                          name="duplicate_action"
                          className="mt-0.5"
                          checked={duplicateAction === 'import'}
                          onChange={() => setDuplicateAction('import')}
                        />
                        <span>Ignore check and add anyway.</span>
                      </label>
                    </div>
                    {duplicateAction === 'import' ? (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                        Warning: this will create duplicate member records.
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {importPrecheck.summary.duplicate_rows > 0 && !importCommitResult ? (
                  <div className="rounded-xl border border-gray-200 p-3 bg-white">
                    <button
                      type="button"
                      onClick={openDuplicateEditor}
                      className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                    >
                      Preview duplicates & correct data
                    </button>
                    <p className="mt-2 text-xs text-gray-500">
                      Edit duplicate rows and re-check before confirming import.
                    </p>
                  </div>
                ) : null}

                {showDuplicateEditor ? (
                  <div className="rounded-xl border border-gray-200 overflow-hidden">
                    <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-sm font-medium text-gray-700">
                      Duplicate rows editor
                    </div>
                    <div className="px-4 py-2 text-xs text-amber-700 bg-amber-50 border-b border-amber-100">
                      Duplicate check key is <span className="font-medium">first_name + last_name + dob</span>. Update any one to remove duplicates.
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                      {duplicateRowsList.map((rowNum) => {
                        const idx = rowNum - 2;
                        const row = duplicateDraftRows[idx] || {};
                        return (
                          <div key={`dup-edit-${rowNum}`} className="p-3 border-b border-gray-100 last:border-b-0">
                            <p className="text-xs text-gray-500 mb-2">Row {rowNum}</p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                              <input
                                value={String(row.first_name || '')}
                                onChange={(e) => updateDuplicateDraftCell(rowNum, 'first_name', e.target.value)}
                                placeholder="First name"
                                className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                              />
                              <input
                                value={String(row.last_name || '')}
                                onChange={(e) => updateDuplicateDraftCell(rowNum, 'last_name', e.target.value)}
                                placeholder="Last name"
                                className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                              />
                              <input
                                value={String(row.dob || '')}
                                onChange={(e) => updateDuplicateDraftCell(rowNum, 'dob', e.target.value)}
                                placeholder="DOB (YYYY-MM-DD)"
                                className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowDuplicateEditor(false)}
                        className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void recheckCorrectedRows()}
                        disabled={duplicateRechecking}
                        className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                      >
                        {duplicateRechecking ? 'Re-checking…' : 'Re-check corrected rows'}
                      </button>
                    </div>
                  </div>
                ) : null}

                {importCommitResult ? (
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm">
                    <p className="font-semibold text-blue-900 mb-1">Import completed</p>
                    <p className="text-blue-800">
                      Created: {importCommitResult.summary.created_rows} · Skipped: {importCommitResult.summary.skipped_rows} · Failed: {importCommitResult.summary.failed_rows}
                    </p>
                  </div>
                ) : null}

                {importCommitting ? (
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm">
                    <p className="font-semibold text-blue-900 mb-1">Import in progress</p>
                    <p className="text-blue-800">
                      {Math.min(importProgress.processed, importProgress.total)}/{importProgress.total} imported
                    </p>
                  </div>
                ) : null}
              </div>
              <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setImportSummaryOpen(false);
                    setImportPrecheck(null);
                    setImportCommitResult(null);
                    setImportCommitting(false);
                    setImportJobId(null);
                    setImportProgress({ processed: 0, total: 0 });
                    setDuplicateAction('skip');
                    setShowDuplicateEditor(false);
                    setDuplicateDraftRows([]);
                    setImportRows([]);
                  }}
                  disabled={importCommitting}
                  className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  Close
                </button>
                {!importCommitResult && (
                  <button
                    type="button"
                    onClick={() => void handleConfirmImportCommit()}
                    disabled={importCommitting || effectiveImportCount === 0}
                    className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {importCommitting ? 'Importing…' : `Confirm import (${effectiveImportCount})`}
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
