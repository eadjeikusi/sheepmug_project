import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { countryIsoToFlagEmoji, callingCodePlusDisplay } from "../lib/phoneE164";
import { displayMemberWords } from "../lib/memberDisplayFormat";
import { colors, radius, type } from "../theme";
import type { CountryCode } from "libphonenumber-js";

export type CountryOption = { code: string; label: string };

function countryMatchesQuery(o: CountryOption, queryRaw: string): boolean {
  const raw = queryRaw.trim();
  if (!raw) return true;
  const tokens = raw
    .toLowerCase()
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (tokens.length === 0) return true;

  const code = o.code.toLowerCase();
  const label = o.label.toLowerCase();
  let plusLc = "";
  let digits = "";
  try {
    plusLc = callingCodePlusDisplay(o.code as CountryCode).toLowerCase();
    digits = plusLc.replace(/\D/g, "");
  } catch {
    plusLc = "";
  }
  const haystack = `${code} ${label} ${plusLc} ${digits}`;

  return tokens.every((tok) => {
    if (!tok) return true;
    if (haystack.includes(tok)) return true;
    const tokDigits = tok.replace(/\D/g, "");
    if (tokDigits.length > 0 && (digits === tokDigits || digits.startsWith(tokDigits) || plusLc.includes(tok))) {
      return true;
    }
    return false;
  });
}

type Props = {
  visible: boolean;
  title: string;
  options: CountryOption[];
  selectedCode: string;
  onSelect: (code: string) => void;
  onClose: () => void;
};

export function CountryPickerModal({
  visible,
  title,
  options,
  selectedCode,
  onSelect,
  onClose,
}: Props) {
  const [q, setQ] = useState("");
  useEffect(() => {
    if (!visible) setQ("");
  }, [visible]);

  const filtered = useMemo(() => {
    if (!q.trim()) return options;
    return options.filter((o) => countryMatchesQuery(o, q));
  }, [options, q]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search by name, code, or dial code (e.g. Ghana, GH, +233)"
            placeholderTextColor={colors.textSecondary}
            style={styles.search}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.code}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            renderItem={({ item }) => {
              const active = item.code === selectedCode;
              return (
                <Pressable
                  style={[styles.row, active && styles.rowActive]}
                  onPress={() => onSelect(item.code)}
                >
                  <Text style={styles.rowFlag}>{countryIsoToFlagEmoji(item.code)}</Text>
                  <Text style={styles.rowCode}>{item.code}</Text>
                  <Text style={styles.rowCalling}>{callingCodePlusDisplay(item.code as CountryCode)}</Text>
                  <Text style={styles.rowLabel} numberOfLines={2}>
                    {displayMemberWords(item.label)}
                  </Text>
                  {active ? (
                    <Ionicons name="checkmark" size={20} color={colors.accent} />
                  ) : (
                    <View style={{ width: 20 }} />
                  )}
                </Pressable>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    padding: 16,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    zIndex: 1,
    maxHeight: "85%",
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: "hidden",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetTitle: {
    fontSize: type.bodyStrong.size,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  search: {
    marginHorizontal: 12,
    marginVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: type.body.size,
    color: colors.textPrimary,
    backgroundColor: "#f8fafc",
  },
  list: { maxHeight: 400 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowActive: { backgroundColor: "#f1f5f9" },
  rowFlag: { fontSize: 22, marginRight: 8 },
  rowCode: {
    width: 32,
    fontSize: type.caption.size,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  rowCalling: {
    width: 44,
    fontSize: type.caption.size,
    fontWeight: "600",
    color: colors.accent,
  },
  rowLabel: { flex: 1, fontSize: type.body.size, color: colors.textPrimary },
});
