import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "../../contexts/ThemeContext";
import { parseFlexibleDateTime, toLocalDateTimeString, toYmd } from "../../lib/dateTimeFormat";
import { radius } from "../../theme";
import { DatePickerField } from "./DatePickerField";
import { TimePickerField } from "./TimePickerField";

export type DateTimePickerFieldProps = {
  value: string;
  onChange: (v: string) => void;
  datePlaceholder?: string;
  timePlaceholder?: string;
  disabled?: boolean;
  /** No scheduling in the past (local calendar day). */
  minimumDate?: Date;
  maximumDate?: Date;
};

export function DateTimePickerField({
  value,
  onChange,
  datePlaceholder = "Date",
  timePlaceholder = "Time",
  disabled,
  minimumDate,
  maximumDate,
}: DateTimePickerFieldProps) {
  const { colors } = useTheme();
  const parsed = useMemo(() => parseFlexibleDateTime(value), [value]);
  const ymd = parsed ? toYmd(parsed.calDate) : "";
  const timeHHmm = parsed?.timeHHmm ?? "";

  return (
    <View
      style={[
        styles.splitOuter,
        {
          borderColor: colors.border,
          backgroundColor: colors.bg,
        },
      ]}
    >
      <DatePickerField
        value={ymd}
        onChange={(nextYmd) => {
          const base = parseYmdToLocalCal(nextYmd);
          if (!base) return;
          const t = timeHHmm || "00:00";
          onChange(toLocalDateTimeString(base, t));
        }}
        placeholder={datePlaceholder}
        disabled={disabled}
        variant="splitSegment"
        minimumDate={minimumDate}
        maximumDate={maximumDate}
      />
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <TimePickerField
        value={timeHHmm}
        onChange={(nextTime) => {
          const base = parsed?.calDate ?? new Date();
          onChange(toLocalDateTimeString(base, nextTime));
        }}
        placeholder={timePlaceholder}
        disabled={disabled}
        variant="splitSegment"
      />
    </View>
  );
}

function parseYmdToLocalCal(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const styles = StyleSheet.create({
  splitOuter: {
    flexDirection: "row",
    alignItems: "stretch",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    minHeight: 36,
    overflow: "hidden",
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
  },
});
