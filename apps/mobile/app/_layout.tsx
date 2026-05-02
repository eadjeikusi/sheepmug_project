import { useCallback, useEffect, useRef, useState } from "react";
import { Stack } from "expo-router";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ActivityIndicator, Alert, AppState, Modal, Pressable, StyleSheet, Text, View } from "react-native";
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
import { OfflineSyncProvider } from "../contexts/OfflineSyncContext";
import { authenticateWithBiometrics, getBiometricAvailability } from "../lib/biometric";
import { getBiometricUnlockEnabled, setBiometricUnlockEnabled } from "../lib/storage";
import { initPreventAutoHideSplash, safeHideSplashAsync } from "../lib/safeSplashScreen";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

initPreventAutoHideSplash();

/** Avoid handling the same cold-start notification twice (e.g. React Strict Mode). */
let expoPushColdStartHandled = false;

/** Last resort if auth/bootstrap never finishes — avoids permanent native splash. */
function SplashSafetyHide() {
  useEffect(() => {
    const t = setTimeout(() => {
      devWarn("root: 14s splash safety hide");
      void safeHideSplashAsync();
    }, 14_000);
    return () => clearTimeout(t);
  }, []);
  return null;
}

const APP_LOCK_GRACE_MS = 45_000;

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SplashSafetyHide />
      <ThemeProvider>
        <AuthProvider>
          <BranchProvider>
            <NotificationProvider>
              <OfflineSyncProvider>
                <RootNavigator />
              </OfflineSyncProvider>
            </NotificationProvider>
          </BranchProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { colors, resolvedScheme } = useTheme();
  const { token, loading, logout } = useAuth();
  const router = useRouter();
  const [lockVisible, setLockVisible] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [lockMessage, setLockMessage] = useState<string | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const lastBackgroundAtRef = useRef(Date.now());
  const startupGuardCheckedRef = useRef(false);

  const unlockApp = useCallback(async () => {
    if (lockBusy) return;
    setLockBusy(true);
    try {
      const availability = await getBiometricAvailability();
      if (!availability.available) {
        await setBiometricUnlockEnabled(false);
        setLockVisible(false);
        setLockMessage(null);
        Alert.alert(
          "Biometric unlock disabled",
          availability.reason || "Biometric unlock is no longer available on this device."
        );
        return;
      }

      const result = await authenticateWithBiometrics("Unlock SheepMug");
      if (result.success) {
        setLockVisible(false);
        setLockMessage(null);
        return;
      }
      setLockMessage(result.errorMessage || "Unable to unlock. Try again.");
    } finally {
      setLockBusy(false);
    }
  }, [lockBusy]);

  const checkAndLockIfNeeded = useCallback(async () => {
    if (!token) {
      setLockVisible(false);
      setLockMessage(null);
      return;
    }
    const enabled = await getBiometricUnlockEnabled();
    if (!enabled) {
      setLockVisible(false);
      setLockMessage(null);
      return;
    }
    setLockVisible(true);
    setLockMessage(null);
    await unlockApp();
  }, [token, unlockApp]);

  useEffect(() => {
    if (loading) return;
    if (startupGuardCheckedRef.current) return;
    startupGuardCheckedRef.current = true;
    void checkAndLockIfNeeded();
  }, [loading, checkAndLockIfNeeded]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      const prevState = appStateRef.current;
      if (nextState === "active" && prevState.match(/inactive|background/)) {
        const idleMs = Date.now() - lastBackgroundAtRef.current;
        if (idleMs >= APP_LOCK_GRACE_MS) {
          void checkAndLockIfNeeded();
        }
      }
      if (nextState.match(/inactive|background/)) {
        lastBackgroundAtRef.current = Date.now();
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, [checkAndLockIfNeeded]);

  useEffect(() => {
    if (token) return;
    setLockVisible(false);
    setLockMessage(null);
  }, [token]);

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
        <Stack.Screen name="reports" options={{ title: "Reports", headerShown: true }} />
        <Stack.Screen name="leaders" options={{ headerShown: false }} />
        <Stack.Screen name="profile-details" options={{ title: "Profile Details" }} />
        <Stack.Screen name="families" options={{ title: "Families" }} />
        <Stack.Screen name="family/[id]" options={{ title: "Family" }} />
        <Stack.Screen name="members-deleted" options={{ title: "Deleted members" }} />
      </Stack>
      <Modal visible={Boolean(lockVisible && token)} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={stylesLock.backdrop}>
          <View style={[stylesLock.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[stylesLock.title, { color: colors.textPrimary }]}>Unlock SheepMug</Text>
            <Text style={[stylesLock.body, { color: colors.textSecondary }]}>
              {lockMessage || "Use your biometrics to continue. You can also use device passcode."}
            </Text>
            {lockBusy ? <ActivityIndicator color={colors.accent} /> : null}
            <Pressable
              style={[stylesLock.primaryBtn, { backgroundColor: colors.accent }, lockBusy && stylesLock.disabledBtn]}
              onPress={() => void unlockApp()}
              disabled={lockBusy}
            >
              <Text style={stylesLock.primaryBtnText}>Try again / Use passcode</Text>
            </Pressable>
            <Pressable
              style={[stylesLock.secondaryBtn, { borderColor: colors.border }, lockBusy && stylesLock.disabledBtn]}
              onPress={async () => {
                await logout();
                router.replace("/login");
              }}
              disabled={lockBusy}
            >
              <Text style={[stylesLock.secondaryBtnText, { color: colors.textPrimary }]}>Log out</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const stylesLock = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.42)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    fontWeight: type.subtitle.weight,
  },
  body: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
  },
  primaryBtn: {
    minHeight: 42,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    fontWeight: type.bodyStrong.weight,
  },
  secondaryBtn: {
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  secondaryBtnText: {
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    fontWeight: type.bodyStrong.weight,
  },
  disabledBtn: {
    opacity: 0.6,
  },
});
