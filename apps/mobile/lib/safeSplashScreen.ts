import * as SplashScreen from "expo-splash-screen";

/**
 * Hides the Expo splash. After fast refresh or in some Expo Go / iOS states,
 * the native splash is not registered and `hideAsync()` rejects. We swallow
 * that so dev reload does not log an uncaught promise error.
 */
export async function safeHideSplashAsync(): Promise<void> {
  try {
    await SplashScreen.hideAsync();
  } catch {
    // expected when no splash view is attached
  }
}

export function initPreventAutoHideSplash(): void {
  void SplashScreen.preventAutoHideAsync().catch(() => {
    // dev reload can run before native splash is ready
  });
}
