import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router';
import QRCode from 'qrcode';
import { Group, Member } from '@/types';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'sonner';
import AddMembersModal from '../modals/AddMembersModal';
import ManageSubgroupModal from '../modals/ManageSubgroupModal';
import MemberDetailPanel from '../panels/MemberDetailPanel';
import DeleteModal from '../modals/DeleteModal';
import MinistryCard from '../cards/MinistryCard';
import {
  Trash2,
  ArrowLeft,
  Users,
  Mail,
  ChevronRight,
  Globe,
  UserCheck,
  Download,
  Share2,
  Send,
  Calendar,
  GitBranch,
  Inbox,
  UserCircle2,
  Phone,
  Crown,
  Search,
  CheckCircle,
  XCircle,
  Ban,
  X,
} from 'lucide-react';

type DetailTab = 'overview' | 'members' | 'events' | 'requests' | 'subgroups' | 'settings';

function embeddedMemberName(gm: { members?: { first_name?: string; last_name?: string } | null }) {
  const m = gm.members;
  if (m && typeof m === 'object' && !Array.isArray(m)) {
    const n = `${m.first_name || ''} ${m.last_name || ''}`.trim();
    return n || 'Member';
  }
  return 'Member';
}

function embeddedMemberPhoto(gm: {
  members?: { memberimage_url?: string | null } | null;
}): string | null {
  const m = gm.members;
  if (m && typeof m === 'object' && !Array.isArray(m)) {
    const url = m.memberimage_url;
    return url && String(url).trim() ? String(url).trim() : null;
  }
  return null;
}

function memberInitials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
}

function joinRequestDisplayName(r: {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
}): string {
  const fn = (r.first_name || '').trim();
  const ln = (r.last_name || '').trim();
  if (fn || ln) return `${fn} ${ln}`.trim();
  return (r.full_name || '').trim() || 'Applicant';
}

const MemberRowAvatar: React.FC<{ name: string; imageUrl: string | null }> = ({ name, imageUrl }) => {
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = Boolean(imageUrl) && !imgFailed;

  return (
    <div className="w-10 h-10 rounded-full shrink-0 overflow-hidden bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold ring-1 ring-black/5">
      {showImg ? (
        <img
          src={imageUrl!}
          alt=""
          className="w-full h-full object-cover"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span aria-hidden>{memberInitials(name)}</span>
      )}
    </div>
  );
};

function normalizeMemberForDetailPanel(raw: Record<string, unknown> & { id: string }): Member {
  const first = (raw.first_name as string) ?? '';
  const last = (raw.last_name as string) ?? '';
  const phoneRaw = raw.phone_number ?? raw.phone ?? raw.phoneNumber;
  const base: Member = {
    ...(raw as unknown as Member),
    id: raw.id as string,
    organization_id: (raw.organization_id as string) ?? '',
    branch_id: (raw.branch_id as string | null) ?? null,
    family_id: (raw.family_id as string | null) ?? null,
    member_id_string: (raw.member_id_string as string | null) ?? null,
    first_name: first,
    last_name: last,
    email: (raw.email as string | null) ?? null,
    phone: typeof phoneRaw === 'string' ? phoneRaw : (phoneRaw as string | null) ?? null,
    dob: (raw.dob as string | null) ?? null,
    gender: (raw.gender as string | null) ?? null,
    marital_status: (raw.marital_status as string | null) ?? null,
    occupation: (raw.occupation as string | null) ?? null,
    address: (raw.address as string | null) ?? null,
    emergency_contact_name: (raw.emergency_contact_name as string | null) ?? null,
    emergency_contact_phone: (raw.emergency_contact_phone as string | null) ?? null,
    date_joined: (raw.date_joined as string | null) ?? null,
    status: (raw.status as string | null) ?? null,
    member_url: (raw.member_url as string | null) ?? null,
    created_at: (raw.created_at as string) ?? '',
    updated_at: (raw.updated_at as string) ?? '',
    is_deleted: Boolean(raw.is_deleted),
    deleted_at: (raw.deleted_at as string | null) ?? null,
    fullName: (raw.fullName as string) ?? `${first} ${last}`.trim(),
    profileImage:
      (raw.profileImage as string | undefined) ??
      (raw.memberimage_url as string | undefined) ??
      (raw.member_url as string | undefined),
    phoneNumber:
      (raw.phoneNumber as string | undefined) ??
      (typeof phoneRaw === 'string' ? phoneRaw : undefined),
    location: (raw.location as string | undefined) ?? (raw.address as string | undefined),
  };
  return base;
}

function memberFromGroupRow(gm: {
  member_id?: string | null;
  members?: {
    first_name?: string;
    last_name?: string;
    email?: string | null;
    memberimage_url?: string | null;
  } | null;
}, roster: Record<string, unknown>[]): Member | null {
  const id = gm.member_id;
  if (!id || typeof id !== 'string') return null;
  const fromRoster = roster.find((m) => m.id === id);
  if (fromRoster) return normalizeMemberForDetailPanel(fromRoster as Record<string, unknown> & { id: string });
  const emb = gm.members;
  if (!emb || typeof emb !== 'object') return null;
  return normalizeMemberForDetailPanel({
    id,
    first_name: emb.first_name ?? '',
    last_name: emb.last_name ?? '',
    email: emb.email ?? null,
    organization_id: '',
    branch_id: null,
    family_id: null,
    member_id_string: null,
    phone: null,
    dob: null,
    gender: null,
    marital_status: null,
    occupation: null,
    address: null,
    emergency_contact_name: null,
    emergency_contact_phone: null,
    date_joined: null,
    status: null,
    member_url: null,
    created_at: '',
    updated_at: '',
    is_deleted: false,
    deleted_at: null,
    memberimage_url: emb.memberimage_url ?? null,
  } as Record<string, unknown> & { id: string });
}

/** Max edits allowed by approximate token length (typo tolerance). */
function fuzzyMaxEdits(tokenLen: number): number {
  if (tokenLen <= 2) return 0;
  if (tokenLen <= 6) return 1;
  if (tokenLen <= 11) return 2;
  return 3;
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Uint16Array(n + 1);
  const curr = new Uint16Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    prev.set(curr);
  }
  return prev[n];
}

function levenshteinWithin(a: string, b: string, max: number): boolean {
  if (max < 0) return false;
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > max) return false;
  return levenshteinDistance(a, b) <= max;
}

const TOKEN_SPLIT = /[\s,.;:@/|()[\]#"'`]+/;

function haystackWords(haystack: string): string[] {
  return haystack.split(TOKEN_SPLIT).filter((w) => w.length > 0);
}

/** Single query token vs full lowercased haystack (substring + fuzzy per word — no full-string O(n²) scan). */
function tokenMatchesHaystack(token: string, haystack: string): boolean {
  if (!token) return true;
  if (haystack.includes(token)) return true;

  const maxD = fuzzyMaxEdits(token.length);
  if (maxD === 0) {
    return haystackWords(haystack).some((w) => w === token || w.startsWith(token));
  }

  for (const w of haystackWords(haystack)) {
    if (w.length < 1) continue;
    if (Math.abs(w.length - token.length) > maxD + 2) continue;
    if (levenshteinWithin(token, w, maxD)) return true;
  }

  return false;
}

/** Digit-only token: substring, whole-string fuzzy, then bounded window scan for short haystacks only. */
function digitTokenMatches(token: string, digitsHaystack: string): boolean {
  if (!token) return true;
  if (digitsHaystack.includes(token)) return true;
  const maxD = fuzzyMaxEdits(token.length);
  if (maxD === 0) return false;
  if (levenshteinWithin(token, digitsHaystack, maxD)) return true;
  const n = digitsHaystack.length;
  if (n > 40) return false;
  const m = token.length;
  for (let span = Math.max(1, m - maxD); span <= m + maxD && span <= n; span++) {
    for (let i = 0; i + span <= n; i++) {
      if (levenshteinWithin(token, digitsHaystack.slice(i, i + span), maxD)) return true;
    }
  }
  return false;
}

type MemberSearchRow = { gm: any; haystack: string; digitsHaystack: string };

function buildMemberSearchRows(deduped: any[], rosterById: Map<string, any>): MemberSearchRow[] {
  const out: MemberSearchRow[] = [];
  for (const gm of deduped) {
    const memberId = gm.member_id as string | null | undefined;
    const roster = memberId ? rosterById.get(memberId) ?? null : null;
    const name = embeddedMemberName(gm);
    const displayName =
      (roster?.fullName as string | undefined)?.trim() ||
      [roster?.first_name, roster?.last_name].filter(Boolean).join(' ').trim() ||
      name;
    const phone = String(roster?.phoneNumber ?? roster?.phone_number ?? roster?.phone ?? '').toLowerCase();
    const address = String(roster?.location ?? roster?.address ?? '').toLowerCase();
    const email = String(roster?.email ?? '').toLowerCase();
    const status = String((roster?.status as string | undefined) || 'active').toLowerCase();
    const joined = roster?.dateJoined ?? roster?.date_joined ?? null;
    const joinedStr = joined ? String(joined).split('T')[0].toLowerCase() : '';
    const emb = gm.members;
    const embEmail =
      emb && typeof emb === 'object' && !Array.isArray(emb)
        ? String((emb as { email?: string | null }).email ?? '').toLowerCase()
        : '';
    const haystack = [displayName, phone, address, email || embEmail, status, joinedStr, memberId ?? '']
      .join(' ')
      .toLowerCase();
    const digitsHaystack = [phone, String(roster?.phone_number ?? ''), String(roster?.phone ?? ''), address]
      .join('')
      .replace(/\D/g, '');
    out.push({ gm, haystack, digitsHaystack });
  }
  return out;
}

function searchRowMatches(row: MemberSearchRow, rawQuery: string): boolean {
  const ql = rawQuery.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!ql) return true;
  const { haystack, digitsHaystack } = row;
  if (haystack.includes(ql)) return true;

  const tokens = ql.split(/\s+/).filter(Boolean);
  return tokens.every((t) => {
    if (/^\d+$/.test(t) && digitsHaystack.length > 0) {
      return digitTokenMatches(t, digitsHaystack) || tokenMatchesHaystack(t, haystack);
    }
    return tokenMatchesHaystack(t, haystack);
  });
}

function groupTypeBadgeClass(t: string | null | undefined) {
  const x = (t || '').toLowerCase();
  if (x.includes('music') || x.includes('worship')) return 'bg-pink-100 text-pink-800 border-pink-200';
  if (x.includes('youth')) return 'bg-violet-100 text-violet-800 border-violet-200';
  if (x.includes('prayer')) return 'bg-rose-50 text-rose-800 border-rose-200';
  return 'bg-indigo-50 text-indigo-800 border-indigo-200';
}

function downloadQrDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

async function shareUrl(url: string, title: string) {
  if (!url) {
    toast.error('No link available yet');
    return;
  }
  try {
    if (navigator.share) {
      await navigator.share({ title, url });
    } else {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied to clipboard');
    }
  } catch (e: any) {
    if (e?.name !== 'AbortError') {
      try {
        await navigator.clipboard.writeText(url);
        toast.success('Link copied');
      } catch {
        toast.error('Could not share link');
      }
    }
  }
}

const MinistryDetail: React.FC = () => {
  const { groupId } = useParams<{ groupId: string }>();
  const { token } = useAuth();

  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [groupMembers, setGroupMembers] = useState<any[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [errorMembers, setErrorMembers] = useState<string | null>(null);

  const [subgroups, setSubgroups] = useState<Group[]>([]);
  const [loadingSubgroups, setLoadingSubgroups] = useState(true);
  const [errorSubgroups, setErrorSubgroups] = useState<string | null>(null);

  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [requestActionBusyId, setRequestActionBusyId] = useState<string | null>(null);
  const [joinLinkModalOpen, setJoinLinkModalOpen] = useState(false);

  const [isAddMembersModalOpen, setIsAddMembersModalOpen] = useState(false);
  const [availableMembers, setAvailableMembers] = useState<any[]>([]);
  const [loadingAvailableMembers, setLoadingAvailableMembers] = useState(true);

  const [isManageSubgroupModalOpen, setIsManageSubgroupModalOpen] = useState(false);
  const [editingSubgroup, setEditingSubgroup] = useState<Group | null>(null);

  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [qrPublic, setQrPublic] = useState('');
  const [qrJoin, setQrJoin] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [viewingMemberDetail, setViewingMemberDetail] = useState<Member | null>(null);
  const [removeFromGroupConfirmOpen, setRemoveFromGroupConfirmOpen] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');

  const publicSectionRef = React.useRef<HTMLDivElement>(null);
  const joinSectionRef = React.useRef<HTMLDivElement>(null);
  const selectAllMembersRef = React.useRef<HTMLInputElement>(null);

  const fetchGroupDetails = useCallback(async () => {
    if (!groupId || !token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/groups/${groupId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch group details');
      }
      const data = await response.json();
      setGroup(data);
    } catch (err: any) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [groupId, token]);

  const fetchGroupMembers = useCallback(async () => {
    if (!groupId || !token) return;
    setLoadingMembers(true);
    setErrorMembers(null);
    try {
      const response = await fetch(`/api/group-members?group_id=${encodeURIComponent(groupId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch group members');
      }
      const data = await response.json();
      setGroupMembers(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setErrorMembers(err.message);
      toast.error(err.message);
    } finally {
      setLoadingMembers(false);
    }
  }, [groupId, token]);

  const fetchSubgroups = useCallback(async () => {
    if (!groupId || !token) return;
    setLoadingSubgroups(true);
    setErrorSubgroups(null);
    try {
      const response = await fetch(`/api/groups?parent_group_id=${encodeURIComponent(groupId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch subgroups');
      }
      const data = await response.json();
      setSubgroups(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setErrorSubgroups(err.message);
      toast.error(err.message);
    } finally {
      setLoadingSubgroups(false);
    }
  }, [groupId, token]);

  const fetchPendingRequests = useCallback(async () => {
    if (!groupId || !token) return;
    setLoadingRequests(true);
    try {
      const params = new URLSearchParams({ status: 'pending', group_id: groupId });
      const res = await fetch(`/api/group-requests?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPendingRequests([]);
        toast.error((data as { error?: string }).error || 'Could not load join requests');
        return;
      }
      setPendingRequests(Array.isArray(data) ? data : []);
    } catch {
      setPendingRequests([]);
      toast.error('Could not load join requests');
    } finally {
      setLoadingRequests(false);
    }
  }, [groupId, token]);

  const handleApproveJoinRequest = async (requestId: string) => {
    if (!token) return;
    setRequestActionBusyId(requestId);
    try {
      const res = await fetch(`/api/group-requests/${encodeURIComponent(requestId)}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error || 'Could not approve request');
      }
      toast.success('Approved. They are now in this group (and parent ministries as needed).');
      await fetchPendingRequests();
      await fetchGroupMembers();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setRequestActionBusyId(null);
    }
  };

  const handleDeclineJoinRequest = async (requestId: string) => {
    if (!token) return;
    if (!window.confirm('Decline this join request?')) return;
    setRequestActionBusyId(requestId);
    try {
      const res = await fetch(`/api/group-requests/${encodeURIComponent(requestId)}/reject`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error || 'Could not decline request');
      }
      toast.success('Request declined.');
      await fetchPendingRequests();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Decline failed');
    } finally {
      setRequestActionBusyId(null);
    }
  };

  const handleIgnoreJoinRequest = async (requestId: string) => {
    if (!token) return;
    if (
      !window.confirm(
        'Ignore this request? It leaves the pending list without adding them to the group (soft-dismiss).'
      )
    )
      return;
    setRequestActionBusyId(requestId);
    try {
      const res = await fetch(`/api/group-requests/${encodeURIComponent(requestId)}/ignore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error || 'Could not ignore request');
      }
      toast.success('Request ignored.');
      await fetchPendingRequests();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Ignore failed');
    } finally {
      setRequestActionBusyId(null);
    }
  };

  const fetchAvailableMembers = useCallback(async () => {
    if (!token) return;
    setLoadingAvailableMembers(true);
    try {
      const response = await fetch(`/api/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch available members');
      }
      const data = await response.json();
      setAvailableMembers(Array.isArray(data) ? data : []);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoadingAvailableMembers(false);
    }
  }, [token]);

  const dedupedGroupMembers = useMemo(() => {
    const seen = new Set<string>();
    const out: any[] = [];
    for (const gm of groupMembers) {
      const mid = gm.member_id as string | null | undefined;
      if (!mid) {
        out.push(gm);
        continue;
      }
      if (seen.has(mid)) continue;
      seen.add(mid);
      out.push(gm);
    }
    return out;
  }, [groupMembers]);

  const removeFromGroupConfirmMessage = useMemo(() => {
    const groupLabel = group?.name ?? 'this group';
    const names = selectedMemberIds
      .map((id) => {
        const row = dedupedGroupMembers.find((g) => g.member_id === id);
        return row ? embeddedMemberName(row) : null;
      })
      .filter((x): x is string => Boolean(x));
    const namesLine =
      names.length <= 3
        ? names.join(', ')
        : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;

    if (selectedMemberIds.length === 1) {
      const who = namesLine || 'this member';
      return `You're about to remove ${who} from "${groupLabel}".\n\nTheir profile stays in your member directory, and other group memberships are not changed. Only the link to this group is removed.\n\nThis does not delete the person from your church.`;
    }
    return `You're about to remove ${selectedMemberIds.length} people from "${groupLabel}".\n\nThey remain in your member list; you're only removing their link to this group.\n\nThis is not the same as deleting a member from the church.`;
  }, [selectedMemberIds, dedupedGroupMembers, group?.name]);

  const performRemoveSelectedFromGroup = async () => {
    if (selectedMemberIds.length === 0 || !token || !groupId) return;
    const n = selectedMemberIds.length;
    const ids = [...selectedMemberIds];
    try {
      for (const memberId of ids) {
        const response = await fetch(
          `/api/group-members?group_id=${encodeURIComponent(groupId)}&member_id=${encodeURIComponent(memberId)}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
        );
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to remove member from group');
        }
      }
      toast.success(
        n === 1 ? 'Member removed from this group' : `${n} members removed from this group`
      );
      setSelectedMemberIds([]);
      fetchGroupMembers();
      fetchGroupDetails();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleEditSubgroup = (subgroup: Group) => {
    setEditingSubgroup(subgroup);
    setIsManageSubgroupModalOpen(true);
  };

  const handleDeleteSubgroup = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this subgroup?')) return;
    if (!token) {
      toast.error('Authentication required.');
      return;
    }
    try {
      const response = await fetch(`/api/groups/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error((errBody as { error?: string }).error || 'Failed to delete subgroup');
      }
      toast.success('Subgroup deleted');
      fetchSubgroups();
      fetchGroupDetails();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete subgroup');
    }
  };

  const handleCreateSubgroupClick = () => {
    setEditingSubgroup(null);
    setIsManageSubgroupModalOpen(true);
  };

  const handleSavePublicWebsiteSettings = async () => {
    if (!token || !groupId || !group) return;
    try {
      const response = await fetch(`/api/groups/${groupId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          public_website_enabled: group.public_website_enabled,
          public_link_slug: group.public_link_slug,
          cover_image_url: group.cover_image_url,
          announcements_content: group.announcements_content,
          program_outline_content: group.program_outline_content,
          contact_email: group.contact_email,
          contact_phone: group.contact_phone,
          join_link_enabled: group.join_link_enabled,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to save settings');
      }
      toast.success('Settings saved');
      fetchGroupDetails();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const updateJoinLink = async (enabled: boolean) => {
    if (!token || !groupId || !group) return;
    setGroup((prev) => (prev ? { ...prev, join_link_enabled: enabled } : null));
    try {
      const response = await fetch(`/api/groups/${groupId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ join_link_enabled: enabled }),
      });
      if (!response.ok) throw new Error('Failed to update join link');
      toast.success(enabled ? 'Join link enabled' : 'Join link disabled');
      fetchGroupDetails();
    } catch (err: any) {
      toast.error(err.message);
      setGroup((prev) => (prev ? { ...prev, join_link_enabled: !enabled } : null));
    }
  };

  useEffect(() => {
    if (!groupId || !token) {
      setLoading(false);
      setLoadingMembers(false);
      setLoadingSubgroups(false);
      return;
    }

    fetchGroupDetails();
    fetchGroupMembers();
    fetchSubgroups();
    fetchAvailableMembers();
    fetchPendingRequests();
  }, [
    groupId,
    token,
    fetchGroupDetails,
    fetchGroupMembers,
    fetchSubgroups,
    fetchAvailableMembers,
    fetchPendingRequests,
  ]);

  const listMemberIds = useMemo(
    () =>
      dedupedGroupMembers
        .map((gm: { member_id?: string | null }) => gm.member_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    [dedupedGroupMembers]
  );

  const rosterById = useMemo(() => {
    const m = new Map<string, any>();
    for (const row of availableMembers as any[]) {
      if (row?.id) m.set(String(row.id), row);
    }
    return m;
  }, [availableMembers]);

  const openMemberDetailFromJoinRequest = (r: { member_id?: string | null }) => {
    const mid = typeof r.member_id === 'string' ? r.member_id : null;
    if (!mid) return;
    const raw = rosterById.get(mid);
    if (raw) {
      setViewingMemberDetail(normalizeMemberForDetailPanel(raw as Record<string, unknown> & { id: string }));
    }
  };

  const memberSearchRows = useMemo(
    () => buildMemberSearchRows(dedupedGroupMembers, rosterById),
    [dedupedGroupMembers, rosterById]
  );

  const memberSearchQl = memberSearchQuery.trim().toLowerCase().replace(/\s+/g, ' ');
  const filteredGroupMembers = useMemo(() => {
    if (!memberSearchQl) return dedupedGroupMembers;
    const q = memberSearchQuery.trim();
    return memberSearchRows.filter((row) => searchRowMatches(row, q)).map((r) => r.gm);
  }, [dedupedGroupMembers, memberSearchQl, memberSearchQuery, memberSearchRows]);

  const filteredListMemberIds = useMemo(
    () =>
      filteredGroupMembers
        .map((gm: { member_id?: string | null }) => gm.member_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    [filteredGroupMembers]
  );

  const allMembersSelected =
    filteredListMemberIds.length > 0 &&
    filteredListMemberIds.every((id) => selectedMemberIds.includes(id));
  const someMembersSelected =
    filteredListMemberIds.some((id) => selectedMemberIds.includes(id)) && !allMembersSelected;

  useEffect(() => {
    if (activeTab !== 'members') {
      setSelectedMemberIds([]);
      setMemberSearchQuery('');
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'requests' && groupId && token) {
      void fetchPendingRequests();
    }
  }, [activeTab, groupId, token, fetchPendingRequests]);

  useEffect(() => {
    setViewingMemberDetail(null);
    setMemberSearchQuery('');
  }, [groupId]);

  useEffect(() => {
    const valid = new Set(listMemberIds);
    setSelectedMemberIds((prev) => {
      const next = prev.filter((id) => valid.has(id));
      if (next.length === prev.length && next.every((id, i) => id === prev[i])) return prev;
      return next;
    });
  }, [listMemberIds]);

  useEffect(() => {
    const el = selectAllMembersRef.current;
    if (el) el.indeterminate = someMembersSelected;
  }, [someMembersSelected]);

  const toggleMemberRowSelection = (memberId: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]
    );
  };

  const toggleSelectAllMembers = () => {
    setSelectedMemberIds((prev) => {
      const visible = filteredListMemberIds;
      if (visible.length === 0) return prev;
      const allVisibleSelected = visible.every((id) => prev.includes(id));
      if (allVisibleSelected) {
        if (memberSearchQl) return prev.filter((id) => !visible.includes(id));
        return [];
      }
      if (memberSearchQl) return [...new Set([...prev, ...visible])];
      return [...listMemberIds];
    });
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const publicPageUrl = useMemo(() => {
    if (!group?.public_website_enabled || !group?.public_link_slug) return '';
    return `${origin}/public/groups/${group.public_link_slug}`;
  }, [group?.public_website_enabled, group?.public_link_slug, origin]);

  const joinPageUrl = useMemo(() => {
    if (!group?.id || !group?.join_link_enabled) return '';
    const slug = (group as { join_invite_token?: string | null }).join_invite_token || group.id;
    return `${origin}/join-group/${slug}`;
  }, [group, origin]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (publicPageUrl) {
        try {
          const u = await QRCode.toDataURL(publicPageUrl, { width: 220, margin: 2 });
          if (!cancelled) setQrPublic(u);
        } catch {
          if (!cancelled) setQrPublic('');
        }
      } else {
        setQrPublic('');
      }
      if (joinPageUrl) {
        try {
          const u = await QRCode.toDataURL(joinPageUrl, { width: 220, margin: 2 });
          if (!cancelled) setQrJoin(u);
        } catch {
          if (!cancelled) setQrJoin('');
        }
      } else {
        setQrJoin('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicPageUrl, joinPageUrl]);

  useEffect(() => {
    if (!joinLinkModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setJoinLinkModalOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [joinLinkModalOpen]);

  const leaderMember = useMemo(() => {
    if (!group?.leader_id) return null;
    return availableMembers.find((m) => m.id === group.leader_id) || null;
  }, [group?.leader_id, availableMembers]);

  const eventsCount = 0;

  if (loading) {
    return (
      <div className="flex flex-col flex-1 p-8 items-center justify-center">
        <p className="text-gray-600 text-sm">Loading ministry…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col flex-1 p-8 items-center justify-center gap-4">
        <p className="text-red-600 text-sm">{error}</p>
        <Link to="/groups" className="text-indigo-600 font-medium text-sm hover:underline">
          Back to groups
        </Link>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="flex flex-col flex-1 p-8 items-center justify-center gap-4">
        <h1 className="text-xl font-semibold text-gray-900">Ministry not found</h1>
        <Link to="/groups" className="text-indigo-600 font-medium text-sm hover:underline">
          Back to groups
        </Link>
      </div>
    );
  }

  const tabs: { id: DetailTab; label: string; count?: number; dot?: boolean }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'members', label: 'Members', count: dedupedGroupMembers.length },
    { id: 'events', label: 'Events', count: eventsCount },
    { id: 'requests', label: 'Requests', count: pendingRequests.length, dot: pendingRequests.length > 0 },
    { id: 'subgroups', label: 'Subgroups', count: subgroups.length },
    { id: 'settings', label: 'Settings' },
  ];

  const renderOverviewQrCards = () => (
    <div ref={publicSectionRef} className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
      <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50/90 to-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-blue-900 font-semibold text-sm uppercase tracking-wide">
          <Globe className="w-4 h-4" />
          Public view link
        </div>
        <p className="mt-2 text-sm text-blue-900/70">
          Share this QR code or link publicly so anyone can view group details and events.
        </p>
        <div className="mt-5 flex flex-col sm:flex-row gap-6 items-center">
          <div className="shrink-0 w-[132px] h-[132px] bg-white rounded-xl border border-blue-100 flex items-center justify-center p-2">
            {qrPublic ? (
              <img src={qrPublic} alt="" className="w-full h-full object-contain" />
            ) : (
              <span className="text-xs text-center text-blue-800/60 px-2">
                Set a public slug under Settings & enable public page
              </span>
            )}
          </div>
          <div className="flex-1 w-full min-w-0">
            <div className="rounded-xl border border-blue-100 bg-white/80 px-3 py-2 text-xs text-gray-700 break-all font-mono">
              {publicPageUrl || '—'}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!qrPublic}
                onClick={() => qrPublic && downloadQrDataUrl(qrPublic, `${group.name}-public-qr.png`)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 shadow-sm"
              >
                <Download className="w-4 h-4" />
                Download
              </button>
              <button
                type="button"
                disabled={!publicPageUrl}
                onClick={() => shareUrl(publicPageUrl, `${group.name} — public page`)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-blue-200 bg-white text-blue-800 hover:bg-blue-50 disabled:opacity-40"
              >
                <Share2 className="w-4 h-4" />
                Share
              </button>
            </div>
          </div>
        </div>
      </div>

      <div ref={joinSectionRef} className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/90 to-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-emerald-900 font-semibold text-sm uppercase tracking-wide">
          <UserCheck className="w-4 h-4" />
          Member join link
        </div>
        <p className="mt-2 text-sm text-emerald-900/70">
          Each group (including subgroups) has its own link. Public (no login): directory members confirm name
          and date of birth. When you approve, they are added to this group and all parent ministries.
        </p>
        <div className="mt-5 flex flex-col sm:flex-row gap-6 items-center">
          <div className="shrink-0 w-[132px] h-[132px] bg-white rounded-xl border border-emerald-100 flex items-center justify-center p-2">
            {qrJoin ? (
              <img src={qrJoin} alt="" className="w-full h-full object-contain" />
            ) : (
              <span className="text-xs text-center text-emerald-800/60 px-2">
                Enable join link under Settings
              </span>
            )}
          </div>
          <div className="flex-1 w-full min-w-0">
            <div className="rounded-xl border border-emerald-100 bg-white/80 px-3 py-2 text-xs text-gray-700 break-all font-mono">
              {joinPageUrl || '—'}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!qrJoin}
                onClick={() => qrJoin && downloadQrDataUrl(qrJoin, `${group.name}-join-qr.png`)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 shadow-sm"
              >
                <Download className="w-4 h-4" />
                Download
              </button>
              <button
                type="button"
                disabled={!joinPageUrl}
                onClick={() => shareUrl(joinPageUrl, `${group.name} — join`)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50 disabled:opacity-40"
              >
                <Share2 className="w-4 h-4" />
                Share
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderLeaderCard = () => (
    <div className="mb-10">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Group leader</p>
      <div className="rounded-2xl border border-violet-100 bg-gradient-to-r from-violet-50/80 to-purple-50/50 p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="shrink-0">
            {leaderMember?.memberimage_url || leaderMember?.member_url ? (
              <img
                src={leaderMember.memberimage_url || leaderMember.member_url}
                alt=""
                className="w-16 h-16 rounded-full object-cover border-4 border-white shadow"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-violet-200 text-violet-800 flex items-center justify-center text-lg font-bold border-4 border-white shadow">
                {(group.profiles?.first_name?.[0] || 'L').toUpperCase()}
                {(group.profiles?.last_name?.[0] || '').toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-gray-900">
                  {leaderMember
                    ? `${leaderMember.first_name || ''} ${leaderMember.last_name || ''}`.trim()
                    : group.profiles
                      ? `${group.profiles.first_name || ''} ${group.profiles.last_name || ''}`.trim()
                      : 'No leader assigned'}
                </p>
                <div className="mt-2 flex flex-col gap-1 text-sm text-gray-600">
                  {(leaderMember?.email || group.contact_email) && (
                    <span className="inline-flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-gray-400" />
                      {leaderMember?.email || group.contact_email}
                    </span>
                  )}
                  {(leaderMember?.phone || leaderMember?.phone_number) && (
                    <span className="inline-flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-gray-400" />
                      {leaderMember?.phone || leaderMember?.phone_number}
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-violet-100 text-violet-800 text-xs font-semibold border border-violet-200/80">
                <Crown className="w-3.5 h-3.5" />
                Leader
              </div>
            </div>
            <div className="mt-4 max-w-md">
              <label className="block text-xs font-medium text-gray-500 mb-1">Change leader</label>
              <select
                value={group.leader_id || ''}
                disabled={loadingAvailableMembers}
                onChange={async (e) => {
                  const newLeaderId = e.target.value === '' ? null : e.target.value;
                  if (!token || !groupId || !group) return;
                  try {
                    const response = await fetch(`/api/groups/${groupId}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ leader_id: newLeaderId }),
                    });
                    if (!response.ok) {
                      const errorData = await response.json().catch(() => ({}));
                      throw new Error(errorData.error || 'Failed to update leader');
                    }
                    toast.success('Leader updated');
                    fetchGroupDetails();
                  } catch (err: any) {
                    toast.error(err.message);
                  }
                }}
                className="w-full rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              >
                <option value="">No leader</option>
                {availableMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.first_name} {member.last_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderSubgroupGrid = () => (
    <div className="mb-10">
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Subgroups ({subgroups.length})
        </p>
        <button
          type="button"
          onClick={handleCreateSubgroupClick}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
        >
          + Create subgroup
        </button>
      </div>
      {loadingSubgroups ? (
        <p className="text-sm text-gray-500 py-8">Loading subgroups…</p>
      ) : errorSubgroups ? (
        <p className="text-sm text-red-600">{errorSubgroups}</p>
      ) : subgroups.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50 py-12 text-center text-sm text-gray-500">
          No subgroups yet. Create one to mirror your main ministry cards.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {subgroups.map((sg) => (
            <MinistryCard
              key={sg.id}
              ministry={sg}
              onEdit={handleEditSubgroup}
              onDelete={handleDeleteSubgroup}
            />
          ))}
        </div>
      )}
    </div>
  );

  const renderQuickStats = () => (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Quick stats</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Members', value: dedupedGroupMembers.length, icon: Users },
          { label: 'Events', value: eventsCount, icon: Calendar },
          { label: 'Subgroups', value: subgroups.length, icon: GitBranch },
          { label: 'Pending requests', value: pendingRequests.length, icon: Inbox, accent: pendingRequests.length > 0 },
        ].map(({ label, value, icon: Icon, accent }) => (
          <div
            key={label}
            className={`rounded-2xl border p-4 shadow-sm ${
              accent ? 'border-amber-100 bg-amber-50/50' : 'border-gray-100 bg-white'
            }`}
          >
            <Icon className={`w-4 h-4 ${accent ? 'text-amber-600' : 'text-indigo-500'}`} />
            <p className={`mt-2 text-2xl font-bold ${accent ? 'text-amber-800' : 'text-gray-900'}`}>{value}</p>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mt-0.5">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col flex-1 bg-gray-50/80 min-h-0">
      <div className="max-w-6xl mx-auto w-full px-4 md:px-8 py-8">
        <nav className="mb-6" aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
            <li className="inline-flex items-center gap-1">
              <Link
                to="/groups"
                className="inline-flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 font-medium"
              >
                <ArrowLeft className="w-4 h-4 shrink-0" />
                Ministries
              </Link>
            </li>
            {(group.breadcrumb ?? []).map((crumb) => (
              <li key={crumb.id} className="inline-flex items-center gap-1 min-w-0">
                <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" aria-hidden />
                <Link
                  to={`/groups/${crumb.id}`}
                  className="text-indigo-600 hover:text-indigo-800 font-medium truncate max-w-[220px] md:max-w-xs"
                  title={crumb.name}
                >
                  {crumb.name}
                </Link>
              </li>
            ))}
            <li className="inline-flex items-center gap-1 min-w-0">
              <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" aria-hidden />
              <span
                className="font-semibold text-gray-900 truncate max-w-[240px] md:max-w-sm"
                title={group.name}
                aria-current="page"
              >
                {group.name}
              </span>
            </li>
          </ol>
        </nav>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 md:p-8 mb-6">
          <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-6">
            <div className="flex gap-4 min-w-0">
              <div className="shrink-0 w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-lg">
                <UserCircle2 className="w-8 h-8" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{group.name}</h1>
                  <span
                    className={`text-xs font-semibold px-2.5 py-0.5 rounded-lg border ${groupTypeBadgeClass(group.group_type)}`}
                  >
                    {group.group_type || 'ministry'}
                  </span>
                </div>
                {group.description && (
                  <p className="mt-2 text-gray-600 text-sm md:text-base max-w-3xl">{group.description}</p>
                )}
                <div className="flex flex-wrap gap-x-6 gap-y-2 mt-5 text-sm text-gray-600">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-indigo-500" />
                    <strong className="text-gray-900">{dedupedGroupMembers.length}</strong> members
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-indigo-500" />
                    <strong className="text-gray-900">{eventsCount}</strong> events
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <GitBranch className="w-4 h-4 text-indigo-500" />
                    <strong className="text-gray-900">{subgroups.length}</strong> subgroups
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 ${
                      pendingRequests.length > 0 ? 'text-amber-700 font-medium' : ''
                    }`}
                  >
                    <Inbox className="w-4 h-4" />
                    <strong className={pendingRequests.length > 0 ? 'text-amber-800' : 'text-gray-900'}>
                      {pendingRequests.length}
                    </strong>{' '}
                    pending requests
                  </span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <button
                type="button"
                onClick={() => publicSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="px-4 py-2.5 rounded-xl text-sm font-medium border border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
              >
                Public QR
              </button>
              <button
                type="button"
                onClick={() => setJoinLinkModalOpen(true)}
                className="px-4 py-2.5 rounded-xl text-sm font-medium border border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
              >
                Join QR
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('members');
                  toast.info('Tip: open Messages from the sidebar to email your congregation.');
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm"
              >
                <Send className="w-4 h-4" />
                Message all members
              </button>
            </div>
          </div>

          <div className="mt-8 border-b border-gray-100">
            <nav className="flex gap-1 overflow-x-auto pb-px -mb-px scrollbar-thin">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={`relative shrink-0 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                    activeTab === t.id
                      ? 'text-indigo-600'
                      : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {t.label}
                  {t.count !== undefined && (
                    <span className="ml-1.5 text-xs opacity-80">({t.count})</span>
                  )}
                  {t.dot && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-red-500 align-middle" />}
                  {activeTab === t.id && (
                    <span className="absolute left-3 right-3 bottom-0 h-0.5 rounded-full bg-indigo-600" />
                  )}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {activeTab === 'overview' && (
          <div>
            {renderOverviewQrCards()}
            {renderLeaderCard()}
            {renderSubgroupGrid()}
            {renderQuickStats()}
          </div>
        )}

        {activeTab === 'members' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 md:p-8">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:gap-3">
                <h2 className="shrink-0 text-lg font-semibold text-gray-900">Members</h2>
                <label className="relative block min-w-0 w-full sm:flex-1 sm:max-w-md">
                  <span className="sr-only">Search members</span>
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                    aria-hidden
                  />
                  <input
                    type="search"
                    value={memberSearchQuery}
                    onChange={(e) => setMemberSearchQuery(e.target.value)}
                    placeholder="Search (typos OK) — name, phone, email…"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50/80 py-2.5 pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-500 focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    autoComplete="off"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => setIsAddMembersModalOpen(true)}
                className="shrink-0 self-start px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm md:self-center"
              >
                Add members
              </button>
            </div>

            {selectedMemberIds.length > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 px-4 py-3 rounded-xl bg-gray-100 border border-gray-200/80">
                <p className="text-sm font-medium text-gray-800">
                  {selectedMemberIds.length} selected
                </p>
                <button
                  type="button"
                  onClick={() => setRemoveFromGroupConfirmOpen(true)}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-amber-900 bg-white border border-amber-200 hover:bg-amber-50 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Remove from group
                </button>
              </div>
            )}

            {loadingMembers ? (
              <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>
            ) : errorMembers ? (
              <p className="text-sm text-red-600 py-4">{errorMembers}</p>
            ) : dedupedGroupMembers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 py-12 text-center text-sm text-gray-500">
                No members in this group yet.
              </div>
            ) : filteredGroupMembers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 py-12 text-center text-sm text-gray-500">
                No members match “{memberSearchQuery.trim()}”. Try a different search.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/90">
                      <th className="w-12 pl-4 pr-2 py-4 align-middle">
                        <input
                          ref={selectAllMembersRef}
                          type="checkbox"
                          checked={allMembersSelected}
                          onChange={toggleSelectAllMembers}
                          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          aria-label={
                            memberSearchQl
                              ? 'Select all members matching search'
                              : 'Select all members'
                          }
                        />
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-4">
                        Member
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-4">
                        Phone
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-4">
                        Address
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-4">
                        Joined
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-4">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredGroupMembers.map((gm) => {
                      const memberId = gm.member_id as string | null | undefined;
                      const roster = memberId
                        ? (availableMembers as any[]).find((m) => m.id === memberId)
                        : null;
                      const name = embeddedMemberName(gm);
                      const displayName =
                        (roster?.fullName as string | undefined)?.trim() ||
                        [roster?.first_name, roster?.last_name].filter(Boolean).join(' ').trim() ||
                        name;
                      const photo =
                        roster?.profileImage || roster?.memberimage_url || embeddedMemberPhoto(gm);
                      const phone =
                        roster?.phoneNumber ?? roster?.phone_number ?? roster?.phone ?? null;
                      const address = roster?.location ?? roster?.address ?? null;
                      const joined =
                        roster?.dateJoined ?? roster?.date_joined ?? null;
                      const statusRaw = (roster?.status as string | undefined) || 'active';
                      const selected = Boolean(memberId && selectedMemberIds.includes(memberId));

                      const openPanel = () => {
                        const m = memberFromGroupRow(gm, availableMembers as Record<string, unknown>[]);
                        if (m) setViewingMemberDetail(m);
                      };

                      return (
                        <tr
                          key={gm.id}
                          tabIndex={0}
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest('[data-group-member-select]')) return;
                            openPanel();
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              if ((e.target as HTMLElement).closest('[data-group-member-select]')) return;
                              e.preventDefault();
                              openPanel();
                            }
                          }}
                          className={`border-b border-gray-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 cursor-pointer ${
                            selected ? 'bg-indigo-50' : 'hover:bg-gray-50'
                          }`}
                        >
                          <td
                            data-group-member-select
                            className="pl-4 pr-2 py-4 align-middle"
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => memberId && toggleMemberRowSelection(memberId)}
                              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                              aria-label={`Select ${displayName}`}
                              disabled={!memberId}
                            />
                          </td>
                          <td className="px-6 py-4 align-middle">
                            <div className="flex items-center space-x-3 min-w-0 max-w-xs">
                              <MemberRowAvatar name={displayName} imageUrl={photo ?? null} />
                              <span className="font-medium text-gray-900 truncate text-[14px]">
                                {displayName}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 align-middle">
                            <span className="text-gray-900 text-[14px]">{phone || 'N/A'}</span>
                          </td>
                          <td className="px-6 py-4 align-middle">
                            <span className="text-gray-600 text-[14px]">{address || 'N/A'}</span>
                          </td>
                          <td className="px-6 py-4 align-middle">
                            <span className="text-gray-600 text-[14px]">
                              {joined ? String(joined).split('T')[0] : 'N/A'}
                            </span>
                          </td>
                          <td className="px-6 py-4 align-middle">
                            <span
                              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${
                                statusRaw === 'active'
                                  ? 'bg-green-50 text-green-700 border-green-200'
                                  : 'bg-gray-50 text-gray-700 border-gray-200'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                                  statusRaw === 'active' ? 'bg-green-500' : 'bg-gray-400'
                                }`}
                              />
                              {statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'events' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center text-gray-500 text-sm">
            <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            No events linked to this group yet.
          </div>
        )}

        {activeTab === 'requests' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 md:p-8">
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Join requests</h2>
                <p className="mt-1 text-sm text-gray-500 max-w-2xl">
                  People who asked to join via your group link. Approve adds them to this group; decline or ignore
                  removes them from this list.
                </p>
              </div>
            </div>

            {loadingRequests ? (
              <p className="text-sm text-gray-500 py-8 text-center">Loading requests…</p>
            ) : pendingRequests.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 py-12 text-center text-sm text-gray-500">
                No pending join requests for this group.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/90">
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-4">
                        Requester
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-4">
                        Date of birth
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-4">
                        Source
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-4">
                        Requested
                      </th>
                      <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-4">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingRequests.map((r: any) => {
                      const name = joinRequestDisplayName(r);
                      const verified = Boolean(r.member_id);
                      const mid = typeof r.member_id === 'string' ? r.member_id : null;
                      const roster = mid ? rosterById.get(mid) : null;
                      const photo =
                        roster?.profileImage ||
                        roster?.memberimage_url ||
                        roster?.member_url ||
                        null;
                      const dobRaw = r.dob ?? r.date_of_birth;
                      const dobLabel =
                        dobRaw && String(dobRaw).trim()
                          ? new Date(dobRaw as string).toLocaleDateString()
                          : '—';
                      const reqAt = r.requested_at || r.created_at;
                      const reqLabel = reqAt
                        ? new Date(reqAt as string).toLocaleString(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })
                        : '—';
                      const busy = requestActionBusyId === r.id;
                      const canOpenRoster = verified && mid && roster;

                      return (
                        <tr
                          key={r.id}
                          tabIndex={canOpenRoster ? 0 : undefined}
                          onClick={() => {
                            if (canOpenRoster) openMemberDetailFromJoinRequest(r);
                          }}
                          onKeyDown={(e) => {
                            if (!canOpenRoster) return;
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openMemberDetailFromJoinRequest(r);
                            }
                          }}
                          className={`border-b border-gray-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
                            canOpenRoster ? 'cursor-pointer hover:bg-gray-50' : ''
                          }`}
                        >
                          <td className="px-6 py-4 align-middle">
                            <div className="flex items-center gap-3 min-w-0 max-w-xs">
                              <MemberRowAvatar name={name} imageUrl={photo ?? null} />
                              <div className="min-w-0">
                                <span className="font-medium text-gray-900 truncate text-[14px] block">
                                  {name}
                                </span>
                                {r.email ? (
                                  <span className="text-xs text-gray-500 truncate block">{r.email}</span>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 align-middle">
                            <span className="text-gray-900 text-[14px]">{dobLabel}</span>
                          </td>
                          <td className="px-6 py-4 align-middle">
                            {verified ? (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border bg-emerald-50 text-emerald-800 border-emerald-200">
                                Directory match
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border bg-amber-50 text-amber-800 border-amber-200">
                                Guest application
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 align-middle">
                            <span className="text-gray-600 text-[14px]">{reqLabel}</span>
                          </td>
                          <td
                            className="px-6 py-4 align-middle text-right"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleApproveJoinRequest(r.id)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 shadow-sm"
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                                Approve
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleIgnoreJoinRequest(r.id)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                              >
                                <Ban className="w-3.5 h-3.5" />
                                Ignore
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleDeclineJoinRequest(r.id)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 shadow-sm"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                Decline
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'subgroups' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 md:p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">Subgroups</h2>
              <button
                type="button"
                onClick={handleCreateSubgroupClick}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
              >
                Create subgroup
              </button>
            </div>
            {loadingSubgroups ? (
              <p className="text-sm text-gray-500 py-8 text-center">Loading subgroups…</p>
            ) : errorSubgroups ? (
              <p className="text-sm text-red-600 py-4">{errorSubgroups}</p>
            ) : subgroups.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50 py-12 text-center text-sm text-gray-500">
                No subgroups yet. Use “Create subgroup” to add one.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {subgroups.map((subgroup) => (
                  <MinistryCard
                    key={subgroup.id}
                    ministry={subgroup}
                    onEdit={handleEditSubgroup}
                    onDelete={handleDeleteSubgroup}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 md:p-8">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Public page</h2>
              <label className="flex items-center justify-between gap-4 mb-4">
                <span className="text-sm font-medium text-gray-800">Enable public website</span>
                <input
                  type="checkbox"
                  checked={group.public_website_enabled || false}
                  onChange={(e) =>
                    setGroup((prev) => (prev ? { ...prev, public_website_enabled: e.target.checked } : null))
                  }
                  className="h-5 w-5 rounded border-gray-300 text-indigo-600"
                />
              </label>
              {group.public_website_enabled && (
                <div className="space-y-3 p-4 rounded-xl bg-gray-50 border border-gray-100 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Public slug</label>
                    <input
                      type="text"
                      value={group.public_link_slug || ''}
                      onChange={(e) =>
                        setGroup((prev) => (prev ? { ...prev, public_link_slug: e.target.value } : null))
                      }
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                      placeholder="youth-ministry"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Cover image URL</label>
                    <input
                      type="text"
                      value={group.cover_image_url || ''}
                      onChange={(e) =>
                        setGroup((prev) => (prev ? { ...prev, cover_image_url: e.target.value } : null))
                      }
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Announcements</label>
                    <textarea
                      value={group.announcements_content || ''}
                      onChange={(e) =>
                        setGroup((prev) => (prev ? { ...prev, announcements_content: e.target.value } : null))
                      }
                      rows={3}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Program outline</label>
                    <textarea
                      value={group.program_outline_content || ''}
                      onChange={(e) =>
                        setGroup((prev) => (prev ? { ...prev, program_outline_content: e.target.value } : null))
                      }
                      rows={3}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Contact email</label>
                      <input
                        type="email"
                        value={group.contact_email || ''}
                        onChange={(e) =>
                          setGroup((prev) => (prev ? { ...prev, contact_email: e.target.value } : null))
                        }
                        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Contact phone</label>
                      <input
                        type="text"
                        value={group.contact_phone || ''}
                        onChange={(e) =>
                          setGroup((prev) => (prev ? { ...prev, contact_phone: e.target.value } : null))
                        }
                        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                </div>
              )}
              <label className="flex items-center justify-between gap-4 mb-4">
                <span className="text-sm font-medium text-gray-800">Allow public join requests</span>
                <input
                  type="checkbox"
                  checked={group.join_link_enabled || false}
                  onChange={(e) => updateJoinLink(e.target.checked)}
                  className="h-5 w-5 rounded border-gray-300 text-indigo-600"
                />
              </label>
              <button
                type="button"
                onClick={handleSavePublicWebsiteSettings}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700"
              >
                Save settings
              </button>
            </div>
          </div>
        )}
      </div>

      {joinLinkModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/45 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => setJoinLinkModalOpen(false)}
          aria-hidden="true"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="join-link-modal-title"
            className="w-full max-w-md rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/95 via-white to-white p-6 shadow-2xl shadow-emerald-900/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-emerald-900 font-semibold text-sm uppercase tracking-wide">
                  <UserCheck className="w-4 h-4 shrink-0" aria-hidden />
                  <span id="join-link-modal-title">Member join link</span>
                </div>
                <p className="mt-2 text-sm text-emerald-900/75 leading-relaxed">
                  Share this QR or link so directory members can request to join{' '}
                  <span className="font-medium text-emerald-950">{group.name}</span>. They confirm first name, last
                  name, and date of birth; you approve under Requests.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setJoinLinkModalOpen(false)}
                className="shrink-0 rounded-xl p-2 text-emerald-800/80 hover:bg-emerald-100/80 hover:text-emerald-950 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-5 flex flex-col sm:flex-row gap-6 items-center">
              <div className="shrink-0 w-[140px] h-[140px] bg-white rounded-xl border border-emerald-100 flex items-center justify-center p-2 shadow-sm">
                {qrJoin ? (
                  <img src={qrJoin} alt="" className="w-full h-full object-contain" />
                ) : (
                  <span className="text-xs text-center text-emerald-800/60 px-2 leading-snug">
                    Enable &quot;Allow public join requests&quot; under Settings to generate a QR code.
                  </span>
                )}
              </div>
              <div className="flex-1 w-full min-w-0">
                <p className="text-[11px] font-medium text-emerald-900/60 uppercase tracking-wide mb-1.5">
                  Link
                </p>
                <div className="rounded-xl border border-emerald-100 bg-white/90 px-3 py-2.5 text-xs text-gray-800 break-all font-mono leading-relaxed">
                  {joinPageUrl || '—'}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!qrJoin}
                    onClick={() => qrJoin && downloadQrDataUrl(qrJoin, `${group.name}-join-qr.png`)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 shadow-sm"
                  >
                    <Download className="w-4 h-4" />
                    Download QR
                  </button>
                  <button
                    type="button"
                    disabled={!joinPageUrl}
                    onClick={() => joinPageUrl && shareUrl(joinPageUrl, `${group.name} — join`)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-emerald-200 bg-white text-emerald-900 hover:bg-emerald-50 disabled:opacity-40"
                  >
                    <Share2 className="w-4 h-4" />
                    Share link
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setJoinLinkModalOpen(false);
                    joinSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    if (activeTab !== 'overview') setActiveTab('overview');
                  }}
                  className="mt-4 w-full sm:w-auto text-sm font-medium text-emerald-800 hover:text-emerald-950 underline-offset-2 hover:underline"
                >
                  View full details on Overview
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AddMembersModal
        isOpen={isAddMembersModalOpen}
        onClose={() => setIsAddMembersModalOpen(false)}
        groupId={groupId!}
        existingMemberIds={dedupedGroupMembers
          .map((gm) => gm.member_id as string | null | undefined)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)}
        onMembersAdded={() => {
          fetchGroupMembers();
          fetchGroupDetails();
          fetchPendingRequests();
          fetchAvailableMembers();
        }}
      />

      <MemberDetailPanel
        isOpen={!!viewingMemberDetail}
        onClose={() => setViewingMemberDetail(null)}
        member={viewingMemberDetail as any}
        familyGroups={[]}
        allMembers={availableMembers as any}
        onEdit={(updated) => {
          setAvailableMembers((prev) => {
            const u = updated as Member;
            if (prev.some((x) => x.id === u.id)) {
              return prev.map((x) => (x.id === u.id ? { ...x, ...u } : x));
            }
            return [...prev, u as any];
          });
          setViewingMemberDetail(normalizeMemberForDetailPanel(updated as Record<string, unknown> & { id: string }));
          fetchGroupMembers();
          fetchAvailableMembers();
        }}
      />

      <DeleteModal
        isOpen={removeFromGroupConfirmOpen}
        onClose={() => setRemoveFromGroupConfirmOpen(false)}
        onConfirm={() => void performRemoveSelectedFromGroup()}
        title={
          selectedMemberIds.length === 1
            ? 'Remove from this group?'
            : `Remove ${selectedMemberIds.length} people from this group?`
        }
        message={removeFromGroupConfirmMessage}
        confirmLabel="Remove from group"
        variant="caution"
      />

      <ManageSubgroupModal
        isOpen={isManageSubgroupModalOpen}
        onClose={() => {
          setIsManageSubgroupModalOpen(false);
          setEditingSubgroup(null);
        }}
        parentGroupId={groupId!}
        editingSubgroup={editingSubgroup}
        onSubgroupManaged={() => {
          fetchSubgroups();
          setEditingSubgroup(null);
        }}
      />
    </div>
  );
};

export default MinistryDetail;
