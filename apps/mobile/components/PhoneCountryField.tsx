import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { CountryCode } from "libphonenumber-js";
import { CountryPickerModal } from "./CountryPickerModal";
import {
  callingCodePlusDisplay,
  clampNationalDigitsForCountry,
  countryIsoToFlagEmoji,
  sortedCountryOptions,
} from "../lib/phoneE164";
import { colors, radius, type } from "../theme";

type Props = {
  label: string;
  countryIso: string;
  national: string;
  onCountryChange: (iso: string) => void;
  onNationalChange: (v: string) => void;
  defaultCountry: string;
  placeholderNational?: string;
  required?: boolean;
  /** Shown under the field (e.g. verification copy). */
  helperText?: string;
  /** Use grey label (and neutral dial code) for sub-fields under a section, e.g. emergency phone. */
  labelVariant?: "accent" | "muted";
};

export function PhoneCountryField({
  label,
  countryIso,
  national,
  onCountryChange,
  onNationalChange,
  defaultCountry,
  placeholderNational = "Mobile number",
  required,
  helperText,
  labelVariant = "accent",
}: Props) {
  const [open, setOpen] = useState(false);
  const options = useMemo(() => sortedCountryOptions(), []);
  const resolved = (countryIso || defaultCountry || "US").toUpperCase() as CountryCode;
  const flag = countryIsoToFlagEmoji(resolved);
  const plusCode = callingCodePlusDisplay(resolved);

  function handleNationalInput(text: string) {
    const digits = text.replace(/\D/g, "");
    const clamped = clampNationalDigitsForCountry(digits, resolved);
    onNationalChange(clamped);
  }

  const muted = labelVariant === "muted";

  return (
    <View style={styles.fieldBlock}>
      <Text style={[styles.fieldLabel, muted && styles.fieldLabelMuted]}>
        {label.toUpperCase()}
        {required ? " *" : ""}
      </Text>
      <View style={styles.underlineRow}>
        <Pressable
          style={styles.countryTrigger}
          onPress={() => setOpen(true)}
          accessibilityLabel="Select country"
        >
          <Text style={styles.flagEmoji} accessibilityLabel={`Flag ${resolved}`}>
            {flag}
          </Text>
          <Text style={[styles.callingCode, muted && styles.callingCodeMuted]}>{plusCode}</Text>
          <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
        </Pressable>
        <View style={styles.sep} />
        <TextInput
          value={national}
          onChangeText={handleNationalInput}
          placeholder={placeholderNational}
          placeholderTextColor={colors.textSecondary}
          style={styles.nationalInput}
          keyboardType="phone-pad"
          autoCorrect={false}
        />
      </View>
      {helperText ? <Text style={styles.helper}>{helperText}</Text> : null}
      <CountryPickerModal
        visible={open}
        title="Country"
        options={options}
        selectedCode={resolved}
        onSelect={(code) => {
          onCountryChange(code);
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fieldBlock: { marginBottom: 14 },
  fieldLabel: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: "700",
    color: colors.accent,
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  fieldLabelMuted: {
    color: colors.textSecondary,
    fontWeight: type.caption.weight,
    letterSpacing: type.caption.letterSpacing,
  },
  underlineRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#cbd5e1",
    paddingBottom: 8,
    minHeight: 44,
  },
  countryTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingRight: 4,
    flexShrink: 0,
  },
  flagEmoji: {
    fontSize: 22,
    lineHeight: 26,
  },
  callingCode: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    fontWeight: "600",
    color: colors.accent,
    minWidth: 36,
  },
  callingCodeMuted: {
    color: colors.textPrimary,
  },
  sep: {
    width: StyleSheet.hairlineWidth,
    height: 22,
    backgroundColor: "#cbd5e1",
    marginHorizontal: 8,
  },
  nationalInput: {
    flex: 1,
    minWidth: 0,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  helper: {
    marginTop: 6,
    fontSize: type.caption.size,
    lineHeight: 18,
    color: colors.textPrimary,
    letterSpacing: type.caption.letterSpacing,
  },
});
