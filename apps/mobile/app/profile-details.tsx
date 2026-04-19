import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import type { AuthUser } from "@sheepmug/shared-api";
import { api } from "../lib/api";
import { ensurePhotoLibraryPermission } from "../lib/photoLibraryAccess";
import { uploadMemberImageFromUri } from "../lib/uploadMemberImage";
import { MemberInitialAvatar } from "../components/MemberInitialAvatar";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { displayMemberWords } from "../lib/memberDisplayFormat";
import { radius, sizes, type } from "../theme";

function displayNameFromUser(user: AuthUser | null): string {
  if (!user) return "";
  return [String(user.first_name || "").trim(), String(user.last_name || "").trim()].filter(Boolean).join(" ");
}

export default function ProfileDetailsScreen() {
  const router = useRouter();
  const { user, setUserLocal, refreshUser } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [initialFirstName, setInitialFirstName] = useState("");
  const [initialLastName, setInitialLastName] = useState("");
  const [initialEmail, setInitialEmail] = useState("");
  const [initialProfileImage, setInitialProfileImage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  useEffect(() => {
    setFirstName(String(user?.first_name || ""));
    setLastName(String(user?.last_name || ""));
    setEmail(String(user?.email || ""));
    setProfileImage(typeof user?.profile_image === "string" ? user.profile_image : null);
    setInitialFirstName(String(user?.first_name || ""));
    setInitialLastName(String(user?.last_name || ""));
    setInitialEmail(String(user?.email || ""));
    setInitialProfileImage(typeof user?.profile_image === "string" ? user.profile_image : null);
  }, [user]);

  const hasChanges = useMemo(() => {
    const fn = firstName.trim();
    const ln = lastName.trim();
    const em = email.trim();
    const img = (profileImage || "").trim() || null;
    const ifn = initialFirstName.trim();
    const iln = initialLastName.trim();
    const iem = initialEmail.trim();
    const iimg = (initialProfileImage || "").trim() || null;
    return fn !== ifn || ln !== iln || em !== iem || img !== iimg;
  }, [email, firstName, initialEmail, initialFirstName, initialLastName, initialProfileImage, lastName, profileImage]);

  const canSave = useMemo(() => {
    if (!user?.id || saving || uploadingImage) return false;
    if (!firstName.trim() || !lastName.trim()) return false;
    return hasChanges;
  }, [firstName, hasChanges, lastName, saving, uploadingImage, user?.id]);

  async function uploadNewImage() {
    if (!(await ensurePhotoLibraryPermission())) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const uri = result.assets[0].uri;
    setUploadingImage(true);
    try {
      const uploadedUrl = await uploadMemberImageFromUri(uri);
      setProfileImage(uploadedUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not upload image.";
      Alert.alert("Profile image", message);
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleSave() {
    if (!user?.id || !canSave) return;
    setSaving(true);
    try {
      const payload = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        profile_image: (profileImage || "").trim() || null,
      };
      const result = await api.auth.updateProfile(payload);
      const nextUser: AuthUser = {
        ...user,
        ...(result?.user || {}),
      };
      await setUserLocal(nextUser);
      setInitialFirstName(nextUser.first_name || "");
      setInitialLastName(nextUser.last_name || "");
      setInitialEmail(nextUser.email || "");
      setInitialProfileImage(nextUser.profile_image || null);
      await refreshUser().catch(() => undefined);
      Alert.alert("Saved", "Your profile details were updated.");
      router.back();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save profile changes.";
      Alert.alert("Profile details", message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={sizes.headerIcon} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.title}>Profile Details</Text>
          <View style={styles.backBtn} />
        </View>

        <View style={styles.card}>
          <View style={styles.avatarRow}>
            {profileImage ? (
              <Image source={{ uri: profileImage }} style={styles.avatar} />
            ) : (
              <MemberInitialAvatar
                initial={firstName.trim()[0] || user?.first_name?.[0] || "U"}
                size={64}
                textStyle={styles.avatarFallbackText}
              />
            )}
            <View style={styles.avatarActions}>
              <Text style={styles.avatarName}>
                {displayMemberWords(displayNameFromUser(user).trim() || "My profile")}
              </Text>
              <Pressable style={styles.secondaryBtn} onPress={() => void uploadNewImage()} disabled={uploadingImage}>
                {uploadingImage ? (
                  <ActivityIndicator size="small" color={colors.textPrimary} />
                ) : (
                  <Text style={styles.secondaryBtnText}>Change Image</Text>
                )}
              </Pressable>
            </View>
          </View>

          <Text style={styles.label}>First Name</Text>
          <TextInput
            value={firstName}
            onChangeText={setFirstName}
            placeholder="First name"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
          />

          <Text style={styles.label}>Last Name</Text>
          <TextInput
            value={lastName}
            onChangeText={setLastName}
            placeholder="Last name"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
          />

          <Text style={styles.label}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email address"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>

        <Pressable
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          onPress={() => void handleSave()}
          disabled={!canSave}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
        </Pressable>
      </ScrollView>
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
}) {
  return StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  container: { padding: 16, gap: 14, paddingBottom: 28 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: {
    color: colors.textPrimary,
    fontSize: type.h1.size,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.weight,
    letterSpacing: type.h1.letterSpacing,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eceff3",
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    padding: 14,
    gap: 8,
  },
  avatarRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  avatar: { width: 64, height: 64, borderRadius: radius.pill, backgroundColor: "#ececec" },
  avatarFallback: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: "#ececec",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: {
    color: colors.textPrimary,
    fontSize: type.title.size,
    lineHeight: type.title.lineHeight,
    fontWeight: type.title.weight,
  },
  avatarActions: { gap: 6, flex: 1 },
  avatarName: {
    color: colors.textPrimary,
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    fontWeight: type.bodyStrong.weight,
  },
  secondaryBtn: {
    alignSelf: "flex-start",
    minHeight: 34,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    justifyContent: "center",
    backgroundColor: "#f8fafc",
  },
  secondaryBtnText: {
    color: colors.textPrimary,
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.bodyStrong.weight,
  },
  label: {
    marginTop: 6,
    color: colors.textSecondary,
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.caption.weight,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    color: colors.textPrimary,
    backgroundColor: "#fff",
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
  },
  saveBtn: {
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: {
    color: "#fff",
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    fontWeight: type.subtitle.weight,
  },
});
}
