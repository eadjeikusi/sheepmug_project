import { useCallback, useRef, useState } from "react";
import {
  FlatList,
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
import { Ionicons } from "@expo/vector-icons";
import { setOnboardingCompleted } from "../lib/storage";
import { colors, sizes, type } from "../theme";

type Slide = {
  title: string;
  body: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconBg: string;
};

const SLIDES: Slide[] = [
  {
    title: "Discipleship made easy",
    body: "Streamline how your church equips and grows disciples in one place.",
    icon: "heart-outline",
    iconBg: "#eff6ff",
  },
  {
    title: "Assign members to leaders",
    body: "Connect members with church leaders and disciples who can shepherd and walk with them.",
    icon: "people-outline",
    iconBg: "#eff6ff",
  },
  {
    title: "Track attendance & absences",
    body: "Take attendance for assignments and get notifications when someone is absent.",
    icon: "calendar-outline",
    iconBg: "#fef3c7",
  },
  {
    title: "To-do list for church leaders",
    body: "Keep tasks and follow-ups organized so leaders stay on top of ministry work.",
    icon: "checkbox-outline",
    iconBg: "#dbeafe",
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<Slide>>(null);
  const [page, setPage] = useState(0);

  const finish = useCallback(() => {
    void (async () => {
      try {
        await setOnboardingCompleted(true);
      } catch {
        // still navigate
      }
      router.replace("/(tabs)/dashboard");
    })();
  }, [router]);

  const goNext = useCallback(() => {
    if (page < SLIDES.length - 1) {
      const next = page + 1;
      listRef.current?.scrollToIndex({ index: next, animated: true });
      setPage(next);
    } else {
      finish();
    }
  }, [page, finish]);

  const goHeaderBack = useCallback(() => {
    if (page > 0) {
      const prev = page - 1;
      listRef.current?.scrollToIndex({ index: prev, animated: true });
      setPage(prev);
    } else if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      router.replace("/(tabs)/dashboard");
    }
  }, [page, navigation, router]);

  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const i = Math.round(x / width);
      setPage(Math.min(Math.max(i, 0), SLIDES.length - 1));
    },
    [width]
  );

  const onScrollToIndexFailed = useCallback(
    (info: { index: number }) => {
      const wait = new Promise((r) => setTimeout(r, 100));
      void wait.then(() => {
        listRef.current?.scrollToIndex({ index: info.index, animated: true });
      });
    },
    []
  );

  const renderItem: ListRenderItem<Slide> = useCallback(
    ({ item }) => (
      <View style={[styles.slide, { width }]}>
        <View style={[styles.illustrationCircle, { backgroundColor: item.iconBg }]}>
          <Ionicons name={item.icon} size={88} color={colors.textPrimary} />
        </View>
        <Text style={styles.title}>{item.title}</Text>
        <Text style={styles.body}>{item.body}</Text>
      </View>
    ),
    [width]
  );

  const bottomPad = Math.max(insets.bottom, 12);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false, animation: "fade" }} />

      {/* minHeight:0 lets the list shrink inside flex so it does not eat the whole screen / touch layer */}
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
          style={styles.list}
          data={SLIDES}
          keyExtractor={(_, i) => `slide-${i}`}
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
          initialNumToRender={SLIDES.length}
          windowSize={5}
          bounces={false}
          keyboardShouldPersistTaps="handled"
        />
      </View>

      <View style={[styles.bottomChrome, { paddingBottom: bottomPad }]}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>

        <View style={styles.footer}>
          <Pressable
            onPress={finish}
            hitSlop={16}
            accessibilityRole="button"
            accessibilityLabel="Skip onboarding"
            style={({ pressed }) => [styles.skipPress, pressed && styles.pressed]}
          >
            <Text style={styles.skip}>SKIP</Text>
          </Pressable>
          <Pressable
            onPress={goNext}
            accessibilityRole="button"
            accessibilityLabel={page === SLIDES.length - 1 ? "Get started" : "Next slide"}
            style={({ pressed }) => [styles.nextBtn, pressed && styles.nextBtnPressed]}
          >
            <Text style={styles.nextBtnText}>{page === SLIDES.length - 1 ? "GET STARTED" : "NEXT"}</Text>
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
  nextBtnText: {
    color: "#ffffff",
    fontSize: type.caption.size,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
});
