import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { hhmmToParts, partsToHHmm } from "../../lib/timeParts";
import { radius, type } from "../../theme";

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

type Colors = { textPrimary: string; textSecondary: string; border: string; accent: string };

type Props = {
  valueHHmm: string;
  onChange: (hhmm: string) => void;
  colors: Colors;
};

export function TimePickerColumns({ valueHHmm, onChange, colors }: Props) {
  const { hour12, minute, isPm } = useMemo(() => hhmmToParts(valueHHmm || "00:00"), [valueHHmm]);

  const setParts = (next: Partial<{ hour12: number; minute: number; isPm: boolean }>) => {
    const h = next.hour12 ?? hour12;
    const mi = next.minute ?? minute;
    const ap = next.isPm ?? isPm;
    onChange(partsToHHmm(h, mi, ap));
  };

  return (
    <View style={styles.row}>
      <View style={[styles.col, { borderColor: colors.border }]}>
        <Text style={[styles.colTitle, { color: colors.textSecondary }]}>Hour</Text>
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          {HOURS.map((h) => (
            <Pressable
              key={h}
              onPress={() => setParts({ hour12: h })}
              style={[styles.item, hour12 === h && { backgroundColor: colors.accent + "44" }]}
            >
              <Text style={[styles.itemText, { color: colors.textPrimary }]}>{h}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <View style={[styles.col, { borderColor: colors.border }]}>
        <Text style={[styles.colTitle, { color: colors.textSecondary }]}>Min</Text>
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          {MINUTES.map((m) => (
            <Pressable
              key={m}
              onPress={() => setParts({ minute: m })}
              style={[styles.item, minute === m && { backgroundColor: colors.accent + "44" }]}
            >
              <Text style={[styles.itemText, { color: colors.textPrimary }]}>{String(m).padStart(2, "0")}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <View style={[styles.colNarrow, { borderColor: colors.border }]}>
        <Text style={[styles.colTitle, { color: colors.textSecondary }]}></Text>
        <View style={styles.apWrap}>
          {(["am", "pm"] as const).map((ap) => {
            const active = (ap === "pm") === isPm;
            return (
              <Pressable
                key={ap}
                onPress={() => setParts({ isPm: ap === "pm" })}
                style={[
                  styles.apBtn,
                  { borderColor: colors.border },
                  active && { backgroundColor: colors.accent + "44" },
                ]}
              >
                <Text style={[styles.apText, { color: colors.textPrimary }]}>{ap.toUpperCase()}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, paddingHorizontal: 8, paddingBottom: 8 },
  col: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    maxHeight: 200,
  },
  colNarrow: {
    width: 72,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    maxHeight: 200,
  },
  colTitle: { textAlign: "center", fontSize: 11, paddingVertical: 4 },
  scroll: { maxHeight: 168 },
  item: { paddingVertical: 8, alignItems: "center" },
  itemText: { fontSize: type.body.size },
  apWrap: { padding: 8, gap: 8, flex: 1, justifyContent: "center" },
  apBtn: {
    paddingVertical: 12,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  apText: { fontWeight: "700", fontSize: 15 },
});
