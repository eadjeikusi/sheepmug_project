import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { CustomFieldDefinition, Member, MemberStatusOption } from "@sheepmug/shared-api";
import { api } from "../lib/api";
import { getDeviceDefaultCountryIso } from "../lib/deviceDefaultCountry";
import { normalizePhoneToE164, normalizePhoneToE164Required } from "../lib/phoneE164";
import { displayMemberWords } from "../lib/memberDisplayFormat";
import { ensurePhotoLibraryPermission } from "../lib/photoLibraryAccess";
import { uploadMemberImageFromUri } from "../lib/uploadMemberImage";
import { colors, radius, type } from "../theme";
import { FormModalShell } from "./FormModalShell";
import { MemberInitialAvatar } from "./MemberInitialAvatar";
import { PhoneCountryField } from "./PhoneCountryField";
import { YmdDateField } from "./YmdDateField";
import { useOfflineSync } from "../contexts/OfflineSyncContext";

type Props = {
  visible: boolean;
  onClose: () => void;
  memberStatusOptions: MemberStatusOption[];
  fieldDefs: CustomFieldDefinition[];
  onCreated: (m: Member) => void;
};

const GENDER_OPTIONS = ["Male", "Female", "Other"];
const MARITAL_OPTIONS = ["Single", "Married", "Divorced", "Widowed"];

function todayYmd(): string {
  return new Date().toISOString().split("T")[0];
}

function OptionPills({
  options,
  value,
  onSelect,
}: {
  options: string[];
  value: string;
  onSelect: (v: string) => void;
}) {
  const lower = value.toLowerCase();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.pillRow}
      keyboardShouldPersistTaps="handled"
    >
      {options.map((opt) => {
        const active = opt.toLowerCase() === lower;
        return (
          <Pressable
            key={opt}
            style={[styles.pill, active && styles.pillActive]}
            onPress={() => onSelect(opt)}
          >
            <Text style={[styles.pillText, active && styles.pillTextActive]}>{opt}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function MemberAddModal({ visible, onClose, memberStatusOptions, fieldDefs, onCreated }: Props) {
  const { isOnline, queueMemberCreate } = useOfflineSync();
  const defaultCountry = getDeviceDefaultCountryIso();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneCountryIso, setPhoneCountryIso] = useState(defaultCountry);
  const [phoneNational, setPhoneNational] = useState("");
  const [emergencyCountryIso, setEmergencyCountryIso] = useState(defaultCountry);
  const [emergencyNational, setEmergencyNational] = useState("");
  const [address, setAddress] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("");
  const [marital, setMarital] = useState("");
  const [occupation, setOccupation] = useState("");
  const [dateJoined, setDateJoined] = useState(todayYmd);
  const [status, setStatus] = useState("Active");
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const [profileImageUri, setProfileImageUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const dc = getDeviceDefaultCountryIso();
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhoneCountryIso(dc);
    setPhoneNational("");
    setEmergencyCountryIso(dc);
    setEmergencyNational("");
    setAddress("");
    setEmergencyName("");
    setDob("");
    setGender("");
    setMarital("");
    setOccupation("");
    setDateJoined(todayYmd());
    setStatus("Active");
    const next: Record<string, string> = {};
    for (const def of fieldDefs) next[def.field_key] = "";
    setCustomFields(next);
    setProfileImageUri(null);
  }, [visible, fieldDefs]);

  async function handlePickProfilePhoto() {
    if (!(await ensurePhotoLibraryPermission())) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setProfileImageUri(result.assets[0].uri);
  }

  async function handleSave() {
    if (!firstName.trim() || !lastName.trim()) {
      Alert.alert("Member", "First name and last name are required.");
      return;
    }
    if (!phoneNational.trim()) {
      Alert.alert("Member", "Phone number is required.");
      return;
    }
    try {
      normalizePhoneToE164Required(phoneNational, phoneCountryIso, defaultCountry);
    } catch (e: unknown) {
      Alert.alert("Phone", e instanceof Error ? e.message : "Invalid phone number");
      return;
    }
    if (emergencyNational.trim()) {
      try {
        normalizePhoneToE164(emergencyNational, emergencyCountryIso, defaultCountry);
      } catch (e: unknown) {
        Alert.alert("Emergency phone", e instanceof Error ? e.message : "Invalid phone number");
        return;
      }
    }

    setSaving(true);
    try {
      let profileImageUrl: string | null = null;
      if (profileImageUri && isOnline) {
        profileImageUrl = await uploadMemberImageFromUri(profileImageUri);
      }

      const body: Record<string, unknown> = {
        first_name: displayMemberWords(firstName.trim()),
        last_name: displayMemberWords(lastName.trim()),
        email: email.trim() || null,
        phone: phoneNational.trim(),
        phone_country_iso: phoneCountryIso,
        address: displayMemberWords(address.trim()),
        emergency_contact_name: emergencyName.trim() ? displayMemberWords(emergencyName.trim()) : "",
        emergency_contact_phone: emergencyNational.trim(),
        emergency_contact_phone_country_iso: emergencyNational.trim() ? emergencyCountryIso : null,
        dob: dob.trim() || null,
        gender: gender.trim() ? displayMemberWords(gender.trim()) : null,
        marital_status: marital.trim() ? displayMemberWords(marital.trim()) : null,
        occupation: occupation.trim() ? displayMemberWords(occupation.trim()) : null,
        date_joined: dateJoined.trim() || todayYmd(),
        status: displayMemberWords(status.trim() || "active"),
        ...(profileImageUrl ? { profileImage: profileImageUrl } : {}),
      };
      if (fieldDefs.length > 0) {
        const cf: Record<string, unknown> = {};
        for (const def of fieldDefs) {
          const s = (customFields[def.field_key] ?? "").trim();
          if (!s) {
            cf[def.field_key] = null;
            continue;
          }
          if (def.field_type === "number" || def.field_type === "integer") {
            const n = Number(s);
            cf[def.field_key] = Number.isFinite(n) ? n : s;
          } else if (def.field_type === "boolean") {
            cf[def.field_key] = s.toLowerCase() === "true" || s === "1";
          } else if (def.field_type === "date") {
            cf[def.field_key] = s;
          } else {
            cf[def.field_key] = displayMemberWords(s);
          }
        }
        body.custom_fields = cf;
      }
      if (!isOnline) {
        await queueMemberCreate(body);
        const tempMember = {
          id: `offline-member-${Date.now()}`,
          first_name: displayMemberWords(firstName.trim()),
          last_name: displayMemberWords(lastName.trim()),
          email: email.trim() || null,
          phone: phoneNational.trim(),
          status: displayMemberWords(status.trim() || "active"),
          profile_image: null,
          local_only: true,
        } as Member;
        onCreated(tempMember);
        Alert.alert("Saved offline", "Member was saved offline and will sync when internet is available.");
        onClose();
        return;
      }

      const created = await api.members.create(body);
      onCreated(created);
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not create member";
      Alert.alert("Member", msg);
    } finally {
      setSaving(false);
    }
  }

  const statusLabels =
    memberStatusOptions.length > 0
      ? memberStatusOptions.map((o) => o.label)
      : ["Active", "Inactive"];

  const footer = (
    <View style={styles.footer}>
      <Pressable onPress={onClose} disabled={saving} style={[styles.footerBtn, styles.footerBtnSecondary]}>
        <Text style={styles.footerBtnSecondaryText}>Cancel</Text>
      </Pressable>
      <Pressable
        onPress={() => void handleSave()}
        disabled={saving || !firstName.trim() || !lastName.trim() || !phoneNational.trim()}
        style={[styles.footerBtn, styles.footerBtnPrimary, saving && { opacity: 0.7 }]}
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.footerBtnPrimaryText}>Add member</Text>}
      </Pressable>
    </View>
  );

  return (
    <FormModalShell
      visible={visible}
      onClose={onClose}
      title="Add member"
      subtitle="Create a new member record for this branch."
      headerIcon="person-add-outline"
      footer={footer}
    >
      {/* -------- Profile photo -------- */}
      <Text style={styles.sectionLabel}>{displayMemberWords("Profile photo")}</Text>
      <View style={styles.profileRow}>
        <Pressable
          onPress={() => void handlePickProfilePhoto()}
          style={({ pressed }) => [styles.profileAvatarWrap, pressed && { opacity: 0.9 }]}
          accessibilityRole="button"
          accessibilityLabel="Choose profile photo"
        >
          {profileImageUri ? (
            <Image source={{ uri: profileImageUri }} style={styles.profileAvatarImg} />
          ) : (
            <MemberInitialAvatar
              initial={firstName.trim()[0] || lastName.trim()[0] || "M"}
              size={88}
              textStyle={styles.profileAvatarPlaceholderText}
            />
          )}
        </Pressable>
        <View style={styles.profileActions}>
          <Pressable onPress={() => void handlePickProfilePhoto()} style={styles.profileLinkBtn}>
            <Text style={styles.profileLinkText}>{profileImageUri ? "Change photo" : "Add photo"}</Text>
          </Pressable>
          {profileImageUri ? (
            <Pressable onPress={() => setProfileImageUri(null)} style={styles.profileLinkBtn}>
              <Text style={styles.profileRemoveText}>Remove</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <Text style={styles.profileHint}>Optional. Square crop recommended.</Text>

      {/* -------- Name -------- */}
      <Text style={styles.sectionLabel}>{displayMemberWords("Name")}</Text>
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>{displayMemberWords("First name")}</Text>
        <TextInput value={firstName} onChangeText={setFirstName} style={styles.input} />
      </View>
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>{displayMemberWords("Last name")}</Text>
        <TextInput value={lastName} onChangeText={setLastName} style={styles.input} />
      </View>

      {/* -------- Contact -------- */}
      <Text style={styles.sectionLabel}>{displayMemberWords("Contact")}</Text>
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>{displayMemberWords("Email")}</Text>
        <TextInput value={email} onChangeText={setEmail} style={styles.input} keyboardType="email-address" autoCapitalize="none" />
      </View>
      <PhoneCountryField
        label={displayMemberWords("Mobile number")}
        countryIso={phoneCountryIso}
        national={phoneNational}
        onCountryChange={setPhoneCountryIso}
        onNationalChange={setPhoneNational}
        defaultCountry={defaultCountry}
        required
        placeholderNational=""
      />
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>{displayMemberWords("Address")}</Text>
        <TextInput value={address} onChangeText={setAddress} style={styles.input} />
      </View>

      {/* -------- Emergency -------- */}
      <Text style={styles.sectionLabel}>{displayMemberWords("Emergency")}</Text>
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>{displayMemberWords("Contact name")}</Text>
        <TextInput value={emergencyName} onChangeText={setEmergencyName} style={styles.input} />
      </View>
      <PhoneCountryField
        label={displayMemberWords("Contact phone")}
        countryIso={emergencyCountryIso}
        national={emergencyNational}
        onCountryChange={setEmergencyCountryIso}
        onNationalChange={setEmergencyNational}
        defaultCountry={defaultCountry}
        placeholderNational=""
        labelVariant="muted"
      />

      {/* -------- Member info -------- */}
      <Text style={styles.sectionLabel}>{displayMemberWords("Member info")}</Text>
      <YmdDateField label="Date of birth" value={dob} onChange={setDob} placeholder="" disallowFutureDates />
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>{displayMemberWords("Gender")}</Text>
        <OptionPills options={GENDER_OPTIONS} value={gender} onSelect={setGender} />
      </View>
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>{displayMemberWords("Marital status")}</Text>
        <OptionPills options={MARITAL_OPTIONS} value={marital} onSelect={setMarital} />
      </View>
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>{displayMemberWords("Occupation")}</Text>
        <TextInput value={occupation} onChangeText={setOccupation} style={styles.input} />
      </View>
      <YmdDateField label="Date joined" value={dateJoined} onChange={setDateJoined} placeholder="" />

      {/* -------- Status -------- */}
      <Text style={styles.sectionLabel}>{displayMemberWords("Membership status")}</Text>
      <OptionPills options={statusLabels} value={status} onSelect={setStatus} />

      {/* -------- Custom fields -------- */}
      {fieldDefs.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>{displayMemberWords("Additional fields")}</Text>
          {fieldDefs.map((def) =>
            def.field_type === "date" ? (
              <YmdDateField
                key={def.id}
                label={String(def.label || "")}
                value={customFields[def.field_key] ?? ""}
                onChange={(ymd) => setCustomFields((prev) => ({ ...prev, [def.field_key]: ymd }))}
                placeholder=""
              />
            ) : (
              <View key={def.id} style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>{displayMemberWords(String(def.label || ""))}</Text>
                <TextInput
                  value={customFields[def.field_key] ?? ""}
                  onChangeText={(text) => setCustomFields((prev) => ({ ...prev, [def.field_key]: text }))}
                  style={styles.input}
                />
              </View>
            )
          )}
        </>
      ) : null}
    </FormModalShell>
  );
}

const styles = StyleSheet.create({
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 4,
  },
  profileAvatarWrap: {
    borderRadius: radius.pill,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  profileAvatarImg: {
    width: 88,
    height: 88,
    borderRadius: 44,
  },
  profileAvatarPlaceholder: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },
  profileAvatarPlaceholderText: {
    fontSize: 32,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  profileActions: { flex: 1, gap: 6 },
  profileLinkBtn: { alignSelf: "flex-start", paddingVertical: 4 },
  profileLinkText: {
    fontSize: type.body.size,
    fontWeight: "600",
    color: colors.accent,
  },
  profileRemoveText: {
    fontSize: type.caption.size,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  profileHint: {
    fontSize: type.caption.size,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: type.overline.size,
    fontWeight: "700",
    color: colors.accent,
    marginTop: 14,
    marginBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  fieldBlock: { marginBottom: 10 },
  fieldLabel: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.caption.weight,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textPrimary,
    backgroundColor: "#f8fafc",
  },
  pillRow: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: "#f8fafc",
  },
  pillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  pillText: {
    fontSize: type.caption.size,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  pillTextActive: { color: "#fff" },
  footer: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
  footerBtn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: radius.sm, minWidth: 100, alignItems: "center" },
  footerBtnSecondary: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.card },
  footerBtnSecondaryText: { fontSize: type.body.size, fontWeight: "600", color: colors.textPrimary },
  footerBtnPrimary: { backgroundColor: colors.accent },
  footerBtnPrimaryText: { fontSize: type.body.size, fontWeight: "600", color: "#fff" },
});
