import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useAuth } from "../contexts/AuthContext";
import { ensureOfflineBootstrap, subscribeOfflineBootstrapProgress } from "../lib/offline/bootstrapCoordinator";
import { getOfflineBootstrapDone, setOfflineBootstrapDone } from "../lib/storage";
import { colors, radius, type } from "../theme";

/**
 * Recovery path when onboarding finished but offline bootstrap did not complete
 * (network error, force-close, or skip from tour).
 */
export default function OfflineSetupScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [running, setRunning] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;

    const start = async () => {
      const done = await getOfflineBootstrapDone(uid).catch(() => false);
      if (cancelled) return;
      if (done) {
        router.replace("/(tabs)/dashboard");
        return;
      }
      setRunning(true);
      setError(null);
      setProgressText("Starting…");
      const unsub = subscribeOfflineBootstrapProgress(uid, (p) => {
        setProgressText(`${p.step} (${p.done}/${p.total})`);
      });
      try {
        await ensureOfflineBootstrap(uid);
        if (cancelled) return;
        setProgressText("Ready");
        router.replace("/(tabs)/dashboard");
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load offline data");
        }
      } finally {
        unsub();
        if (!cancelled) setRunning(false);
      }
    };

    void start();
    return () => {
      cancelled = true;
    };
  }, [uid, router]);

  const retry = async () => {
    if (!uid) return;
    setRunning(true);
    setError(null);
    setProgressText("Starting…");
    const unsub = subscribeOfflineBootstrapProgress(uid, (p) => {
      setProgressText(`${p.step} (${p.done}/${p.total})`);
    });
    try {
      await ensureOfflineBootstrap(uid);
      setProgressText("Ready");
      router.replace("/(tabs)/dashboard");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load offline data");
    } finally {
      unsub();
      setRunning(false);
    }
  };

  const skip = async () => {
    if (!uid) return;
    await setOfflineBootstrapDone(uid, true);
    router.replace("/(tabs)/dashboard");
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ title: "Offline setup" }} />
      <View style={styles.container}>
        <Text style={styles.title}>Getting offline data</Text>
        <Text style={styles.body}>
          We are downloading members, events, tasks, and ministries so the app works without internet.
        </Text>

        <View style={styles.statusCard}>
          <Text style={styles.statusLabel}>Status</Text>
          <Text style={styles.statusText}>{progressText || "…"}</Text>
          {running ? <ActivityIndicator color={colors.accent} style={{ marginTop: 8 }} /> : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        {error ? (
          <Pressable style={styles.primaryBtn} onPress={() => void retry()}>
            <Text style={styles.primaryBtnText}>Retry download</Text>
          </Pressable>
        ) : null}

        <Pressable style={styles.skipBtn} onPress={() => void skip()}>
          <Text style={styles.skipBtnText}>Skip for now</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, padding: 20, gap: 14, justifyContent: "center" },
  title: {
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    fontWeight: type.pageTitle.weight,
    color: colors.textPrimary,
    textAlign: "center",
  },
  body: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textSecondary,
    textAlign: "center",
  },
  statusCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    padding: 14,
    marginTop: 6,
  },
  statusLabel: { fontSize: type.caption.size, color: colors.textSecondary, fontWeight: "600" },
  statusText: { marginTop: 6, fontSize: type.bodyStrong.size, color: colors.textPrimary, fontWeight: "600" },
  errorText: { marginTop: 8, fontSize: type.caption.size, color: "#b91c1c" },
  primaryBtn: {
    marginTop: 8,
    minHeight: 46,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { color: "#fff", fontSize: type.bodyStrong.size, fontWeight: "700" },
  skipBtn: { alignItems: "center", justifyContent: "center", minHeight: 42 },
  skipBtnText: { color: colors.textSecondary, fontSize: type.body.size, fontWeight: "600" },
});
