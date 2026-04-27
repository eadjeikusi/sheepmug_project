import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius } from "../theme";

const HALF_MS = 700;
const OPACITY_LOW = 0.38;
const OPACITY_HIGH = 0.78;

function usePulseOpacity() {
  const v = useRef(new Animated.Value(OPACITY_LOW)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: OPACITY_HIGH, duration: HALF_MS, useNativeDriver: true }),
        Animated.timing(v, { toValue: OPACITY_LOW, duration: HALF_MS, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return v;
}

type BlockProps = {
  style?: StyleProp<ViewStyle>;
  fillColor?: string;
};

/** Pulsing rectangle — pass width/height via style. */
export function SkeletonBlock({ style, fillColor = colors.border }: BlockProps) {
  const opacity = usePulseOpacity();
  return (
    <Animated.View
      style={[styles.blockBase, { backgroundColor: fillColor, opacity }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

export function MemberRowSkeleton({ fillColor }: { fillColor?: string }) {
  return (
    <View style={styles.memberRow}>
      <SkeletonBlock style={styles.memberAvatar} fillColor={fillColor} />
      <View style={styles.memberTextCol}>
        <SkeletonBlock style={styles.memberLine1} fillColor={fillColor} />
        <SkeletonBlock style={styles.memberLine2} fillColor={fillColor} />
      </View>
    </View>
  );
}

export function MemberListSkeleton({ count = 8, fillColor }: { count?: number; fillColor?: string }) {
  return (
    <View style={styles.memberListWrap}>
      {Array.from({ length: count }, (_, i) => (
        <MemberRowSkeleton key={i} fillColor={fillColor} />
      ))}
    </View>
  );
}

export function EventCardSkeleton({ fillColor }: { fillColor?: string }) {
  return (
    <View style={styles.eventCard}>
      <View style={styles.eventRow}>
        <SkeletonBlock style={styles.eventThumb} fillColor={fillColor} />
        <View style={styles.eventMain}>
          <View style={styles.eventTitleRow}>
            <SkeletonBlock style={styles.eventTitleBar} fillColor={fillColor} />
            <SkeletonBlock style={styles.eventPill} fillColor={fillColor} />
          </View>
          <SkeletonBlock style={styles.eventMeta} fillColor={fillColor} />
        </View>
      </View>
    </View>
  );
}

export function EventListSkeleton({ count = 6, fillColor }: { count?: number; fillColor?: string }) {
  return (
    <View style={styles.eventListOuter}>
      {Array.from({ length: count }, (_, i) => (
        <EventCardSkeleton key={i} fillColor={fillColor} />
      ))}
    </View>
  );
}

export function TaskBlockSkeleton({ fillColor }: { fillColor?: string }) {
  return (
    <View style={styles.taskBlock}>
      <SkeletonBlock style={styles.taskTitle} fillColor={fillColor} />
      <SkeletonBlock style={styles.taskSub} fillColor={fillColor} />
      <View style={styles.taskChips}>
        <SkeletonBlock style={styles.taskChip} fillColor={fillColor} />
        <SkeletonBlock style={styles.taskChipWide} fillColor={fillColor} />
      </View>
    </View>
  );
}

export function TaskListSkeleton({ count = 6, fillColor }: { count?: number; fillColor?: string }) {
  return (
    <View style={styles.taskListWrap}>
      {Array.from({ length: count }, (_, i) => (
        <TaskBlockSkeleton key={i} fillColor={fillColor} />
      ))}
    </View>
  );
}

export function MinistryCardSkeleton({ fillColor }: { fillColor?: string }) {
  return (
    <View style={styles.minCard}>
      <SkeletonBlock style={styles.minTitle} fillColor={fillColor} />
      <SkeletonBlock style={styles.minDesc} fillColor={fillColor} />
      <View style={styles.minFooter}>
        <View style={styles.minFaces}>
          <SkeletonBlock style={styles.minFace} fillColor={fillColor} />
          <SkeletonBlock style={[styles.minFace, styles.minFaceOverlap]} fillColor={fillColor} />
        </View>
        <SkeletonBlock style={styles.minChevron} fillColor={fillColor} />
      </View>
    </View>
  );
}

export function MinistryListSkeleton({ count = 4, fillColor }: { count?: number; fillColor?: string }) {
  return (
    <View style={styles.minList}>
      {Array.from({ length: count }, (_, i) => (
        <MinistryCardSkeleton key={i} fillColor={fillColor} />
      ))}
    </View>
  );
}

export function NotificationRowSkeleton({ fillColor }: { fillColor?: string }) {
  return (
    <View style={styles.notifRow}>
      <SkeletonBlock style={styles.notifIcon} fillColor={fillColor} />
      <View style={styles.notifBody}>
        <SkeletonBlock style={styles.notifTitle} fillColor={fillColor} />
        <SkeletonBlock style={styles.notifSub} fillColor={fillColor} />
      </View>
    </View>
  );
}

export function NotificationListSkeleton({ count = 6, fillColor }: { count?: number; fillColor?: string }) {
  return (
    <View>
      {Array.from({ length: count }, (_, i) => (
        <NotificationRowSkeleton key={i} fillColor={fillColor} />
      ))}
    </View>
  );
}

export function ReportHistoryRowSkeleton({ fillColor }: { fillColor?: string }) {
  return (
    <View style={styles.histRow}>
      <View style={styles.histLeft}>
        <SkeletonBlock style={styles.histName} fillColor={fillColor} />
        <SkeletonBlock style={styles.histDesc} fillColor={fillColor} />
      </View>
      <SkeletonBlock style={styles.histDate} fillColor={fillColor} />
      <View style={styles.histExport}>
        <SkeletonBlock style={styles.histLink} fillColor={fillColor} />
      </View>
    </View>
  );
}

export function ReportHistoryTableSkeleton({ rows = 5, fillColor }: { rows?: number; fillColor?: string }) {
  return (
    <View>
      {Array.from({ length: rows }, (_, i) => (
        <ReportHistoryRowSkeleton key={i} fillColor={fillColor} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  blockBase: { borderRadius: radius.sm },
  memberListWrap: { paddingTop: 4, gap: 4 },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    minHeight: 74,
    padding: 14,
    marginBottom: 4,
  },
  memberAvatar: { width: 40, height: 40, borderRadius: 20 },
  memberTextCol: { flex: 1, minWidth: 0, gap: 8 },
  memberLine1: { height: 14, width: "55%", borderRadius: 6 },
  memberLine2: { height: 12, width: "40%", borderRadius: 6 },
  eventCard: {
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  eventRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  eventThumb: { width: 72, height: 72, borderRadius: radius.sm },
  eventMain: { flex: 1, minWidth: 0 },
  eventTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  eventTitleBar: { flex: 1, minWidth: 0, height: 16, borderRadius: 6 },
  eventPill: { width: 72, height: 24, borderRadius: radius.pill },
  eventMeta: { marginTop: 8, height: 13, width: "88%", borderRadius: 5 },
  eventListOuter: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  taskListWrap: { gap: 10 },
  taskBlock: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
    marginBottom: 4,
  },
  taskTitle: { height: 15, width: "70%", borderRadius: 6 },
  taskSub: { marginTop: 10, height: 12, width: "50%", borderRadius: 5 },
  taskChips: { marginTop: 12, flexDirection: "row", gap: 8 },
  taskChip: { height: 22, width: 88, borderRadius: 6 },
  taskChipWide: { height: 22, width: 100, borderRadius: 6 },
  minList: { gap: 12, width: "100%" },
  minCard: {
    width: "100%",
    borderRadius: 20,
    padding: 16,
    backgroundColor: "#e8e2f8",
    shadowColor: "rgba(0,0,0,0.12)",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 3,
    marginBottom: 2,
  },
  minTitle: { height: 16, width: "62%", borderRadius: 6, marginBottom: 8 },
  minDesc: { height: 13, width: "85%", borderRadius: 5 },
  minFooter: { marginTop: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  minFaces: { flexDirection: "row", alignItems: "center" },
  minFace: { width: 32, height: 32, borderRadius: 16 },
  minFaceOverlap: { marginLeft: -8 },
  minChevron: { width: 20, height: 20, borderRadius: 4 },
  notifRow: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  notifIcon: { width: 40, height: 40, borderRadius: 12 },
  notifBody: { flex: 1, minWidth: 0, gap: 8 },
  notifTitle: { height: 15, width: "75%", borderRadius: 5 },
  notifSub: { height: 12, width: "90%", borderRadius: 5 },
  histRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  histLeft: { flex: 1.2, minWidth: 140, gap: 6 },
  histName: { height: 14, width: "80%", borderRadius: 5 },
  histDesc: { height: 11, width: "60%", borderRadius: 4 },
  histDate: { width: 100, height: 13, borderRadius: 4 },
  histExport: { width: 100, alignItems: "flex-start" },
  histLink: { height: 14, width: 36, borderRadius: 4 },
});
