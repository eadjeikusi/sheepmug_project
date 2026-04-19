import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { Member } from "@sheepmug/shared-api";
import { MemberInitialAvatar } from "../../components/MemberInitialAvatar";
import { api } from "../../lib/api";
import { normalizeImageUri } from "../../lib/imageUri";
import { displayMemberWords } from "../../lib/memberDisplayFormat";
import { colors, radius, sizes, type } from "../../theme";

function firstValidImageUri(member: Member): string | null {
  const candidates = [
    member.avatar_url,
    member.member_url,
    member.profileImage as string | null | undefined,
    member.profile_image as string | null | undefined,
    member.memberimage_url as string | null | undefined,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

export default function FamilyMembersScreen() {
  const router = useRouter();
  const { id, name: nameParam } = useLocalSearchParams<{ id: string; name?: string }>();
  const familyId = typeof id === "string" ? id : "";
  const titleFromRoute =
    typeof nameParam === "string"
      ? (() => {
          try {
            return decodeURIComponent(nameParam);
          } catch {
            return nameParam;
          }
        })()
      : "";

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    if (!familyId) {
      setMembers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await api.families.members(familyId).catch(() => [] as Member[]);
      setMembers(Array.isArray(list) ? list : []);
    } finally {
      setLoading(false);
    }
  }, [familyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => {
      const blob = [m.first_name, m.last_name, m.email, m.phone]
        .map((x) => String(x || "").toLowerCase())
        .join(" ");
      return blob.includes(q);
    });
  }, [members, query]);

  const headerTitle = displayMemberWords(titleFromRoute.trim() || "Family");

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={sizes.headerIcon} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.screenTitle} numberOfLines={1}>
            {headerTitle}
          </Text>
          <Text style={styles.countLabel}>
            {loading ? "…" : `${filtered.length} member${filtered.length === 1 ? "" : "s"}`}
          </Text>
        </View>
        <View style={styles.backSpacer} />
      </View>

      <View style={styles.searchRow}>
        <TextInput
          placeholder="Filter results by name"
          placeholderTextColor={colors.textSecondary}
          value={query}
          onChangeText={setQuery}
          style={styles.input}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        <Pressable style={styles.searchAction} onPress={() => setQuery((v) => v.trim())}>
          <Ionicons name="search-outline" size={sizes.headerIcon} color={colors.textPrimary} />
        </Pressable>
      </View>

      {loading && members.length === 0 ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.helper}>Loading members…</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
          renderItem={({ item }) => {
            const imageUri = normalizeImageUri(firstValidImageUri(item));
            return (
              <Pressable
                style={styles.row}
                onPress={() =>
                  router.push({
                    pathname: "/member/[id]",
                    params: { id: item.id },
                  })
                }
              >
                <View style={styles.rowTop}>
                  {imageUri ? (
                    <Image source={{ uri: imageUri }} style={styles.avatarImage} />
                  ) : (
                    <MemberInitialAvatar initial={item.first_name?.[0] || "M"} size={40} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>
                      {displayMemberWords(`${item.first_name || ""} ${item.last_name || ""}`.trim())}
                    </Text>
                    <Text style={styles.meta}>
                      {displayMemberWords(String(item.status || "active").replace(/_/g, " "))}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text style={styles.helper}>{members.length === 0 ? "No members in this family." : "No members found"}</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backBtn: { padding: 8 },
  backSpacer: { width: 40 },
  titleBlock: { flex: 1, minWidth: 0 },
  screenTitle: {
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    fontWeight: type.pageTitle.weight,
    letterSpacing: type.pageTitle.letterSpacing,
    color: colors.textPrimary,
    textAlign: "center",
  },
  countLabel: {
    fontSize: type.caption.size,
    color: colors.textSecondary,
    textAlign: "center",
    marginTop: 2,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    backgroundColor: colors.card,
    fontSize: type.body.size,
    color: colors.textPrimary,
  },
  searchAction: {
    width: sizes.headerIconButton,
    height: sizes.headerIconButton,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  listContent: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 32 },
  loadingWrap: { alignItems: "center", gap: 10, paddingVertical: 24 },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    minHeight: 74,
    padding: 14,
    marginBottom: 4,
  },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatarImage: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: "#efefef",
  },
  avatarStub: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: "#efefef",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    fontWeight: type.bodyStrong.weight,
    color: "#3b3b3f",
  },
  name: {
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    fontWeight: type.subtitle.weight,
    color: colors.textPrimary,
  },
  meta: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.textSecondary,
    marginTop: 4,
    letterSpacing: type.caption.letterSpacing,
  },
  helper: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textSecondary,
    marginTop: 8,
    letterSpacing: type.body.letterSpacing,
  },
});
