import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Calendar } from "lucide-react-native";
import { useTheme } from "../../contexts/ThemeContext";
import { formatCompactWeekdayDate, formatLongWeekdayDate } from "../../lib/memberDisplayFormat";
import { parseYmdToLocalDate, toYmd } from "../../lib/dateTimeFormat";
import { radius, type } from "../../theme";
import { MobilePickerSheet } from "./MobilePickerSheet";
import { CalendarPickerBody } from "./CalendarPickerBody";

export type DatePickerFieldProps = {
  value: string;
  onChange: (ymd: string) => void;
  placeholder?: string;
  minimumDate?: Date;
  maximumDate?: Date;
  disabled?: boolean;
  /** Split row: no horizontal margin, caller supplies outer border */
  variant?: "default" | "splitSegment";
  containerStyle?: StyleProp<ViewStyle>;
};

/** When `maximumDate` is omitted, allow far-future dates (e.g. task due dates). */
function defaultOpenMaxDate(): Date {
  const t = new Date(2100, 11, 31);
  t.setHours(23, 59, 59, 999);
  return t;
}

export function DatePickerField({
  value,
  onChange,
  placeholder = "Select date",
  minimumDate,
  maximumDate,
  disabled,
  variant = "default",
  containerStyle,
}: DatePickerFieldProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(() => parseYmdToLocalDate(value) || new Date());

  const min = useMemo(() => minimumDate ?? new Date(1900, 0, 1), [minimumDate]);
  const max = useMemo(() => maximumDate ?? defaultOpenMaxDate(), [maximumDate]);

  const dateVal = useMemo(() => {
    const p = parseYmdToLocalDate(value);
    if (p) return p;
    const n = new Date();
    n.setHours(12, 0, 0, 0);
    return n;
  }, [value]);

  useEffect(() => {
    if (open) {
      setDraft(parseYmdToLocalDate(value) || dateVal);
    }
  }, [open, value, dateVal]);

  const displayText = value.trim()
    ? (variant === "splitSegment" ? formatCompactWeekdayDate(value.trim()) : formatLongWeekdayDate(value.trim())) ||
      value.trim()
    : "";

  const pickerColors = useMemo(
    () => ({
      textPrimary: colors.textPrimary,
      textSecondary: colors.textSecondary,
      border: colors.border,
      card: colors.card,
      accent: colors.accent,
      bg: colors.bg,
    }),
    [colors],
  );

  const renderBody = useCallback(
    () => (
      <CalendarPickerBody
        initialMonth={draft}
        selected={draft}
        onSelectDay={setDraft}
        minDate={min}
        maxDate={max}
        colors={pickerColors}
      />
    ),
    [draft, min, max, pickerColors],
  );

  function openPicker() {
    if (disabled) return;
    setOpen(true);
  }

  const triggerStyles = [
    styles.trigger,
    variant === "default" ? styles.triggerDefault : styles.triggerSplit,
    {
      borderColor: colors.border,
      backgroundColor: colors.bg,
    },
    disabled && { opacity: 0.5 },
    containerStyle,
  ];

  return (
    <View>
      <Pressable onPress={openPicker} disabled={disabled} style={({ pressed }) => [triggerStyles, pressed && !disabled && { opacity: 0.92 }]}>
        <Calendar size={18} color={colors.textSecondary} strokeWidth={2} />
        <Text
          style={[styles.triggerText, { color: displayText ? colors.textPrimary : colors.textSecondary }]}
          numberOfLines={1}
        >
          {displayText || placeholder}
        </Text>
      </Pressable>

      <MobilePickerSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        onConfirm={() => {
          onChange(toYmd(draft));
          setOpen(false);
        }}
        renderBody={renderBody}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
  },
  triggerDefault: {
    alignSelf: "stretch",
  },
  triggerSplit: {
    borderWidth: 0,
    borderRadius: 0,
    flex: 1,
    minWidth: 0,
  },
  triggerText: {
    flex: 1,
    minWidth: 0,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    fontWeight: type.body.weight,
  },
});
