import { useEffect, useMemo, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { useAuth } from "../contexts/AuthContext";
import { SHEEPMUG_LOGO } from "../lib/branding";
import { supabaseRealtime } from "../lib/supabaseClient";
import { colors, type } from "../theme";

/** Standard login accent (reference-style blue); distinct from app tab accent. */
const AUTH_BLUE = colors.accent;
const AUTH_BLUE_MUTED = "#93c5fd";

type AuthStage = "login" | "request" | "verify" | "reset";

function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();

  const [stage, setStage] = useState<AuthStage>("login");
  const [busy, setBusy] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [canResendAt, setCanResendAt] = useState<number | null>(null);
  const [resendSecondsLeft, setResendSecondsLeft] = useState(0);

  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [codeFocused, setCodeFocused] = useState(false);
  const [newPasswordFocused, setNewPasswordFocused] = useState(false);
  const [confirmFocused, setConfirmFocused] = useState(false);

  useEffect(() => {
    if (!canResendAt) {
      setResendSecondsLeft(0);
      return;
    }
    const tick = () => {
      const diff = Math.max(0, Math.ceil((canResendAt - Date.now()) / 1000));
      setResendSecondsLeft(diff);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [canResendAt]);

  const canSignIn = useMemo(
    () => email.trim().length > 0 && password.length > 0 && !busy,
    [email, password, busy]
  );

  const canRequestCode = useMemo(() => email.trim().length > 0 && !busy, [email, busy]);
  const canVerifyCode = useMemo(() => code.replace(/\D/g, "").length === 6 && !verifyingCode, [code, verifyingCode]);
  const canReset = useMemo(
    () =>
      newPassword.length >= 8 &&
      confirmPassword.length >= 8 &&
      newPassword === confirmPassword &&
      !busy,
    [newPassword, confirmPassword, busy]
  );

  async function handleSignIn() {
    if (!canSignIn) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await login(email, password);
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  async function requestCode() {
    if (!canRequestCode) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      try {
        await supabaseRealtime.auth.signOut();
      } catch {
        // no-op
      }
      const sentAt = Date.now();
      const { error: sendErr } = await supabaseRealtime.auth.resetPasswordForEmail(email.trim());
      if (sendErr) throw new Error(sendErr.message || "Unable to send code.");
      setStage("verify");
      setCode("");
      setCanResendAt(sentAt + 120_000);
      setMessage("Code sent. It may take about 1 minute to arrive.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to send code.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (!canVerifyCode) return;
    const normalizedCode = code.replace(/\D/g, "");
    if (normalizedCode.length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setVerifyingCode(true);
    setError(null);
    setMessage(null);
    try {
      const { error: verifyErr } = await supabaseRealtime.auth.verifyOtp({
        email: email.trim(),
        token: normalizedCode,
        type: "recovery",
      });
      if (verifyErr) throw new Error(verifyErr.message || "Invalid or expired code.");
      setStage("reset");
      setMessage("Code verified. Set your new password.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to verify code.");
    } finally {
      setVerifyingCode(false);
    }
  }

  async function resetPassword() {
    if (!canReset) return;
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { error: updateErr } = await supabaseRealtime.auth.updateUser({ password: newPassword });
      if (updateErr) throw new Error(updateErr.message || "Unable to reset password.");
      try {
        await supabaseRealtime.auth.signOut();
      } catch {
        // no-op
      }
      setMessage("Password updated. Sign in with your new password.");
      setStage("login");
      setPassword("");
      setShowPassword(false);
      setCode("");
      setNewPassword("");
      setConfirmPassword("");
      setShowNewPassword(false);
      setShowConfirmPassword(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to reset password.");
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    if (!email.trim()) {
      setError("Enter your email first.");
      return;
    }
    if (resendSecondsLeft > 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const sentAt = Date.now();
      const { error: sendErr } = await supabaseRealtime.auth.resetPasswordForEmail(email.trim());
      if (sendErr) throw new Error(sendErr.message || "Unable to resend code.");
      setCanResendAt(sentAt + 120_000);
      setCode("");
      setMessage("A new code has been sent. It may take about 1 minute to arrive.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to resend code.");
    } finally {
      setBusy(false);
    }
  }

  function backToLogin() {
    setStage("login");
    setError(null);
    setMessage(null);
    setBusy(false);
    setVerifyingCode(false);
    setCode("");
    setNewPassword("");
    setConfirmPassword("");
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setCanResendAt(null);
    setResendSecondsLeft(0);
  }

  const inputBorder = (focused: boolean) => ({
    borderColor: focused ? AUTH_BLUE_MUTED : "#e5e7eb",
    borderWidth: 1,
  });

  const title =
    stage === "login"
      ? "Sheepmug CMS"
      : stage === "request"
      ? "Forgot Password"
      : stage === "verify"
      ? "Verify Code"
      : "Set New Password";

  const subtitle =
    stage === "login"
      ? "Discipleship made easy"
      : stage === "request"
        ? "Enter your email and we will send a verification code."
        : stage === "verify"
          ? "Do you have code already? Enter it below to verify first."
          : "Create a new password for your account.";

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView behavior={Platform.select({ ios: "padding", android: undefined })} style={styles.keyboardWrap}>
        <View style={styles.backgroundTop} />
        <View style={styles.backgroundBottom} />
        <View style={styles.patternOverlay} pointerEvents="none">
          <View style={[styles.patternLine, { top: 32, left: 0, right: 0 }]} />
          <View style={[styles.patternLine, { top: 92, left: 0, right: 0 }]} />
          <View style={[styles.patternLine, { top: 152, left: 0, right: 0 }]} />
          <View style={[styles.patternDot, { top: 44, left: "16%" }]} />
          <View style={[styles.patternDot, { top: 74, left: "64%" }]} />
          <View style={[styles.patternDot, { top: 126, left: "38%" }]} />
          <View style={[styles.patternDot, { top: 168, left: "78%" }]} />
        </View>

        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.headerBlock}>
            <View style={styles.logoCropWrap}>
              <Image source={SHEEPMUG_LOGO} style={styles.logo} resizeMode="cover" accessibilityLabel="Sheepmug logo" />
            </View>
            <Text style={styles.screenTitle}>{title}</Text>
            <Text style={styles.helperText}>{subtitle}</Text>
          </View>

          <View style={styles.card}>
            {stage === "login" ? (
              <>
                <View style={[styles.inputWrap, inputBorder(emailFocused)]}>
                  <TextInput
                    autoCapitalize="none"
                    keyboardType="email-address"
                    value={email}
                    onChangeText={setEmail}
                    onFocus={() => setEmailFocused(true)}
                    onBlur={() => setEmailFocused(false)}
                    placeholder="Loisbecket@gmail.com"
                    placeholderTextColor="#9ca3af"
                    style={styles.input}
                  />
                </View>

                <View style={[styles.inputWrap, inputBorder(passwordFocused)]}>
                  <TextInput
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={setPassword}
                    onFocus={() => setPasswordFocused(true)}
                    onBlur={() => setPasswordFocused(false)}
                    placeholder="*******"
                    placeholderTextColor="#9ca3af"
                    style={styles.input}
                  />
                  <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10}>
                    <Ionicons name={showPassword ? "eye-outline" : "eye-off-outline"} size={19} color="#6b7280" />
                  </Pressable>
                </View>

                <View style={styles.optionRow}>
                  <Pressable style={styles.rememberWrap} onPress={() => setRememberMe((v) => !v)}>
                    <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                      {rememberMe ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
                    </View>
                    <Text style={styles.rememberText}>Remember me</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setStage("request");
                      setError(null);
                      setMessage(null);
                      setPassword("");
                      setShowPassword(false);
                    }}
                  >
                    <Text style={styles.forgotLink}>Forgot Password ?</Text>
                  </Pressable>
                </View>

                {!!error && <Text style={styles.error}>{error}</Text>}
                {!!message && <Text style={styles.success}>{message}</Text>}

                <Pressable
                  style={[styles.primaryBtn, !canSignIn && styles.primaryBtnDisabled]}
                  onPress={() => void handleSignIn()}
                  disabled={!canSignIn}
                >
                  <Text style={styles.primaryBtnText}>{busy ? "Please wait..." : "Log In"}</Text>
                </Pressable>

                <View style={styles.footerRow}>
                  <Text style={styles.footerText}>Don't have an account? </Text>
                  <Pressable onPress={() => setError("Sign up is currently available on web only.")}>
                    <Text style={styles.footerLink}>Sign Up</Text>
                  </Pressable>
                </View>
              </>
            ) : stage === "request" ? (
              <>
                <View style={[styles.fieldBlock, inputBorder(emailFocused)]}>
                  <Text style={styles.fieldLabel}>Email Address</Text>
                  <TextInput
                    autoCapitalize="none"
                    keyboardType="email-address"
                    value={email}
                    editable={stage !== "reset"}
                    onChangeText={setEmail}
                    onFocus={() => setEmailFocused(true)}
                    onBlur={() => setEmailFocused(false)}
                    placeholder="name@example.com"
                    placeholderTextColor="#9ca3af"
                    style={styles.fieldInput}
                  />
                </View>

                {!!error && <Text style={styles.error}>{error}</Text>}
                {!!message && <Text style={styles.success}>{message}</Text>}

                <Pressable
                  style={[styles.primaryBtn, !canRequestCode && styles.primaryBtnDisabled]}
                  onPress={() => void requestCode()}
                  disabled={!canRequestCode}
                >
                  <Text style={styles.primaryBtnText}>{busy ? "Sending..." : "Send Code"}</Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    setStage("verify");
                    setError(null);
                    setMessage(null);
                  }}
                  hitSlop={12}
                >
                  <Text style={styles.inlineLink}>Do you have code already?</Text>
                </Pressable>

                <Pressable onPress={backToLogin} hitSlop={12}>
                  <Text style={styles.inlineLink}>Back to login</Text>
                </Pressable>
              </>
            ) : stage === "verify" ? (
              <>
                <View style={[styles.fieldBlock, inputBorder(codeFocused)]}>
                  <Text style={styles.fieldLabel}>Verification Code</Text>
                  <TextInput
                    value={code}
                    onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
                    onFocus={() => setCodeFocused(true)}
                    onBlur={() => setCodeFocused(false)}
                    placeholder="Enter code here"
                    placeholderTextColor="#9ca3af"
                    keyboardType="number-pad"
                    maxLength={6}
                    textAlign="center"
                    style={styles.fieldInputCode}
                  />
                </View>

                {!!error && <Text style={styles.error}>{error}</Text>}
                {!!message && <Text style={styles.success}>{message}</Text>}

                <Pressable
                  style={[styles.primaryBtn, !canVerifyCode && styles.primaryBtnDisabled]}
                  onPress={() => void verifyCode()}
                  disabled={!canVerifyCode}
                >
                  <Text style={styles.primaryBtnText}>{verifyingCode ? "Verifying Code..." : "Verify Code"}</Text>
                </Pressable>

                <Pressable
                  onPress={() => void resendCode()}
                  disabled={busy || resendSecondsLeft > 0}
                  hitSlop={12}
                >
                  <Text style={[styles.inlineLink, resendSecondsLeft > 0 && styles.inlineLinkDisabled]}>
                    {resendSecondsLeft > 0 ? `Send code again in ${formatCountdown(resendSecondsLeft)}` : "Send code again"}
                  </Text>
                </Pressable>

                <Pressable onPress={backToLogin} hitSlop={12}>
                  <Text style={styles.inlineLink}>Back to login</Text>
                </Pressable>
              </>
            ) : (
              <>
                <View style={[styles.fieldBlock, inputBorder(newPasswordFocused)]}>
                  <Text style={styles.fieldLabel}>New Password</Text>
                  <View style={styles.passwordRow}>
                    <TextInput
                      secureTextEntry={!showNewPassword}
                      value={newPassword}
                      onChangeText={setNewPassword}
                      onFocus={() => setNewPasswordFocused(true)}
                      onBlur={() => setNewPasswordFocused(false)}
                      placeholder="At least 8 characters"
                      placeholderTextColor="#9ca3af"
                      style={styles.fieldInputPlain}
                    />
                    <Pressable onPress={() => setShowNewPassword((v) => !v)} hitSlop={10}>
                      <Ionicons name={showNewPassword ? "eye-outline" : "eye-off-outline"} size={19} color="#6b7280" />
                    </Pressable>
                  </View>
                </View>

                <View style={[styles.fieldBlock, inputBorder(confirmFocused)]}>
                  <Text style={styles.fieldLabel}>Confirm Password</Text>
                  <View style={styles.passwordRow}>
                    <TextInput
                      secureTextEntry={!showConfirmPassword}
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      onFocus={() => setConfirmFocused(true)}
                      onBlur={() => setConfirmFocused(false)}
                      placeholder="Re-enter password"
                      placeholderTextColor="#9ca3af"
                      style={styles.fieldInputPlain}
                    />
                    <Pressable onPress={() => setShowConfirmPassword((v) => !v)} hitSlop={10}>
                      <Ionicons name={showConfirmPassword ? "eye-outline" : "eye-off-outline"} size={19} color="#6b7280" />
                    </Pressable>
                  </View>
                </View>

                {!!error && <Text style={styles.error}>{error}</Text>}
                {!!message && <Text style={styles.success}>{message}</Text>}

                <Pressable
                  style={[styles.primaryBtn, !canReset && styles.primaryBtnDisabled]}
                  onPress={() => void resetPassword()}
                  disabled={!canReset}
                >
                  <Text style={styles.primaryBtnText}>{busy ? "Updating..." : "Update Password"}</Text>
                </Pressable>

                <Pressable onPress={backToLogin} hitSlop={12}>
                  <Text style={styles.inlineLink}>Back to login</Text>
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#f3f4f6" },
  keyboardWrap: { flex: 1 },
  backgroundTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "45%",
    backgroundColor: AUTH_BLUE,
  },
  backgroundBottom: {
    position: "absolute",
    top: "45%",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#f3f4f6",
  },
  patternOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "45%",
  },
  patternLine: {
    position: "absolute",
    height: 1,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  patternDot: {
    position: "absolute",
    width: 4,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.75)",
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    maxWidth: 450,
    alignSelf: "center",
    width: "100%",
  },
  headerBlock: {
    alignItems: "center",
    marginTop: 28,
    marginBottom: 30,
  },
  logoCropWrap: {
    width: 80,
    height: 80,
    overflow: "hidden",
    borderRadius: 20,
    marginBottom: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 108,
    height: 84,
  },
  screenTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "700",
    color: "#fff",
    textAlign: "center",
  },
  helperText: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: "rgba(255,255,255,0.9)",
    textAlign: "center",
    maxWidth: 300,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    paddingHorizontal: 24,
    paddingVertical: 24,
    borderWidth: 1,
    borderColor: "#eef0f3",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
    marginTop: 6,
  },
  inputWrap: {
    minHeight: 50,
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 14,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  input: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    color: "#111827",
    fontWeight: "500",
    paddingVertical: 10,
  },
  optionRow: {
    marginTop: 2,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  rememberWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  checkbox: {
    width: 17,
    height: 17,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    borderColor: AUTH_BLUE,
    backgroundColor: AUTH_BLUE,
  },
  rememberText: {
    color: "#6b7280",
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "500",
  },
  fieldBlock: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 14,
    backgroundColor: "#ffffff",
  },
  fieldLabel: {
    fontSize: 12,
    lineHeight: 16,
    color: "#6b7280",
    fontWeight: "500",
    marginBottom: 6,
  },
  fieldInput: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: "#111827",
    paddingVertical: 0,
    minHeight: 22,
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  fieldInputPlain: {
    flex: 1,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: "#111827",
    paddingVertical: 4,
    minHeight: 28,
  },
  fieldInputCode: {
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: 5,
    color: "#111827",
    paddingVertical: 4,
    minHeight: 30,
  },
  passwordToggle: {
    color: AUTH_BLUE,
    fontSize: type.caption.size,
    fontWeight: "600",
  },
  error: {
    color: "#b91c1c",
    fontSize: type.caption.size,
    marginBottom: 8,
    textAlign: "center",
  },
  success: {
    color: "#047857",
    fontSize: type.caption.size,
    marginBottom: 8,
    textAlign: "center",
  },
  primaryBtn: {
    height: 52,
    borderRadius: 12,
    backgroundColor: AUTH_BLUE,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: {
    color: "#ffffff",
    fontSize: type.bodyStrong.size,
    fontWeight: "700",
  },
  forgotLink: {
    fontSize: 13,
    lineHeight: 16,
    color: AUTH_BLUE,
    fontWeight: "600",
  },
  footerRow: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  footerText: {
    color: "#6b7280",
    fontSize: 13,
    lineHeight: 16,
  },
  footerLink: {
    color: AUTH_BLUE,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "700",
  },
  inlineLink: {
    marginTop: 14,
    textAlign: "center",
    fontSize: type.body.size,
    color: AUTH_BLUE,
    fontWeight: "600",
  },
  inlineLinkDisabled: {
    color: "#94a3b8",
  },
});
