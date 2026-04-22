import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import type { Member } from "@sheepmug/shared-api";
import { ApiError } from "@sheepmug/shared-api";
import { HeaderIconCircleButton } from "../components/HeaderIconCircle";
import { MemberInitialAvatar } from "../components/MemberInitialAvatar";
import { api } from "../lib/api";
import { displayMemberWords } from "../lib/memberDisplayFormat";
import { normalizeImageUri } from "../lib/imageUri";
import { usePermissions } from "../hooks/usePermissions";
import { colors, radius, sizes, type } from "../theme";

const PAGE = 50;

function memberName(m: Member): string {
  const fn = String(m.first_name || "").trim();
  const ln = String(m.last_name || "").trim();
  const n = `${fn} ${ln}`.trim();
  return n || "Member";
}

function firstImage(m: Member): string | null {
  const c = [m.avatar_url, m.member_url, (m as { profile_image?: string }).profile_image];
  for (const x of c) {
    if (typeof x === "string" && x.trim()) return normalizeImageUri(x.trim());
  }
  return null;
}

export default function MembersDeletedScreen() {
  const router = useRouter();
  const { can } = usePermissions();
  const canViewDeleted = can("view_deleted_members");
  const canPurge = can("delete_members");

  const [rows, setRows] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [purging, setPurging] = useState(false);

  const load = useCallback(async () => {
    if (!canViewDeleted) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const first = await api.members.list({
        deleted_only: true,
        limit: PAGE,
        offset: 0,
      });
      const out: Member[] = [...first.members];
      const total = first.total_count;
      let offset = first.members.length;
      while (out.length < total && offset < total) {
        const next = await api.members.list({
          deleted_only: true,
          limit: PAGE,
          offset,
        });
        out.push(...next.members);
        if (next.members.length < PAGE) break;
        offset += next.members.length;
        if (offset > 10000) break;
      }
      setRows(out);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [canViewDeleted]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (selected.size === rows.length) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(rows.map((m) => m.id)));
  }, [rows, selected.size]);

  const runPurge = useCallback(() => {
    const ids = Array.from(selected);
    if (ids.length === 0 || !canPurge) return;
    Alert.alert(
      "Delete permanently",
      `Remove ${ids.length} member(s) from the directory forever? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete permanently",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setPurging(true);
              try {
                const res = await api.members.batchPurge(ids);
                setSelected(new Set());
                await load();
                if (res.errors && res.errors.length > 0) {
                  Alert.alert(
                    "Partial result",
                    `${res.purged} removed. Some errors:\n${res.errors.slice(0, 5).join("\n")}`,
                  );
                }
              } catch (e) {
                const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Could not delete";
                Alert.alert("Delete", msg);
              } finally {
                setPurging(false);
              }
            })();
          },
        },
      ]
    );
  }, [canPurge, selected, load]);

  const headerTitle = useMemo(() => "Deleted members", []);

  if (!canViewDeleted) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.topBar}>
          <HeaderIconCircleButton onPress={() => router.back()} hitSlop={12} accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={sizes.headerIcon} color={colors.textPrimary} />
          </HeaderIconCircleButton>
          <Text style={styles.topTitle}>{headerTitle}</Text>
          <View style={{ width: sizes.headerIconButton }} />
        </View>
        <View style={styles.centerMsg}>
          <Text style={styles.muted}>You do not have permission to view deleted members.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <HeaderIconCircleButton onPress={() => router.back()} hitSlop={12} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={sizes.headerIcon} color={colors.textPrimary} />
        </HeaderIconCircleButton>
        <Text style={styles.topTitle} numberOfLines={1}>
          {headerTitle}
        </Text>
        <View style={{ width: sizes.headerIconButton }} />
      </View>

      {canPurge && selected.size > 0 ? (
        <View style={styles.bulkBar}>
          <Text style={styles.bulkText}>
            {selected.size} selected
          </Text>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={selectAll}
            style={styles.bulkSecondary}
            disabled={purging}
          >
            <Text style={styles.bulkSecondaryText}>{selected.size === rows.length ? "Clear all" : "Select all"}</Text>
          </Pressable>
          <Pressable
            onPress={runPurge}
            style={[styles.bulkDanger, purging && styles.bulkDisabled]}
            disabled={purging}
          >
            {purging ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="trash-outline" size={18} color="#fff" />
                <Text style={styles.bulkDangerText}>Delete permanently</Text>
              </>
            )}
          </Pressable>
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <Text style={styles.muted}>No deleted members in this branch.</Text>
          }
          renderItem={({ item }) => {
            const on = selected.has(item.id);
            const uri = firstImage(item);
            const name = memberName(item);
            const initial = (name.trim()[0] || "M").toUpperCase();
            const RowInner = (
              <>
                {canPurge ? (
                  <View style={[styles.check, on && styles.checkOn]}>
                    {on ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                  </View>
                ) : null}
                {uri ? (
                  <Image source={{ uri }} style={styles.avatarImg} />
                ) : (
                  <MemberInitialAvatar initial={initial} size={40} />
                )}
                <View style={styles.rowText}>
                  <Text style={styles.name} numberOfLines={1}>
                    {displayMemberWords(name)}
                  </Text>
                  {item.email ? (
                    <Text style={styles.sub} numberOfLines={1}>
                      {item.email}
                    </Text>
                  ) : null}
                </View>
              </>
            );
            if (!canPurge) {
              return <View style={styles.row}>{RowInner}</View>;
            }
            return (
              <Pressable
                style={[styles.row, on && styles.rowOn]}
                onPress={() => toggle(item.id)}
              >
                {RowInner}
              </Pressable>
            );
          }}
        />
      )}

      <Modal visible={purging} transparent animationType="fade">
        <View style={styles.purgeOverlay} accessibilityLabel="Deleting members">
          <ActivityIndicator size="large" color="#ffffff" />
          <Text style={styles.purgeOverlayText}>Deleting members…</Text>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  purgeOverlay: {
    flex: 1,
    backgroundColor: "rgba(17, 17, 17, 0.5)",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: 24,
  },
  purgeOverlayText: {
    color: "#ffffff",
    fontSize: type.body.size,
    fontWeight: "600",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  topTitle: {
    flex: 1,
    fontSize: type.title.size,
    fontWeight: type.title.weight,
    color: colors.textPrimary,
    textAlign: "center",
  },
  centerMsg: { padding: 24 },
  muted: { fontSize: type.body.size, color: colors.textSecondary, textAlign: "center", marginTop: 24 },
  bulkBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 8,
  },
  bulkText: { fontSize: type.body.size, fontWeight: "600", color: colors.textPrimary },
  bulkSecondary: { paddingVertical: 8, paddingHorizontal: 10 },
  bulkSecondaryText: { color: colors.accent, fontWeight: "600", fontSize: type.caption.size },
  bulkDanger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#b91c1c",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.md,
  },
  bulkDisabled: { opacity: 0.6 },
  bulkDangerText: { color: "#fff", fontWeight: "700", fontSize: type.caption.size },
  listContent: { padding: 12, paddingBottom: 32 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    marginBottom: 8,
  },
  rowOn: { borderColor: colors.accent, backgroundColor: colors.accentSurface },
  check: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  avatarImg: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#f1f5f9" },
  rowText: { flex: 1, minWidth: 0 },
  name: { fontSize: type.bodyStrong.size, fontWeight: "600", color: colors.textPrimary },
  sub: { fontSize: type.caption.size, color: colors.textSecondary, marginTop: 2 },
});
