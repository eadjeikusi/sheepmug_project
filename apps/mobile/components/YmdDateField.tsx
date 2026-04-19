import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { displayMemberWords } from "../lib/memberDisplayFormat";
import { useTheme } from "../contexts/ThemeContext";
import { type } from "../theme";
import { DatePickerField } from "./datetime/DatePickerField";

type Props = {
  label: string;
  value: string;
  onChange: (ymd: string) => void;
  placeholder?: string;
  /**
   * When true, dates after today are disabled (e.g. date of birth).
   * When false, future dates are allowed (due dates, date joined, etc.).
   */
  disallowFutureDates?: boolean;
};

function defaultOpenMaxDate(): Date {
  const t = new Date(2100, 11, 31);
  t.setHours(23, 59, 59, 999);
  return t;
}

export function YmdDateField({
  label,
  value,
  onChange,
  placeholder = "Select date",
  disallowFutureDates = false,
}: Props) {
  const { colors } = useTheme();
  const max = useMemo(() => {
    if (!disallowFutureDates) return defaultOpenMaxDate();
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate(), 23, 59, 59, 999);
  }, [disallowFutureDates]);

  return (
    <View style={styles.fieldBlock}>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{displayMemberWords(label)}</Text>
      <DatePickerField
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        maximumDate={max}
        minimumDate={new Date(1900, 0, 1)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fieldBlock: { marginBottom: 10 },
  fieldLabel: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.caption.weight,
    marginBottom: 4,
  },
});
