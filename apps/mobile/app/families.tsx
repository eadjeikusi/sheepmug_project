import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { Family } from "@sheepmug/shared-api";
import { api } from "../lib/api";
import { HeaderIconCircleButton } from "../components/HeaderIconCircle";
import { useBranch } from "../contexts/BranchContext";
import { usePermissions } from "../hooks/usePermissions";
import { displayMemberWords } from "../lib/memberDisplayFormat";
import { getOfflineResourceCache, setOfflineResourceCache } from "../lib/storage";
import { colors, radius, sizes, type } from "../theme";

const PAGE_SIZE = 10;
const FAMILIES_FULL_FETCH_SIZE = 200;

async function fetchAllFamilies(branchId?: string): Promise<Family[]> {
  const out: Family[] = [];
  let offset = 0;
  while (true) {
    const page = await api.families.list(
      branchId ? { branch_id: branchId, offset, limit: FAMILIES_FULL_FETCH_SIZE } : { offset, limit: FAMILIES_FULL_FETCH_SIZE }
    );
    const rows = Array.isArray(page) ? page : [];
    out.push(...rows);
    if (rows.length < FAMILIES_FULL_FETCH_SIZE) break;
    offset += FAMILIES_FULL_FETCH_SIZE;
  }
  return out;
}

export default function FamiliesListScreen() {
  const router = useRouter();
  const { can } = usePermissions();
  const { selectedBranch } = useBranch();
  const [families, setFamilies] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    if (!can("view_families")) {
      setFamilies([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const bid = selectedBranch?.id?.trim() || undefined;
      const cacheKey = `families:list:${bid || "all"}`;
      const [cachedByBranch, cachedGlobal] = await Promise.all([
        getOfflineResourceCache<{ families: Family[] }>(cacheKey),
        getOfflineResourceCache<{ families: Family[] }>(bid ? "families:list" : "families:list:all"),
      ]);
      const cachedRows = cachedByBranch?.data?.families || cachedGlobal?.data?.families;
      if (cachedRows) {
        const cachedList = Array.isArray(cachedRows) ? cachedRows : [];
        setFamilies(cachedList);
        setHasMore(false);
      }
      try {
        const list = await fetchAllFamilies(bid);
        setFamilies(Array.isArray(list) ? list : []);
        setHasMore(false);
        await setOfflineResourceCache(cacheKey, { families: Array.isArray(list) ? list : [] });
      } catch {
        // keep cached families when offline
      }
    } finally {
      setLoading(false);
    }
  }, [selectedBranch?.id, can]);

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

  const loadMore = useCallback(async () => {
    if (loading || refreshing || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const bid = selectedBranch?.id?.trim() || undefined;
      const list = await api.families
        .list(bid ? { branch_id: bid, offset: families.length, limit: PAGE_SIZE } : { offset: families.length, limit: PAGE_SIZE })
        .catch(() => null);
      if (!list) return;
      setFamilies((prev) => {
        const merged = [...prev, ...list];
        void setOfflineResourceCache(`families:list:${bid || "all"}`, { families: merged });
        return merged;
      });
      setHasMore(list.length === PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  }, [families.length, hasMore, loading, loadingMore, refreshing, selectedBranch?.id]);

  const sorted = useMemo(() => {
    return [...families].sort((a, b) =>
      String(a.family_name || "").localeCompare(String(b.family_name || ""), undefined, {
        sensitivity: "base",
      })
    );
  }, [families]);

  if (!can("view_families")) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <HeaderIconCircleButton onPress={() => router.back()} hitSlop={12} accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={sizes.headerIcon} color={colors.textPrimary} />
          </HeaderIconCircleButton>
          <Text style={styles.headerTitle}>Families</Text>
          <View style={styles.headerSpacer} />
        </View>
        <Text style={styles.muted}>
          You do not have permission to view families. Ask an administrator if you need access.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <HeaderIconCircleButton onPress={() => router.back()} hitSlop={12} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={sizes.headerIcon} color={colors.textPrimary} />
        </HeaderIconCircleButton>
        <Text style={styles.headerTitle}>Families</Text>
        <View style={styles.headerSpacer} />
      </View>
      {loading && families.length === 0 ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.muted}>Loading families…</Text>
          </View>
        ) : sorted.length === 0 ? (
          <Text style={styles.muted}>No family groups in this branch yet.</Text>
        ) : (
          <FlatList
            data={sorted}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.scroll}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
            onEndReached={() => void loadMore()}
            onEndReachedThreshold={0.35}
            renderItem={({ item: f }) => {
              const label = String(f.family_name || "Family").trim() || "Family";
              return (
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  onPress={() =>
                    router.push({
                      pathname: "/family/[id]",
                      params: {
                        id: f.id,
                        name: encodeURIComponent(label),
                      },
                    })
                  }
                >
                  <View style={styles.rowIcon}>
                    <Ionicons name="home-outline" size={22} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.rowTitle} numberOfLines={2}>
                      {displayMemberWords(label)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                </Pressable>
              );
            }}
            ListFooterComponent={
              loadingMore ? (
                <View style={styles.footerLoader}>
                  <ActivityIndicator color={colors.accent} />
                </View>
              ) : null
            }
          />
        )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    fontWeight: type.pageTitle.weight,
    letterSpacing: type.pageTitle.letterSpacing,
    color: colors.textPrimary,
  },
  headerSpacer: { width: sizes.headerIconButton },
  scroll: { padding: 16, paddingBottom: 32 },
  centered: { alignItems: "center", gap: 10, paddingVertical: 24 },
  muted: {
    fontSize: type.body.size,
    color: colors.textSecondary,
    textAlign: "center",
    paddingVertical: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    marginBottom: 10,
  },
  rowPressed: { opacity: 0.92 },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.accentSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: {
    fontSize: type.body.size,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  footerLoader: {
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
