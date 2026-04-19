import { useMemo } from "react";
import { Alert, Image, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../contexts/AuthContext";
import { useBranch } from "../contexts/BranchContext";
import { getMemberJoinQrImageUrl, getMemberJoinRegisterUrl } from "../lib/memberJoinRegisterUrl";
import { colors, radius, type } from "../theme";

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function MemberJoinQrModal({ visible, onClose }: Props) {
  const { user } = useAuth();
  const { selectedBranch } = useBranch();
  const qrTargetUrl = useMemo(
    () => getMemberJoinRegisterUrl(selectedBranch?.id, user?.branch_id),
    [selectedBranch?.id, user?.branch_id]
  );
  const qrImageUrl = useMemo(() => getMemberJoinQrImageUrl(qrTargetUrl), [qrTargetUrl]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.qrModalCard}>
          <View style={styles.qrBadge}>
            <Ionicons name="qr-code-outline" size={24} color={colors.accent} />
          </View>

          <Text style={styles.qrTitle}>Scan QR code</Text>
          <Text style={styles.qrSubtitle}>
            Scan this code to open the member join form. Submit new members data here and manage records.
          </Text>

          <View style={styles.qrImageWrap}>
            <Image source={{ uri: qrImageUrl }} style={styles.qrImage} />
          </View>

          <View style={styles.qrDividerWrap}>
            <View style={styles.qrDividerLine} />
            <Text style={styles.qrDividerText}>or use this URL manually</Text>
            <View style={styles.qrDividerLine} />
          </View>

          <View style={styles.urlRow}>
            <Text numberOfLines={1} style={styles.urlText}>
              {qrTargetUrl || "Select a branch to generate a join link"}
            </Text>
            <Pressable
              style={styles.urlActionBtn}
              onPress={() =>
                qrTargetUrl
                  ? void Linking.openURL(qrTargetUrl).catch(() => Alert.alert("Unable to open URL", qrTargetUrl))
                  : Alert.alert("Branch required", "Select a branch first to generate member join QR.")
              }
            >
              <Ionicons name="open-outline" size={16} color={colors.textPrimary} />
            </Pressable>
          </View>

          <Pressable
            style={styles.verifyBtn}
            onPress={() =>
              qrTargetUrl
                ? void Linking.openURL(qrTargetUrl).catch(() => Alert.alert("Unable to open URL", qrTargetUrl))
                : Alert.alert("Branch required", "Select a branch first to generate member join QR.")
            }
          >
            <Text style={styles.verifyBtnText}>Open member join URL</Text>
            <Ionicons name="arrow-forward" size={16} color="#fff" />
          </Pressable>

          <Pressable
            style={styles.downloadBtn}
            onPress={() =>
              void Linking.openURL(qrImageUrl).catch(() =>
                Alert.alert("Unable to download QR", "Could not open QR image link.")
              )
            }
          >
            <Ionicons name="download-outline" size={16} color={colors.textPrimary} />
            <Text style={styles.downloadBtnText}>Download QR image</Text>
          </Pressable>

          <Pressable style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 17, 17, 0.25)",
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
  },
  qrModalCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 20,
    backgroundColor: "#fff",
    paddingTop: 22,
    paddingHorizontal: 18,
    paddingBottom: 14,
    borderWidth: 1,
    borderColor: "#eceff3",
    alignItems: "center",
  },
  qrBadge: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "#dbe0ff",
    backgroundColor: "#eef2ff",
    alignItems: "center",
    justifyContent: "center",
    marginTop: -46,
    marginBottom: 10,
  },
  qrTitle: {
    fontSize: type.title.size,
    lineHeight: type.title.lineHeight,
    fontWeight: type.title.weight,
    color: colors.textPrimary,
    letterSpacing: type.title.letterSpacing,
    textAlign: "center",
  },
  qrSubtitle: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textSecondary,
    textAlign: "center",
    marginTop: 6,
    letterSpacing: type.body.letterSpacing,
  },
  qrImageWrap: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: "#fff",
    padding: 8,
  },
  qrImage: {
    width: 210,
    height: 210,
    borderRadius: 10,
    backgroundColor: "#fff",
  },
  qrDividerWrap: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    gap: 8,
  },
  qrDividerLine: { flex: 1, height: 1, backgroundColor: "#e8ebf0" },
  qrDividerText: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.textSecondary,
    letterSpacing: type.caption.letterSpacing,
  },
  urlRow: {
    width: "100%",
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#dfe3e8",
    borderRadius: radius.sm,
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 10,
    paddingRight: 6,
    gap: 8,
  },
  urlText: {
    flex: 1,
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    color: colors.textPrimary,
    fontWeight: type.bodyStrong.weight,
  },
  urlActionBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "#dfe3e8",
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  verifyBtn: {
    width: "100%",
    marginTop: 14,
    minHeight: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  verifyBtnText: {
    color: "#fff",
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    fontWeight: type.bodyStrong.weight,
  },
  downloadBtn: {
    width: "100%",
    marginTop: 10,
    minHeight: 42,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "#dfe3e8",
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  downloadBtnText: {
    color: colors.textPrimary,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    fontWeight: type.bodyStrong.weight,
  },
  closeBtn: {
    marginTop: 10,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  closeBtnText: {
    color: colors.textSecondary,
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.caption.weight,
  },
});
