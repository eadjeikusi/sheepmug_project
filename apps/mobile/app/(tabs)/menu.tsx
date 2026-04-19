import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../contexts/AuthContext";
import { useBranch } from "../../contexts/BranchContext";
import { useNotifications } from "../../contexts/NotificationContext";
import { useTheme } from "../../contexts/ThemeContext";
import { radius, type } from "../../theme";
import Constants from "expo-constants";
import { FilterPickerModal, type AnchorRect } from "../../components/FilterPickerModal";
import { MemberInitialAvatar } from "../../components/MemberInitialAvatar";
import { displayMemberWords } from "../../lib/memberDisplayFormat";
import { getFaceRecognitionOptIn, setFaceRecognitionOptIn } from "../../lib/storage";

function initials(first?: string, last?: string) {
  const a = (first || "").trim()[0] || "";
  const b = (last || "").trim()[0] || "";
  return (a + b || "U").toUpperCase();
}

function MenuRow({
  icon,
  label,
  colors,
  danger,
  onPress,
  rightNode,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  colors: {
    bg: string;
    card: string;
    textPrimary: string;
    textSecondary: string;
    border: string;
    accent: string;
    success: string;
  };
  danger?: boolean;
  onPress?: () => void;
  rightNode?: ReactNode;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable style={styles.menuRow} onPress={onPress}>
      <View style={styles.menuRowLeft}>
        <Ionicons name={icon} size={16} color={danger ? "#dc2626" : colors.textPrimary} />
        <Text style={[styles.menuRowText, danger && styles.menuRowDanger]}>{label}</Text>
      </View>
      {rightNode || <Ionicons name="chevron-forward" size={15} color={colors.textSecondary} />}
    </Pressable>
  );
}

export default function MenuScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { branches, selectedBranch, selectBranch, refreshBranches } = useBranch();
  useNotifications();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [refreshing, setRefreshing] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [faqOpen, setFaqOpen] = useState(false);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [branchPickerAnchor, setBranchPickerAnchor] = useState<AnchorRect | null>(null);
  const branchRowRef = useRef<View>(null);
  const [faceRecognitionOptIn, setFaceRecognitionOptInState] = useState(false);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const on = await getFaceRecognitionOptIn();
      if (mounted) setFaceRecognitionOptInState(on);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const switchTrackColor = useMemo(
    () => ({ false: colors.border, true: colors.accent }),
    [colors.accent, colors.border]
  );

  const biometricLabel = Platform.OS === "ios" ? "Face ID" : "Face unlock";

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshBranches();
    } finally {
      setRefreshing(false);
    }
  }, [refreshBranches]);

  const goProfile = () => {
    router.push("/profile-details");
  };

  const appVersion = Constants.expoConfig?.version || "1.0.0";
  const appBuild = Constants.expoConfig?.ios?.buildNumber || Constants.expoConfig?.android?.versionCode || "dev";
  const selectedBranchName = selectedBranch?.name?.trim()
    ? displayMemberWords(selectedBranch.name)
    : "Select branch";

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
      >
        <Text style={styles.pageTitle}>Settings</Text>

        <Pressable style={styles.profileCard} onPress={goProfile}>
          {user?.profile_image ? (
            <Image source={{ uri: user.profile_image }} style={styles.avatar} />
          ) : (
            <MemberInitialAvatar
              initial={initials(user?.first_name, user?.last_name)}
              size={42}
              textStyle={styles.avatarText}
            />
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>
              {displayMemberWords(
                [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim() || "My Profile"
              )}
            </Text>
            <Text style={styles.profileRole}>{user?.email || "Profile details"}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </Pressable>

        <Text style={styles.sectionLabel}>Facial recognition</Text>
        <View style={styles.block}>
          <View style={styles.faceSwitchRow}>
            <View style={styles.faceSwitchTextWrap}>
              <Text style={styles.faceSwitchTitle}>Allow facial recognition</Text>
              <Text style={styles.faceSwitchDesc}>
                When your church turns this on, you can use {biometricLabel} on this device for a faster, optional sign-in
                flow. Your face data stays on-device until enrollment is implemented.
              </Text>
            </View>
            <Switch
              value={faceRecognitionOptIn}
              onValueChange={(v) => {
                setFaceRecognitionOptInState(v);
                void setFaceRecognitionOptIn(v);
              }}
              trackColor={switchTrackColor}
              thumbColor={faceRecognitionOptIn ? "#ffffff" : "#f4f3f4"}
              accessibilityLabel="Allow facial recognition"
            />
          </View>
          <View style={styles.faceDivider} />
          <MenuRow
            icon="scan-outline"
            label="Enroll or update face data"
            colors={colors}
            onPress={() => {
              if (!faceRecognitionOptIn) {
                Alert.alert(
                  "Turn on facial recognition",
                  `Enable “Allow facial recognition” first. Enrollment will use ${biometricLabel} when the feature is ready.`
                );
                return;
              }
              Alert.alert(
                "Face enrollment",
                "Enrollment is not available yet. When your organization enables facial recognition, you will complete a short scan here so SheepMug can verify it is you at sign-in."
              );
            }}
          />
          <MenuRow
            icon="trash-outline"
            label="Remove face data from this device"
            colors={colors}
            danger
            onPress={() => {
              Alert.alert(
                "Remove face data",
                "There is no enrolled template stored in SheepMug yet. When enrollment launches, you will be able to clear it from this screen."
              );
            }}
          />
        </View>

        <Text style={styles.sectionLabel}>Other settings</Text>
        <View style={styles.block}>
          <View ref={branchRowRef} collapsable={false}>
            <MenuRow
              icon="git-branch-outline"
              label="Branch"
              colors={colors}
              rightNode={
                <View style={styles.branchDropRight}>
                  <Text style={styles.branchDropValue} numberOfLines={1}>
                    {selectedBranchName}
                  </Text>
                  <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
                </View>
              }
              onPress={() => {
                branchRowRef.current?.measureInWindow((x, y, width, height) => {
                  setBranchPickerAnchor({ x, y, width, height });
                  setBranchPickerOpen(true);
                });
              }}
            />
          </View>
          <MenuRow icon="person-outline" label="Profile details" onPress={goProfile} colors={colors} />
          <MenuRow
            icon="notifications-outline"
            label="Notification settings"
            onPress={() => router.push("/notification-settings")}
            colors={colors}
          />
          <MenuRow
            icon="notifications"
            label="Notification inbox"
            onPress={() => router.push("/notifications")}
            colors={colors}
          />
        </View>

        <View style={styles.block}>
          <MenuRow icon="information-circle-outline" label="About application" onPress={() => setAboutOpen(true)} colors={colors} />
          <MenuRow icon="chatbubble-ellipses-outline" label="Help / FAQ" onPress={() => setFaqOpen(true)} colors={colors} />
        </View>

        <Pressable
          style={styles.logoutBtn}
          onPress={async () => {
            await logout();
            router.replace("/login");
          }}
        >
          <Text style={styles.logoutText}>Logout</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={aboutOpen} transparent animationType="fade" onRequestClose={() => setAboutOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>About SheepMug</Text>
            <Text style={styles.modalBody}>
              SheepMug helps church leaders manage members, ministries, events, attendance, and follow-up tasks in one place.
            </Text>
            <Text style={styles.modalMeta}>Version: {appVersion}</Text>
            <Text style={styles.modalMeta}>Build: {String(appBuild)}</Text>
            <Pressable style={styles.modalCloseBtn} onPress={() => setAboutOpen(false)}>
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={faqOpen} transparent animationType="fade" onRequestClose={() => setFaqOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Help / FAQ</Text>
            <View style={styles.faqList}>
              <Text style={styles.faqItem}>1. How do I add or edit a member? Open Members, pick a profile, then use edit actions.</Text>
              <Text style={styles.faqItem}>2. How do I switch branches? Open Settings and tap the branch name you want.</Text>
              <Text style={styles.faqItem}>3. Where can I control notifications? Open Settings then Notification settings.</Text>
              <Text style={styles.faqItem}>4. How do tasks work? Tasks can be assigned to leaders and tracked by status and due date.</Text>
              <Text style={styles.faqItem}>5. How is attendance recorded? Open an event and mark members as present, absent, or unsure.</Text>
            </View>
            <Pressable style={styles.modalCloseBtn} onPress={() => setFaqOpen(false)}>
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <FilterPickerModal
        visible={branchPickerOpen}
        title="Select branch"
        anchorRect={branchPickerAnchor}
        options={branches.map((branch) => ({
          value: branch.id,
          label: displayMemberWords(String(branch.name || "")),
        }))}
        selectedValue={selectedBranch?.id || ""}
        onSelect={(value) => {
          const branch = branches.find((b) => b.id === value);
          if (branch) void selectBranch(branch);
        }}
        onClose={() => {
          setBranchPickerOpen(false);
          setBranchPickerAnchor(null);
        }}
      />
    </SafeAreaView>
  );
}

function makeStyles(colors: {
  bg: string;
  card: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  accent: string;
  success: string;
}) {
  return StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  container: { padding: 16, gap: 12, paddingBottom: 30 },
  pageTitle: {
    textAlign: "center",
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: colors.textPrimary,
    fontWeight: type.pageTitle.weight,
    letterSpacing: type.pageTitle.letterSpacing,
  },
  profileCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatar: { width: 42, height: 42, borderRadius: radius.pill, backgroundColor: "#ececec" },
  avatarFallback: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: "#ececec",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: colors.textPrimary,
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    fontWeight: type.bodyStrong.weight,
  },
  profileName: {
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    color: colors.textPrimary,
    fontWeight: type.subtitle.weight,
  },
  profileRole: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textSecondary,
    letterSpacing: type.body.letterSpacing,
  },
  sectionLabel: {
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    color: colors.textSecondary,
    fontWeight: type.bodyStrong.weight,
    marginTop: 2,
  },
  block: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  faceSwitchRow: {
    paddingHorizontal: 12,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  faceSwitchTextWrap: { flex: 1, gap: 6 },
  faceSwitchTitle: {
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    color: colors.textPrimary,
    fontWeight: type.subtitle.weight,
    letterSpacing: type.subtitle.letterSpacing,
  },
  faceSwitchDesc: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight + 2,
    color: colors.textSecondary,
    letterSpacing: type.caption.letterSpacing,
  },
  faceDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: 12,
  },
  menuRow: {
    minHeight: 54,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  menuRowLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  menuRowText: {
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    color: colors.textPrimary,
    letterSpacing: type.subtitle.letterSpacing,
  },
  menuRowDanger: { color: "#dc2626" },
  branchDropRight: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "58%" },
  branchDropValue: {
    color: colors.textSecondary,
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.caption.weight,
  },
  logoutBtn: {
    marginTop: 8,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.textPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  logoutText: {
    color: "#fff",
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    fontWeight: type.subtitle.weight,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.36)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  modalCard: {
    width: "100%",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    padding: 16,
    gap: 10,
  },
  modalTitle: {
    color: colors.textPrimary,
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    fontWeight: type.subtitle.weight,
  },
  modalBody: {
    color: colors.textSecondary,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
  },
  modalMeta: {
    color: colors.textPrimary,
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.bodyStrong.weight,
  },
  faqList: { gap: 8 },
  faqItem: {
    color: colors.textSecondary,
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight + 2,
  },
  modalCloseBtn: {
    marginTop: 6,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCloseText: {
    color: "#fff",
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    fontWeight: type.bodyStrong.weight,
  },
});
}
