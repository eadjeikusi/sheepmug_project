import { useMemo, useState } from "react";
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
import { Stack, useRouter } from "expo-router";
import { useAuth } from "../contexts/AuthContext";
import { SHEEPMUG_LOGO } from "../lib/branding";
import { colors, type } from "../theme";

/** Standard login accent (reference-style blue); distinct from app tab accent. */
const AUTH_BLUE = "#2563eb";
const AUTH_BLUE_MUTED = "#93c5fd";

type AuthView = "login" | "signup";

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();

  const [view, setView] = useState<AuthView>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);
  const [confirmFocused, setConfirmFocused] = useState(false);

  const canSignIn = useMemo(
    () => email.trim().length > 0 && password.length > 0 && !busy,
    [email, password, busy]
  );
  const canSignUp = useMemo(
    () =>
      fullName.trim().length > 1 &&
      email.trim().length > 0 &&
      password.length >= 6 &&
      confirmPassword.length >= 6 &&
      password === confirmPassword &&
      !busy,
    [fullName, email, password, confirmPassword, busy]
  );

  async function handleSignIn() {
    if (!canSignIn) return;
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  const inputBorder = (focused: boolean) => ({
    borderColor: focused ? AUTH_BLUE_MUTED : "#e5e7eb",
    borderWidth: 1,
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView behavior={Platform.select({ ios: "padding", android: undefined })} style={styles.keyboardWrap}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.brandBlock}>
            <Image source={SHEEPMUG_LOGO} style={styles.logo} resizeMode="contain" accessibilityLabel="Sheepmug" />
            <Text style={styles.brandText}>Sheepmug</Text>
          </View>

          <Text style={styles.screenTitle}>{view === "login" ? "Welcome Back" : "Create account"}</Text>

          <Text style={styles.switchRow}>
            {view === "login" ? "Don't have an account? " : "Already have an account? "}
            <Text style={styles.link} onPress={() => { setError(null); setView(view === "login" ? "signup" : "login"); }}>
              {view === "login" ? "Sign up" : "Sign in"}
            </Text>
          </Text>

          {view === "signup" && (
            <View style={[styles.fieldBlock, inputBorder(nameFocused)]}>
              <Text style={styles.fieldLabel}>Full name</Text>
              <TextInput
                value={fullName}
                onChangeText={setFullName}
                onFocus={() => setNameFocused(true)}
                onBlur={() => setNameFocused(false)}
                placeholder="Your name"
                placeholderTextColor="#9ca3af"
                style={styles.fieldInput}
              />
            </View>
          )}

          <View style={[styles.fieldBlock, inputBorder(emailFocused)]}>
            <Text style={styles.fieldLabel}>Email Address</Text>
            <TextInput
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              onFocus={() => setEmailFocused(true)}
              onBlur={() => setEmailFocused(false)}
              placeholder="name@example.com"
              placeholderTextColor="#9ca3af"
              style={styles.fieldInput}
            />
          </View>

          <View style={[styles.fieldBlock, inputBorder(passwordFocused)]}>
            <TextInput
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              onFocus={() => setPasswordFocused(true)}
              onBlur={() => setPasswordFocused(false)}
              placeholder={view === "login" ? "Enter Password" : "Create Password"}
              placeholderTextColor="#9ca3af"
              style={styles.fieldInputPlain}
            />
          </View>

          {view === "signup" && (
            <View style={[styles.fieldBlock, inputBorder(confirmFocused)]}>
              <TextInput
                secureTextEntry
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                onFocus={() => setConfirmFocused(true)}
                onBlur={() => setConfirmFocused(false)}
                placeholder="Re-enter Password"
                placeholderTextColor="#9ca3af"
                style={styles.fieldInputPlain}
              />
            </View>
          )}

          {!!error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            style={[styles.primaryBtn, !(view === "login" ? canSignIn : canSignUp) && styles.primaryBtnDisabled]}
            onPress={() => (view === "login" ? void handleSignIn() : setError("Signup flow will be connected next."))}
            disabled={!(view === "login" ? canSignIn : canSignUp)}
          >
            <Text style={styles.primaryBtnText}>{busy ? "Please wait…" : view === "login" ? "Sign in" : "Register"}</Text>
          </Pressable>

          {view === "login" && (
            <Pressable onPress={() => setError("Password reset will be connected next.")} hitSlop={12}>
              <Text style={styles.forgotLink}>Forgot your password?</Text>
            </Pressable>
          )}

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>Or sign in with</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.socialRow}>
            <Pressable style={styles.socialBtn} onPress={() => setError("Google sign-in will be connected next.")}>
              <Text style={styles.socialG}>G</Text>
              <Text style={styles.socialBtnLabel}>Google</Text>
            </Pressable>
            <Pressable style={styles.socialBtn} onPress={() => setError("Facebook sign-in will be connected next.")}>
              <Text style={styles.socialF}>f</Text>
              <Text style={[styles.socialBtnLabel, styles.socialFbText]}>Facebook</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#ffffff" },
  keyboardWrap: { flex: 1 },
  container: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 40,
    maxWidth: 480,
    width: "100%",
    alignSelf: "center",
  },
  brandBlock: {
    alignItems: "center",
    marginBottom: 20,
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 12,
  },
  brandText: {
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    color: colors.textPrimary,
    fontWeight: "700",
  },
  screenTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
    marginBottom: 12,
  },
  switchRow: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textSecondary,
    textAlign: "center",
    marginBottom: 24,
  },
  link: { color: AUTH_BLUE, fontWeight: "600" },
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
  fieldInputPlain: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: "#111827",
    paddingVertical: 4,
    minHeight: 28,
  },
  error: {
    color: "#b91c1c",
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
    marginTop: 16,
    textAlign: "center",
    fontSize: type.body.size,
    color: AUTH_BLUE,
    fontWeight: "500",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 28,
    marginBottom: 20,
    gap: 12,
  },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: "#e5e7eb" },
  dividerText: {
    fontSize: type.caption.size,
    color: "#9ca3af",
    fontWeight: "500",
  },
  socialRow: { flexDirection: "row", gap: 12 },
  socialBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#ffffff",
  },
  socialG: {
    fontSize: 16,
    fontWeight: "700",
    color: "#4285F4",
  },
  socialF: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1877f2",
  },
  socialBtnLabel: {
    fontSize: type.body.size,
    fontWeight: "600",
    color: "#111827",
  },
  socialFbText: { color: "#1877f2" },
});
