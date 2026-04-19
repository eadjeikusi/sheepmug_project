import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Group, Member } from "@sheepmug/shared-api";
import { MemberInitialAvatar } from "../components/MemberInitialAvatar";
import { api } from "../lib/api";
import { useBranch } from "../contexts/BranchContext";
import { getSearchHistory, prependSearchHistory } from "../lib/storage";
import { normalizeImageUri } from "../lib/imageUri";
import { displayMemberWords } from "../lib/memberDisplayFormat";
import { colors, radius, sizes, type } from "../theme";

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

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export default function SearchScreen() {
  const router = useRouter();
  const { selectedBranch } = useBranch();
  const params = useLocalSearchParams<{ q?: string }>();
  const initialQ = typeof params.q === "string" ? params.q : "";
  const [query, setQuery] = useState(initialQ);
  const debounced = useDebounced(query, 280);
  const [members, setMembers] = useState<Member[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadSearchData = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    try {
      const [mPayload, g, h] = await Promise.all([
        api.members.list({ limit: 100 }).catch(() => ({ members: [] as Member[], total_count: 0 })),
        api.groups.list({ tree: true, limit: 100 }).catch(() => [] as Group[]),
        getSearchHistory(),
      ]);
      setMembers(mPayload.members);
      setGroups(g);
      setHistory(h);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSearchData(true);
  }, [loadSearchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadSearchData(false);
    } finally {
      setRefreshing(false);
    }
  }, [loadSearchData]);

  const branchGroups = useMemo(() => {
    const bid = selectedBranch?.id;
    if (!bid) return groups;
    return groups.filter((g) => String((g as { branch_id?: string | null }).branch_id || "") === bid);
  }, [groups, selectedBranch?.id]);

  const branchMembers = useMemo(() => {
    const bid = selectedBranch?.id;
    return members.filter((m) => {
      const mb = (m as { branch_id?: string | null }).branch_id;
      if (!bid) return true;
      return mb != null && String(mb) === bid;
    });
  }, [members, selectedBranch?.id]);

  const qLower = debounced.trim().toLowerCase();

  const results = useMemo(() => {
    if (!qLower) return { members: [] as Member[], groups: [] as Group[] };
    const mem = branchMembers.filter((m) => {
      const blob = `${m.first_name || ""} ${m.last_name || ""} ${m.email || ""}`.toLowerCase();
      return blob.includes(qLower);
    });
    const grp = branchGroups.filter((g) => {
      const blob = `${g.name || ""} ${g.description || ""} ${g.group_type || ""}`.toLowerCase();
      return blob.includes(qLower);
    });
    return { members: mem.slice(0, 40), groups: grp.slice(0, 40) };
  }, [branchMembers, branchGroups, qLower]);

  const onPickMember = useCallback(
    (m: Member) => {
      void prependSearchHistory(`${m.first_name || ""} ${m.last_name || ""}`.trim() || "Member");
      router.dismiss();
      router.push({ pathname: "/member/[id]", params: { id: m.id } });
    },
    [router]
  );

  const onPickGroup = useCallback(
    (g: Group) => {
      void prependSearchHistory(String(g.name || "Ministry"));
      router.dismiss();
      router.push({ pathname: "/ministry/[id]", params: { id: String(g.id) } });
    },
    [router]
  );

  const onPickHistory = useCallback((h: string) => {
    setQuery(h);
  }, []);

  const listData = useMemo(() => {
    const rows: { key: string; kind: "member" | "group"; member?: Member; group?: Group }[] = [];
    for (const m of results.members) {
      rows.push({ key: `m:${m.id}`, kind: "member", member: m });
    }
    for (const g of results.groups) {
      rows.push({ key: `g:${g.id}`, kind: "group", group: g });
    }
    return rows;
  }, [results]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.toolbar}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Close search">
          <Ionicons name="close" size={26} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.searchField}>
          <Ionicons name="search-outline" size={sizes.headerIcon} color={colors.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search members"
            placeholderTextColor={colors.textSecondary}
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
            autoFocus
            returnKeyType="search"
          />
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : !qLower ? (
        <ScrollView
          contentContainerStyle={styles.historyBlock}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
        >
          <Text style={styles.historyTitle}>Recent</Text>
          {history.length === 0 ? (
            <Text style={styles.muted}>No recent searches yet.</Text>
          ) : (
            history.map((h) => (
              <Pressable key={h} style={styles.historyRow} onPress={() => onPickHistory(h)}>
                <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
                <Text style={styles.historyText} numberOfLines={1}>
                  {displayMemberWords(h)}
                </Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item) => item.key}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <Text style={styles.muted}>No matches for “{debounced.trim()}”.</Text>
          }
          renderItem={({ item }) => {
            if (item.kind === "member" && item.member) {
              const m = item.member;
              const uri = normalizeImageUri(firstValidImageUri(m));
              const name = `${m.first_name || ""} ${m.last_name || ""}`.trim() || "Member";
              return (
                <Pressable style={styles.row} onPress={() => onPickMember(m)}>
                  {uri ? (
                    <Image source={{ uri }} style={styles.avatar} />
                  ) : (
                    <MemberInitialAvatar initial={m.first_name?.[0] || "M"} size={44} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{displayMemberWords(name)}</Text>
                    <Text style={styles.rowSub}>Member</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </Pressable>
              );
            }
            if (item.kind === "group" && item.group) {
              const g = item.group;
              return (
                <Pressable style={styles.row} onPress={() => onPickGroup(g)}>
                  <View style={styles.groupIcon}>
                    <Ionicons name="layers-outline" size={22} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={2}>
                      {displayMemberWords(String(g.name || "Ministry"))}
                    </Text>
                    <Text style={styles.rowSub}>Ministry</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </Pressable>
              );
            }
            return null;
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
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
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 8,
    fontSize: 16,
    color: colors.textPrimary,
  },
  historyBlock: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  historyTitle: {
    fontSize: type.caption.size,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  historyText: { flex: 1, fontSize: type.body.size, color: colors.textPrimary },
  muted: { fontSize: type.body.size, color: colors.textSecondary, paddingHorizontal: 16, paddingTop: 12 },
  listContent: { paddingHorizontal: 16, paddingBottom: 32, gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#eee" },
  avatarStub: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: { fontSize: type.bodyStrong.size, fontWeight: "700", color: colors.textPrimary },
  groupIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#eef2ff",
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: { fontSize: type.bodyStrong.size, fontWeight: "600", color: colors.textPrimary },
  rowSub: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "600",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
});
