import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import type { Member } from '@/types';
import type { FamilyGroup } from '../utils/mockData';
import { useAuth } from './AuthContext';
import { useBranch } from './BranchContext';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import MemberDetailPanel from '../components/panels/MemberDetailPanel';

/** Map GET /api/members/:id or list row to UI `Member` (matches Members.tsx list mapping). */
export function mapApiMemberRowToMember(m: Record<string, unknown>): Member {
  const row = m as Record<string, unknown> & {
    id?: string;
    first_name?: string | null;
    last_name?: string | null;
    phone_number?: string | null;
    phone?: string | null;
    phone_country_iso?: string | null;
    address?: string | null;
    emergency_contact_name?: string | null;
    emergency_contact_phone?: string | null;
    emergency_contact_phone_country_iso?: string | null;
    avatar_url?: string | null;
    memberimage_url?: string | null;
    member_url?: string | null;
    profile_image?: string | null;
    branch_id?: string | null;
    is_deleted?: boolean | null;
    deleted_at?: string | null;
  };
  return {
    ...(row as unknown as Member),
    id: String(row.id ?? ''),
    fullName: `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim(),
    phone: (row.phone_number as string | null | undefined) ?? (row.phone as string | null) ?? null,
    phoneNumber: String(row.phone_number || row.phone || ''),
    phone_country_iso: row.phone_country_iso ?? null,
    location: String(row.address || ''),
    emergencyContactName: String(row.emergency_contact_name || ''),
    emergencyContactPhone: String(row.emergency_contact_phone || ''),
    emergency_contact_phone_country_iso: row.emergency_contact_phone_country_iso ?? null,
    profileImage: String(
      row.avatar_url || row.memberimage_url || row.member_url || row.profile_image || '',
    ),
    memberUrl: String(row.member_url || ''),
    churchId: row.branch_id as string | null | undefined,
    is_deleted: Boolean(row.is_deleted),
    deleted_at: (row.deleted_at as string | null) || null,
  } as Member;
}

export type MemberProfileOpenOpts = {
  familyGroups?: FamilyGroup[];
  allMembers?: Member[];
  onUpdated?: (m: Member) => void;
};

type Ctx = {
  openMember: (m: Member, opts?: MemberProfileOpenOpts) => void;
  openMemberById: (id: string, opts?: MemberProfileOpenOpts) => Promise<void>;
  closeMember: () => void;
};

const MemberProfileModalContext = createContext<Ctx | null>(null);

export function useMemberProfileModal(): Ctx {
  const v = useContext(MemberProfileModalContext);
  if (!v) {
    throw new Error('useMemberProfileModal must be used within MemberProfileModalProvider');
  }
  return v;
}

/** Safe for optional use outside provider (e.g. gradual rollout). */
export function useMemberProfileModalOptional(): Ctx | null {
  return useContext(MemberProfileModalContext);
}

export function MemberProfileModalProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const { selectedBranch } = useBranch();
  const [member, setMember] = useState<Member | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [opts, setOpts] = useState<MemberProfileOpenOpts | null>(null);
  const onUpdatedRef = useRef<((m: Member) => void) | undefined>(undefined);

  const closeMember = useCallback(() => {
    setIsOpen(false);
    setMember(null);
    setOpts(null);
    onUpdatedRef.current = undefined;
  }, []);

  const openMember = useCallback((m: Member, o?: MemberProfileOpenOpts) => {
    onUpdatedRef.current = o?.onUpdated;
    setOpts(o ?? null);
    setMember(m);
    setIsOpen(true);
  }, []);

  const openMemberById = useCallback(
    async (id: string, o?: MemberProfileOpenOpts) => {
      if (!token) {
        toast.error('Please sign in again.');
        return;
      }
      const tid = String(id || '').trim();
      if (!tid) return;
      onUpdatedRef.current = o?.onUpdated;
      setOpts(o ?? null);
      try {
        const res = await fetch(`/api/members/${encodeURIComponent(tid)}`, {
          headers: withBranchScope(selectedBranch?.id ?? null, { Authorization: `Bearer ${token}` }),
        });
        const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) throw new Error(typeof raw?.error === 'string' ? raw.error : 'Could not load member');
        setMember(mapApiMemberRowToMember(raw));
        setIsOpen(true);
      } catch (e) {
        setOpts(null);
        onUpdatedRef.current = undefined;
        toast.error(e instanceof Error ? e.message : 'Could not load member');
      }
    },
    [token, selectedBranch?.id],
  );

  const onEdit = useCallback((updated: Member) => {
    setMember(updated);
    onUpdatedRef.current?.(updated);
  }, []);

  const value = useMemo(
    () => ({ openMember, openMemberById, closeMember }),
    [openMember, openMemberById, closeMember],
  );

  const allMembersForPanel = opts?.allMembers?.length
    ? opts.allMembers
    : member
      ? [member]
      : [];

  return (
    <MemberProfileModalContext.Provider value={value}>
      {children}
      <MemberDetailPanel
        isOpen={isOpen}
        onClose={closeMember}
        member={member as Member | null}
        familyGroups={(opts?.familyGroups ?? []) as FamilyGroup[]}
        allMembers={allMembersForPanel as Member[]}
        onEdit={onEdit}
      />
    </MemberProfileModalContext.Provider>
  );
}
