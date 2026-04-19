import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { ActivityIndicator, Image, StyleSheet, View } from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { SHEEPMUG_LOGO } from "../lib/branding";
import { devLog, devWarn } from "../lib/devLog";
import { getOnboardingCompleted } from "../lib/storage";
import { colors } from "../theme";

export default function IndexScreen() {
  const { token, loading } = useAuth();
  const [onboardingReady, setOnboardingReady] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);

  useEffect(() => {
    if (!loading) {
      devLog("index: hide splash (auth ready)");
      void SplashScreen.hideAsync().catch(() => {});
    }
  }, [loading]);

  /** Never leave the native splash up if auth or storage misbehaves. */
  useEffect(() => {
    const t = setTimeout(() => {
      devWarn("index: 8s splash safety hide");
      void SplashScreen.hideAsync().catch(() => {});
    }, 8000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (loading || !token) {
      setOnboardingReady(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const done = await getOnboardingCompleted().catch(() => false);
      if (!cancelled) {
        setOnboardingDone(done);
        setOnboardingReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, token]);

  useEffect(() => {
    if (loading) {
      devLog("index: route → (waiting auth bootstrap)");
      return;
    }
    if (!token) {
      devLog("index: route → /login");
      return;
    }
    if (!onboardingReady) {
      devLog("index: route → (loading onboarding…)");
      return;
    }
    if (!onboardingDone) {
      devLog("index: route → /onboarding");
      return;
    }
    devLog("index: route → /(tabs)/dashboard");
  }, [loading, token, onboardingReady, onboardingDone]);

  if (loading) {
    return (
      <View style={styles.boot}>
        <Image source={SHEEPMUG_LOGO} style={styles.bootLogo} resizeMode="contain" accessibilityLabel="Sheepmug" />
        <ActivityIndicator color={colors.accent} style={styles.bootSpinner} />
      </View>
    );
  }

  if (!token) {
    return <Redirect href="/login" />;
  }

  if (!onboardingReady) {
    return (
      <View style={styles.boot}>
        <Image source={SHEEPMUG_LOGO} style={styles.bootLogo} resizeMode="contain" accessibilityLabel="Sheepmug" />
        <ActivityIndicator color={colors.accent} style={styles.bootSpinner} />
      </View>
    );
  }

  if (!onboardingDone) {
    return <Redirect href="/onboarding" />;
  }

  return <Redirect href="/(tabs)/dashboard" />;
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#ffffff",
    paddingHorizontal: 48,
  },
  bootLogo: {
    width: 160,
    height: 160,
  },
  bootSpinner: {
    marginTop: 24,
  },
});
