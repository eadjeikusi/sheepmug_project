import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Group } from "@sheepmug/shared-api";
import { useRouter } from "expo-router";
import { AddMinistryModal } from "../../components/AddMinistryModal";
import { FilterResultsChips, FilterResultsHeaderCount } from "../../components/FilterResultsSection";
import { HeaderIconCircleButton } from "../../components/HeaderIconCircle";
import type { AnchorRect } from "../../components/FilterPickerModal";
import { FilterPickerModal } from "../../components/FilterPickerModal";
import { MinistryListSkeleton } from "../../components/DataSkeleton";
import { MinistriesGrid } from "../../components/MinistriesGrid";
import { api } from "../../lib/api";
import { getOfflineResourceCache, setOfflineResourceCache } from "../../lib/storage";
import { useGroupTypeOptions } from "../../hooks/useGroupTypeOptions";
import { usePermissions } from "../../hooks/usePermissions";
import { canCreateGroup } from "@sheepmug/permissions-helpers";
import { sortMinistriesGroups } from "../../lib/ministriesOrder";
import { colors, radius, sizes, type } from "../../theme";
import { useFocusEffect } from "@react-navigation/native";

const PAGE_SIZE = 10;
const MINISTRIES_CACHE_KEY = "ministries:list";

export default function MinistriesScreen() {
  const router = useRouter();
  const { can } = usePermissions();
  const canManageGroups = canCreateGroup(can);
  const { options: groupTypeOpts } = useGroupTypeOptions(true);
  const sortedGt = useMemo(
    () =>
      [...groupTypeOpts].sort(
        (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label),
      ),
    [groupTypeOpts],
  );
  const typeFilterOptions = useMemo(
    () => [{ value: "", label: "All types" }, ...sortedGt.map((o) => ({ value: o.label, label: o.label }))],
    [sortedGt],
  );
  const [typeFilter, setTypeFilter] = useState("");
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [typeAnchor, setTypeAnchor] = useState<AnchorRect | null>(null);
  const typeFilterRef = useRef<View>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<TextInput>(null);

  const loadGroups = useCallback(
    async (showSpinner: boolean, reset = true) => {
      if (showSpinner) setLoading(true);
      try {
        if (reset) {
          const cached = await getOfflineResourceCache<{ groups: Group[]; total_count: number }>(
            MINISTRIES_CACHE_KEY
          );
          if (cached?.data?.groups) {
            const cachedRows = sortMinistriesGroups(cached.data.groups);
            setGroups(cachedRows);
            setHasMore(false);
          }
        }
        const offset = reset ? 0 : groups.length;
        const data = await api.groups.list(
          typeFilter.trim()
            ? { group_type: typeFilter.trim(), offset, limit: PAGE_SIZE }
            : { offset, limit: PAGE_SIZE }
        );
        const nextRows = sortMinistriesGroups(data);
        setGroups((prev) => (reset ? nextRows : sortMinistriesGroups([...prev, ...nextRows])));
        setHasMore(nextRows.length === PAGE_SIZE);
        if (reset && !typeFilter.trim()) {
          await setOfflineResourceCache(MINISTRIES_CACHE_KEY, {
            groups: nextRows,
            total_count: nextRows.length,
          });
        }
      } catch {
        // keep cached groups when offline
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [groups.length, typeFilter]
  );

  useEffect(() => {
    void loadGroups(true, true);
  }, [loadGroups]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await loadGroups(false, true);
    } finally {
      setRefreshing(false);
    }
  }

  const onLoadMore = useCallback(async () => {
    if (loading || refreshing || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      await loadGroups(false, false);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadGroups, loading, loadingMore, refreshing]);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => (g.name || "").toLowerCase().includes(q));
  }, [groups, query]);

  const openTypeFilterMenu = useCallback(() => {
    typeFilterRef.current?.measureInWindow((x, y, w, h) => {
      setTypeAnchor({ x, y, width: w, height: h });
      setTypeMenuOpen(true);
    });
  }, []);

  const filterChips = useMemo(() => {
    const t = typeFilter.trim();
    if (!t) return [];
    return [{ key: "type", label: t, onLabelPress: openTypeFilterMenu }];
  }, [typeFilter, openTypeFilterMenu]);

  const clearAppliedFilters = useCallback(() => {
    setTypeFilter("");
  }, []);

  const removeFilterByKey = useCallback((key: string) => {
    if (key === "type") setTypeFilter("");
  }, []);

  function toggleSearch() {
    if (searchOpen) {
      setSearchOpen(false);
      setQuery("");
      Keyboard.dismiss();
    } else {
      setSearchOpen(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  useFocusEffect(
    useCallback(() => {
      return () => {
        setTypeMenuOpen(false);
        setTypeAnchor(null);
      };
    }, [])
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
        onScroll={(e) => {
          const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
          const nearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 220;
          if (nearBottom) void onLoadMore();
        }}
        scrollEventThrottle={120}
      >
        <View style={styles.topRow}>
          <View style={styles.titleBlock}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Ministries</Text>
              <FilterResultsHeaderCount count={filteredGroups.length} />
            </View>
          </View>
          <View style={styles.topActions}>
            {canManageGroups ? (
              <HeaderIconCircleButton accessibilityLabel="Add ministry" onPress={() => setAddOpen(true)} hitSlop={8}>
                <Ionicons name="add-outline" size={sizes.headerIcon} color={colors.textPrimary} />
              </HeaderIconCircleButton>
            ) : null}
            <View ref={typeFilterRef} collapsable={false}>
              <HeaderIconCircleButton
                accessibilityLabel={
                  typeFilter
                    ? `Filter by group type, ${typeFilter} selected. Opens menu.`
                    : "Filter by group type"
                }
                accessibilityState={{ selected: Boolean(typeFilter.trim()) }}
                onPress={openTypeFilterMenu}
                active={Boolean(typeFilter.trim()) || typeMenuOpen}
                hitSlop={8}
              >
                <Ionicons
                  name={typeFilter.trim() ? "filter" : "filter-outline"}
                  size={sizes.headerIcon}
                  color={typeFilter.trim() ? colors.accent : colors.textPrimary}
                />
              </HeaderIconCircleButton>
            </View>
            <HeaderIconCircleButton
              accessibilityLabel={searchOpen ? "Close search" : "Search ministries"}
              onPress={toggleSearch}
              active={searchOpen}
              hitSlop={8}
            >
              <Ionicons
                name={searchOpen ? "close-outline" : "search-outline"}
                size={sizes.headerIcon}
                color={colors.textPrimary}
              />
            </HeaderIconCircleButton>
          </View>
        </View>

        {searchOpen ? (
          <View style={styles.searchFieldWrap}>
            <Ionicons name="search" size={sizes.headerIcon} color={colors.textSecondary} style={styles.searchFieldIcon} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder="Search by group name"
              placeholderTextColor={colors.textSecondary}
              style={styles.searchInput}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />
          </View>
        ) : null}

        <FilterResultsChips
          chips={filterChips}
          onRemoveChip={removeFilterByKey}
          onClearAll={clearAppliedFilters}
        />

        {loading && groups.length === 0 ? (
          <MinistryListSkeleton count={5} />
        ) : filteredGroups.length === 0 ? (
          <Text style={styles.helper}>
            {groups.length === 0 ? "No ministries found." : "No ministries match your search."}
          </Text>
        ) : (
          <MinistriesGrid
            groups={filteredGroups}
            onPressItem={(g) => router.push({ pathname: "/ministry/[id]", params: { id: g.id } })}
          />
        )}
        {loadingMore ? (
          <View style={styles.footerLoader}>
            <Ionicons name="sync-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.helper}>Loading more...</Text>
          </View>
        ) : null}
      </ScrollView>

      <FilterPickerModal
        visible={typeMenuOpen && typeAnchor !== null}
        title="Group type"
        options={typeFilterOptions}
        selectedValue={typeFilter}
        anchorRect={typeAnchor}
        onSelect={(v) => {
          setTypeFilter(v);
          setTypeMenuOpen(false);
          setTypeAnchor(null);
        }}
        onClose={() => {
          setTypeMenuOpen(false);
          setTypeAnchor(null);
        }}
      />

      <AddMinistryModal
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={() => void loadGroups(false, true)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: 16, paddingBottom: 28, gap: 10 },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  topActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  titleBlock: { flex: 1, minWidth: 0, paddingRight: 10 },
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
  title: {
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    fontWeight: type.pageTitle.weight,
    color: colors.textPrimary,
    letterSpacing: type.pageTitle.letterSpacing,
  },
  searchFieldWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    minHeight: 46,
  },
  searchFieldIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textPrimary,
    paddingVertical: 8,
  },
  helper: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textSecondary,
    marginTop: 8,
    letterSpacing: type.body.letterSpacing,
  },
  footerLoader: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
});
