import { Alert, Linking } from "react-native";
import * as ImagePicker from "expo-image-picker";

/** Use in Alert dialogs when access was denied (iOS/Android system prompt text is set in app.json). */
export const PHOTO_ACCESS_ALERT_TITLE = "SheepMug CMS";

export const PHOTO_ACCESS_ALERT_BODY =
  "SheepMug CMS needs access to your photo library to choose or update images. You can enable this in Settings.";

/**
 * Ensures media library access for image picking. The system dialog copy is configured via
 * `expo-image-picker` in app.json (`photosPermission` / iOS Info.plist).
 */
export async function ensurePhotoLibraryPermission(): Promise<boolean> {
  const existing = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (existing.granted) return true;

  const requested = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (requested.granted) return true;

  Alert.alert(PHOTO_ACCESS_ALERT_TITLE, PHOTO_ACCESS_ALERT_BODY, [
    { text: "Cancel", style: "cancel" },
    { text: "Open Settings", onPress: () => void Linking.openSettings() },
  ]);
  return false;
}
