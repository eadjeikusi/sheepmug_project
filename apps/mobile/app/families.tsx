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
import { useBranch } from "../contexts/BranchContext";
import { displayMemberWords } from "../lib/memberDisplayFormat";
import { getOfflineResourceCache, setOfflineResourceCache } from "../lib/storage";
import { colors, radius, sizes, type } from "../theme";

const PAGE_SIZE = 10;

export default function FamiliesListScreen() {
  const router = useRouter();
  const { selectedBranch } = useBranch();
  const [families, setFamilies] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const bid = selectedBranch?.id?.trim() || undefined;
      const cacheKey = `families:list:${bid || "all"}`;
      const cached = await getOfflineResourceCache<{ families: Family[] }>(cacheKey);
      if (cached?.data?.families) {
        const cachedList = Array.isArray(cached.data.families) ? cached.data.families : [];
        setFamilies(cachedList);
        setHasMore(cachedList.length === PAGE_SIZE);
      }
      const list = await api.families.list(
        bid ? { branch_id: bid, offset: 0, limit: PAGE_SIZE } : { offset: 0, limit: PAGE_SIZE }
      );
      setFamilies(Array.isArray(list) ? list : []);
      setHasMore(list.length === PAGE_SIZE);
      await setOfflineResourceCache(cacheKey, { families: Array.isArray(list) ? list : [] });
    } finally {
      setLoading(false);
    }
  }, [selectedBranch?.id]);

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
        .list(bid ? { branch_id: bid, offset: families.length, limit: PAGE_SIZE } : { offset: families.length, limit: PAGE_SIZE });
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

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={sizes.headerIcon} color={colors.textPrimary} />
        </Pressable>
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
  backBtn: { padding: 8 },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    fontWeight: type.pageTitle.weight,
    letterSpacing: type.pageTitle.letterSpacing,
    color: colors.textPrimary,
  },
  headerSpacer: { width: 40 },
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
