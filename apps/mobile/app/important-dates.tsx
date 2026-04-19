import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { UpcomingImportantDateItem } from "@sheepmug/shared-api";
import { api } from "../lib/api";
import { colors, radius, sizes, type } from "../theme";
import { formatLongWeekdayDate } from "../lib/memberDisplayFormat";

const RANGE_OPTIONS: Array<{ id: number; label: string }> = [
  { id: 7, label: "7d" },
  { id: 30, label: "30d" },
  { id: 90, label: "90d" },
];

export default function ImportantDatesScreen() {
  const router = useRouter();
  const [items, setItems] = useState<UpcomingImportantDateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rangeDays, setRangeDays] = useState<number>(30);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.importantDates.upcoming({ range_days: rangeDays, q: search.trim() || undefined });
      setItems(Array.isArray(rows) ? rows : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [rangeDays, search]);

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

  const subtitle = useMemo(() => {
    return `${items.length} upcoming`;
  }, [items.length]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={sizes.headerIcon} color={colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.topTitle}>All Important Dates</Text>
          <Text style={styles.topSub}>{subtitle}</Text>
        </View>
      </View>

      <View style={styles.filters}>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={colors.textSecondary} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search member or title"
            placeholderTextColor={colors.textSecondary}
            style={styles.searchInput}
            autoCapitalize="none"
          />
        </View>
        <View style={styles.rangeRow}>
          {RANGE_OPTIONS.map((opt) => (
            <Pressable
              key={opt.id}
              onPress={() => setRangeDays(opt.id)}
              style={[styles.rangeChip, rangeDays === opt.id && styles.rangeChipOn]}
            >
              <Text style={[styles.rangeChipText, rangeDays === opt.id && styles.rangeChipTextOn]}>
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No upcoming important dates.</Text>}
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => router.push(`/member/${encodeURIComponent(item.member_id)}`)}
            >
              <View style={styles.cardHead}>
                <Text style={styles.member}>{item.member_display_name}</Text>
                <Text style={styles.days}>{item.days_until === 0 ? "Today" : `${item.days_until}d`}</Text>
              </View>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.meta}>
                {(formatLongWeekdayDate(item.occurs_on) || item.occurs_on) + (item.time_value ? ` · ${item.time_value}` : "")}
              </Text>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  topTitle: { fontSize: type.title.size, fontWeight: type.title.weight, color: colors.textPrimary },
  topSub: { fontSize: type.caption.size, color: colors.textSecondary },
  filters: { paddingHorizontal: 12, paddingTop: 12, gap: 10 },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: type.body.size },
  rangeRow: { flexDirection: "row", gap: 8 },
  rangeChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.card,
  },
  rangeChipOn: { borderColor: colors.accent, backgroundColor: colors.accentSurface },
  rangeChipText: { color: colors.textSecondary, fontSize: type.caption.size },
  rangeChipTextOn: { color: colors.accent, fontWeight: "700" },
  list: { padding: 12, gap: 10, paddingBottom: 24 },
  empty: { textAlign: "center", color: colors.textSecondary, marginTop: 24 },
  card: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
    gap: 4,
  },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  member: { color: colors.textPrimary, fontSize: type.bodyStrong.size, fontWeight: type.bodyStrong.weight },
  days: { color: colors.accent, fontSize: type.caption.size, fontWeight: "700" },
  title: { color: colors.textPrimary, fontSize: type.body.size, fontWeight: "600" },
  meta: { color: colors.textSecondary, fontSize: type.caption.size },
});
