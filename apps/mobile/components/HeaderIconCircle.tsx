import type { ReactNode } from "react";
import type { PressableProps, StyleProp, ViewProps, ViewStyle } from "react-native";
import { Pressable, View } from "react-native";
import { useTheme } from "../contexts/ThemeContext";
import { radius, sizes } from "../theme";

export function headerIconCircleBaseStyle(backgroundColor: string): ViewStyle {
  return {
    width: sizes.headerIconButton,
    height: sizes.headerIconButton,
    borderRadius: radius.pill,
    backgroundColor,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  };
}

type CircleButtonProps = Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle>;
  /** Search / filter “on” state — accent border and surface. */
  active?: boolean;
};

export function HeaderIconCircleButton({ style, active, disabled, ...rest }: CircleButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      disabled={disabled}
      style={({ pressed }) => [
        headerIconCircleBaseStyle(colors.headerIconCircleBg),
        active && {
          borderWidth: 1,
          borderColor: colors.accent,
          backgroundColor: colors.accentSurface,
        },
        disabled && { opacity: 0.55 },
        pressed && !disabled && { opacity: 0.85 },
        style,
      ]}
      {...rest}
    />
  );
}

type CircleViewProps = ViewProps & {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

export function HeaderIconCircle({ style, ...rest }: CircleViewProps) {
  const { colors } = useTheme();
  return <View style={[headerIconCircleBaseStyle(colors.headerIconCircleBg), style]} {...rest} />;
}
