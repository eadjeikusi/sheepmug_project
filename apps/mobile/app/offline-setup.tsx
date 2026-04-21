import { useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { runOfflineBootstrap } from "../lib/offline/bootstrap";
import { setOfflineBootstrapDone } from "../lib/storage";
import { colors, radius, type } from "../theme";

export default function OfflineSetupScreen() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progressText, setProgressText] = useState("Ready");
  const [error, setError] = useState<string | null>(null);

  const finish = async () => {
    await setOfflineBootstrapDone(true);
    router.replace("/(tabs)/dashboard");
  };

  const startBootstrap = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    setProgressText("Starting...");
    try {
      await runOfflineBootstrap((p) => {
        setProgressText(`${p.step} (${p.done}/${p.total})`);
      });
      setProgressText("Offline data loaded");
      await finish();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load offline data");
    } finally {
      setRunning(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ title: "Offline setup" }} />
      <View style={styles.container}>
        <Text style={styles.title}>Prepare app for offline use</Text>
        <Text style={styles.body}>
          Load data now so members, tasks, events, ministries, families, and search work when internet is down.
        </Text>

        <View style={styles.statusCard}>
          <Text style={styles.statusLabel}>Status</Text>
          <Text style={styles.statusText}>{progressText}</Text>
          {running ? <ActivityIndicator color={colors.accent} style={{ marginTop: 8 }} /> : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        <Pressable style={[styles.primaryBtn, running && styles.primaryBtnDisabled]} disabled={running} onPress={() => void startBootstrap()}>
          <Text style={styles.primaryBtnText}>{running ? "Loading..." : "Load Data for Offline Use"}</Text>
        </Pressable>

        <Pressable style={styles.skipBtn} onPress={() => void finish()}>
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
  primaryBtnDisabled: { opacity: 0.7 },
  primaryBtnText: { color: "#fff", fontSize: type.bodyStrong.size, fontWeight: "700" },
  skipBtn: { alignItems: "center", justifyContent: "center", minHeight: 42 },
  skipBtnText: { color: colors.textSecondary, fontSize: type.body.size, fontWeight: "600" },
});
