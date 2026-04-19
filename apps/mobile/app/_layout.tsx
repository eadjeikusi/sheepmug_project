import { useEffect } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "../contexts/AuthContext";
import { devWarn } from "../lib/devLog";
import { BranchProvider } from "../contexts/BranchContext";
import { NotificationProvider } from "../contexts/NotificationContext";
import { ThemeProvider, useTheme } from "../contexts/ThemeContext";
import { StatusBar } from "expo-status-bar";
import { type } from "../theme";
import { useAuth } from "../contexts/AuthContext";
import { navigateFromNotificationAction, parseExpoPushNotificationData } from "../lib/notificationNavigation";
import { useRouter } from "expo-router";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

void SplashScreen.preventAutoHideAsync();

/** Avoid handling the same cold-start notification twice (e.g. React Strict Mode). */
let expoPushColdStartHandled = false;

/** Last resort if auth/bootstrap never finishes — avoids permanent native splash. */
function SplashSafetyHide() {
  useEffect(() => {
    const t = setTimeout(() => {
      devWarn("root: 14s splash safety hide");
      void SplashScreen.hideAsync().catch(() => {});
    }, 14_000);
    return () => clearTimeout(t);
  }, []);
  return null;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SplashSafetyHide />
      <ThemeProvider>
        <AuthProvider>
          <BranchProvider>
            <NotificationProvider>
              <RootNavigator />
            </NotificationProvider>
          </BranchProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { colors, resolvedScheme } = useTheme();
  const { token } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!token) return;
    let mounted = true;
    const register = async () => {
      try {
        if (!Device.isDevice) return;
        const perms = await Notifications.getPermissionsAsync();
        let status = perms.status;
        if (status !== "granted") {
          const asked = await Notifications.requestPermissionsAsync();
          status = asked.status;
        }
        if (status !== "granted") return;
        const projectId = String(
          process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
            process.env.EXPO_PUBLIC_EXPO_PROJECT_ID ||
            "",
        ).trim();
        const tokenRes = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
        const pushToken = String(tokenRes.data || "").trim();
        if (!mounted || !pushToken) return;
        const base = String(process.env.EXPO_PUBLIC_API_BASE_URL || "").trim();
        if (!base) return;
        await fetch(`${base.replace(/\/$/, "")}/api/profile/push-token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ push_token: pushToken }),
        });
      } catch (error) {
        // Expo push token endpoint can return transient 503; don't crash app init.
        const msg = error instanceof Error ? error.message : String(error || "unknown");
        devWarn("push token registration skipped", msg);
      }
    };
    void register();
    return () => {
      mounted = false;
    };
  }, [token]);

  useEffect(() => {
    const handle = (response: Notifications.NotificationResponse) => {
      const raw = (response.notification.request.content.data || {}) as Record<string, unknown>;
      const { actionPath, payload } = parseExpoPushNotificationData(raw);
      navigateFromNotificationAction(router, actionPath, payload);
    };
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    void Notifications.getLastNotificationResponseAsync().then((last) => {
      if (expoPushColdStartHandled) return;
      expoPushColdStartHandled = true;
      if (last) handle(last);
    });
    return () => sub.remove();
  }, [router]);

  return (
    <>
      <StatusBar style={resolvedScheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: {
            fontWeight: type.subtitle.weight,
            fontSize: type.subtitle.size,
          },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="search" options={{ presentation: "modal", title: "Search" }} />
        <Stack.Screen name="group-join-requests" options={{ title: "Group join requests" }} />
        <Stack.Screen name="member-join-requests" options={{ title: "Member join requests" }} />
        <Stack.Screen name="important-dates" options={{ title: "All Important Dates" }} />
        <Stack.Screen name="profile-details" options={{ title: "Profile Details" }} />
        <Stack.Screen name="families" options={{ title: "Families" }} />
        <Stack.Screen name="family/[id]" options={{ title: "Family" }} />
        <Stack.Screen name="members-deleted" options={{ title: "Deleted members" }} />
      </Stack>
    </>
  );
}
