import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { darkColors, lightColors, type ThemeColors } from "../theme";
import {
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from "../lib/storage";

type ThemeState = {
  preference: ThemePreference;
  resolvedScheme: "light" | "dark";
  colors: ThemeColors;
  setPreference: (next: ThemePreference) => Promise<void>;
};

const ThemeContext = createContext<ThemeState | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    let mounted = true;
    (async () => {
      const saved = await getThemePreference();
      if (mounted) setPreferenceState(saved);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const resolvedScheme: "light" | "dark" =
    preference === "system" ? (systemScheme === "dark" ? "dark" : "light") : preference;
  const colors = resolvedScheme === "dark" ? darkColors : lightColors;

  async function setPreference(next: ThemePreference) {
    await setThemePreference(next);
    setPreferenceState(next);
  }

  const value = useMemo<ThemeState>(
    () => ({
      preference,
      resolvedScheme,
      colors,
      setPreference,
    }),
    [preference, resolvedScheme, colors]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
