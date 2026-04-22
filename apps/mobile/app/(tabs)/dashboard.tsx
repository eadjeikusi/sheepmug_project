import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import type { Family, Group, Member, TaskItem } from "@sheepmug/shared-api";
import { useAuth } from "../../contexts/AuthContext";
import { useBranch } from "../../contexts/BranchContext";
import { useNotifications } from "../../contexts/NotificationContext";
import { usePermissions } from "../../hooks/usePermissions";
import { HeaderIconCircleButton } from "../../components/HeaderIconCircle";
import { MemberInitialAvatar } from "../../components/MemberInitialAvatar";
import { MemberJoinQrModal } from "../../components/MemberJoinQrModal";
import { api } from "../../lib/api";
import { normalizeImageUri } from "../../lib/imageUri";
import { displayMemberWords } from "../../lib/memberDisplayFormat";
import { getMemberJoinRegisterUrl } from "../../lib/memberJoinRegisterUrl";
import {
  getDashboardLastSeenCounts,
  getOfflineResourceCache,
  setDashboardLastSeenCounts,
  setOfflineResourceCache,
  type DashboardLastSeenCounts,
} from "../../lib/storage";
import { colors, radius, sizes, type } from "../../theme";
import { useOfflineSync } from "../../contexts/OfflineSyncContext";

function firstValidImageUri(member: Member): string | null {
  const candidates = [
    member.avatar_url,
    member.member_url,
    member.profileImage as string | null | undefined,
    member.profile_image as string | null | undefined,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

type StripItem = {
  key: string;
  uri: string | null;
  letter: string;
  onPress: () => void;
  isGroup?: boolean;
};

const AVATAR_STRIP_MAX = 5;
const RECENT_MEMBERS_SPOTLIGHT_MAX = 5;
const DASHBOARD_MEMBERS_FETCH_SIZE = 200;

async function fetchAllMembersForDashboard(): Promise<{ members: Member[]; total_count: number }> {
  const out: Member[] = [];
  let offset = 0;
  let totalCount = 0;
  while (true) {
    const page = await api.members.list({ offset, limit: DASHBOARD_MEMBERS_FETCH_SIZE });
    const rows = Array.isArray(page.members) ? page.members : [];
    out.push(...rows);
    totalCount = Number(page.total_count || out.length);
    if (rows.length < DASHBOARD_MEMBERS_FETCH_SIZE || out.length >= totalCount) break;
    offset += DASHBOARD_MEMBERS_FETCH_SIZE;
  }
  return { members: out, total_count: totalCount || out.length };
}

/** Stable pseudo-shuffle so join cards show varied faces without flickering every render. */
function shuffleMembersForStrip(members: Member[], seed: string): Member[] {
  const copy = [...members];
  copy.sort((a, b) => {
    const ha = hashString(`${seed}:${a.id}`);
    const hb = hashString(`${seed}:${b.id}`);
    return ha - hb;
  });
  return copy;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

function formatTimeAgo(ts: string | null): string {
  if (!ts) return "never";
  const ms = new Date(ts).getTime();
  if (Number.isNaN(ms)) return "never";
  const diffMs = Date.now() - ms;
  if (diffMs < 60_000) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}

/** Resolve directory member id from GET /api/group-members row (junction or nested `members`). */
function rowMemberIdFromGroupRow(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (typeof r.member_id === "string" && r.member_id.trim()) return r.member_id.trim();
  const m = r.members;
  if (m && typeof m === "object" && !Array.isArray(m)) {
    const id = (m as { id?: string }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  if (Array.isArray(m) && m[0] && typeof (m[0] as { id?: string }).id === "string") {
    return String((m[0] as { id: string }).id).trim();
  }
  return null;
}

function memberStripItem(m: Member, keyPrefix: string, router: { push: (href: any) => void }): StripItem {
  const mid = m.id;
  return {
    key: `${keyPrefix}:${mid}`,
    uri: normalizeImageUri(firstValidImageUri(m)),
    letter: (m.first_name?.[0] || "M").toUpperCase(),
    onPress: () => router.push({ pathname: "/member/[id]", params: { id: mid } }),
  };
}

function memberIdFromTaskStripKey(key: string): string | null {
  if (!key.startsWith("pt-m:")) return null;
  return key.slice("pt-m:".length) || null;
}

function groupJoinStrip(
  rows: Record<string, unknown>[],
  memberById: Map<string, Member>,
  homeMembersFallbackOrder: Member[],
  router: { push: (href: any) => void }
): { items: StripItem[]; extra: number } {
  const safeMembers = Array.isArray(homeMembersFallbackOrder) ? homeMembersFallbackOrder : [];
  const source: Record<string, unknown>[] =
    rows.length > 0
      ? rows
      : safeMembers.slice(0, AVATAR_STRIP_MAX).map((m) => ({ member_id: m.id } as Record<string, unknown>));
  const total = source.length;
  const slice = source.slice(0, AVATAR_STRIP_MAX);
  const items: StripItem[] = [];
  for (const row of slice) {
    const mid = typeof row.member_id === "string" ? row.member_id : null;
    const gidRaw = row.group_id;
    const gid = typeof gidRaw === "string" ? gidRaw : gidRaw != null ? String(gidRaw) : "";
    if (mid && memberById.has(mid)) {
      const m = memberById.get(mid)!;
      items.push({
        key: `gj-m:${mid}`,
        uri: normalizeImageUri(firstValidImageUri(m)),
        letter: (m.first_name?.[0] || "M").toUpperCase(),
        onPress: () => router.push({ pathname: "/member/[id]", params: { id: mid } }),
      });
    } else if (gid) {
      items.push({
        key: `gj-g:${gid}`,
        uri: null,
        letter: "G",
        isGroup: true,
        onPress: () => router.push({ pathname: "/ministry/[id]", params: { id: gid } }),
      });
    }
  }
  return { items, extra: Math.max(0, total - AVATAR_STRIP_MAX) };
}

function memberJoinStrip(
  rows: Record<string, unknown>[],
  memberById: Map<string, Member>,
  homeMembersFallbackOrder: Member[],
  router: { push: (href: any) => void }
): { items: StripItem[]; extra: number } {
  const safeMembers = Array.isArray(homeMembersFallbackOrder) ? homeMembersFallbackOrder : [];
  const source: Record<string, unknown>[] =
    rows.length > 0
      ? rows
      : safeMembers.slice(0, AVATAR_STRIP_MAX).map(
          (m) =>
            ({
              member_id: m.id,
              first_name: m.first_name,
              last_name: m.last_name,
              id: m.id,
            }) as Record<string, unknown>
        );
  const total = source.length;
  const slice = source.slice(0, AVATAR_STRIP_MAX);
  const items: StripItem[] = [];
  for (const row of slice) {
    const fn = typeof row.first_name === "string" ? row.first_name : "";
    const ln = typeof row.last_name === "string" ? row.last_name : "";
    const letter = `${fn[0] || ""}${ln[0] || ""}`.trim() || "?";
    const mid = typeof row.member_id === "string" ? row.member_id : null;
    const rid = String(row.id ?? row.request_id ?? items.length);
    const m = mid ? memberById.get(mid) : undefined;
    if (m) {
      items.push({
        key: `mj-m:${mid}:${rid}`,
        uri: normalizeImageUri(firstValidImageUri(m)),
        letter: (m.first_name?.[0] || "M").toUpperCase(),
        onPress: () => router.push({ pathname: "/member/[id]", params: { id: mid } }),
      });
    } else {
      items.push({
        key: `mj:${rid}`,
        uri: null,
        letter: letter.toUpperCase().slice(0, 2),
        onPress: () => {
          if (mid) router.push({ pathname: "/member/[id]", params: { id: mid } });
        },
      });
    }
  }
  return { items, extra: Math.max(0, total - AVATAR_STRIP_MAX) };
}

/**
 * Task card avatars: unique task subjects (member / group) first — no duplicate member faces.
 * If fewer than five, pad with members from related group rosters, then recent spotlight, then branch list.
 * "+N" counts extra unique task subjects beyond the first five slots (pad faces do not increase N).
 */
function pendingTaskStrip(
  tasks: TaskItem[],
  memberById: Map<string, Member>,
  homeMembers: Member[],
  groupPadMembers: Member[],
  spotlightMembers: Member[],
  router: { push: (href: any) => void }
): { items: StripItem[]; extra: number } {
  const pending = tasks.filter((t) => String(t.status || "").toLowerCase() === "pending");
  const source = pending.length > 0 ? pending : tasks;

  const taskUnique: StripItem[] = [];
  const seenSubject = new Set<string>();
  for (const t of source) {
    const r = t as Record<string, unknown>;
    const tt = r.task_type;
    if (tt === "member" && typeof r.member_id === "string") {
      const mid = r.member_id;
      const key = `m:${mid}`;
      if (seenSubject.has(key)) continue;
      seenSubject.add(key);
      const m = memberById.get(mid);
      if (m) {
        taskUnique.push(memberStripItem(m, "pt-m", router));
      }
    } else if (tt === "group" && typeof r.group_id === "string") {
      const gid = r.group_id;
      const key = `g:${gid}`;
      if (seenSubject.has(key)) continue;
      seenSubject.add(key);
      taskUnique.push({
        key: `pt-g:${gid}`,
        uri: null,
        letter: "G",
        isGroup: true,
        onPress: () => router.push({ pathname: "/ministry/[id]", params: { id: gid } }),
      });
    }
  }

  const extra = Math.max(0, taskUnique.length - AVATAR_STRIP_MAX);
  const items: StripItem[] = taskUnique.slice(0, AVATAR_STRIP_MAX);

  const usedMemberIds = new Set<string>();
  for (const it of items) {
    const mid = memberIdFromTaskStripKey(it.key);
    if (mid) usedMemberIds.add(mid);
  }

  const padPool: Member[] = [];
  const seenPad = new Set<string>();
  for (const m of [...groupPadMembers, ...spotlightMembers, ...homeMembers]) {
    if (!m?.id || seenPad.has(m.id)) continue;
    seenPad.add(m.id);
    padPool.push(m);
  }

  for (const m of padPool) {
    if (items.length >= AVATAR_STRIP_MAX) break;
    if (usedMemberIds.has(m.id)) continue;
    usedMemberIds.add(m.id);
    items.push(memberStripItem(m, "pt-pad", router));
  }

  if (items.length === 0) {
    const safeMembers = Array.isArray(homeMembers) ? homeMembers : [];
    const fallback = safeMembers.slice(0, AVATAR_STRIP_MAX);
    for (const m of fallback) {
      items.push(memberStripItem(m, "pt-fallback", router));
    }
    return { items, extra: 0 };
  }

  return { items, extra };
}

function AvatarStrip({
  items,
  extraCount,
  dark,
  requestSurface,
}: {
  items: StripItem[];
  extraCount: number;
  dark?: boolean;
  /** Lime request cards: white ring on round avatars (readability on green). */
  requestSurface?: boolean;
}) {
  if (items.length === 0 && extraCount <= 0) return null;
  const imgStyle = [styles.avatarStripImg, requestSurface && styles.avatarStripImgOnLime];
  const groupStyle = [styles.avatarStripGroup, requestSurface && styles.avatarStripGroupOnLime];
  return (
    <View style={styles.avatarStrip}>
      {items.map((it, idx) => (
        <Pressable
          key={it.key}
          onPress={it.onPress}
          style={[styles.avatarStripPress, idx > 0 && styles.avatarStripOverlap]}
          hitSlop={6}
        >
          {it.isGroup ? (
            <View style={groupStyle}>
              <Ionicons name="layers-outline" size={14} color={colors.accent} />
            </View>
          ) : it.uri ? (
            <Image source={{ uri: it.uri }} style={imgStyle} />
          ) : (
            <MemberInitialAvatar
              initial={it.letter}
              size={28}
              textStyle={dark ? styles.avatarStripLetterDark : undefined}
            />
          )}
        </Pressable>
      ))}
      {extraCount > 0 ? (
        <View
          style={[
            styles.avatarStripMore,
            dark && styles.avatarStripMoreOnDark,
            requestSurface && styles.avatarStripMoreOnLime,
          ]}
        >
          <Text
            style={[
              styles.avatarStripMoreText,
              dark && styles.avatarStripMoreTextOnDark,
              requestSurface && styles.avatarStripMoreTextOnLime,
            ]}
          >
            +{extraCount}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export default function DashboardScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { can } = usePermissions();
  const { selectedBranch } = useBranch();
  const { unreadCount } = useNotifications();
  const { isOnline, syncing, checkConnectivity, lastSyncAt, downloadRunning, downloadProgressText } = useOfflineSync();
  const [, setClockTick] = useState(0);

  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [branchGroups, setBranchGroups] = useState<Group[]>([]);
  const [groupRequestCount, setGroupRequestCount] = useState(0);
  const [memberRequestCount, setMemberRequestCount] = useState(0);
  const [pendingTaskCount, setPendingTaskCount] = useState(0);
  const [countsLoading, setCountsLoading] = useState(false);
  const [recentSpotlightMembers, setRecentSpotlightMembers] = useState<Member[]>([]);
  const [recentSpotlightMode, setRecentSpotlightMode] = useState<"new_members" | "group_assignments">(
    "group_assignments"
  );
  const [spotlightLoading, setSpotlightLoading] = useState(false);
  const [activeTag, setActiveTag] = useState<"members" | "families" | "ministries" | "event">("members");
  const [lastSeen, setLastSeen] = useState<DashboardLastSeenCounts>({});
  const [groupRequestRows, setGroupRequestRows] = useState<Record<string, unknown>[]>([]);
  const [memberRequestRows, setMemberRequestRows] = useState<Record<string, unknown>[]>([]);
  const [tasksMine, setTasksMine] = useState<TaskItem[]>([]);
  /** Members in rosters of groups referenced by pending group tasks (for diverse task-card avatars). */
  const [taskStripGroupPadMembers, setTaskStripGroupPadMembers] = useState<Member[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [myFamilies, setMyFamilies] = useState<Family[]>([]);
  const [myFamiliesLoading, setMyFamiliesLoading] = useState(false);
  const [showMemberQrModal, setShowMemberQrModal] = useState(false);

  /** Prefer `profiles.first_name` from auth; if empty, use linked member row (same id) from directory — matches DB. */
  const firstName = useMemo(() => {
    const fromProfile = (user?.first_name || "").trim();
    if (fromProfile) return fromProfile;
    const uid = user?.id;
    if (uid) {
      const linked = members.find((m) => m.id === uid);
      const fromMember = (linked?.first_name || "").trim();
      if (fromMember) return fromMember;
    }
    const email = (user?.email || "").trim();
    if (email && email.includes("@")) {
      const local = email.split("@")[0]?.trim();
      if (local) return local;
    }
    return "there";
  }, [user?.first_name, user?.id, user?.email, members]);

  const homeMembers = useMemo(() => {
    const bid = selectedBranch?.id;
    return members.filter((m) => {
      const mb = (m as { branch_id?: string | null }).branch_id;
      if (!bid) return true;
      return mb != null && String(mb) === bid;
    });
  }, [members, selectedBranch?.id]);

  const memberById = useMemo(() => new Map(homeMembers.map((m) => [m.id, m])), [homeMembers]);

  const hasLinkedMember = Boolean(user?.id && members.some((m) => m.id === user.id));

  const loadMyFamilies = useCallback(async () => {
    const uid = user?.id;
    if (!uid || !members.some((m) => m.id === uid)) {
      setMyFamilies([]);
      return;
    }
    setMyFamiliesLoading(true);
    try {
      const list = await api.families.forMember(uid).catch(() => [] as Family[]);
      setMyFamilies(Array.isArray(list) ? list : []);
    } finally {
      setMyFamiliesLoading(false);
    }
  }, [user?.id, members]);

  useEffect(() => {
    void loadMyFamilies();
  }, [loadMyFamilies]);

  useEffect(() => {
    const id = setInterval(() => {
      setClockTick((v) => v + 1);
    }, 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [seen, cachedMembers] = await Promise.all([
        getDashboardLastSeenCounts(),
        getOfflineResourceCache<{ members: Member[]; total_count: number }>("members:list"),
      ]);
      if (!mounted) return;
      setLastSeen(seen);
      if (cachedMembers?.data?.members) {
        setMembers(Array.isArray(cachedMembers.data.members) ? cachedMembers.data.members : []);
      }
      try {
        const listPayload = await fetchAllMembersForDashboard();
        if (!mounted) return;
        setMembers(Array.isArray(listPayload?.members) ? listPayload.members : []);
        await setOfflineResourceCache("members:list", {
          members: Array.isArray(listPayload?.members) ? listPayload.members : [],
          total_count: Number(listPayload?.total_count || 0),
        });
      } catch {
        // keep cached members when offline
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedBranch?.id]);

  const dashboardFocusSkipRefresh = useRef(true);
  useFocusEffect(
    useCallback(() => {
      void getDashboardLastSeenCounts().then(setLastSeen);
      if (dashboardFocusSkipRefresh.current) {
        dashboardFocusSkipRefresh.current = false;
        return;
      }
      void refreshDashboardData().catch(() => {
        // keep existing dashboard state when refresh fails
      });
    }, [refreshDashboardData])
  );

  const canViewMemberRequests = can("view_member_requests") || can("approve_member_requests");
  const canAddMembers = can("add_members");
  const canViewGroupRequests = can("view_group_requests") || can("approve_group_requests");
  const canViewTasks = can("view_member_tasks") || can("view_group_tasks");

  const userAvatarUri = useMemo(() => {
    const raw = user?.profile_image;
    if (typeof raw === "string" && raw.trim()) return normalizeImageUri(raw.trim());
    return null;
  }, [user?.profile_image]);

  const refreshDashboardData = useCallback(async () => {
    setCountsLoading(true);
    setSpotlightLoading(true);
    try {
      const [gr, mr, taskList, recentSpot] = await Promise.all([
        canViewGroupRequests
          ? api.groupRequests.list({ status: "pending" }).catch(() => [])
          : Promise.resolve([]),
        canViewMemberRequests
          ? api.memberRequests.list({ status: "pending" }).catch(() => [])
          : Promise.resolve([]),
        canViewTasks
          ? api.tasks.mine({ status: "all", limit: 50 }).catch(() => ({ tasks: [] as TaskItem[], total_count: 0 }))
          : Promise.resolve({ tasks: [] as TaskItem[], total_count: 0 }),
        api.dashboard.recentMembers({ limit: RECENT_MEMBERS_SPOTLIGHT_MAX }).catch(() => ({
          mode: "group_assignments" as const,
          members: [] as Member[],
        })),
      ]);
      const safeRecentMembers = (
        Array.isArray(recentSpot?.members) && recentSpot.members.length > 0
          ? recentSpot.members
          : homeMembers.slice(0, RECENT_MEMBERS_SPOTLIGHT_MAX)
      ).filter((m) => Boolean(m && typeof m === "object" && typeof (m as { id?: unknown }).id === "string"));
      setRecentSpotlightMembers(safeRecentMembers);
      setRecentSpotlightMode(
        recentSpot?.mode === "new_members" || recentSpot?.mode === "group_assignments"
          ? recentSpot.mode
          : "group_assignments"
      );
      const grArr = Array.isArray(gr) ? (gr as Record<string, unknown>[]) : [];
      const mrArr = Array.isArray(mr) ? (mr as Record<string, unknown>[]) : [];
      setGroupRequestRows(grArr);
      setMemberRequestRows(mrArr);
      setGroupRequestCount(grArr.length);
      setMemberRequestCount(mrArr.length);
      const list = taskList.tasks;
      setTasksMine(list);
      setPendingTaskCount(
        list.filter((t) => String(t.status || "").toLowerCase() === "pending").length
      );
    } finally {
      setCountsLoading(false);
      setSpotlightLoading(false);
    }
  }, [canViewGroupRequests, canViewMemberRequests, canViewTasks, selectedBranch?.id, homeMembers]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const bid = selectedBranch?.id;
      const rows = await api.groups.list({ tree: true }).catch(() => [] as Group[]);
      if (!mounted) return;
      const filtered = bid
        ? rows.filter((g) => String((g as { branch_id?: string | null }).branch_id || "") === bid)
        : rows;
      setBranchGroups(filtered);
    })();
    return () => {
      mounted = false;
    };
  }, [selectedBranch?.id]);

  useEffect(() => {
    void refreshDashboardData().catch(() => {
      // keep existing dashboard state when refresh fails
    });
  }, [refreshDashboardData]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pending = tasksMine.filter((t) => String(t.status || "").toLowerCase() === "pending");
      const source = pending.length > 0 ? pending : tasksMine;
      const gids = [
        ...new Set(
          source
            .filter((t) => String((t as { task_type?: string }).task_type) === "group")
            .map((t) => String((t as { group_id?: string }).group_id || "").trim())
            .filter(Boolean)
        ),
      ].slice(0, 6);

      if (gids.length === 0) {
        if (!cancelled) setTaskStripGroupPadMembers([]);
        return;
      }

      const lists = await Promise.all(gids.map((gid) => api.groups.members(gid).catch(() => [])));
      if (cancelled) return;

      const midOrder: string[] = [];
      const seenMid = new Set<string>();
      for (const rows of lists) {
        for (const row of rows) {
          const mid = rowMemberIdFromGroupRow(row);
          if (mid && !seenMid.has(mid)) {
            seenMid.add(mid);
            midOrder.push(mid);
          }
        }
      }

      const map = new Map(homeMembers.map((m) => [m.id, m]));
      const resolved: Member[] = [];
      for (const mid of midOrder) {
        const m = map.get(mid);
        if (m) resolved.push(m);
      }
      setTaskStripGroupPadMembers(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [tasksMine, homeMembers]);

  const homeShuffledGroupJoin = useMemo(
    () => shuffleMembersForStrip(homeMembers, `dash-gjr:${selectedBranch?.id || "x"}`),
    [homeMembers, selectedBranch?.id]
  );
  const homeShuffledMemberJoin = useMemo(
    () => shuffleMembersForStrip(homeMembers, `dash-mjr:${selectedBranch?.id || "x"}`),
    [homeMembers, selectedBranch?.id]
  );

  const groupStrip = useMemo(
    () => groupJoinStrip(groupRequestRows, memberById, homeShuffledGroupJoin, router),
    [groupRequestRows, memberById, homeShuffledGroupJoin, router]
  );
  const memberStrip = useMemo(
    () => memberJoinStrip(memberRequestRows, memberById, homeShuffledMemberJoin, router),
    [memberRequestRows, memberById, homeShuffledMemberJoin, router]
  );
  const taskStrip = useMemo(
    () =>
      pendingTaskStrip(
        tasksMine,
        memberById,
        homeMembers,
        taskStripGroupPadMembers,
        recentSpotlightMembers,
        router
      ),
    [tasksMine, memberById, homeMembers, taskStripGroupPadMembers, recentSpotlightMembers, router]
  );

  const groupJoinNewDelta = useMemo(() => {
    if (!canViewGroupRequests) return 0;
    return Math.max(0, groupRequestCount - (lastSeen.groupRequests ?? 0));
  }, [canViewGroupRequests, groupRequestCount, lastSeen.groupRequests]);

  const memberJoinNewDelta = useMemo(() => {
    if (!canViewMemberRequests) return 0;
    return Math.max(0, memberRequestCount - (lastSeen.memberRequests ?? 0));
  }, [canViewMemberRequests, memberRequestCount, lastSeen.memberRequests]);

  const showNewTasks = canViewTasks && pendingTaskCount > (lastSeen.pendingTasks ?? 0);

  const membersSpotlightHint = useMemo(() => {
    if (recentSpotlightMode === "new_members") {
      return "Newest people added to this branch (org owners see everyone).";
    }
    return "Newest people added to ministries in your scope — or groups you lead when you have full-branch access.";
  }, [recentSpotlightMode]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      try {
        await checkConnectivity();
        const [seen, listPayload] = await Promise.all([
          getDashboardLastSeenCounts(),
          fetchAllMembersForDashboard(),
        ]);
        setLastSeen(seen);
        setMembers(Array.isArray(listPayload?.members) ? listPayload.members : []);
        await setOfflineResourceCache("members:list", {
          members: Array.isArray(listPayload?.members) ? listPayload.members : [],
          total_count: Number(listPayload?.total_count || 0),
        });
      } catch {
        // keep existing/cached dashboard data when offline refresh fails
      }
      try {
        await refreshDashboardData();
      } catch {
        // keep current dashboard cards when offline
      }
      try {
        await loadMyFamilies();
      } catch {
        // keep current family spotlight when offline
      }
    } finally {
      setRefreshing(false);
    }
  }, [refreshDashboardData, loadMyFamilies, checkConnectivity]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
      >
        <View style={styles.dashHeader}>
          <View style={styles.dashGreeting}>
            <Pressable
              onPress={() => router.push("/(tabs)/menu")}
              accessibilityLabel="Open settings"
              style={styles.profileImageBtn}
            >
              {userAvatarUri ? (
                <Image source={{ uri: userAvatarUri }} style={styles.profileImage} />
              ) : (
                <MemberInitialAvatar
                  initial={(user?.first_name || "U")[0]}
                  size={42}
                  textStyle={styles.profileImageFallbackText}
                />
              )}
            </Pressable>
            <View style={styles.greetingCopy}>
              <Text style={styles.hiText} numberOfLines={2}>
                Hi <Text style={styles.hiName}>{displayMemberWords(firstName)}</Text>
              </Text>
              <View style={styles.headerStatusRow}>
                <View style={[styles.headerStatusPill, !isOnline ? styles.headerStatusPillOffline : null]}>
                  <View style={[styles.headerStatusDot, { backgroundColor: isOnline ? "#16a34a" : "#dc2626" }]} />
                  <Text style={[styles.headerStatusText, !isOnline ? styles.headerStatusTextOffline : null]}>
                    {isOnline ? "Online" : "Offline"}
                  </Text>
                </View>
                <Text style={styles.headerStatusMeta}>Last sync {formatTimeAgo(lastSyncAt)}</Text>
              </View>
              {downloadRunning ? (
                <View style={styles.downloadStatusRow}>
                  <ActivityIndicator size="small" color={colors.accent} />
                  <Text style={styles.downloadStatusText} numberOfLines={1}>
                    Downloading: {downloadProgressText}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
          <View style={styles.headerActions}>
            <HeaderIconCircleButton
              disabled={syncing || refreshing}
              onPress={() => void onRefresh()}
              accessibilityLabel="Reload dashboard"
            >
              <Ionicons
                name={syncing || refreshing ? "sync-outline" : "refresh-outline"}
                size={sizes.headerIcon}
                color={colors.textPrimary}
              />
            </HeaderIconCircleButton>
            <HeaderIconCircleButton onPress={() => router.push("/notifications")} accessibilityLabel="Notifications">
              <Ionicons name="notifications-outline" size={sizes.headerIcon} color={colors.textPrimary} />
              {unreadCount > 0 ? (
                <View style={styles.notifBadge}>
                  <Text style={styles.notifBadgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
                </View>
              ) : null}
            </HeaderIconCircleButton>
          </View>
        </View>

        <View style={styles.searchRow}>
          <Pressable
            style={styles.searchField}
            onPress={() => router.push("/search")}
            accessibilityLabel="Open search"
          >
            <Ionicons name="search-outline" size={sizes.headerIcon} color={colors.textSecondary} />
            <Text style={styles.searchPlaceholderText}>Search members</Text>
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tagRow}
          keyboardShouldPersistTaps="handled"
        >
          {(
            [
              { id: "members" as const, label: "Members", icon: "people-outline" as const, href: "/(tabs)/members" as const },
              { id: "families" as const, label: "Families", icon: "home-outline" as const, href: "/families" as const },
              { id: "ministries" as const, label: "Ministries", icon: "layers-outline" as const, href: "/(tabs)/ministries" as const },
              { id: "event" as const, label: "Event", icon: "calendar-outline" as const, href: "/(tabs)/event" as const },
            ] as const
          ).map((tag) => {
            const selected = activeTag === tag.id;
            const addMemberChip = tag.id === "members" && canAddMembers;
            const displayLabel = addMemberChip ? "+ Member" : tag.label;
            const displayIcon = addMemberChip ? ("add-outline" as const) : tag.icon;
            return (
              <Pressable
                key={tag.id}
                accessibilityLabel={addMemberChip ? "Add member with QR code" : undefined}
                onPress={() => {
                  if (addMemberChip) {
                    if (!getMemberJoinRegisterUrl(selectedBranch?.id, user?.branch_id)) {
                      Alert.alert("Branch required", "Select a branch first to generate member join QR.");
                      return;
                    }
                    setShowMemberQrModal(true);
                    return;
                  }
                  setActiveTag(tag.id);
                  router.push(tag.href);
                }}
                style={[styles.tagChip, selected && styles.tagChipActive]}
              >
                <Ionicons
                  name={displayIcon}
                  size={16}
                  color={selected ? "#ffffff" : colors.textSecondary}
                />
                <Text style={[styles.tagChipText, selected && styles.tagChipTextActive]}>{displayLabel}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.summaryGrid}>
          <View style={styles.summaryRow}>
            <Pressable
              style={[styles.summaryCard, styles.summaryCardRequest]}
              onPress={() => {
                void setDashboardLastSeenCounts({ groupRequests: groupRequestCount });
                setLastSeen((s) => ({ ...s, groupRequests: groupRequestCount }));
                router.push("/group-join-requests");
              }}
            >
              <View style={styles.requestCardTopRow}>
                <View style={styles.requestTitleBlock}>
                  <Text style={styles.requestCardTitle} numberOfLines={2}>
                    Group Join Requests
                  </Text>
                  {groupJoinNewDelta > 0 ? (
                    <View
                      style={styles.requestCountTag}
                      accessibilityLabel={`${groupJoinNewDelta} new group join requests since you last opened this list`}
                    >
                      <Text style={styles.requestCountTagText}>
                        {groupJoinNewDelta > 99 ? "99+" : String(groupJoinNewDelta)}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.requestJumpCircle}>
                  <Ionicons name="arrow-up-outline" size={14} color="#365314" />
                </View>
              </View>
              <Text style={styles.requestCardSubtitle}>
                {countsLoading ? "Loading requests..." : canViewGroupRequests ? `${groupRequestCount} pending requests` : "No access"}
              </Text>
              <AvatarStrip requestSurface items={groupStrip.items} extraCount={groupStrip.extra} />
            </Pressable>
            <Pressable
              style={[styles.summaryCard, styles.summaryCardRequest]}
              onPress={() => {
                void setDashboardLastSeenCounts({ memberRequests: memberRequestCount });
                setLastSeen((s) => ({ ...s, memberRequests: memberRequestCount }));
                router.push("/member-join-requests");
              }}
            >
              <View style={styles.requestCardTopRow}>
                <View style={styles.requestTitleBlock}>
                  <Text style={styles.requestCardTitle} numberOfLines={2}>
                    Member Join Requests
                  </Text>
                  {memberJoinNewDelta > 0 ? (
                    <View
                      style={styles.requestCountTag}
                      accessibilityLabel={`${memberJoinNewDelta} new member join requests since you last opened this list`}
                    >
                      <Text style={styles.requestCountTagText}>
                        {memberJoinNewDelta > 99 ? "99+" : String(memberJoinNewDelta)}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.requestJumpCircle}>
                  <Ionicons name="arrow-up-outline" size={14} color="#365314" />
                </View>
              </View>
              <Text style={styles.requestCardSubtitle}>
                {countsLoading ? "Loading requests..." : canViewMemberRequests ? `${memberRequestCount} pending requests` : "No access"}
              </Text>
              <AvatarStrip requestSurface items={memberStrip.items} extraCount={memberStrip.extra} />
            </Pressable>
          </View>
          <View style={styles.summaryRow}>
            <Pressable
              style={[styles.summaryCard, styles.summaryCardDark]}
              onPress={() => {
                void setDashboardLastSeenCounts({ pendingTasks: pendingTaskCount });
                setLastSeen((s) => ({ ...s, pendingTasks: pendingTaskCount }));
                router.push({ pathname: "/(tabs)/task", params: { pending: "1" } });
              }}
            >
              <View style={styles.summaryCardTop}>
                <View style={styles.summaryCardTextBlock}>
                  <View style={styles.summaryTitleRow}>
                    <Text style={[styles.summaryCardTitle, styles.summaryCardTitleOnDark]}>Task Pending</Text>
                    {showNewTasks ? (
                      <View style={styles.newPillDark}>
                        <View style={styles.newDotDark} />
                        <Text style={styles.newPillTextDark}>New</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.summaryCardCount, styles.summaryCardCountOnDark]}>
                    {countsLoading ? "—" : canViewTasks ? `${pendingTaskCount} tasks` : "—"}
                  </Text>
                </View>
                <View style={[styles.summaryIconCircle, styles.summaryIconCircleOnDark]}>
                  <Ionicons name="list-outline" size={22} color="#ffffff" />
                </View>
              </View>
              <AvatarStrip dark items={taskStrip.items} extraCount={taskStrip.extra} />
            </Pressable>
          </View>
        </View>

        {hasLinkedMember && !myFamiliesLoading && myFamilies.length > 0 ? (
          <View style={styles.myFamiliesSection}>
            <View style={styles.spotlightHeader}>
              <Text style={styles.spotlightTitle}>Your families</Text>
              <Pressable onPress={() => router.push("/families")} hitSlop={8}>
                <Text style={styles.viewAllText}>View all</Text>
              </Pressable>
            </View>
            <Text style={styles.spotlightHint}>Family groups your member profile is linked to.</Text>
            <View style={styles.myFamiliesList}>
              {myFamilies.map((f) => {
                const label = String(f.family_name || "Family").trim() || "Family";
                return (
                  <Pressable
                    key={f.id}
                    style={styles.myFamilyRow}
                    onPress={() =>
                      router.push({
                        pathname: "/family/[id]",
                        params: { id: f.id, name: encodeURIComponent(label) },
                      })
                    }
                  >
                    <View style={styles.myFamilyIcon}>
                      <Ionicons name="home-outline" size={20} color={colors.accent} />
                    </View>
                    <Text style={styles.myFamilyName} numberOfLines={2}>
                      {displayMemberWords(label)}
                    </Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        <View style={styles.spotlightSection}>
          <View style={styles.spotlightHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.spotlightTitle}>Recent members</Text>
              {!spotlightLoading && !countsLoading ? (
                <Text style={styles.spotlightModeTag}>
                  {recentSpotlightMode === "new_members" ? "Branch newcomers" : "Ministry activity"}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={() => router.push("/(tabs)/members")} hitSlop={8}>
              <Text style={styles.viewAllText}>View all</Text>
            </Pressable>
          </View>
          <Text style={styles.spotlightHint}>{membersSpotlightHint}</Text>
          {spotlightLoading || membersLoading || countsLoading ? (
            <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />
          ) : recentSpotlightMembers.length === 0 ? (
            <Text style={styles.homeMembersEmpty}>
              {recentSpotlightMode === "new_members"
                ? "No new members in this branch yet."
                : "No recent ministry joins in your scope yet. Open Members to browse the directory."}
            </Text>
          ) : (
            <View style={styles.spotlightList}>
              {recentSpotlightMembers.slice(0, RECENT_MEMBERS_SPOTLIGHT_MAX).map((m) => {
                const imageUri = normalizeImageUri(firstValidImageUri(m));
                return (
                  <Pressable
                    key={`dash-m-${m.id}`}
                    style={styles.spotlightRow}
                    onPress={() => router.push({ pathname: "/member/[id]", params: { id: m.id } })}
                  >
                    {imageUri ? (
                      <Image source={{ uri: imageUri }} style={styles.spotlightAvatar} />
                    ) : (
                      <MemberInitialAvatar initial={m.first_name?.[0] || "M"} size={44} />
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.spotlightName}>
                        {displayMemberWords(`${m.first_name || ""} ${m.last_name || ""}`.trim() || "Member")}
                      </Text>
                      <Text style={styles.spotlightBadge}>Member</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

      </ScrollView>

      <MemberJoinQrModal visible={showMemberQrModal} onClose={() => setShowMemberQrModal(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  container: { padding: 16, gap: 12, paddingBottom: 120 },
  dashHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 8,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  greetingCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  headerStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  headerStatusPill: {
    minHeight: 20,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    backgroundColor: "#e8f7ee",
    borderWidth: 1,
    borderColor: "#86efac",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  headerStatusPillOffline: {
    backgroundColor: "#fff1f2",
    borderColor: "#fecaca",
  },
  headerStatusDot: { width: 7, height: 7, borderRadius: 3.5 },
  headerStatusText: {
    fontSize: 11,
    color: "#166534",
    fontWeight: "700",
  },
  headerStatusTextOffline: {
    color: "#b91c1c",
  },
  headerStatusMeta: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  downloadStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  downloadStatusText: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    color: colors.accent,
    fontWeight: "600",
  },
  dashGreeting: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
    gap: 12,
  },
  hiText: {
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: colors.textPrimary,
    fontWeight: type.body.weight,
  },
  hiName: { fontWeight: type.title.weight },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  searchField: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: "#d9dce1",
    backgroundColor: "#ffffff",
  },
  searchPlaceholderText: {
    flex: 1,
    paddingVertical: 8,
    fontSize: 15,
    lineHeight: 20,
    color: "#9ca3af",
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingBottom: 4,
    marginBottom: 4,
  },
  tagChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: "#d9dce1",
    backgroundColor: "#f8fafc",
  },
  tagChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 2,
  },
  tagChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#4b5563",
  },
  tagChipTextActive: {
    color: "#ffffff",
  },
  notifBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  notifBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  profileImageBtn: {},
  profileImage: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#e5e7eb",
    borderWidth: 1,
    borderColor: colors.border,
  },
  profileImageFallback: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
  },
  profileImageFallbackText: { color: "#fff", fontSize: type.bodyStrong.size, fontWeight: "700" },
  summaryGrid: { gap: 12, marginTop: 4 },
  summaryRow: { flexDirection: "row", gap: 12, alignItems: "stretch" },
  summaryCard: {
    flex: 1,
    minHeight: 132,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    justifyContent: "space-between",
  },
  summaryCardRequest: {
    minHeight: 190,
    borderRadius: 20,
    borderColor: "#9dcc70",
    backgroundColor: "#b9e68c",
    justifyContent: "flex-start",
    gap: 8,
  },
  requestCardTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  requestTitleBlock: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  requestCountTag: {
    minWidth: 24,
    minHeight: 24,
    borderRadius: 12,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 7,
  },
  requestCountTagText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
  },
  requestJumpCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#84cc16",
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  requestCardTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    fontWeight: "700",
    color: "#1a2e05",
  },
  requestCardSubtitle: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: "#3f6212",
  },
  summaryCardMint: {
    backgroundColor: colors.accentSurface,
    borderColor: colors.accentBorder,
  },
  summaryCardSky: {
    backgroundColor: "#eff6ff",
    borderColor: "#bfdbfe",
  },
  summaryCardDark: {
    backgroundColor: "#1e293b",
    borderColor: "#1e293b",
  },
  summaryCardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  summaryCardTextBlock: { flex: 1, minWidth: 0 },
  summaryTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  newPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: "#fee2e2",
  },
  newDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#ef4444",
  },
  newPillText: { fontSize: 11, fontWeight: "800", color: "#b91c1c" },
  newPillDark: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  newDotDark: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#fca5a5",
  },
  newPillTextDark: { fontSize: 11, fontWeight: "800", color: "#fecaca" },
  avatarStrip: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    minHeight: 28,
    paddingLeft: 2,
  },
  avatarStripPress: {},
  avatarStripOverlap: { marginLeft: -10 },
  avatarStripImg: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#e5e7eb" },
  avatarStripImgOnLime: {
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.85)",
  },
  avatarStripStub: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarStripLetter: { fontSize: 11, fontWeight: "800", color: colors.textPrimary },
  avatarStripStubDark: { backgroundColor: "rgba(255,255,255,0.18)" },
  avatarStripLetterDark: { color: "#ffffff" },
  avatarStripMoreOnDark: { backgroundColor: "rgba(255,255,255,0.14)" },
  avatarStripMoreTextOnDark: { color: "rgba(255,255,255,0.85)" },
  avatarStripGroup: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accentSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarStripGroupOnLime: {
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.85)",
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  avatarStripMoreOnLime: {
    backgroundColor: "rgba(255,255,255,0.5)",
    borderWidth: 1,
    borderColor: "rgba(77,124,15,0.35)",
  },
  avatarStripMoreTextOnLime: {
    color: "#365314",
    fontWeight: "800",
  },
  avatarStripMore: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    paddingHorizontal: 6,
    backgroundColor: "rgba(0,0,0,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarStripMoreText: { fontSize: 11, fontWeight: "800", color: colors.textSecondary },
  summaryCardTitle: {
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    fontWeight: type.bodyStrong.weight,
    color: colors.textPrimary,
  },
  summaryCardTitleOnDark: { color: "#ffffff" },
  summaryCardCount: {
    marginTop: 6,
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.textSecondary,
    fontWeight: type.bodyStrong.weight,
  },
  summaryCardCountOnDark: { color: "rgba(255,255,255,0.85)" },
  summaryIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.9)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.accentBorder,
  },
  summaryIconCircleBlue: {
    borderColor: colors.accentBorder,
    backgroundColor: "#ffffff",
  },
  summaryIconCircleOnDark: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderColor: "rgba(255,255,255,0.2)",
  },
  spotlightSection: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
    gap: 8,
  },
  spotlightHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  spotlightTitle: {
    fontSize: type.title.size,
    lineHeight: type.title.lineHeight,
    fontWeight: type.title.weight,
    color: colors.textPrimary,
  },
  spotlightModeTag: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "700",
    color: colors.accent,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  viewAllText: {
    fontSize: type.bodyStrong.size,
    fontWeight: type.bodyStrong.weight,
    color: colors.accent,
  },
  spotlightHint: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.textSecondary,
  },
  myFamiliesSection: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
    gap: 8,
  },
  myFamiliesList: { gap: 8, marginTop: 4 },
  myFamilyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  myFamilyIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.accentSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  myFamilyName: {
    flex: 1,
    minWidth: 0,
    fontSize: type.body.size,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  spotlightList: { gap: 8, marginTop: 4 },
  spotlightRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  spotlightAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#eee" },
  spotlightAvatarStub: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  spotlightAvatarLetter: { fontSize: type.bodyStrong.size, fontWeight: "700", color: colors.textPrimary },
  spotlightGroupIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accentSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  spotlightName: {
    fontSize: type.bodyStrong.size,
    fontWeight: type.bodyStrong.weight,
    color: colors.textPrimary,
  },
  spotlightBadge: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "600",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  homeMembersEmpty: {
    fontSize: type.body.size,
    color: colors.textSecondary,
    textAlign: "center",
    paddingVertical: 12,
  },
});
