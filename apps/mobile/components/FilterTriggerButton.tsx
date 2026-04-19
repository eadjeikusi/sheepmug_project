import { Ionicons } from "@expo/vector-icons";
import { forwardRef } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius, type } from "../theme";

type Props = {
  valueLabel: string;
  onPress: () => void;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
  /** When the menu is open for this control, chevron points up (reference UI). */
  open?: boolean;
};

/**
 * Search/filter toolbar trigger: left-aligned value + chevron; use inside a flex row.
 * `ref` targets the outer wrapper for `measureInWindow` (anchored dropdown).
 */
export const FilterTriggerButton = forwardRef<View, Props>(function FilterTriggerButton(
  { valueLabel, onPress, accessibilityLabel, style, open = false },
  ref
) {
  return (
    <View ref={ref} collapsable={false} style={[styles.wrap, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={({ pressed }) => [styles.root, pressed && styles.pressed]}
      >
        <Text style={styles.value} numberOfLines={1}>
          {valueLabel}
        </Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.textSecondary}
          style={styles.chevron}
        />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    minWidth: 0,
  },
  root: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  pressed: { opacity: 0.92 },
  value: {
    flex: 1,
    minWidth: 0,
    fontSize: type.caption.size,
    fontWeight: "600",
    color: colors.textPrimary,
    textAlign: "left",
  },
  chevron: { flexShrink: 0 },
});
