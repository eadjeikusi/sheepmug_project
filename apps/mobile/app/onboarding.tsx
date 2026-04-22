import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  ListRenderItem,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { Stack, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../contexts/AuthContext";
import { MemberInitialAvatar } from "../components/MemberInitialAvatar";
import { api } from "../lib/api";
import { ensureOfflineBootstrap, subscribeOfflineBootstrapProgress } from "../lib/offline/bootstrapCoordinator";
import { ensurePhotoLibraryPermission } from "../lib/photoLibraryAccess";
import { getOfflineBootstrapDone, setOnboardingCompleted } from "../lib/storage";
import { uploadMemberImageFromUri } from "../lib/uploadMemberImage";
import { colors, sizes, type } from "../theme";

type StepKind = "welcome" | "photo" | "members_tasks" | "attendance" | "offline" | "finale";

const BOOTSTRAP_STEP_LABEL: Record<string, string> = {
  Members: "Saving members",
  "Groups and families": "Saving ministries and families",
  Events: "Saving events",
  Tasks: "Saving tasks",
  "Member profiles": "Saving member profiles",
  "Family members": "Saving family members",
  "Ministry details": "Saving ministry details",
  "Search data": "Preparing search",
};

function formatBootstrapProgress(step: string, done: number, total: number): string {
  const label = BOOTSTRAP_STEP_LABEL[step] ?? step;
  return `${label} (${done}/${total})`;
}

export default function OnboardingScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user, refreshUser, setUserLocal } = useAuth();
  const uid = user?.id ?? null;

  const firstName = String(user?.first_name ?? "").trim() || "there";
  /** Fixed for this tour so the pager does not reshuffle after the user uploads a photo. */
  const [tourIncludePhoto] = useState(() => !Boolean(String(user?.profile_image ?? "").trim()));

  const steps = useMemo(() => {
    const s: StepKind[] = ["welcome"];
    if (tourIncludePhoto) s.push("photo");
    s.push("members_tasks", "attendance", "offline", "finale");
    return s;
  }, [tourIncludePhoto]);

  const listRef = useRef<FlatList<StepKind>>(null);
  const [page, setPage] = useState(0);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [offlineRunning, setOfflineRunning] = useState(false);
  const [offlineProgress, setOfflineProgress] = useState("");
  const [offlineError, setOfflineError] = useState<string | null>(null);

  useEffect(() => {
    void refreshUser().catch(() => undefined);
  }, [refreshUser]);

  /** Background prefetch so the offline step is often already complete. */
  useEffect(() => {
    if (!uid) return;
    void getOfflineBootstrapDone(uid).then((done) => {
      if (done) setOfflineReady(true);
      else void ensureOfflineBootstrap(uid).catch(() => {});
    });
  }, [uid]);

  useEffect(() => {
    if (!uid || steps[page] !== "offline") return;
    let cancelled = false;
    void getOfflineBootstrapDone(uid).then((d) => {
      if (!cancelled && d) setOfflineReady(true);
    });
    const unsub = subscribeOfflineBootstrapProgress(uid, (p) => {
      setOfflineProgress(formatBootstrapProgress(p.step, p.done, p.total));
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [uid, page, steps]);

  const skipEntireTour = useCallback(async () => {
    if (!uid) return;
    try {
      await setOnboardingCompleted(uid, true);
    } catch {
      /* still navigate */
    }
    const bootstrapDone = await getOfflineBootstrapDone(uid).catch(() => false);
    if (bootstrapDone) router.replace("/(tabs)/dashboard");
    else router.replace("/offline-setup");
  }, [router, uid]);

  const finishToApp = useCallback(async () => {
    if (!uid) return;
    try {
      await setOnboardingCompleted(uid, true);
    } catch {
      /* still navigate */
    }
    router.replace("/(tabs)/dashboard");
  }, [router, uid]);

  const goNext = useCallback(() => {
    const kind = steps[page];
    if (kind === "offline" && !offlineReady) return;
    if (kind === "finale") {
      void finishToApp();
      return;
    }
    if (page < steps.length - 1) {
      const next = page + 1;
      listRef.current?.scrollToIndex({ index: next, animated: true });
      setPage(next);
    }
  }, [page, steps, offlineReady, finishToApp]);

  const goHeaderBack = useCallback(() => {
    if (page > 0) {
      const prev = page - 1;
      listRef.current?.scrollToIndex({ index: prev, animated: true });
      setPage(prev);
    } else if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      void skipEntireTour();
    }
  }, [page, navigation, skipEntireTour]);

  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      let i = Math.round(x / width);
      i = Math.min(Math.max(i, 0), steps.length - 1);
      const offlineIdx = steps.indexOf("offline");
      if (offlineIdx >= 0 && i > offlineIdx && !offlineReady) {
        listRef.current?.scrollToIndex({ index: offlineIdx, animated: true });
        setPage(offlineIdx);
        return;
      }
      setPage(i);
    },
    [width, steps, offlineReady]
  );

  const onScrollToIndexFailed = useCallback((info: { index: number }) => {
    const wait = new Promise((r) => setTimeout(r, 100));
    void wait.then(() => {
      listRef.current?.scrollToIndex({ index: info.index, animated: true });
    });
  }, []);

  const pickAndUploadPhoto = useCallback(async () => {
    if (!uid || !user) return;
    if (!(await ensurePhotoLibraryPermission())) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const uri = result.assets[0].uri;
    setUploadingImage(true);
    try {
      const uploadedUrl = await uploadMemberImageFromUri(uri);
      const payload = {
        first_name: String(user.first_name ?? "").trim(),
        last_name: String(user.last_name ?? "").trim(),
        email: String(user.email ?? "").trim(),
        profile_image: uploadedUrl.trim() || null,
      };
      const res = await api.auth.updateProfile(payload);
      const nextUser = { ...user, ...(res?.user || {}), profile_image: uploadedUrl.trim() || null };
      await setUserLocal(nextUser);
      await refreshUser().catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not upload image.";
      Alert.alert("Profile photo", message);
    } finally {
      setUploadingImage(false);
    }
  }, [refreshUser, setUserLocal, uid, user]);

  const startOfflineDownload = useCallback(() => {
    if (!uid) return;
    setOfflineRunning(true);
    setOfflineError(null);
    void ensureOfflineBootstrap(uid)
      .then(() => setOfflineReady(true))
      .catch((e: unknown) => setOfflineError(e instanceof Error ? e.message : "Download failed"))
      .finally(() => setOfflineRunning(false));
  }, [uid]);

  const renderSlideBody = (kind: StepKind) => {
    switch (kind) {
      case "welcome":
        return (
          <>
            <View style={[styles.illustrationCircle, { backgroundColor: "#f3f4f6" }]}>
              <Ionicons name="hand-left-outline" size={72} color={colors.textPrimary} />
            </View>
            <Text style={styles.title}>Welcome, {firstName}</Text>
            <Text style={styles.body}>
              Take a minute while we set up your account on this device. Swipe through a quick tour, or skip anytime.
            </Text>
          </>
        );
      case "photo":
        return (
          <>
            <Pressable
              onPress={() => void pickAndUploadPhoto()}
              disabled={uploadingImage}
              style={[styles.illustrationCircle, { backgroundColor: "#eff6ff" }]}
            >
              {user?.profile_image ? (
                <Image source={{ uri: user.profile_image }} style={styles.photoHero} />
              ) : (
                <MemberInitialAvatar initial={firstName[0] || "U"} size={96} textStyle={styles.photoInitial} />
              )}
              {uploadingImage ? (
                <View style={styles.uploadOverlay}>
                  <ActivityIndicator size="large" color="#fff" />
                  <Text style={styles.uploadOverlayText}>Uploading…</Text>
                </View>
              ) : null}
            </Pressable>
            <Text style={styles.title}>Add a profile photo</Text>
            <Text style={styles.body}>Help your team recognize you. You can skip this or add a photo from your library.</Text>
            <Pressable style={styles.secondaryOutlineBtn} onPress={() => void pickAndUploadPhoto()} disabled={uploadingImage}>
              <Text style={styles.secondaryOutlineBtnText}>{uploadingImage ? "Uploading…" : "Choose photo"}</Text>
            </Pressable>
          </>
        );
      case "members_tasks":
        return (
          <>
            <View style={[styles.illustrationCircle, { backgroundColor: "#eff6ff" }]}>
              <Ionicons name="people-outline" size={88} color={colors.textPrimary} />
            </View>
            <Text style={styles.title}>Members and tasks</Text>
            <Text style={styles.body}>
              Keep people and leader tasks together so follow-ups stay visible and nothing slips through the cracks.
            </Text>
          </>
        );
      case "attendance":
        return (
          <>
            <View style={[styles.illustrationCircle, { backgroundColor: "#fef3c7" }]}>
              <Ionicons name="calendar-outline" size={88} color={colors.textPrimary} />
            </View>
            <Text style={styles.title}>Attendance and reports</Text>
            <Text style={styles.body}>
              Track who was present, notice when someone has not been in church for a while, and use reports to support
              pastoral care.
            </Text>
          </>
        );
      case "offline":
        return (
          <>
            <View style={[styles.illustrationCircle, { backgroundColor: "#ecfdf5" }]}>
              <Ionicons name="cloud-download-outline" size={88} color={colors.textPrimary} />
            </View>
            <Text style={styles.title}>Work offline</Text>
            <Text style={styles.body}>
              Download members, events, tasks, and ministries so Sheepmug stays useful on spotty Wi‑Fi or when you are
              completely offline.
            </Text>
            {offlineError ? <Text style={styles.offlineError}>{offlineError}</Text> : null}
            {offlineProgress ? <Text style={styles.offlineProgress}>{offlineProgress}</Text> : null}
            {!offlineReady ? (
              <Pressable
                style={[styles.offlinePrimaryBtn, offlineRunning && styles.offlinePrimaryBtnDisabled]}
                onPress={startOfflineDownload}
                disabled={offlineRunning}
              >
                {offlineRunning ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.offlinePrimaryBtnText}>Download data for offline</Text>
                )}
              </Pressable>
            ) : (
              <Text style={styles.offlineReadyHint}>Offline data is ready. Tap next when you are ready to continue.</Text>
            )}
          </>
        );
      case "finale":
        return (
          <>
            <View style={[styles.illustrationCircle, { backgroundColor: "#ede9fe" }]}>
              <Ionicons name="checkmark-circle-outline" size={88} color={colors.textPrimary} />
            </View>
            <Text style={styles.title}>You are all set</Text>
            <Text style={styles.body}>Open the app and start working with your church. You can change your profile anytime from the menu.</Text>
          </>
        );
      default:
        return null;
    }
  };

  const renderItem: ListRenderItem<StepKind> = useCallback(
    ({ item }) => (
      <View style={[styles.slide, { width }]}>
        {renderSlideBody(item)}
      </View>
    ),
    [
      firstName,
      offlineError,
      offlineProgress,
      offlineReady,
      offlineRunning,
      pickAndUploadPhoto,
      startOfflineDownload,
      uploadingImage,
      user?.profile_image,
      width,
    ]
  );

  const bottomPad = Math.max(insets.bottom, 12);
  const kind = steps[page];
  const nextDisabled = kind === "offline" && !offlineReady;
  const isLast = kind === "finale";
  const nextLabel = isLast ? "GET STARTED" : "NEXT";

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false, animation: "fade" }} />

      <View style={styles.pagerWrap}>
        <View style={[styles.onboardingTopBar, { paddingTop: insets.top }]}>
          <Pressable
            onPress={goHeaderBack}
            hitSlop={12}
            style={styles.onboardingBackBtn}
            accessibilityRole="button"
            accessibilityLabel={page > 0 ? "Previous slide" : "Go back"}
          >
            <Ionicons name="chevron-back" size={sizes.headerIcon} color="#111827" />
          </Pressable>
        </View>
        <FlatList
          ref={listRef}
          key={steps.join("-")}
          style={styles.list}
          data={steps}
          keyExtractor={(item, i) => `${item}-${i}`}
          renderItem={renderItem}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScrollEnd}
          onScrollToIndexFailed={onScrollToIndexFailed}
          getItemLayout={(_, index) => ({
            length: width,
            offset: width * index,
            index,
          })}
          initialNumToRender={steps.length}
          windowSize={5}
          bounces={false}
          keyboardShouldPersistTaps="handled"
        />
      </View>

      <View style={[styles.bottomChrome, { paddingBottom: bottomPad }]}>
        <View style={styles.dots}>
          {steps.map((_, i) => (
            <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>

        <View style={styles.footer}>
          <Pressable
            onPress={() => void skipEntireTour()}
            hitSlop={16}
            accessibilityRole="button"
            accessibilityLabel="Skip onboarding"
            style={({ pressed }) => [styles.skipPress, pressed && styles.pressed]}
          >
            <Text style={styles.skip}>SKIP</Text>
          </Pressable>
          <Pressable
            onPress={goNext}
            disabled={nextDisabled}
            accessibilityRole="button"
            accessibilityLabel={isLast ? "Get started" : "Next slide"}
            style={({ pressed }) => [
              styles.nextBtn,
              pressed && styles.nextBtnPressed,
              nextDisabled && styles.nextBtnDisabled,
            ]}
          >
            <Text style={styles.nextBtnText}>{nextLabel}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#ffffff",
    minHeight: 0,
  },
  pagerWrap: {
    flex: 1,
    minHeight: 0,
  },
  onboardingTopBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
  onboardingBackBtn: {
    padding: 8,
    minWidth: sizes.headerIconButton,
    minHeight: sizes.headerIconButton,
    justifyContent: "center",
    alignItems: "center",
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  slide: {
    paddingHorizontal: 28,
    paddingTop: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  illustrationCircle: {
    width: 200,
    height: 200,
    borderRadius: 100,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 32,
    overflow: "hidden",
  },
  photoHero: {
    width: 200,
    height: 200,
    borderRadius: 100,
  },
  photoInitial: {
    fontSize: 40,
    fontWeight: "700",
  },
  uploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  uploadOverlayText: {
    color: "#fff",
    fontSize: type.caption.size,
    fontWeight: "600",
  },
  secondaryOutlineBtn: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  secondaryOutlineBtnText: {
    fontSize: type.bodyStrong.size,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  offlineError: {
    marginTop: 8,
    color: "#b91c1c",
    fontSize: type.caption.size,
    textAlign: "center",
  },
  offlineProgress: {
    marginTop: 8,
    color: colors.textSecondary,
    fontSize: type.caption.size,
    textAlign: "center",
  },
  offlinePrimaryBtn: {
    marginTop: 16,
    minHeight: 48,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
    maxWidth: 340,
  },
  offlinePrimaryBtnDisabled: {
    opacity: 0.7,
  },
  offlinePrimaryBtnText: {
    color: "#fff",
    fontSize: type.bodyStrong.size,
    fontWeight: "700",
  },
  offlineReadyHint: {
    marginTop: 12,
    fontSize: type.body.size,
    color: colors.textSecondary,
    textAlign: "center",
    maxWidth: 320,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
    marginBottom: 12,
  },
  body: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textSecondary,
    textAlign: "center",
    maxWidth: 340,
  },
  bottomChrome: {
    backgroundColor: "#ffffff",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e5e7eb",
    zIndex: 20,
    elevation: 20,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    paddingTop: 16,
    paddingBottom: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "transparent",
  },
  dotActive: {
    backgroundColor: "#111827",
    borderColor: "#111827",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 8,
  },
  skipPress: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  pressed: {
    opacity: 0.7,
  },
  skip: {
    fontSize: type.caption.size,
    fontWeight: "600",
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  nextBtn: {
    backgroundColor: "#111827",
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  nextBtnPressed: {
    opacity: 0.9,
  },
  nextBtnDisabled: {
    opacity: 0.35,
  },
  nextBtnText: {
    color: "#ffffff",
    fontSize: type.caption.size,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
});
