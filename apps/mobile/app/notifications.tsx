import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { useCallback, useState } from "react";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { HeaderIconCircleButton } from "../components/HeaderIconCircle";
import { useNotifications } from "../contexts/NotificationContext";
import { colors, radius, sizes, type } from "../theme";
import { capitalizeLeadingChar, displayMemberWords, formatLongWeekdayDateTime } from "../lib/memberDisplayFormat";
import {
  notificationImageUri,
  notificationRichSubtitle,
  rightAlignedMemberThumbnail,
} from "../lib/notificationPayloadDisplay";
import { navigateFromNotificationAction } from "../lib/notificationNavigation";
import { NotificationListSkeleton } from "../components/DataSkeleton";

export default function NotificationsScreen() {
  const router = useRouter();
  const { notifications, unreadCount, loading, loadingMore, hasMore, refresh, loadMore, markOneRead, markAllRead } = useNotifications();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <HeaderIconCircleButton onPress={() => router.back()} hitSlop={12} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={sizes.headerIcon} color={colors.textPrimary} />
        </HeaderIconCircleButton>
        <Text style={styles.headerTitle}>Notifications</Text>
        {unreadCount > 0 ? (
          <Pressable onPress={() => void markAllRead()} hitSlop={8}>
            <Text style={styles.markAll}>Mark all read</Text>
          </Pressable>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
        onEndReached={() => {
          if (!loadingMore && hasMore) {
            void loadMore();
          }
        }}
        onEndReachedThreshold={0.35}
        ListEmptyComponent={
          loading ? (
            <NotificationListSkeleton count={8} />
          ) : (
            <Text style={styles.muted}>No notifications yet.</Text>
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator size="small" color={colors.accent} />
            </View>
          ) : null
        }
        renderItem={({ item: n }) => {
          const pl =
            n.payload && typeof n.payload === "object" && !Array.isArray(n.payload)
              ? (n.payload as Record<string, unknown>)
              : {};
          const imageUrl = notificationImageUri(pl);
          const thumbRight = rightAlignedMemberThumbnail(n.type, pl);
          return (
            <Pressable
              key={n.id}
              style={[styles.row, !n.read_at && styles.rowUnread]}
              onPress={() => {
                if (!n.read_at) void markOneRead(n.id);
                navigateFromNotificationAction(router, n.action_path, pl);
              }}
            >
              {!thumbRight ? (
                <View style={styles.rowIcon}>
                  {imageUrl ? (
                    <Image source={{ uri: imageUrl }} style={styles.rowImage} />
                  ) : (
                    <Ionicons name="notifications-outline" size={20} color={colors.textSecondary} />
                  )}
                </View>
              ) : null}
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{displayMemberWords(String(n.title || ""))}</Text>
                {(() => {
                  const sub = notificationRichSubtitle(pl);
                  return sub ? (
                    <Text style={styles.rowSubtitle} numberOfLines={2}>
                      {sub}
                    </Text>
                  ) : null;
                })()}
                <Text style={styles.rowMsg} numberOfLines={3}>
                  {capitalizeLeadingChar(String(n.message || ""))}
                </Text>
                <Text style={styles.rowMeta}>
                  {n.created_at ? formatLongWeekdayDateTime(String(n.created_at)) : ""}
                </Text>
              </View>
              {thumbRight && imageUrl ? (
                <Image source={{ uri: imageUrl }} style={styles.rowThumbRight} />
              ) : null}
            </Pressable>
          );
        }}
      />
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
  markAll: {
    width: 72,
    textAlign: "right",
    fontSize: type.caption.size,
    color: colors.accent,
    fontWeight: type.bodyStrong.weight,
  },
  scroll: { padding: 16, paddingBottom: 32, gap: 10 },
  muted: { color: colors.textSecondary, textAlign: "center", marginTop: 24 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  rowUnread: { backgroundColor: colors.accentSurface, borderColor: colors.accentBorder },
  rowIcon: { marginTop: 2 },
  rowBody: { flex: 1, minWidth: 0 },
  rowImage: { width: 40, height: 40, borderRadius: 20 },
  rowThumbRight: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: "#f1f5f9",
  },
  rowSubtitle: {
    marginTop: 2,
    fontSize: type.caption.size,
    color: colors.textSecondary,
    fontWeight: type.bodyStrong.weight,
  },
  rowTitle: {
    fontSize: type.bodyStrong.size,
    fontWeight: type.bodyStrong.weight,
    color: colors.textPrimary,
  },
  rowMsg: {
    marginTop: 4,
    fontSize: type.body.size,
    color: colors.textSecondary,
    lineHeight: type.body.lineHeight,
  },
  rowMeta: { marginTop: 6, fontSize: type.caption.size, color: colors.textSecondary },
  footerLoader: { paddingVertical: 16, alignItems: "center" },
});
