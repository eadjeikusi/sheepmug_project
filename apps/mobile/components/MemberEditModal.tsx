import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { CustomFieldDefinition, Member, MemberStatusOption } from "@sheepmug/shared-api";
import { api } from "../lib/api";
import { getDeviceDefaultCountryIso } from "../lib/deviceDefaultCountry";
import { displayMemberWords } from "../lib/memberDisplayFormat";
import { e164ToCountryAndNational, normalizePhoneToE164, normalizePhoneToE164Required } from "../lib/phoneE164";
import { colors, radius, type } from "../theme";
import { FormModalShell } from "./FormModalShell";
import { PhoneCountryField } from "./PhoneCountryField";
import { YmdDateField } from "./YmdDateField";

type Props = {
  visible: boolean;
  onClose: () => void;
  memberId: string;
  member: Member | null;
  memberStatusOptions: MemberStatusOption[];
  fieldDefs: CustomFieldDefinition[];
  onSaved: (m: Member) => void;
};

const GENDER_OPTIONS = ["Male", "Female", "Other"];
const MARITAL_OPTIONS = ["Single", "Married", "Divorced", "Widowed"];

function pickStr(m: Member, ...keys: string[]): string {
  const o = m as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function toYmd(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(t);
  return m ? m[1] : t;
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

export function MemberEditModal({
  visible,
  onClose,
  memberId,
  member,
  memberStatusOptions,
  fieldDefs,
  onSaved,
}: Props) {
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
  const [dateJoined, setDateJoined] = useState("");
  const [status, setStatus] = useState("");
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !member) return;
    const dc = getDeviceDefaultCountryIso();
    setFirstName(pickStr(member, "first_name"));
    setLastName(pickStr(member, "last_name"));
    setEmail(pickStr(member, "email"));
    const phoneStr = pickStr(member, "phone", "phone_number", "phoneNumber");
    const parsedPhone = e164ToCountryAndNational(phoneStr, dc);
    const storedPc = pickStr(member, "phone_country_iso", "phoneCountryIso");
    setPhoneCountryIso(storedPc || parsedPhone.countryIso);
    setPhoneNational(parsedPhone.national);
    setAddress(pickStr(member, "address", "location"));
    setEmergencyName(pickStr(member, "emergency_contact_name", "emergencyContactName"));
    const emStr = pickStr(member, "emergency_contact_phone", "emergencyContactPhone");
    const parsedEm = e164ToCountryAndNational(emStr, dc);
    const storedEc = pickStr(member, "emergency_contact_phone_country_iso", "emergencyContactPhoneCountryIso");
    setEmergencyCountryIso(storedEc || parsedEm.countryIso);
    setEmergencyNational(parsedEm.national);
    setDob(toYmd(pickStr(member, "dob", "dateOfBirth")));
    setGender(pickStr(member, "gender"));
    setMarital(pickStr(member, "marital_status", "maritalStatus"));
    setOccupation(pickStr(member, "occupation"));
    setDateJoined(toYmd(pickStr(member, "date_joined", "dateJoined")));
    setStatus(pickStr(member, "status"));
    const raw = member.custom_fields;
    const next: Record<string, string> = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const def of fieldDefs) {
        const v = (raw as Record<string, unknown>)[def.field_key];
        if (v === null || v === undefined) {
          next[def.field_key] = "";
        } else if (def.field_type === "date") {
          next[def.field_key] = toYmd(String(v));
        } else {
          next[def.field_key] = String(v);
        }
      }
    } else {
      for (const def of fieldDefs) next[def.field_key] = "";
    }
    setCustomFields(next);
  }, [visible, member, fieldDefs]);

  async function handleSave() {
    if (!memberId || !member) return;
    if (!firstName.trim() || !lastName.trim()) {
      Alert.alert("Member", "First name and last name are required.");
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
        date_joined: dateJoined.trim() || null,
        status: status.trim() ? displayMemberWords(status.trim()) : null,
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
      const updated = await api.members.update(memberId, body);
      onSaved(updated);
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not save member";
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
        disabled={saving || !firstName.trim() || !lastName.trim()}
        style={[styles.footerBtn, styles.footerBtnPrimary, saving && { opacity: 0.7 }]}
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.footerBtnPrimaryText}>Save</Text>}
      </Pressable>
    </View>
  );

  return (
    <FormModalShell
      visible={visible}
      onClose={onClose}
      title="Edit member"
      subtitle="Update profile details for this branch."
      headerIcon="person-outline"
      footer={footer}
    >
      {/* -------- Name -------- */}
      <Text style={styles.sectionLabel}>{displayMemberWords("Name")}</Text>
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>{displayMemberWords("First name")}</Text>
        <TextInput value={firstName} onChangeText={setFirstName} placeholder="First name" placeholderTextColor={colors.textSecondary} style={styles.input} />
      </View>
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>{displayMemberWords("Last name")}</Text>
        <TextInput value={lastName} onChangeText={setLastName} placeholder="Last name" placeholderTextColor={colors.textSecondary} style={styles.input} />
      </View>

      {/* -------- Contact -------- */}
      <Text style={styles.sectionLabel}>{displayMemberWords("Contact")}</Text>
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>{displayMemberWords("Email")}</Text>
        <TextInput value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={colors.textSecondary} style={styles.input} keyboardType="email-address" autoCapitalize="none" />
      </View>
      <PhoneCountryField
        label={displayMemberWords("Mobile number")}
        countryIso={phoneCountryIso}
        national={phoneNational}
        onCountryChange={setPhoneCountryIso}
        onNationalChange={setPhoneNational}
        defaultCountry={defaultCountry}
        required
        helperText="We'll send you a text verification code."
      />
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>{displayMemberWords("Address")}</Text>
        <TextInput value={address} onChangeText={setAddress} placeholder="Address / location" placeholderTextColor={colors.textSecondary} style={styles.input} />
      </View>

      {/* -------- Emergency -------- */}
      <Text style={styles.sectionLabel}>{displayMemberWords("Emergency")}</Text>
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>{displayMemberWords("Contact name")}</Text>
        <TextInput value={emergencyName} onChangeText={setEmergencyName} placeholder="Emergency contact name" placeholderTextColor={colors.textSecondary} style={styles.input} />
      </View>
      <PhoneCountryField
        label={displayMemberWords("Contact phone")}
        countryIso={emergencyCountryIso}
        national={emergencyNational}
        onCountryChange={setEmergencyCountryIso}
        onNationalChange={setEmergencyNational}
        defaultCountry={defaultCountry}
        placeholderNational="Optional"
        labelVariant="muted"
      />

      {/* -------- Member info -------- */}
      <Text style={styles.sectionLabel}>{displayMemberWords("Member info")}</Text>
      <YmdDateField label="Date of birth" value={dob} onChange={setDob} placeholder="Optional" disallowFutureDates />
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
        <TextInput value={occupation} onChangeText={setOccupation} placeholder="Occupation" placeholderTextColor={colors.textSecondary} style={styles.input} />
      </View>
      <YmdDateField label="Date joined" value={dateJoined} onChange={setDateJoined} placeholder="Select date" />

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
                placeholder="Select date"
              />
            ) : (
              <View key={def.id} style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>{displayMemberWords(String(def.label || ""))}</Text>
                <TextInput
                  value={customFields[def.field_key] ?? ""}
                  onChangeText={(text) => setCustomFields((prev) => ({ ...prev, [def.field_key]: text }))}
                  placeholder={def.field_type}
                  placeholderTextColor={colors.textSecondary}
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
