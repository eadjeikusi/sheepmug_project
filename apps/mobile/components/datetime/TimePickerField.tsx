import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Clock } from "lucide-react-native";
import { useTheme } from "../../contexts/ThemeContext";
import { formatTime12h } from "../../lib/dateTimeFormat";
import { radius, type } from "../../theme";
import { MobilePickerSheet } from "./MobilePickerSheet";
import { TimePickerColumns } from "./TimePickerColumns";

export type TimePickerFieldProps = {
  value: string;
  onChange: (hhmm: string) => void;
  placeholder?: string;
  disabled?: boolean;
  variant?: "default" | "splitSegment";
  containerStyle?: StyleProp<ViewStyle>;
};

export function TimePickerField({
  value,
  onChange,
  placeholder = "Time",
  disabled,
  variant = "default",
  containerStyle,
}: TimePickerFieldProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const display = value.trim() ? formatTime12h(value.trim()) : "";

  const pickerColors = {
    textPrimary: colors.textPrimary,
    textSecondary: colors.textSecondary,
    border: colors.border,
    accent: colors.accent,
  };

  const renderBody = useCallback(
    () => (
      <TimePickerColumns
        valueHHmm={draft || "00:00"}
        onChange={(hhmm) => {
          setDraft(hhmm);
          onChange(hhmm);
        }}
        colors={pickerColors}
      />
    ),
    [draft, onChange, pickerColors],
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
        <Clock size={18} color={colors.textSecondary} strokeWidth={2} />
        <Text
          style={[styles.triggerText, { color: display ? colors.textPrimary : colors.textSecondary }]}
          numberOfLines={1}
        >
          {display || placeholder}
        </Text>
      </Pressable>

      <MobilePickerSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        onConfirm={() => setOpen(false)}
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
