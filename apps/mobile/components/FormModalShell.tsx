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
import { useTheme } from "../contexts/ThemeContext";
import { colors, radius, sizes, type } from "../theme";
import { HeaderIconCircle, HeaderIconCircleButton } from "./HeaderIconCircle";

export type FormModalVariant = "full" | "compact";

type IonName = ComponentProps<typeof Ionicons>["name"];

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  headerIcon?: IonName;
  variant?: FormModalVariant;
  dynamicHeight?: boolean;
  backdropColor?: string;
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
  dynamicHeight = false,
  backdropColor = "rgba(0,0,0,0.4)",
  children,
  footer,
}: Props) {
  const { colors: themedColors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const compact = variant === "compact";
  const sheetMaxH = compact ? winH * 0.72 : winH * 0.92;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <FormModalOverlayHost>
        <View style={styles.root}>
        <Pressable
          style={[styles.backdrop, { backgroundColor: backdropColor }]}
          onPress={onClose}
          accessibilityLabel="Dismiss"
        />
        <View
          style={[
            styles.sheetOuter,
            { maxHeight: sheetMaxH },
            dynamicHeight ? styles.sheetOuterDynamic : { height: sheetMaxH },
          ]}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={dynamicHeight ? styles.kavDynamic : styles.kav}
            keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 8 : 0}
          >
            <View style={[styles.sheet, dynamicHeight && styles.sheetDynamic, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <View style={styles.headerRow}>
              {headerIcon ? (
                <HeaderIconCircle>
                  <Ionicons name={headerIcon} size={sizes.headerIcon} color={themedColors.accent} />
                </HeaderIconCircle>
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
              <HeaderIconCircleButton onPress={onClose} hitSlop={12} accessibilityLabel="Close">
                <Ionicons name="close" size={sizes.headerIcon} color={themedColors.textPrimary} />
              </HeaderIconCircleButton>
              </View>
              <DashedRule />
              <ScrollView
                style={[styles.scroll, dynamicHeight && styles.scrollDynamic]}
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
  sheetOuterDynamic: {
    height: undefined,
  },
  kav: { flex: 1, width: "100%" },
  kavDynamic: { width: "100%" },
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
  sheetDynamic: {
    flex: 0,
    flexShrink: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
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
  dashedRule: {
    marginHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.accentBorder,
    borderStyle: "dashed",
  },
  scroll: { flexGrow: 1, flexShrink: 1 },
  scrollDynamic: { flexGrow: 0, flexShrink: 1 },
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
