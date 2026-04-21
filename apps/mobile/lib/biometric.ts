import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";

export type BiometricAvailability = {
  available: boolean;
  hasHardware: boolean;
  enrolled: boolean;
  supportsFace: boolean;
  supportsFingerprint: boolean;
  reason: string | null;
};

function reasonText(error: string | undefined): string {
  const e = String(error || "").toLowerCase();
  if (e.includes("not_enrolled")) return "No biometrics are enrolled on this device.";
  if (e.includes("not_available")) return "Biometric authentication is not available on this device.";
  if (e.includes("lockout")) return "Biometric authentication is temporarily locked. Use passcode and try again.";
  if (e.includes("passcode")) return "Set a device passcode first, then enable biometric unlock.";
  if (e.includes("user_cancel") || e.includes("system_cancel")) return "Authentication cancelled.";
  return "Biometric authentication failed. Please try again.";
}

export async function getBiometricAvailability(): Promise<BiometricAvailability> {
  const [hasHardware, enrolled, supportedTypes, securityLevel] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
    LocalAuthentication.getEnrolledLevelAsync(),
  ]);

  const supportsFace = supportedTypes.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
  const supportsFingerprint = supportedTypes.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
  const isStrongEnough =
    Platform.OS === "android"
      ? securityLevel === LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG
      : securityLevel === LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG ||
        securityLevel === LocalAuthentication.SecurityLevel.BIOMETRIC_WEAK;

  if (!hasHardware) {
    return {
      available: false,
      hasHardware,
      enrolled,
      supportsFace,
      supportsFingerprint,
      reason: "This device does not support biometric authentication.",
    };
  }
  if (!enrolled) {
    return {
      available: false,
      hasHardware,
      enrolled,
      supportsFace,
      supportsFingerprint,
      reason: "No biometrics are enrolled. Add Face ID or fingerprint in device settings.",
    };
  }
  if (!isStrongEnough) {
    return {
      available: false,
      hasHardware,
      enrolled,
      supportsFace,
      supportsFingerprint,
      reason: "Biometric security level is not supported for unlock.",
    };
  }

  return {
    available: true,
    hasHardware,
    enrolled,
    supportsFace,
    supportsFingerprint,
    reason: null,
  };
}

export async function authenticateWithBiometrics(promptMessage: string): Promise<{
  success: boolean;
  errorMessage: string | null;
}> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: "Cancel",
      fallbackLabel: "Use passcode",
      disableDeviceFallback: false,
      biometricsSecurityLevel: "strong",
      requireConfirmation: true,
    });
    if (result.success) return { success: true, errorMessage: null };
    return { success: false, errorMessage: reasonText(result.error) };
  } catch (error: unknown) {
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : "Biometric authentication failed.",
    };
  }
}
