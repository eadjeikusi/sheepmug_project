import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, sizes, type } from "../../theme";
import { useAuth } from "../../contexts/AuthContext";
import { usePermissions } from "../../hooks/usePermissions";
import { useNotifications } from "../../contexts/NotificationContext";
import { useTheme } from "../../contexts/ThemeContext";
import { MemberInitialAvatar } from "../../components/MemberInitialAvatar";

export default function TabsLayout() {
  const router = useRouter();
  const { user } = useAuth();
  const { can } = usePermissions();
  const { unreadCount } = useNotifications();
  const { colors: themedColors } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        headerStyle: { backgroundColor: themedColors.bg },
        headerTitle: "",
        headerLeft: () => (
          <Pressable style={styles.headerLeftWrap} onPress={() => router.push("/(tabs)/menu")}>
            {user?.profile_image ? (
              <Image source={{ uri: user.profile_image }} style={styles.headerAvatar} />
            ) : (
              <MemberInitialAvatar
                initial={(user?.first_name || "U")[0]}
                size={42}
                textStyle={styles.headerAvatarText}
              />
            )}
          </Pressable>
        ),
        headerRight: () => (
          <View style={styles.headerRightWrap}>
            <Pressable style={[styles.headerIconButton, { backgroundColor: themedColors.headerIconCircleBg }]}>
              <Ionicons name="headset-outline" size={sizes.headerIcon} color={themedColors.textPrimary} />
            </Pressable>
            <Pressable
              style={[styles.headerIconButton, { backgroundColor: themedColors.headerIconCircleBg }]}
              onPress={() => router.push("/notifications")}
            >
              <Ionicons name="notifications-outline" size={sizes.headerIcon} color={themedColors.textPrimary} />
              {unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
                </View>
              )}
            </Pressable>
          </View>
        ),
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: themedColors.card,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: themedColors.accentBorder,
          height: sizes.tabBarHeight,
          paddingBottom: 10,
          paddingTop: 8,
        },
        tabBarActiveTintColor: themedColors.accent,
        tabBarInactiveTintColor: themedColors.textSecondary,
        tabBarActiveBackgroundColor: themedColors.accentSurface,
        tabBarLabelStyle: {
          fontSize: type.tabLabel.size,
          lineHeight: type.tabLabel.lineHeight,
          fontWeight: type.tabLabel.weight,
          letterSpacing: type.tabLabel.letterSpacing,
        },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          headerShown: false,
          title: "Dashboard",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "home" : "home-outline"} color={color} size={sizes.tabBarIcon} />
          ),
          tabBarItemStyle: { borderRadius: radius.pill },
        }}
      />
      <Tabs.Screen
        name="members"
        options={{
          headerShown: false,
          title: "Members",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "people" : "people-outline"} color={color} size={sizes.tabBarIcon} />
          ),
          tabBarItemStyle: { borderRadius: radius.pill },
        }}
      />
      <Tabs.Screen
        name="ministries"
        options={{
          headerShown: false,
          title: "Ministries",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "layers" : "layers-outline"} color={color} size={sizes.tabBarIcon} />
          ),
          tabBarItemStyle: { borderRadius: radius.pill },
        }}
      />
      <Tabs.Screen
        name="task"
        options={{
          headerShown: false,
          title: "Task",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "checkbox" : "checkbox-outline"} color={color} size={sizes.tabBarIcon} />
          ),
          tabBarItemStyle: { borderRadius: radius.pill },
        }}
      />
      <Tabs.Screen
        name="event"
        options={{
          headerShown: false,
          title: "Event",
          href: can("view_events") ? undefined : null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "calendar" : "calendar-outline"} color={color} size={sizes.tabBarIcon} />
          ),
          tabBarItemStyle: { borderRadius: radius.pill },
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          headerShown: false,
          href: null,
          title: "Menu",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "menu" : "menu-outline"} color={color} size={sizes.tabBarIcon} />
          ),
          tabBarItemStyle: { borderRadius: radius.pill },
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  headerLeftWrap: { marginLeft: 16 },
  headerRightWrap: { marginRight: 16, flexDirection: "row", alignItems: "center", gap: 10 },
  headerAvatar: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: "#ececec",
  },
  headerAvatarFallback: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: "#ececec",
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarText: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.textPrimary,
    fontWeight: type.bodyStrong.weight,
    letterSpacing: type.caption.letterSpacing,
  },
  headerIconButton: {
    width: sizes.headerIconButton,
    height: sizes.headerIconButton,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  badge: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: sizes.headerBadge,
    height: sizes.headerBadge,
    borderRadius: radius.pill,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
});
