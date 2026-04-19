import type { ComponentProps, ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FormModalOverlayHost } from "../contexts/FormModalOverlayContext";
import { colors, radius, sizes, type } from "../theme";

export type FormModalVariant = "full" | "compact";

type IonName = ComponentProps<typeof Ionicons>["name"];

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  headerIcon?: IonName;
  variant?: FormModalVariant;
  children: ReactNode;
  footer?: ReactNode;
};

function DashedRule() {
  return <View style={styles.dashedRule} />;
}

export function FormModalShell({
  visible,
  onClose,
  title,
  subtitle,
  headerIcon,
  variant = "full",
  children,
  footer,
}: Props) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const compact = variant === "compact";
  const sheetMaxH = compact ? winH * 0.72 : winH * 0.92;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <FormModalOverlayHost>
        <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={[styles.sheetOuter, { maxHeight: sheetMaxH, height: sheetMaxH }]}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.kav}
            keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 8 : 0}
          >
            <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <View style={styles.headerRow}>
              {headerIcon ? (
                <View style={styles.iconCircle}>
                  <Ionicons name={headerIcon} size={sizes.headerIcon} color={colors.accent} />
                </View>
              ) : null}
              <View style={styles.headerTextWrap}>
                <Text style={styles.title} numberOfLines={2}>
                  {title}
                </Text>
                {subtitle ? (
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn} accessibilityLabel="Close">
                <Ionicons name="close" size={sizes.headerIcon} color={colors.textPrimary} />
              </Pressable>
              </View>
              <DashedRule />
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {children}
              </ScrollView>
              {footer ? (
                <>
                  <DashedRule />
                  <View style={styles.footerWrap}>{footer}</View>
                </>
              ) : null}
            </View>
          </KeyboardAvoidingView>
        </View>
      </View>
      </FormModalOverlayHost>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  sheetOuter: {
    width: "100%",
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: "hidden",
  },
  kav: { flex: 1, width: "100%" },
  sheet: {
    flex: 1,
    minHeight: 200,
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentBorder,
    borderBottomWidth: 0,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  iconCircle: {
    width: sizes.headerIconButton,
    height: sizes.headerIconButton,
    borderRadius: sizes.headerIconButton / 2,
    backgroundColor: colors.accentSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTextWrap: { flex: 1, minWidth: 0, paddingTop: 2 },
  title: {
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  subtitle: {
    marginTop: 4,
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.textSecondary,
    letterSpacing: type.caption.letterSpacing,
  },
  closeBtn: { padding: 4, marginTop: -4 },
  dashedRule: {
    marginHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.accentBorder,
    borderStyle: "dashed",
  },
  scroll: { flexGrow: 1, flexShrink: 1 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  footerWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
});
