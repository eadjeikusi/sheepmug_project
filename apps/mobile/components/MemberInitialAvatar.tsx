import { useMemo } from "react";
import { StyleSheet, Text, type TextStyle, View, type ViewStyle } from "react-native";

const AVATAR_COLORS = [
  "#FECACA",
  "#FDE68A",
  "#BFDBFE",
  "#C7D2FE",
  "#A7F3D0",
  "#FBCFE8",
  "#DDD6FE",
  "#BAE6FD",
];

type Props = {
  initial?: string;
  size: number;
  style?: ViewStyle;
  textStyle?: TextStyle;
};

export function MemberInitialAvatar({ initial, size, style, textStyle }: Props) {
  const backgroundColor = useMemo(
    () => AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    []
  );
  const label = (initial || "M").trim().charAt(0).toUpperCase() || "M";

  return (
    <View
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor,
        },
        style,
      ]}
    >
      <Text style={[styles.text, { fontSize: Math.max(12, Math.round(size * 0.42)) }, textStyle]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    color: "#111827",
    fontWeight: "700",
  },
});
