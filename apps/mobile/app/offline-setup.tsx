import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useAuth } from "../contexts/AuthContext";
import { ensureOfflineBootstrap, subscribeOfflineBootstrapProgress } from "../lib/offline/bootstrapCoordinator";
import { patchOfflineManifest } from "../lib/offline/manifest";
import { getOfflineBootstrapDone, setOfflineBootstrapDone } from "../lib/storage";
import { colors, radius, type } from "../theme";

/**
 * After onboarding, user chooses whether to download full offline data.
 * Nothing runs until they tap "Download" (avoids startup SQLite / bootstrap races).
 */
export default function OfflineSetupScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const organizationId = user?.organization_id ?? null;
  const [running, setRunning] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;

    const check = async () => {
      const done = await getOfflineBootstrapDone(uid).catch(() => false);
      if (cancelled) return;
      if (done) {
        router.replace("/(tabs)/dashboard");
      }
    };

    void check();
    return () => {
      cancelled = true;
    };
  }, [uid, router]);

  const startDownload = useCallback(async () => {
    if (!uid) return;
    setRunning(true);
    setError(null);
    setProgressText("Starting…");
    const unsub = subscribeOfflineBootstrapProgress(uid, (p) => {
      setProgressText(`${p.step} (${p.done}/${p.total})`);
    });
    try {
      await ensureOfflineBootstrap(uid, organizationId);
      setProgressText("Ready");
      router.replace("/(tabs)/dashboard");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load offline data");
    } finally {
      unsub();
      setRunning(false);
    }
  }, [uid, organizationId, router]);

  const skip = async () => {
    if (!uid) return;
    await patchOfflineManifest({
      bootstrap_account_user_id: uid,
      bootstrap_organization_id: organizationId,
    });
    await setOfflineBootstrapDone(uid, true);
    router.replace("/(tabs)/dashboard");
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ title: "Offline setup" }} />
      <View style={styles.container}>
        <Text style={styles.title}>Use Sheepmug offline?</Text>
        <Text style={styles.body}>
          You can download members, events, tasks, and ministries for full offline access. This uses storage and may take a
          minute on slower connections. You can skip and download later from the dashboard or settings.
        </Text>

        <View style={styles.statusCard}>
          <Text style={styles.statusLabel}>Status</Text>
          <Text style={styles.statusText}>
            {running ? progressText || "…" : error ? "Download failed" : "Not started — tap download when you are ready."}
          </Text>
          {running ? <ActivityIndicator color={colors.accent} style={{ marginTop: 8 }} /> : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        <Pressable
          style={[styles.primaryBtn, running && styles.primaryBtnDisabled]}
          onPress={() => void startDownload()}
          disabled={running}
        >
          <Text style={styles.primaryBtnText}>{error ? "Retry download" : "Download for offline use"}</Text>
        </Pressable>

        <Pressable style={styles.skipBtn} onPress={() => void skip()} disabled={running}>
          <Text style={styles.skipBtnText}>Not now</Text>
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
  primaryBtnDisabled: { opacity: 0.65 },
  primaryBtnText: { color: "#fff", fontSize: type.bodyStrong.size, fontWeight: "700" },
  skipBtn: { alignItems: "center", justifyContent: "center", minHeight: 42 },
  skipBtnText: { color: colors.textSecondary, fontSize: type.body.size, fontWeight: "600" },
});
