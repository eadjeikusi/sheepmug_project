import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { colors, radius, type } from "../theme";

export type FilterPickerOption = { value: string; label: string };

export type AnchorRect = { x: number; y: number; width: number; height: number };

type Props = {
  visible: boolean;
  /** Shown above the list in centered mode; omitted in anchored mode for a cleaner panel. */
  title: string;
  options: FilterPickerOption[];
  selectedValue: string;
  onSelect: (value: string) => void;
  onClose: () => void;
  /**
   * When set, renders a floating white panel with soft shadow directly under the trigger.
   * When omitted or null while visible, falls back to centered sheet (e.g. measure failed).
   */
  anchorRect?: AnchorRect | null;
};

const GAP = 8;

function computeAnchoredPosition(
  anchor: AnchorRect,
  windowW: number,
  windowH: number
): { left: number; top: number; width: number; maxHeight: number } {
  const panelWidth = Math.min(Math.max(anchor.width, 160), windowW - 16);
  let left = anchor.x + (anchor.width - panelWidth) / 2;
  left = Math.max(8, Math.min(left, windowW - panelWidth - 8));

  const bottomOfAnchor = anchor.y + anchor.height;
  const spaceBelow = windowH - bottomOfAnchor - GAP - 16;
  const spaceAbove = anchor.y - GAP - 16;
  const wantH = 320;

  let top: number;
  let maxHeight: number;
  if (spaceBelow >= 140 || spaceBelow >= spaceAbove) {
    top = bottomOfAnchor + GAP;
    maxHeight = Math.min(wantH, Math.max(120, spaceBelow));
  } else {
    maxHeight = Math.min(wantH, Math.max(120, spaceAbove));
    top = anchor.y - GAP - maxHeight;
    if (top < 16) {
      top = 16;
      maxHeight = Math.min(wantH, anchor.y - GAP - 16);
    }
  }

  return { left, top, width: panelWidth, maxHeight };
}

/** Floating soft dropdown (anchored) or centered sheet fallback. */
export function FilterPickerModal({
  visible,
  title,
  options,
  selectedValue,
  onSelect,
  onClose,
  anchorRect,
}: Props) {
  const { width: windowW, height: windowH } = useWindowDimensions();
  const anchored = visible && anchorRect != null && anchorRect.width > 0;
  const pos = anchored ? computeAnchoredPosition(anchorRect!, windowW, windowH) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss" />
        {anchored && pos ? (
          <View
            style={[
              styles.anchorPanel,
              {
                left: pos.left,
                top: pos.top,
                width: pos.width,
                maxHeight: pos.maxHeight,
              },
            ]}
            pointerEvents="box-none"
          >
            <ScrollView
              style={styles.anchorScroll}
              contentContainerStyle={styles.anchorScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={options.length > 6}
              nestedScrollEnabled
            >
              {options.map((opt) => {
                const selected = opt.value === selectedValue;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => {
                      onSelect(opt.value);
                      onClose();
                    }}
                    style={({ pressed }) => [
                      styles.anchorOption,
                      selected && styles.anchorOptionSelected,
                      pressed && styles.optionPressed,
                    ]}
                  >
                    <Text style={[styles.anchorOptionText, selected && styles.anchorOptionTextSelected]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : (
          <View style={styles.centerRoot} pointerEvents="box-none">
            <View style={styles.sheetWrap}>
              <View style={styles.sheet}>
                {title ? <Text style={styles.title}>{title}</Text> : null}
                <ScrollView
                  style={{ maxHeight: 320 }}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={options.length > 6}
                >
                  {options.map((opt) => {
                    const selected = opt.value === selectedValue;
                    return (
                      <Pressable
                        key={opt.value}
                        onPress={() => {
                          onSelect(opt.value);
                          onClose();
                        }}
                        style={({ pressed }) => [
                          styles.option,
                          selected && styles.optionSelected,
                          pressed && styles.optionPressed,
                        ]}
                      >
                        <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{opt.label}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Pressable onPress={onClose} style={({ pressed }) => [styles.cancelBtn, pressed && styles.cancelPressed]}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
    zIndex: 0,
  },
  centerRoot: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    zIndex: 1,
  },
  sheetWrap: {
    zIndex: 2,
    width: "100%",
    maxWidth: "100%",
    alignSelf: "center",
  },
  sheet: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingTop: 16,
    paddingHorizontal: 8,
    paddingBottom: 12,
    maxHeight: "70%",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 12,
  },
  title: {
    fontSize: type.overline.size,
    fontWeight: type.overline.weight,
    letterSpacing: type.overline.letterSpacing,
    color: colors.textSecondary,
    textTransform: "uppercase",
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  anchorPanel: {
    position: "absolute",
    zIndex: 2,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 16,
  },
  anchorScroll: { flexGrow: 0 },
  anchorScrollContent: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  anchorOption: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
  },
  anchorOptionSelected: {
    backgroundColor: colors.accentSurface,
  },
  anchorOptionText: {
    fontSize: type.body.size,
    fontWeight: "500",
    color: colors.textPrimary,
    textAlign: "left",
  },
  anchorOptionTextSelected: {
    fontWeight: "600",
    color: colors.accent,
  },
  option: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
  },
  optionSelected: { backgroundColor: colors.accentSurface },
  optionPressed: { opacity: 0.92 },
  optionText: {
    fontSize: type.body.size,
    color: colors.textPrimary,
    fontWeight: "500",
  },
  optionTextSelected: {
    color: colors.accent,
    fontWeight: "600",
  },
  cancelBtn: {
    marginTop: 4,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelPressed: { opacity: 0.85 },
  cancelText: {
    fontSize: type.body.size,
    color: colors.textSecondary,
    fontWeight: "600",
  },
});
