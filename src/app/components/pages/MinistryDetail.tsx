import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { compressImageForUpload, PUBLIC_BANNER_IMAGE_OPTIONS } from '../../utils/compressImageForUpload';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router';
import QRCode from 'qrcode';
import { Group, Member } from '@/types';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch } from '../../contexts/BranchContext';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import { toast } from 'sonner';
import AddMembersModal from '../modals/AddMembersModal';
import ManageSubgroupModal from '../modals/ManageSubgroupModal';
import MemberDetailPanel from '../panels/MemberDetailPanel';
import DeleteModal from '../modals/DeleteModal';
import MinistryCard from '../cards/MinistryCard';
import CustomFieldsSection from '../CustomFieldsSection';
import PhoneCountryInput from '../PhoneCountryInput';
import GroupTasksSection from '../groups/GroupTasksSection';
import BulkSmsComposeModal from '../modals/BulkSmsComposeModal';
import { useCustomFieldDefinitions } from '../../hooks/useCustomFieldDefinitions';
import { e164ToCountryAndNational } from '@/lib/phoneE164';
import { displayTitleWords } from '@/utils/displayText';
import {
  formatLongWeekdayDate,
  formatLongWeekdayDateTime,
  formatCalendarCountdown,
  formatCompactWeekdayDate,
} from '@/utils/dateDisplayFormat';
import {
  Trash2,
  ArrowLeft,
  Users,
  Mail,
  ChevronRight,
  Globe,
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
  Loader2,
  Upload,
  Copy,
  ExternalLink,
} from 'lucide-react';

type DetailTab = 'overview' | 'members' | 'events' | 'requests' | 'tasks' | 'subgroups' | 'settings';

type ResolvedGroupLeader =
  | { kind: 'member'; member: Member }
  | { kind: 'staff'; profile: NonNullable<Group['profiles']> };

function leaderSummaryFromResolved(resolved: ResolvedGroupLeader | null): {
  title: string;
  photo: string | null;
  initialsSeed: string;
} {
  if (!resolved) {
    return { title: '', photo: null, initialsSeed: 'Leader' };
  }
  if (resolved.kind === 'member') {
    const raw = `${resolved.member.first_name || ''} ${resolved.member.last_name || ''}`.trim();
    const m = resolved.member;
    const photo =
      (m as Member & { memberimage_url?: string | null }).memberimage_url ||
      m.member_url ||
      m.avatar_url ||
      m.profileImage ||
      null;
    return {
      title: raw ? displayTitleWords(raw) : 'Leader',
      photo,
      initialsSeed: raw || 'Leader',
    };
  }
  const raw = `${resolved.profile.first_name || ''} ${resolved.profile.last_name || ''}`.trim();
  return {
    title: raw ? displayTitleWords(raw) : 'Leader',
    photo: resolved.profile.avatar_url || null,
    initialsSeed: raw || 'Leader',
  };
}

const DEFAULT_PUB_PHONE_REGION = 'US';

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
    <div className="w-10 h-10 rounded-full shrink-0 overflow-hidden bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-semibold ring-1 ring-black/5">
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
    phone_country_iso: (raw.phone_country_iso as string | null | undefined) ?? null,
    dob: (raw.dob as string | null) ?? null,
    gender: (raw.gender as string | null) ?? null,
    marital_status: (raw.marital_status as string | null) ?? null,
    occupation: (raw.occupation as string | null) ?? null,
    address: (raw.address as string | null) ?? null,
    emergency_contact_name: (raw.emergency_contact_name as string | null) ?? null,
    emergency_contact_phone: (raw.emergency_contact_phone as string | null) ?? null,
    emergency_contact_phone_country_iso: (raw.emergency_contact_phone_country_iso as string | null | undefined) ?? null,
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
    custom_fields:
      raw.custom_fields &&
      typeof raw.custom_fields === 'object' &&
      !Array.isArray(raw.custom_fields)
        ? (raw.custom_fields as Record<string, unknown>)
        : null,
  };
  return base;
}

/** Public mini-site is on by default; only explicit false turns it off. */
function isPublicWebsiteExplicitlyOff(v: unknown): boolean {
  if (v === false || v === 0) return true;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s === 'false' || s === 'f' || s === '0' || s === 'no' || s === 'off';
  }
  return false;
}

/** URL segment for /public/groups/:slug — safe default from ministry name. */
function suggestPublicSlug(name: string): string {
  const raw = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);
  return raw || 'ministry';
}

function normalizeGroupFromApi(raw: Record<string, unknown>): Group {
  const pubSlug = raw.public_link_slug ?? raw.publicLinkSlug;
  const pubOn = raw.public_website_enabled ?? raw.publicWebsiteEnabled;
  const websiteOn =
    typeof pubOn === 'boolean'
      ? pubOn
      : pubOn == null
        ? true
        : isPublicWebsiteExplicitlyOff(pubOn)
          ? false
          : true;
  return {
    ...(raw as unknown as Group),
    public_link_slug: typeof pubSlug === 'string' ? pubSlug : pubSlug == null ? null : String(pubSlug),
    public_website_enabled: websiteOn,
  };
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
  if (x.includes('youth')) return 'bg-blue-100 text-blue-800 border-blue-200';
  if (x.includes('prayer')) return 'bg-rose-50 text-rose-800 border-rose-200';
  return 'bg-blue-50 text-blue-800 border-blue-200';
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

async function copyLinkToClipboard(label: string, text: string) {
  if (!text?.trim()) {
    toast.error('Nothing to copy');
    return;
  }
  try {
    await navigator.clipboard.writeText(text.trim());
    toast.success(`${label} copied`);
  } catch {
    toast.error('Could not copy');
  }
}

const MinistryDetail: React.FC = () => {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [launchAssignFromUrl] = useState(() => searchParams.get('assign') === '1');
  const { token } = useAuth();
  const { selectedBranch } = useBranch();

  const [group, setGroup] = useState<Group | null>(null);
  const [pubContactNational, setPubContactNational] = useState('');
  const [pubContactCountryIso, setPubContactCountryIso] = useState(DEFAULT_PUB_PHONE_REGION);
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
  const [shareLinksModalOpen, setShareLinksModalOpen] = useState(false);
  const [leaderPreviewOpen, setLeaderPreviewOpen] = useState(false);
  const [bulkSmsModalOpen, setBulkSmsModalOpen] = useState(false);

  const [isAddMembersModalOpen, setIsAddMembersModalOpen] = useState(false);
  const [availableMembers, setAvailableMembers] = useState<any[]>([]);
  const [loadingAvailableMembers, setLoadingAvailableMembers] = useState(true);

  const [isManageSubgroupModalOpen, setIsManageSubgroupModalOpen] = useState(false);
  const [editingSubgroup, setEditingSubgroup] = useState<Group | null>(null);

  const [activeTab, setActiveTab] = useState<DetailTab>(() => {
    const t = searchParams.get('tab');
    if (t === 'tasks') return 'tasks';
    if (t === 'members') return 'members';
    if (t === 'requests') return 'requests';
    return 'overview';
  });
  const { definitions: groupCustomFieldDefs } = useCustomFieldDefinitions(
    'group',
    activeTab === 'settings' && !!token && !!groupId,
  );
  const [qrPublic, setQrPublic] = useState('');
  const [qrJoin, setQrJoin] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [viewingMemberDetail, setViewingMemberDetail] = useState<Member | null>(null);
  const [removeFromGroupConfirmOpen, setRemoveFromGroupConfirmOpen] = useState(false);
  const [deleteMinistryModalOpen, setDeleteMinistryModalOpen] = useState(false);
  const [subgroupToDeleteId, setSubgroupToDeleteId] = useState<string | null>(null);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [assignedRangeStart, setAssignedRangeStart] = useState('');
  const [assignedRangeEnd, setAssignedRangeEnd] = useState('');
  const [pulseHighlightIds, setPulseHighlightIds] = useState<string[]>([]);
  const [pulseHighlightRequestIds, setPulseHighlightRequestIds] = useState<string[]>([]);

  type GroupEventRow = {
    id: string;
    title: string;
    start_time: string;
    end_time: string | null;
    event_type: string | null;
    status: string | null;
    group_name: string | null;
  };
  const [groupEvents, setGroupEvents] = useState<GroupEventRow[]>([]);
  const [loadingGroupEvents, setLoadingGroupEvents] = useState(true);
  const [errorGroupEvents, setErrorGroupEvents] = useState<string | null>(null);

  const selectAllMembersRef = React.useRef<HTMLInputElement>(null);
  const publicCoverFileRef = React.useRef<HTMLInputElement>(null);
  const [publicCoverUploading, setPublicCoverUploading] = useState(false);

  useEffect(() => {
    if (!launchAssignFromUrl) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (!next.has('assign') && !next.has('tab')) return prev;
        next.delete('assign');
        next.delete('tab');
        return next;
      },
      { replace: true },
    );
  }, [groupId, launchAssignFromUrl, setSearchParams]);

  useEffect(() => {
    if (!group) return;
    const p = e164ToCountryAndNational(
      group.contact_phone || '',
      group.contact_phone_country_iso || DEFAULT_PUB_PHONE_REGION,
    );
    setPubContactNational(p.national);
    setPubContactCountryIso(p.countryIso);
  }, [group?.id, group?.contact_phone, group?.contact_phone_country_iso]);

  const fetchGroupDetails = useCallback(async () => {
    if (!groupId || !token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/groups/${groupId}`, {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch group details');
      }
      const data = await response.json();
      const normalized = normalizeGroupFromApi(data as Record<string, unknown>);

      if (normalized.name && !(normalized.public_link_slug ?? '').trim()) {
        const autoSlug = suggestPublicSlug(normalized.name);
        normalized.public_link_slug = autoSlug;
        fetch(`/api/groups/${groupId}`, {
          method: 'PUT',
          headers: withBranchScope(selectedBranch?.id, {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          }),
          body: JSON.stringify({ public_link_slug: autoSlug, public_website_enabled: true }),
        }).catch(() => {});
      }

      setGroup(normalized);
    } catch (err: any) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [groupId, token, selectedBranch?.id]);

  const handlePublicCoverFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    const file = files[0];
    if (!file || !token) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image');
      return;
    }
    setPublicCoverUploading(true);
    try {
      const toUpload = await compressImageForUpload(file, PUBLIC_BANNER_IMAGE_OPTIONS);
      const fd = new FormData();
      fd.append('image', toUpload);
      const res = await fetch('/api/upload-image', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || 'Upload failed');
      }
      const url = (data as { url?: string }).url;
      if (!url) throw new Error('No URL returned');
      setGroup((prev) => (prev ? { ...prev, cover_image_url: url } : null));
      if (groupId && token) {
        const saveRes = await fetch(`/api/groups/${groupId}`, {
          method: 'PUT',
          headers: withBranchScope(selectedBranch?.id, {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          }),
          body: JSON.stringify({ cover_image_url: url, public_website_enabled: true }),
        });
        if (!saveRes.ok) {
          const errBody = await saveRes.json().catch(() => ({}));
          throw new Error((errBody as { error?: string }).error || 'Could not save cover');
        }
      }
      toast.success('Cover saved for your public page');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setPublicCoverUploading(false);
    }
  };

  const fetchGroupMembers = useCallback(async () => {
    if (!groupId || !token) return;
    setLoadingMembers(true);
    setErrorMembers(null);
    try {
      const response = await fetch(`/api/group-members?group_id=${encodeURIComponent(groupId)}`, {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
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
  }, [groupId, token, selectedBranch?.id]);

  const fetchSubgroups = useCallback(async () => {
    if (!groupId || !token) return;
    setLoadingSubgroups(true);
    setErrorSubgroups(null);
    try {
      const rows: Group[] = [];
      let offset = 0;
      while (true) {
        const response = await fetch(
          `/api/groups?parent_group_id=${encodeURIComponent(groupId)}&offset=${offset}&limit=100`,
          {
            headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
          },
        );
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to fetch subgroups');
        }
        const data = await response.json();
        const batch = Array.isArray(data) ? (data as Group[]) : Array.isArray(data?.groups) ? (data.groups as Group[]) : [];
        rows.push(...batch);
        if (batch.length < 100) break;
        offset += batch.length;
      }
      setSubgroups(rows);
    } catch (err: any) {
      setErrorSubgroups(err.message);
      toast.error(err.message);
    } finally {
      setLoadingSubgroups(false);
    }
  }, [groupId, token, selectedBranch?.id]);

  const fetchGroupEvents = useCallback(async () => {
    if (!groupId || !token) return;
    setLoadingGroupEvents(true);
    setErrorGroupEvents(null);
    try {
      const rows: GroupEventRow[] = [];
      let offset = 0;
      while (true) {
        const response = await fetch(
          `/api/groups/${encodeURIComponent(groupId)}/events?offset=${offset}&limit=100`,
          {
            headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
          },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error((data as { error?: string }).error || 'Failed to fetch group events');
        }
        const list = (data as { events?: unknown }).events;
        const batch = Array.isArray(list) ? (list as GroupEventRow[]) : [];
        rows.push(...batch);
        if (batch.length < 100) break;
        offset += batch.length;
      }
      setGroupEvents(rows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch group events';
      setErrorGroupEvents(msg);
      setGroupEvents([]);
      toast.error(msg);
    } finally {
      setLoadingGroupEvents(false);
    }
  }, [groupId, token, selectedBranch?.id]);

  const fetchPendingRequests = useCallback(async () => {
    if (!groupId || !token) return;
    setLoadingRequests(true);
    try {
      const rows: GroupJoinRequestRow[] = [];
      let offset = 0;
      while (true) {
        const params = new URLSearchParams({
          status: 'pending',
          group_id: groupId,
          offset: String(offset),
          limit: '100',
        });
        const res = await fetch(`/api/group-requests?${params.toString()}`, {
          headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setPendingRequests([]);
          toast.error((data as { error?: string }).error || 'Could not load join requests');
          return;
        }
        const batch = Array.isArray(data) ? (data as GroupJoinRequestRow[]) : Array.isArray(data?.requests) ? (data.requests as GroupJoinRequestRow[]) : [];
        rows.push(...batch);
        if (batch.length < 100) break;
        offset += batch.length;
      }
      setPendingRequests(rows);
    } catch {
      setPendingRequests([]);
      toast.error('Could not load join requests');
    } finally {
      setLoadingRequests(false);
    }
  }, [groupId, token, selectedBranch?.id]);

  const handleApproveJoinRequest = async (requestId: string) => {
    if (!token) return;
    setRequestActionBusyId(requestId);
    try {
      const res = await fetch(`/api/group-requests/${encodeURIComponent(requestId)}/approve`, {
        method: 'POST',
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
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
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
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
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
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
      const params = new URLSearchParams();
      if (group?.branch_id) {
        params.set('branch_id', group.branch_id);
      }
      const qs = params.toString();
      const response = await fetch(qs ? `/api/members?${qs}` : `/api/members`, {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch available members');
      }
      const data = await response.json();
      setAvailableMembers(Array.isArray(data) ? data : Array.isArray(data?.members) ? data.members : []);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoadingAvailableMembers(false);
    }
  }, [token, group?.branch_id, selectedBranch?.id]);

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
    const assignedMs = (gm: Record<string, unknown>) => {
      const raw = gm.joined_at ?? gm.created_at ?? gm.joined_date;
      if (raw == null || !String(raw).trim()) return null;
      const t = new Date(String(raw)).getTime();
      return Number.isNaN(t) ? null : t;
    };
    return [...out].sort((a, b) => {
      const ma = assignedMs(a as Record<string, unknown>);
      const mb = assignedMs(b as Record<string, unknown>);
      if (ma != null && mb != null) return mb - ma;
      if (mb != null) return 1;
      if (ma != null) return -1;
      return 0;
    });
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
          {
            method: 'DELETE',
            headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
          }
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

  const executeDeleteSubgroup = useCallback(async () => {
    const id = subgroupToDeleteId;
    if (!id || !token) {
      toast.error('Authentication required.');
      return;
    }
    try {
      const response = await fetch(`/api/groups/${id}`, {
        method: 'DELETE',
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error((errBody as { error?: string }).error || 'Failed to delete subgroup');
      }
      toast.success('Subgroup moved to trash');
      setSubgroupToDeleteId(null);
      fetchSubgroups();
      fetchGroupDetails();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete subgroup');
    }
  }, [subgroupToDeleteId, token, selectedBranch?.id, fetchSubgroups, fetchGroupDetails]);

  const executeDeleteMinistry = useCallback(async () => {
    if (!token || !groupId) {
      toast.error('Authentication required.');
      return;
    }
    if (group?.system_kind === 'all_members') {
      toast.error('All Members is a system group and cannot be deleted.');
      return;
    }
    try {
      const response = await fetch(`/api/groups/${groupId}`, {
        method: 'DELETE',
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error((errBody as { error?: string }).error || 'Failed to delete ministry');
      }
      toast.success('Ministry moved to trash');
      navigate('/groups');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete ministry');
    }
  }, [token, groupId, selectedBranch?.id, navigate]);

  const handleCreateSubgroupClick = () => {
    setEditingSubgroup(null);
    setIsManageSubgroupModalOpen(true);
  };

  const handleSavePublicWebsiteSettings = async () => {
    if (!token || !groupId || !group) return;
    try {
      const response = await fetch(`/api/groups/${groupId}`, {
        method: 'PUT',
        headers: withBranchScope(selectedBranch?.id, {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        }),
        body: JSON.stringify({
          public_website_enabled: true,
          public_link_slug: group.public_link_slug,
          cover_image_url: group.cover_image_url,
          announcements_content: group.announcements_content,
          program_outline_content: group.program_outline_content,
          contact_email: group.contact_email,
          contact_phone: pubContactNational,
          contact_phone_country_iso: pubContactCountryIso,
          join_link_enabled: group.join_link_enabled,
          custom_fields:
            group.custom_fields &&
            typeof group.custom_fields === 'object' &&
            !Array.isArray(group.custom_fields)
              ? group.custom_fields
              : {},
        }),
      });
      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: string;
          hint?: string;
        };
        const msg = errorData.error || 'Failed to save settings';
        throw new Error(errorData.hint ? `${msg} ${errorData.hint}` : msg);
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
        headers: withBranchScope(selectedBranch?.id, {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        }),
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
      setLoadingGroupEvents(false);
      setGroupEvents([]);
      setErrorGroupEvents(null);
      return;
    }

    fetchGroupDetails();
    fetchGroupMembers();
    fetchSubgroups();
    fetchPendingRequests();
    fetchGroupEvents();
  }, [
    groupId,
    token,
    fetchGroupDetails,
    fetchGroupMembers,
    fetchSubgroups,
    fetchPendingRequests,
    fetchGroupEvents,
  ]);

  useEffect(() => {
    if (!token || !groupId) return;
    void fetchAvailableMembers();
  }, [token, groupId, group?.branch_id, fetchAvailableMembers]);

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

  const highlightMemberIds = useMemo(() => {
    const h = searchParams.get('highlight');
    if (!h?.trim()) return [] as string[];
    return h
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }, [searchParams]);

  function membershipAssignedMs(gm: Record<string, unknown>): number | null {
    const raw = gm.joined_at ?? gm.created_at ?? gm.joined_date;
    if (raw == null || !String(raw).trim()) return null;
    const t = new Date(String(raw)).getTime();
    return Number.isNaN(t) ? null : t;
  }

  const dateFilteredGroupMembers = useMemo(() => {
    if (!assignedRangeStart && !assignedRangeEnd) return filteredGroupMembers;
    const startMs = assignedRangeStart
      ? new Date(`${assignedRangeStart}T00:00:00`).getTime()
      : null;
    const endMs = assignedRangeEnd ? new Date(`${assignedRangeEnd}T23:59:59.999`).getTime() : null;
    return filteredGroupMembers.filter((gm) => {
      const ms = membershipAssignedMs(gm as Record<string, unknown>);
      if (ms == null) return false;
      if (startMs != null && Number.isFinite(startMs) && ms < startMs) return false;
      if (endMs != null && Number.isFinite(endMs) && ms > endMs) return false;
      return true;
    });
  }, [filteredGroupMembers, assignedRangeStart, assignedRangeEnd]);

  useEffect(() => {
    if (highlightMemberIds.length === 0) return;
    setActiveTab('members');
    setPulseHighlightIds(highlightMemberIds);
    const t = window.setTimeout(() => setPulseHighlightIds([]), 4000);
    return () => window.clearTimeout(t);
  }, [highlightMemberIds.join(',')]);

  useEffect(() => {
    if (highlightMemberIds.length === 0 || loadingMembers) return;
    const first = highlightMemberIds[0];
    const id = window.requestAnimationFrame(() => {
      const el = document.querySelector(`[data-member-row-id="${first}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [highlightMemberIds.join(','), loadingMembers, dateFilteredGroupMembers.length]);

  useEffect(() => {
    const t = searchParams.get('tab');
    if (t === 'requests') setActiveTab('requests');
  }, [searchParams]);

  const highlightGroupRequestIdFromUrl = useMemo(() => {
    const r = searchParams.get('openRequestId');
    const t = r?.trim() ?? '';
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t) ? t : null;
  }, [searchParams]);

  useEffect(() => {
    if (!highlightGroupRequestIdFromUrl) return;
    setActiveTab('requests');
  }, [highlightGroupRequestIdFromUrl]);

  useEffect(() => {
    if (!highlightGroupRequestIdFromUrl || loadingRequests) return;
    const found = pendingRequests.some((r: { id?: string }) => r.id === highlightGroupRequestIdFromUrl);
    if (!found) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('openRequestId');
        return next;
      });
      return;
    }
    setPulseHighlightRequestIds([highlightGroupRequestIdFromUrl]);
    const tPulse = window.setTimeout(() => setPulseHighlightRequestIds([]), 4000);
    const idRaf = window.requestAnimationFrame(() => {
      document
        .querySelector(`[data-group-request-id="${highlightGroupRequestIdFromUrl}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('openRequestId');
      return next;
    });
    return () => {
      window.clearTimeout(tPulse);
      window.cancelAnimationFrame(idRaf);
    };
  }, [highlightGroupRequestIdFromUrl, loadingRequests, pendingRequests, setSearchParams]);

  const filteredListMemberIds = useMemo(
    () =>
      dateFilteredGroupMembers
        .map((gm: { member_id?: string | null }) => gm.member_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    [dateFilteredGroupMembers]
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

  const publicSlugTrimmed = (group?.public_link_slug ?? '').trim();
  const publicWebsiteLive = !isPublicWebsiteExplicitlyOff(group?.public_website_enabled);

  const publicPageUrl = useMemo(() => {
    if (!publicSlugTrimmed) return '';
    return `${origin}/public/groups/${publicSlugTrimmed}`;
  }, [publicSlugTrimmed, origin]);

  const joinPageUrl = useMemo(() => {
    if (!group?.id || !group?.join_link_enabled) return '';
    const slug = (group as { join_invite_token?: string | null }).join_invite_token || group.id;
    return `${origin}/join-group/${slug}`;
  }, [group, origin]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (publicPageUrl && publicWebsiteLive) {
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
  }, [publicPageUrl, publicWebsiteLive, joinPageUrl]);

  useEffect(() => {
    if (!shareLinksModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShareLinksModalOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shareLinksModalOpen]);

  useEffect(() => {
    if (!leaderPreviewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLeaderPreviewOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leaderPreviewOpen]);

  const resolvedLeaderForCard = useMemo((): ResolvedGroupLeader | null => {
    if (!group?.leader_id) return null;
    const lid = String(group.leader_id);
    const direct = availableMembers.find((m: { id?: string }) => m.id === lid);
    if (direct) {
      return {
        kind: 'member',
        member: normalizeMemberForDetailPanel(direct as Record<string, unknown> & { id: string }),
      };
    }
    const gm = dedupedGroupMembers.find((r: { member_id?: string | null }) => String(r.member_id || '') === lid);
    if (gm) {
      const m = memberFromGroupRow(gm, availableMembers as Record<string, unknown>[]);
      if (m) return { kind: 'member', member: m };
    }
    const prof = group.profiles;
    if (prof && typeof prof === 'object') {
      const fn = String(prof.first_name || '').trim();
      const ln = String(prof.last_name || '').trim();
      if (fn || ln) return { kind: 'staff', profile: prof };
    }
    return null;
  }, [group?.leader_id, group?.profiles, availableMembers, dedupedGroupMembers]);

  const leaderHeroSummary = useMemo(
    () => leaderSummaryFromResolved(resolvedLeaderForCard),
    [resolvedLeaderForCard],
  );

  const eventsCount = groupEvents.length;

  const subgroupDeleteName = useMemo(() => {
    const raw = subgroups.find((s) => s.id === subgroupToDeleteId)?.name ?? 'this subgroup';
    return raw === 'this subgroup' ? raw : displayTitleWords(raw);
  }, [subgroups, subgroupToDeleteId]);

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
        <Link to="/groups" className="text-blue-600 font-medium text-sm hover:underline">
          Back to groups
        </Link>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="flex flex-col flex-1 p-8 items-center justify-center gap-4">
        <h1 className="text-xl font-semibold text-gray-900">Ministry not found</h1>
        <Link to="/groups" className="text-blue-600 font-medium text-sm hover:underline">
          Back to groups
        </Link>
      </div>
    );
  }
  const isAllMembersGroup = group.system_kind === 'all_members';
  const groupDisplayName = displayTitleWords(group.name);

  const tabs: { id: DetailTab; label: string; count?: number; dot?: boolean }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'members', label: 'Members', count: dedupedGroupMembers.length },
    { id: 'events', label: 'Events', count: eventsCount },
    { id: 'requests', label: 'Requests', count: pendingRequests.length, dot: pendingRequests.length > 0 },
    { id: 'tasks', label: 'Tasks' },
    { id: 'subgroups', label: 'Subgroups', count: subgroups.length },
    { id: 'settings', label: 'Settings' },
  ];

  const renderLeaderCard = () => {
    const leaderNameRaw =
      resolvedLeaderForCard?.kind === 'member'
        ? `${resolvedLeaderForCard.member.first_name || ''} ${resolvedLeaderForCard.member.last_name || ''}`.trim()
        : resolvedLeaderForCard?.kind === 'staff'
          ? `${resolvedLeaderForCard.profile.first_name || ''} ${resolvedLeaderForCard.profile.last_name || ''}`.trim()
          : '';
    const leaderNameDisplay = leaderNameRaw ? displayTitleWords(leaderNameRaw) : 'No leader assigned';
    const leaderPhoto =
      resolvedLeaderForCard?.kind === 'member'
        ? (resolvedLeaderForCard.member as Member & { memberimage_url?: string | null }).memberimage_url ||
          resolvedLeaderForCard.member.member_url ||
          resolvedLeaderForCard.member.avatar_url ||
          resolvedLeaderForCard.member.profileImage ||
          null
        : resolvedLeaderForCard?.kind === 'staff'
          ? resolvedLeaderForCard.profile.avatar_url || null
          : null;
    const leaderEmail =
      resolvedLeaderForCard?.kind === 'member'
        ? resolvedLeaderForCard.member.email
        : resolvedLeaderForCard?.kind === 'staff'
          ? resolvedLeaderForCard.profile.email
          : null;
    const leaderPhone =
      resolvedLeaderForCard?.kind === 'member'
        ? resolvedLeaderForCard.member.phone || resolvedLeaderForCard.member.phone_number
        : null;
    const leaderInitials = memberInitials(leaderNameRaw || 'Leader');

    return (
      <>
        <div className="mb-10">
          <p className="text-xs font-semibold text-gray-400 mb-3">Group Leader</p>
          <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50/80 to-blue-50/50 p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center gap-5">
              <button
                type="button"
                disabled={!resolvedLeaderForCard}
                onClick={() => resolvedLeaderForCard && setLeaderPreviewOpen(true)}
                className={`shrink-0 text-left rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  resolvedLeaderForCard ? 'cursor-pointer hover:opacity-95' : 'cursor-default'
                }`}
              >
                {leaderPhoto ? (
                  <img
                    src={leaderPhoto}
                    alt=""
                    className="w-16 h-16 rounded-full object-cover border-4 border-white shadow pointer-events-none"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-blue-200 text-blue-800 flex items-center justify-center text-lg font-bold border-4 border-white shadow pointer-events-none">
                    {leaderInitials}
                  </div>
                )}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    disabled={!resolvedLeaderForCard}
                    onClick={() => resolvedLeaderForCard && setLeaderPreviewOpen(true)}
                    className={`min-w-0 text-left rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      resolvedLeaderForCard ? 'cursor-pointer hover:opacity-90' : 'cursor-default'
                    }`}
                  >
                    <p className="text-lg font-semibold text-gray-900">{leaderNameDisplay}</p>
                    <div className="mt-2 flex flex-col gap-1 text-sm text-gray-600">
                      {(leaderEmail || group.contact_email) && (
                        <span className="inline-flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          {leaderEmail || group.contact_email}
                        </span>
                      )}
                      {leaderPhone && (
                        <span className="inline-flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          {leaderPhone}
                        </span>
                      )}
                    </div>
                  </button>
                  <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-blue-100 text-blue-800 text-xs font-semibold border border-blue-200/80">
                    <Crown className="w-3.5 h-3.5" />
                    Leader
                  </div>
                </div>
                <details className="mt-4 max-w-md group">
                  <summary className="cursor-pointer text-sm font-medium text-blue-800 list-none flex items-center gap-2 [&::-webkit-details-marker]:hidden">
                    <span className="rounded-lg border border-blue-200 bg-white px-3 py-2 group-open:bg-blue-50/80">
                      Assign or change leader…
                    </span>
                    <span className="text-xs font-normal text-gray-500">(member directory list)</span>
                  </summary>
                  <div className="mt-3 pt-3 border-t border-dashed border-blue-100">
                    <p className="text-xs text-gray-500 mb-2">
                      This list is everyone in your branch directory so you can pick who leads this ministry. It is not
                      the list of people assigned to the group.
                    </p>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Choose leader</label>
                    <select
                      value={group.leader_id || ''}
                      disabled={loadingAvailableMembers}
                      onChange={async (e) => {
                        const newLeaderId = e.target.value === '' ? null : e.target.value;
                        if (!token || !groupId || !group) return;
                        try {
                          const response = await fetch(`/api/groups/${groupId}`, {
                            method: 'PUT',
                            headers: withBranchScope(selectedBranch?.id, {
                              'Content-Type': 'application/json',
                              Authorization: `Bearer ${token}`,
                            }),
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
                      className="w-full rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                      <option value="">No leader</option>
                      {availableMembers.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.first_name} {member.last_name}
                        </option>
                      ))}
                    </select>
                  </div>
                </details>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  };

  const renderSubgroupGrid = () => (
    <div className="mb-10">
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-xs font-semibold text-gray-400">
          Subgroups ({subgroups.length})
        </p>
        <button
          type="button"
          onClick={handleCreateSubgroupClick}
          className="text-sm font-medium text-blue-600 hover:text-blue-800"
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
              onEdit={sg.system_kind === 'all_members' ? undefined : handleEditSubgroup}
              onDelete={sg.system_kind === 'all_members' ? undefined : (id) => setSubgroupToDeleteId(id)}
            />
          ))}
        </div>
      )}
    </div>
  );

  const renderQuickStats = () => (
    <div>
      <p className="text-xs font-semibold text-gray-400 mb-3">Quick Stats</p>
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
            <Icon className={`w-4 h-4 ${accent ? 'text-amber-600' : 'text-blue-500'}`} />
            <p className={`mt-2 text-2xl font-bold ${accent ? 'text-amber-800' : 'text-gray-900'}`}>{value}</p>
            <p className="text-xs font-medium text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col flex-1 bg-gray-50/80 min-h-0">
      <input
        ref={publicCoverFileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-hidden
        onChange={(ev) => void handlePublicCoverFileChange(ev)}
      />
      <div className="max-w-6xl mx-auto w-full px-4 md:px-8 py-8">
        <nav className="mb-6" aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
            <li className="inline-flex items-center gap-1">
              <Link
                to="/groups"
                className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-800 font-medium"
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
                  className="text-blue-600 hover:text-blue-800 font-medium truncate max-w-[220px] md:max-w-xs"
                  title={displayTitleWords(crumb.name)}
                >
                  {displayTitleWords(crumb.name)}
                </Link>
              </li>
            ))}
            <li className="inline-flex items-center gap-1 min-w-0">
              <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" aria-hidden />
              <span
                className="font-semibold text-gray-900 truncate max-w-[240px] md:max-w-sm"
                title={groupDisplayName}
                aria-current="page"
              >
                {groupDisplayName}
              </span>
            </li>
          </ol>
        </nav>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 md:p-8 mb-6">
          <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-6">
            <div className="flex gap-4 min-w-0">
              <div className="shrink-0 w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white shadow-lg">
                <UserCircle2 className="w-8 h-8" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{groupDisplayName}</h1>
                  <span
                    className={`text-xs font-semibold px-2.5 py-0.5 rounded-lg border ${groupTypeBadgeClass(group.group_type)}`}
                  >
                    {displayTitleWords((group.group_type || 'ministry').replace(/_/g, ' '))}
                  </span>
                </div>
                {group.description && (
                  <p className="mt-2 text-gray-600 text-sm md:text-base max-w-3xl">
                    {displayTitleWords(group.description)}
                  </p>
                )}
                <div className="flex flex-wrap gap-x-6 gap-y-2 mt-5 text-sm text-gray-600">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-blue-500" />
                    <strong className="text-gray-900">{dedupedGroupMembers.length}</strong> members
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-blue-500" />
                    <strong className="text-gray-900">{eventsCount}</strong> events
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <GitBranch className="w-4 h-4 text-blue-500" />
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
                onClick={() => setShareLinksModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100"
              >
                <Globe className="w-4 h-4" />
                QR & share links
              </button>
              <button
                type="button"
                onClick={() => setBulkSmsModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
              >
                <Send className="w-4 h-4" />
                Message all members
              </button>
              <button
                type="button"
                onClick={() => setDeleteMinistryModalOpen(true)}
                disabled={isAllMembersGroup}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-red-200 bg-white text-red-700 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4" />
                Delete ministry
              </button>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Assigned leader</p>
            {resolvedLeaderForCard ? (
              <button
                type="button"
                onClick={() => setLeaderPreviewOpen(true)}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-gray-50/90 px-4 py-3 text-left hover:bg-gray-50 w-full max-w-xl transition-colors"
              >
                {leaderHeroSummary.photo ? (
                  <img
                    src={leaderHeroSummary.photo}
                    alt=""
                    className="w-12 h-12 rounded-full object-cover ring-2 ring-white shadow shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-800 flex items-center justify-center text-sm font-bold shrink-0">
                    {memberInitials(leaderHeroSummary.initialsSeed)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-gray-900">{leaderHeroSummary.title}</p>
                  <p className="text-xs text-blue-600 font-medium mt-0.5">Click for photo and contact details</p>
                </div>
                <Crown className="w-5 h-5 text-amber-600 shrink-0" aria-hidden />
              </button>
            ) : (
              <p className="text-sm text-gray-600 max-w-xl">
                <span className="font-medium text-gray-800">No leader assigned.</span> Open the{' '}
                <strong>Overview</strong> tab and expand <strong>Assign or change leader</strong> to pick someone from
                your member directory.
              </p>
            )}
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
                      ? 'text-blue-600'
                      : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {t.label}
                  {t.count !== undefined && (
                    <span className="ml-1.5 text-xs opacity-80">({t.count})</span>
                  )}
                  {t.dot && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-red-500 align-middle" />}
                  {activeTab === t.id && (
                    <span className="absolute left-3 right-3 bottom-0 h-0.5 rounded-full bg-blue-600" />
                  )}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {activeTab === 'overview' && (
          <div>
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
                    className="w-full rounded-xl border border-gray-200 bg-gray-50/80 py-2.5 pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-500 focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    autoComplete="off"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => setIsAddMembersModalOpen(true)}
                className="shrink-0 self-start px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 shadow-sm md:self-center"
              >
                Add members
              </button>
            </div>

            <div className="flex flex-wrap items-end gap-3 mb-4 px-1">
              <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
                Assigned from
                <input
                  type="date"
                  value={assignedRangeStart}
                  onChange={(e) => setAssignedRangeStart(e.target.value)}
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-900"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
                Assigned to
                <input
                  type="date"
                  value={assignedRangeEnd}
                  onChange={(e) => setAssignedRangeEnd(e.target.value)}
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-900"
                />
              </label>
              {(assignedRangeStart || assignedRangeEnd) && (
                <button
                  type="button"
                  onClick={() => {
                    setAssignedRangeStart('');
                    setAssignedRangeEnd('');
                  }}
                  className="text-sm text-blue-600 hover:underline pb-1"
                >
                  Clear dates
                </button>
              )}
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
            ) : dateFilteredGroupMembers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 py-12 text-center text-sm text-gray-500">
                No members match this assigned date range. Adjust the dates or clear the filter.
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
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          aria-label={
                            memberSearchQl
                              ? 'Select all members matching search'
                              : 'Select all members'
                          }
                        />
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 px-6 py-4">
                        Member
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 px-6 py-4">
                        Assigned
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 px-6 py-4">
                        Phone
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 px-6 py-4">
                        Address
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 px-6 py-4">
                        Joined
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 px-6 py-4">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dateFilteredGroupMembers.map((gm) => {
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
                      const rowHighlight =
                        memberId &&
                        (pulseHighlightIds.includes(memberId) || highlightMemberIds.includes(memberId));
                      const gmRec = gm as Record<string, unknown>;
                      const assignedRaw = gmRec.joined_at ?? gmRec.created_at ?? gmRec.joined_date;
                      const assignedLabel =
                        assignedRaw != null && String(assignedRaw).trim()
                          ? formatCompactWeekdayDate(String(assignedRaw))
                          : '—';

                      const openPanel = () => {
                        const m = memberFromGroupRow(gm, availableMembers as Record<string, unknown>[]);
                        if (m) setViewingMemberDetail(m);
                      };

                      return (
                        <tr
                          key={gm.id}
                          data-member-row-id={memberId || undefined}
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
                          className={`border-b border-gray-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 cursor-pointer ${
                            selected ? 'bg-blue-50' : 'hover:bg-gray-50'
                          } ${rowHighlight ? 'ring-2 ring-inset ring-amber-400 animate-pulse' : ''}`}
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
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
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
                            <span className="text-gray-600 text-[14px]">{assignedLabel}</span>
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
                                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                                  : 'bg-gray-50 text-gray-700 border-gray-200'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                                  statusRaw === 'active' ? 'bg-blue-500' : 'bg-gray-400'
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
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 md:p-8">
            {loadingGroupEvents ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
                <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                Loading events…
              </div>
            ) : errorGroupEvents ? (
              <p className="text-sm text-red-600 text-center py-8">{errorGroupEvents}</p>
            ) : groupEvents.length === 0 ? (
              <div className="p-6 text-center text-gray-500 text-sm">
                <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                No events linked to this group yet.
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {groupEvents.map((ev) => {
                  const evCd = formatCalendarCountdown(ev.start_time);
                  return (
                    <li key={ev.id}>
                      <Link
                        to={`/events/${ev.id}`}
                        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-4 px-3 -mx-1 hover:bg-gray-50/80 rounded-xl transition-colors"
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                            <Calendar className="w-5 h-5 text-blue-600" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 truncate">{ev.title || 'Untitled event'}</p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {formatLongWeekdayDateTime(ev.start_time)}
                              {evCd ? ` · ${evCd}` : ''}
                            </p>
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {ev.event_type ? (
                                <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-100">
                                  {ev.event_type}
                                </span>
                              ) : null}
                              {ev.status ? (
                                <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                                  {ev.status}
                                </span>
                              ) : null}
                              {ev.group_name ? (
                                <span className="text-[11px] text-gray-600">{ev.group_name}</span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-gray-300 shrink-0 hidden sm:block" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
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
                      <th className="text-left text-xs font-semibold text-gray-500 px-6 py-4">
                        Requester
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 px-6 py-4">
                        Date of birth
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 px-6 py-4">
                        Source
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 px-6 py-4">
                        Requested
                      </th>
                      <th className="text-right text-xs font-semibold text-gray-500 px-6 py-4">
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
                          ? formatLongWeekdayDate(String(dobRaw)) || '—'
                          : '—';
                      const reqAt = r.requested_at || r.created_at;
                      const reqLabel = reqAt ? formatLongWeekdayDateTime(String(reqAt)) || '—' : '—';
                      const busy = requestActionBusyId === r.id;
                      const canOpenRoster = verified && mid && roster;
                      const rowRequestHighlight = pulseHighlightRequestIds.includes(String(r.id));

                      return (
                        <tr
                          key={r.id}
                          data-group-request-id={r.id}
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
                          className={`border-b border-gray-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                            canOpenRoster ? 'cursor-pointer hover:bg-gray-50' : ''
                          } ${rowRequestHighlight ? 'ring-2 ring-inset ring-amber-400 animate-pulse' : ''}`}
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
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border bg-blue-50 text-blue-800 border-blue-200">
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
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 shadow-sm"
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

        {activeTab === 'tasks' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 md:p-8">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Tasks</h2>
              <p className="mt-1 text-sm text-gray-500 max-w-2xl">
                Follow-up tasks for this ministry or linked groups. Assign to staff and track checklist progress.
              </p>
            </div>
            <GroupTasksSection groupId={groupId ?? null} openAssignOnMount={launchAssignFromUrl} />
          </div>
        )}

        {activeTab === 'subgroups' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 md:p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">Subgroups</h2>
              <button
                type="button"
                onClick={handleCreateSubgroupClick}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
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
                    onEdit={subgroup.system_kind === 'all_members' ? undefined : handleEditSubgroup}
                    onDelete={subgroup.system_kind === 'all_members' ? undefined : (id) => setSubgroupToDeleteId(id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 md:p-8">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Public page</h2>
              <p className="text-sm text-gray-600 mb-4">
                Your public ministry page is <strong>on by default</strong>. Set a <strong>public slug</strong> below,
                then save. The URL and QR on Overview use this slug.
              </p>
              <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50/80 p-4">
                <label className="block text-xs font-medium text-gray-500 mb-1">Public slug</label>
                <input
                  type="text"
                  value={group.public_link_slug || ''}
                  onChange={(e) =>
                    setGroup((prev) => (prev ? { ...prev, public_link_slug: e.target.value } : null))
                  }
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                  placeholder="youth-ministry"
                />
                <p className="mt-2 font-mono text-[11px] text-gray-700 break-all">
                  {publicSlugTrimmed
                    ? `${origin}/public/groups/${publicSlugTrimmed}`
                    : '— /public/groups/your-slug will appear here'}
                </p>
              </div>
              <div className="space-y-3 p-4 rounded-xl bg-gray-50 border border-gray-100 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Public cover photo</label>
                    <p className="text-[11px] text-gray-400 mb-2">
                      Same as <strong>Overview → Add cover photo</strong>. Wide banner on the public page.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={publicCoverUploading}
                        onClick={() => publicCoverFileRef.current?.click()}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {publicCoverUploading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <Upload className="h-3.5 w-3.5" aria-hidden />
                        )}
                        Upload image
                      </button>
                      {group.cover_image_url?.trim() ? (
                        <button
                          type="button"
                          onClick={() => setGroup((prev) => (prev ? { ...prev, cover_image_url: '' } : null))}
                          className="text-xs font-medium text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    <input
                      type="text"
                      placeholder="Or paste image URL…"
                      value={group.cover_image_url || ''}
                      onChange={(e) =>
                        setGroup((prev) => (prev ? { ...prev, cover_image_url: e.target.value } : null))
                      }
                      className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
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
                    <div className="md:col-span-2">
                      <PhoneCountryInput
                        label="Contact phone"
                        countryIso={pubContactCountryIso}
                        onCountryChange={setPubContactCountryIso}
                        national={pubContactNational}
                        onNationalChange={setPubContactNational}
                        className="[&_label]:text-xs [&_label]:font-medium [&_label]:text-gray-500 [&_label]:mb-1 [&_p]:text-[10px] [&_select]:py-2 [&_select]:text-sm [&_input]:py-2 [&_input]:text-sm"
                      />
                    </div>
                  </div>
                </div>
              {groupCustomFieldDefs.length > 0 ? (
                <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-5 mb-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Additional fields</h3>
                  <CustomFieldsSection
                    definitions={groupCustomFieldDefs}
                    values={
                      group.custom_fields &&
                      typeof group.custom_fields === 'object' &&
                      !Array.isArray(group.custom_fields)
                        ? group.custom_fields
                        : {}
                    }
                    onChange={(key, value) =>
                      setGroup((prev) => {
                        if (!prev) return null;
                        const cur = prev.custom_fields;
                        const base =
                          cur && typeof cur === 'object' && !Array.isArray(cur)
                            ? { ...cur }
                            : ({} as Record<string, unknown>);
                        base[key] = value;
                        return { ...prev, custom_fields: base };
                      })
                    }
                  />
                </div>
              ) : null}
              <label className="flex items-center justify-between gap-4 mb-4">
                <span className="text-sm font-medium text-gray-800">Allow public join requests</span>
                <input
                  type="checkbox"
                  checked={group.join_link_enabled || false}
                  onChange={(e) => updateJoinLink(e.target.checked)}
                  className="h-5 w-5 rounded border-gray-300 text-blue-600"
                />
              </label>
              <button
                type="button"
                onClick={handleSavePublicWebsiteSettings}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
              >
                Save settings
              </button>
            </div>
          </div>
        )}
      </div>

      {leaderPreviewOpen && resolvedLeaderForCard ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/50"
          role="presentation"
          onClick={() => setLeaderPreviewOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 text-center"
            role="dialog"
            aria-modal="true"
            aria-label="Group leader"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Group leader</p>
            {resolvedLeaderForCard.kind === 'member' &&
            ((resolvedLeaderForCard.member as Member & { memberimage_url?: string | null }).memberimage_url ||
              resolvedLeaderForCard.member.member_url ||
              resolvedLeaderForCard.member.avatar_url ||
              resolvedLeaderForCard.member.profileImage) ? (
              <img
                src={
                  ((resolvedLeaderForCard.member as Member & { memberimage_url?: string | null }).memberimage_url ||
                    resolvedLeaderForCard.member.member_url ||
                    resolvedLeaderForCard.member.avatar_url ||
                    resolvedLeaderForCard.member.profileImage) as string
                }
                alt=""
                className="w-28 h-28 rounded-full object-cover mx-auto border-4 border-gray-100 shadow"
              />
            ) : resolvedLeaderForCard.kind === 'staff' && resolvedLeaderForCard.profile.avatar_url ? (
              <img
                src={resolvedLeaderForCard.profile.avatar_url}
                alt=""
                className="w-28 h-28 rounded-full object-cover mx-auto border-4 border-gray-100 shadow"
              />
            ) : (
              <div className="w-28 h-28 rounded-full bg-blue-100 text-blue-800 flex items-center justify-center text-2xl font-bold mx-auto border-4 border-gray-100 shadow">
                {memberInitials(
                  resolvedLeaderForCard.kind === 'member'
                    ? `${resolvedLeaderForCard.member.first_name || ''} ${resolvedLeaderForCard.member.last_name || ''}`
                    : `${resolvedLeaderForCard.profile.first_name || ''} ${resolvedLeaderForCard.profile.last_name || ''}`,
                )}
              </div>
            )}
            <p className="mt-4 text-lg font-semibold text-gray-900">
              {resolvedLeaderForCard.kind === 'member'
                ? displayTitleWords(
                    `${resolvedLeaderForCard.member.first_name || ''} ${resolvedLeaderForCard.member.last_name || ''}`.trim(),
                  )
                : displayTitleWords(
                    `${resolvedLeaderForCard.profile.first_name || ''} ${resolvedLeaderForCard.profile.last_name || ''}`.trim(),
                  )}
            </p>
            {resolvedLeaderForCard.kind === 'member' && resolvedLeaderForCard.member.email ? (
              <p className="mt-2 text-sm text-gray-600 break-all">{resolvedLeaderForCard.member.email}</p>
            ) : null}
            {resolvedLeaderForCard.kind === 'staff' && resolvedLeaderForCard.profile.email ? (
              <p className="mt-2 text-sm text-gray-600 break-all">{resolvedLeaderForCard.profile.email}</p>
            ) : null}
            {resolvedLeaderForCard.kind === 'member' &&
            (resolvedLeaderForCard.member.phone || resolvedLeaderForCard.member.phone_number) ? (
              <p className="mt-2 text-sm text-gray-600">
                {resolvedLeaderForCard.member.phone || resolvedLeaderForCard.member.phone_number}
              </p>
            ) : null}
            <button
              type="button"
              className="mt-6 w-full rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-200"
              onClick={() => setLeaderPreviewOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {shareLinksModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4 bg-slate-900/45 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => setShareLinksModalOpen(false)}
          aria-hidden="true"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-links-modal-title"
            className="my-4 w-full max-w-lg rounded-2xl border border-blue-200/80 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div
                  id="share-links-modal-title"
                  className="flex items-center gap-2 text-sm font-semibold text-blue-900"
                >
                  <Globe className="h-4 w-4 shrink-0" aria-hidden />
                  Public Ministry & Join
                </div>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  <span className="font-medium text-slate-800">{groupDisplayName}</span> — share the{' '}
                  <strong>public page</strong> for your mini-site, or the <strong>join link</strong> for a shortcut to
                  the request form.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setShareLinksModalOpen(false)}
                className="shrink-0 rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-6 space-y-8">
              <div>
                <p className="text-[11px] font-semibold text-blue-800">Ministry Public Page</p>
                <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                  <div className="flex h-[140px] w-[140px] shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-slate-50 p-2">
                    {qrPublic ? (
                      <img src={qrPublic} alt="" className="h-full w-full object-contain" />
                    ) : (
                      <span className="px-2 text-center text-xs text-slate-500">
                        {!publicSlugTrimmed
                          ? 'Add a public slug under Settings'
                          : !publicWebsiteLive
                            ? 'Public page is turned off for this ministry.'
                            : 'Generating…'}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-800 break-all">
                      {publicPageUrl || '—'}
                    </div>
                    {publicPageUrl && !publicWebsiteLive ? (
                      <p className="mt-2 text-[11px] text-amber-800">
                        Public page is off for this ministry (database opt-out).
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2 items-center">
                      <button
                        type="button"
                        disabled={!qrPublic}
                        onClick={() =>
                          qrPublic && downloadQrDataUrl(qrPublic, `${groupDisplayName}-public-ministry-qr.png`)
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                      >
                        <Download className="h-3.5 w-3.5" />
                        QR
                      </button>
                      {publicPageUrl ? (
                        <Link
                          to={`/public/groups/${publicSlugTrimmed}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Access
                        </Link>
                      ) : null}
                      <button
                        type="button"
                        disabled={!publicPageUrl}
                        onClick={() => copyLinkToClipboard('Public link', publicPageUrl)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 disabled:opacity-40"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy
                      </button>
                      <button
                        type="button"
                        disabled={!publicPageUrl}
                        onClick={() => shareUrl(publicPageUrl, `${groupDisplayName} — public page`)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 disabled:opacity-40"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                        Share
                      </button>
                      <button
                        type="button"
                        disabled={publicCoverUploading || !token}
                        onClick={() => publicCoverFileRef.current?.click()}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                        title={
                          group.cover_image_url?.trim()
                            ? 'Replace the public page banner — choose a new image to overwrite the current one'
                            : 'Add a banner image for the public ministry page'
                        }
                        aria-label={
                          group.cover_image_url?.trim()
                            ? 'Replace public page cover photo'
                            : 'Add public page cover photo'
                        }
                      >
                        {publicCoverUploading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <Upload className="h-3.5 w-3.5" aria-hidden />
                        )}
                        {group.cover_image_url?.trim() ? 'Replace cover' : 'Add cover'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-6">
                <p className="text-[11px] font-semibold text-blue-800">Direct Join Request</p>
                <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                  <div className="flex h-[140px] w-[140px] shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50/50 p-2">
                    {qrJoin ? (
                      <img src={qrJoin} alt="" className="h-full w-full object-contain" />
                    ) : (
                      <span className="px-2 text-center text-xs text-slate-500">
                        Enable public join requests
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-800 break-all">
                      {joinPageUrl || '—'}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!qrJoin}
                        onClick={() =>
                          qrJoin && downloadQrDataUrl(qrJoin, `${groupDisplayName}-join-request-qr.png`)
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                      >
                        <Download className="h-3.5 w-3.5" />
                        QR
                      </button>
                      <button
                        type="button"
                        disabled={!joinPageUrl}
                        onClick={() => copyLinkToClipboard('Join link', joinPageUrl)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 disabled:opacity-40"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy
                      </button>
                      <button
                        type="button"
                        disabled={!joinPageUrl}
                        onClick={() => joinPageUrl && shareUrl(joinPageUrl, `${groupDisplayName} — join`)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 disabled:opacity-40"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                        Share
                      </button>
                    </div>
                  </div>
                </div>
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

      <DeleteModal
        isOpen={deleteMinistryModalOpen}
        onClose={() => setDeleteMinistryModalOpen(false)}
        onConfirm={() => {
          if (isAllMembersGroup) {
            setDeleteMinistryModalOpen(false);
            return;
          }
          void executeDeleteMinistry();
        }}
        title={isAllMembersGroup ? 'System group' : 'Move this ministry to trash?'}
        message={
          isAllMembersGroup
            ? '“All Members” is a system default group and cannot be deleted.'
            : `“${groupDisplayName}” will be hidden from the ministries list and moved to trash for ${30} days. You can restore it from Ministries → Deleted Ministries.\n\nExisting events are kept, but this ministry will be unlinked and members who were on the roster through it will be removed from those events.\n\nMember profiles are not deleted.`
        }
        confirmLabel={isAllMembersGroup ? 'OK' : 'Move to trash'}
      />

      <DeleteModal
        isOpen={!!subgroupToDeleteId}
        onClose={() => setSubgroupToDeleteId(null)}
        onConfirm={() => void executeDeleteSubgroup()}
        title="Delete this subgroup?"
        message={`“${subgroupDeleteName}” will be moved to trash (${30} days). Restore from Ministries → Deleted Ministries.\n\nLinked events stay, but this subgroup is unlinked and its roster members are removed from those events.`}
        confirmLabel="Move to trash"
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

      {group && (
        <BulkSmsComposeModal
          isOpen={bulkSmsModalOpen}
          onClose={() => setBulkSmsModalOpen(false)}
          mode="group"
          lockedGroup={{
            id: group.id,
            name: groupDisplayName,
            memberCount: dedupedGroupMembers.length,
          }}
        />
      )}
    </div>
  );
};

export default MinistryDetail;
