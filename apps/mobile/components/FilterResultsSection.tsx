import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, type } from "../theme";

export function filterResultCountLabel(count: number): string {
  return `${count} result${count === 1 ? "" : "s"}`;
}

export function FilterResultsHeaderCount({ count }: { count: number }) {
  return <Text style={styles.headerResultCount}>{filterResultCountLabel(count)}</Text>;
}

/** Compact count badge on the same row as the screen title (Members / Events / Tasks). */
export function HeaderCountTile({
  count,
  accessibilityLabel,
}: {
  count: number;
  /** Defaults to `filterResultCountLabel(count)`. */
  accessibilityLabel?: string;
}) {
  const label = accessibilityLabel ?? filterResultCountLabel(count);
  return (
    <View
      style={styles.headerCountTile}
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      <Text style={styles.headerCountTileText}>{count}</Text>
    </View>
  );
}

export type FilterResultChip = {
  key: string;
  label: string;
  onLabelPress: () => void;
};

type FilterResultsChipsProps = {
  chips: FilterResultChip[];
  onRemoveChip: (key: string) => void;
  onClearAll: () => void;
};

/** “Filter results” chip row (Members-style). Renders nothing when chips is empty. */
export function FilterResultsChips({ chips, onRemoveChip, onClearAll }: FilterResultsChipsProps) {
  if (chips.length === 0) return null;
  return (
    <View style={styles.filtersBlock}>
      <View style={styles.filtersChipSection}>
        <Text style={styles.filtersSectionTitle}>Filter results</Text>
        <View style={styles.filterChipsWrap}>
          {chips.map((chip) => (
            <View key={chip.key} style={[styles.filterChip, styles.filterChipActive]}>
              <Pressable onPress={chip.onLabelPress} style={styles.filterChipLabelPress}>
                <Text style={[styles.filterChipText, styles.filterChipTextActive]} numberOfLines={2}>
                  {chip.label}
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel={`Remove filter ${chip.label}`}
                onPress={() => onRemoveChip(chip.key)}
                style={styles.filterChipRemoveBtn}
                hitSlop={{ top: 6, bottom: 6, left: 4, right: 6 }}
              >
                <Ionicons name="close" size={14} color={colors.accent} />
              </Pressable>
            </View>
          ))}
          <Pressable style={[styles.filterChip, styles.filterChipMuted]} onPress={onClearAll}>
            <Ionicons name="close" size={13} color={colors.accent} />
            <Text style={[styles.filterChipText, styles.filterChipTextMuted, styles.filterChipClearText]}>
              Clear all
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerResultCount: {
    marginTop: 2,
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.textSecondary,
    fontWeight: type.caption.weight,
  },
  headerCountTile: {
    minWidth: 40,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: colors.accentSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCountTileText: {
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    fontWeight: "700",
    color: colors.accent,
    fontVariant: ["tabular-nums"],
  },
  filtersBlock: {
    backgroundColor: colors.bg,
    paddingBottom: 8,
    marginTop: 4,
  },
  filtersChipSection: {
    gap: 10,
  },
  filtersSectionTitle: {
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    color: colors.accent,
    fontWeight: type.subtitle.weight,
  },
  filterChipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    alignItems: "flex-start",
  },
  filterChipLabelPress: {
    flexShrink: 1,
    maxWidth: 200,
    paddingVertical: 2,
    paddingLeft: 2,
  },
  filterChipRemoveBtn: {
    paddingLeft: 2,
    paddingRight: 4,
    justifyContent: "center",
    alignItems: "center",
    minHeight: 24,
  },
  filterChipClearText: {
    fontSize: type.caption.size,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: colors.accentBorder,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 4,
    minHeight: 28,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 2,
    maxWidth: "100%",
  },
  filterChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSurface,
  },
  filterChipMuted: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSurface,
  },
  filterChipText: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight + 1,
    color: colors.textSecondary,
    fontWeight: "600",
    letterSpacing: type.body.letterSpacing,
    textAlign: "left",
    textAlignVertical: "center",
  },
  filterChipTextActive: {
    color: colors.accent,
  },
  filterChipTextMuted: {
    color: colors.accent,
    opacity: 0.85,
  },
});
