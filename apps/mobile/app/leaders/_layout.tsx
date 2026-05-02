import { Stack } from "expo-router";
import { useTheme } from "../../contexts/ThemeContext";
import { type } from "../../theme";

export default function LeadersStackLayout() {
  const { colors: themeColors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: themeColors.bg },
        headerTintColor: themeColors.textPrimary,
        headerTitleStyle: {
          fontWeight: type.subtitle.weight,
          fontSize: type.subtitle.size,
          color: themeColors.textPrimary,
        },
        contentStyle: { backgroundColor: themeColors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Leaders" }} />
      <Stack.Screen name="[profileId]" options={{ title: "Leader profile" }} />
    </Stack>
  );
}
