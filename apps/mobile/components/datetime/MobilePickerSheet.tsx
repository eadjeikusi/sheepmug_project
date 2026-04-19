import { useLayoutEffect, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../contexts/ThemeContext";
import { useFormModalOverlay } from "../../contexts/FormModalOverlayContext";
import { radius, type } from "../../theme";

type Props = {
  visible: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
  /** Renders spinner / picker; re-created when deps change (use useCallback in parent). */
  renderBody: () => ReactNode;
};

function sheetContent(
  renderBody: () => ReactNode,
  colors: { card: string; border: string; textSecondary: string; accent: string },
  onDismiss: () => void,
  onConfirm: () => void,
) {
  return (
    <View style={styles.root}>
      <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityLabel="Dismiss picker" />
      <View style={[styles.sheet, { backgroundColor: colors.card }]}>
        <View style={[styles.toolbar, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onDismiss} hitSlop={12}>
            <Text style={[styles.cancel, { color: colors.textSecondary }]}>Cancel</Text>
          </Pressable>
          <Pressable onPress={onConfirm} hitSlop={12}>
            <Text style={[styles.done, { color: colors.accent }]}>Done</Text>
          </Pressable>
        </View>
        {renderBody()}
      </View>
    </View>
  );
}

export function MobilePickerSheet({ visible, onDismiss, onConfirm, renderBody }: Props) {
  const { colors } = useTheme();
  const overlay = useFormModalOverlay();

  useLayoutEffect(() => {
    if (!visible) {
      overlay?.setOverlay(null);
      return;
    }
    if (!overlay) return;
    overlay.setOverlay(sheetContent(renderBody, colors, onDismiss, onConfirm));
    return () => overlay.setOverlay(null);
  }, [visible, overlay, onDismiss, onConfirm, renderBody, colors]);

  if (overlay) {
    return null;
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      {sheetContent(renderBody, colors, onDismiss, onConfirm)}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: 24,
  },
  toolbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cancel: { fontSize: type.body.size, fontWeight: "600" },
  done: { fontSize: type.body.size, fontWeight: "700" },
});
