import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useRouter, type Href } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../lib/api";
import { usePermissions } from "../../hooks/usePermissions";
import { canAccessLeadersDirectory } from "@sheepmug/permissions-helpers";
import { useTheme } from "../../contexts/ThemeContext";
import { MemberInitialAvatar } from "../../components/MemberInitialAvatar";
import { displayMemberWords } from "../../lib/memberDisplayFormat";
import { colors as defaultColors, radius, sizes, type } from "../../theme";

const GRID_COLUMNS = 2;
const GRID_GAP = 10;
const GRID_H_PAD = 16;

type LeaderRow = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  group_count?: number;
};

function leaderTitle(l: LeaderRow): string {
  const n = `${String(l.first_name || "").trim()} ${String(l.last_name || "").trim()}`.trim();
  return n || String(l.email || "Leader");
}

export default function LeadersIndexScreen() {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const { can } = usePermissions();
  const { colors: themeColors } = useTheme();
  const canSee = canAccessLeadersDirectory(can);

  const tileWidth = Math.max(
    120,
    Math.floor((windowWidth - GRID_H_PAD * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS),
  );

  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [leaderSearch, setLeaderSearch] = useState("");

  const filteredRows = useMemo(() => {
    const q = leaderSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((l) => {
      const title = leaderTitle(l).toLowerCase();
      const email = String(l.email || "").toLowerCase();
      return title.includes(q) || email.includes(q);
    });
  }, [rows, leaderSearch]);

  const load = useCallback(async () => {
    if (!canSee) {
      setRows([]);
      setLoading(false);
      return;
    }
    try {
      const { leaders } = await api.reports.listLeaders();
      setRows(Array.isArray(leaders) ? leaders.filter((x: LeaderRow) => x?.id) : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canSee]);

  useEffect(() => {
    void load();
  }, [load]);

  const styles = useMemo(() => makeStyles(themeColors), [themeColors]);

  if (!canSee) {
    return (
      <View style={[styles.center, { backgroundColor: themeColors.bg }]}>
        <Text style={[styles.muted, { color: themeColors.textSecondary }]}>
          You do not have permission to view leaders.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: themeColors.bg }]}>
      <Text style={[styles.blurb, { color: themeColors.textSecondary }]}>
        Tap a leader for groups, members, tasks, and reports.
      </Text>
      <View
        style={[
          styles.searchFieldWrap,
          { borderColor: themeColors.border, backgroundColor: themeColors.card },
        ]}
      >
        <Ionicons name="search" size={sizes.headerIcon} color={themeColors.textSecondary} style={styles.searchIcon} />
        <TextInput
          value={leaderSearch}
          onChangeText={setLeaderSearch}
          placeholder="Search leaders by name or email"
          placeholderTextColor={themeColors.textSecondary}
          style={[styles.searchInput, { color: themeColors.textPrimary }]}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={themeColors.accent} />
      ) : (
        <FlatList
          data={filteredRows}
          keyExtractor={(item) => item.id}
          numColumns={GRID_COLUMNS}
          columnWrapperStyle={filteredRows.length > 0 ? styles.gridRow : undefined}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />
          }
          contentContainerStyle={styles.listContent}
          renderItem={({ item: l }) => {
            const uri = l.avatar_url?.trim();
            const count = typeof l.group_count === "number" ? l.group_count : 0;
            return (
              <Pressable
                style={[
                  styles.gridCard,
                  { width: tileWidth, borderColor: themeColors.border, backgroundColor: themeColors.card },
                ]}
                onPress={() => router.push((`/leaders/${l.id}`) as Href)}
                accessibilityLabel={`Leader ${leaderTitle(l)}`}
              >
                {uri ? (
                  <Image source={{ uri }} style={styles.gridAvatar} />
                ) : (
                  <MemberInitialAvatar
                    initial={(leaderTitle(l)[0] || "L").toUpperCase()}
                    size={64}
                    textStyle={styles.gridAvatarInitial}
                  />
                )}
                <Text style={[styles.gridName, { color: themeColors.textPrimary }]} numberOfLines={2}>
                  {displayMemberWords(leaderTitle(l))}
                </Text>
                {l.email ? (
                  <Text style={[styles.gridEmail, { color: themeColors.textSecondary }]} numberOfLines={1}>
                    {l.email}
                  </Text>
                ) : null}
                <View style={styles.gridMetaRow}>
                  <Text style={[styles.gridCount, { color: themeColors.accent }]}>{count}</Text>
                  <Text style={[styles.gridCountLabel, { color: themeColors.textSecondary }]}>
                    {count === 1 ? "group" : "groups"}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={themeColors.textSecondary}
                  style={styles.gridChevron}
                />
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text style={[styles.muted, { color: themeColors.textSecondary, marginTop: 24 }]}>
              {rows.length === 0
                ? "No leaders in your branch scope."
                : "No leaders match your search."}
            </Text>
          }
        />
      )}
    </View>
  );
}

function makeStyles(themeColors: { border: string; textPrimary: string }) {
  return StyleSheet.create({
    screen: { flex: 1, paddingHorizontal: GRID_H_PAD, paddingTop: 8 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    blurb: { ...type.caption, marginBottom: 10, lineHeight: 18 },
    searchFieldWrap: {
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      minHeight: 44,
      marginBottom: 12,
    },
    searchIcon: { marginRight: 8 },
    searchInput: {
      flex: 1,
      fontSize: type.body.size,
      lineHeight: type.body.lineHeight,
      paddingVertical: 8,
    },
    listContent: { paddingBottom: 28, flexGrow: 1 },
    gridRow: { justifyContent: "space-between", marginBottom: GRID_GAP },
    gridCard: {
      borderWidth: 1,
      borderRadius: radius.lg,
      paddingVertical: 14,
      paddingHorizontal: 10,
      alignItems: "center",
    },
    gridAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: defaultColors.border },
    gridAvatarInitial: { fontSize: 22, fontWeight: "700", color: themeColors.textPrimary },
    gridName: { ...type.bodyStrong, fontSize: 15, textAlign: "center", marginTop: 10, minHeight: 40 },
    gridEmail: { ...type.caption, textAlign: "center", marginTop: 2, width: "100%" },
    gridMetaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
    gridCount: { ...type.bodyStrong, fontSize: 16 },
    gridCountLabel: { ...type.caption, fontSize: 11 },
    gridChevron: { marginTop: 6 },
    muted: { ...type.body, textAlign: "center" },
  });
}
