import { Feather } from "@expo/vector-icons";
import { useSignUp } from "@clerk/expo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthMessage } from "@/components/AuthMessage";
import { useColors } from "@/hooks/useColors";

const SNAP_ICON = require("@/assets/images/snap-icon.png");

const HERO_PILLS = [
  { icon: "message-circle" as const, label: "Bone Buddy AI"   },
  { icon: "book-open"      as const, label: "Guided Learning" },
  { icon: "wind"           as const, label: "Guided Wellness"  },
  { icon: "activity"       as const, label: "Progress Tracker" },
];

type Stage = "details" | "verify";

export default function RegisterScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signUp, errors, fetchStatus } = useSignUp();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [stage, setStage] = useState<Stage>("details");
  const signUpReady = Boolean(signUp);

  async function handleRegister() {
    if (!signUpReady) {
      setError("Account creation is still starting. Please wait a moment and try again.");
      return;
    }
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError("Please fill in all fields");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setError("");
    try {
      const result = await signUp.password({
        emailAddress: email.trim(),
        password,
      });
      if (result.error) {
        setError(
          (result.error as { message?: string })?.message ??
            "Registration failed. Please try again.",
        );
        return;
      }
      const sendResult = await signUp.verifications.sendEmailCode();
      if (sendResult.error) {
        setError(
          (sendResult.error as { message?: string })?.message ??
            "We couldn't send your verification code. Please try again.",
        );
        return;
      }
      setStage("verify");
    } catch (e) {
      setError(
        (e as Error)?.message ??
          "Something went wrong. Please try again in a moment.",
      );
    }
  }

  async function handleVerify() {
    if (!signUpReady) {
      setError("Verification is still starting. Please wait a moment and try again.");
      return;
    }
    if (code.trim().length === 0) {
      setError("Enter the 6-digit code from your email");
      return;
    }
    setError("");
    try {
      const result = await signUp.verifications.verifyEmailCode({
        code: code.trim(),
      });
      if (result.error) {
        setError(
          (result.error as { message?: string })?.message ??
            "Invalid code. Please try again.",
        );
        return;
      }
      if (signUp.status === "complete") {
        // Persist the entered name under the new Clerk user's profile key
        // BEFORE finalize so AuthContext picks it up on its very first
        // hydrate. AuthContext keys local profile by `clerkUserId`, which
        // matches `signUp.createdUserId`.
        const newClerkUserId = signUp.createdUserId;
        if (newClerkUserId && name.trim()) {
          try {
            await AsyncStorage.setItem(
              `@snaplife/profile/v1:${newClerkUserId}`,
              JSON.stringify({ name: name.trim() }),
            );
          } catch {
            // Non-fatal — onboarding can still capture the name.
          }
        }
        await signUp.finalize({
          // Clerk activates the session; RootLayout owns app navigation.
          navigate: () => {},
        });
      } else {
        setError("Sign-up could not be completed. Please try again.");
      }
    } catch (e) {
      setError(
        (e as Error)?.message ??
          "Something went wrong. Please try again in a moment.",
      );
    }
  }

  async function handleResendCode() {
    if (!signUpReady) {
      setError("Verification is still starting. Please wait a moment and try again.");
      return;
    }
    setError("");
    try {
      const result = await signUp.verifications.sendEmailCode();
      if (result.error) {
        setError(
          (result.error as { message?: string })?.message ??
            "We couldn't resend your verification code.",
        );
      }
    } catch (e) {
      setError((e as Error)?.message ?? "Could not resend the code.");
    }
  }

  const isLoading = fetchStatus === "fetching";
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* ── Hero — scrolls with content so nothing is clipped on small
            viewports or when the software keyboard is open. ── */}
        <LinearGradient
          colors={["#1C3A4A", "#0D2530"]}
          style={[styles.hero, { paddingTop: topPad + 18 }]}
        >
          <View style={styles.logoLockup}>
            <Image source={SNAP_ICON} style={styles.logoIcon} resizeMode="contain" />
            <Text style={styles.logoWordmark}>SNAP</Text>
            <Text style={styles.logoTagline}>Bone Health for Life</Text>
          </View>
          <Text style={styles.heroEyebrow}>Join the</Text>
          <Text style={styles.heroHeadline}>
            {"Bone Health\n"}
            <Text style={styles.heroHeadlineTeal}>Movement</Text>
          </Text>
          <Text style={styles.heroCaption}>Bone Health for Life and Longevity</Text>
          <View style={styles.pillRow}>
            {HERO_PILLS.map((p) => (
              <View key={p.label} style={styles.pill}>
                <Feather name={p.icon} size={11} color="rgba(255,255,255,0.85)" />
                <Text style={styles.pillText}>{p.label}</Text>
              </View>
            ))}
          </View>
        </LinearGradient>

        <View style={[styles.content, { paddingTop: 28, paddingBottom: bottomPad + 24 }]}>

        {stage === "details" && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.foreground }]}>Create account</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Start your free trial — no credit card needed
            </Text>

            <View style={styles.fields}>
              <View>
                <Text style={[styles.label, { color: colors.foreground }]}>Full name</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.muted, borderColor: colors.border, color: colors.foreground }]}
                  placeholder="Your name"
                  placeholderTextColor={colors.mutedForeground}
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                  autoComplete="name"
                />
              </View>

              <View>
                <Text style={[styles.label, { color: colors.foreground }]}>Email</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.muted, borderColor: colors.border, color: colors.foreground }]}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.mutedForeground}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                />
                {errors.fields.emailAddress && (
                  <Text
                    style={[styles.fieldError, { color: colors.destructive }]}
                    textBreakStrategy="simple"
                    android_hyphenationFrequency="none"
                  >
                    {errors.fields.emailAddress.message}
                  </Text>
                )}
              </View>

              <View>
                <Text style={[styles.label, { color: colors.foreground }]}>Password</Text>
                <View style={[styles.passwordWrap, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                  <TextInput
                    style={[styles.passwordInput, { color: colors.foreground }]}
                    placeholder="Minimum 8 characters"
                    placeholderTextColor={colors.mutedForeground}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPw}
                    autoComplete="new-password"
                    returnKeyType="done"
                    onSubmitEditing={handleRegister}
                  />
                  <Pressable onPress={() => setShowPw((v) => !v)} style={styles.eyeBtn}>
                    <Feather name={showPw ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
                  </Pressable>
                </View>
                {errors.fields.password && (
                  <Text
                    style={[styles.fieldError, { color: colors.destructive }]}
                    textBreakStrategy="simple"
                    android_hyphenationFrequency="none"
                  >
                    {errors.fields.password.message}
                  </Text>
                )}
              </View>

              {error.length > 0 && (
                <AuthMessage message={error} color={colors.destructive} />
              )}

              <TouchableOpacity
                activeOpacity={0.8}
                style={[styles.registerBtn, { backgroundColor: colors.accent, opacity: isLoading ? 0.75 : 1 }]}
                onPressIn={Keyboard.dismiss}
                onPress={handleRegister}
                disabled={isLoading}
                hitSlop={8}
              >
                <Text style={styles.registerBtnText}>
                  {isLoading ? "Creating account…" : "Create Free Account"}
                </Text>
              </TouchableOpacity>

              <Text style={[styles.terms, { color: colors.mutedForeground }]}>
                By creating an account you agree to our{" "}
                <Text style={{ color: colors.primary }}>Terms of Service</Text>
                {" & "}
                <Text style={{ color: colors.primary }}>Privacy Policy</Text>
              </Text>

              {/* Required for sign-up flows. Clerk's bot sign-up protection is enabled by default. */}
              <View nativeID="clerk-captcha" />
            </View>
          </View>
        )}

        {stage === "verify" && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.foreground }]}>Verify your email</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              We sent a 6-digit code to {email.trim()}. Enter it below to finish creating your account.
            </Text>

            <View style={styles.fields}>
              <View>
                <Text style={[styles.label, { color: colors.foreground }]}>Verification code</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.muted, borderColor: colors.border, color: colors.foreground }]}
                  placeholder="123456"
                  placeholderTextColor={colors.mutedForeground}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  maxLength={6}
                  returnKeyType="done"
                  onSubmitEditing={handleVerify}
                />
                {errors.fields.code && (
                  <Text
                    style={[styles.fieldError, { color: colors.destructive }]}
                    textBreakStrategy="simple"
                    android_hyphenationFrequency="none"
                  >
                    {errors.fields.code.message}
                  </Text>
                )}
              </View>

              {error.length > 0 && (
                <AuthMessage message={error} color={colors.destructive} />
              )}

              <TouchableOpacity
                activeOpacity={0.8}
                style={[styles.registerBtn, { backgroundColor: colors.accent, opacity: isLoading ? 0.75 : 1 }]}
                onPressIn={Keyboard.dismiss}
                onPress={handleVerify}
                disabled={isLoading}
                hitSlop={8}
              >
                <Text style={styles.registerBtnText}>
                  {isLoading ? "Verifying…" : "Verify & Continue"}
                </Text>
              </TouchableOpacity>

              <Pressable style={styles.forgotBtn} onPress={handleResendCode} disabled={isLoading}>
                <Text style={[styles.forgotText, { color: colors.primary }]}>Resend code</Text>
              </Pressable>

              <Pressable style={styles.forgotBtn} onPress={() => setStage("details")}>
                <Text style={[styles.forgotText, { color: colors.mutedForeground }]}>Use a different email</Text>
              </Pressable>
            </View>
          </View>
        )}

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
            Already have an account?{" "}
          </Text>
          <Pressable onPress={() => router.replace("/auth/login")}>
            <Text style={[styles.footerLink, { color: colors.primary }]}>Sign in</Text>
          </Pressable>
        </View>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // ─── Hero ───────────────────────────────────────────────────────────────────
  hero: {
    width: "100%",
    paddingHorizontal: 18,
    paddingBottom: 22,
  },
  logoLockup: {
    alignItems: "center",
    marginBottom: 14,
    gap: 4,
  },
  logoIcon: {
    width: 80,
    height: 80,
    marginBottom: 4,
  },
  logoWordmark: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
    color: "#ffffff",
    letterSpacing: 6,
  },
  logoTagline: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: "#3ABBD4",
    letterSpacing: 0.5,
  },
  heroEyebrow: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.6)",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  heroHeadline: {
    fontSize: 34,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    lineHeight: 40,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  heroHeadlineTeal: {
    color: "#3ABBD4",
  },
  heroCaption: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.68)",
    marginBottom: 14,
    letterSpacing: 0.1,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.85)",
  },
  // ─── Form ────────────────────────────────────────────────────────────────────
  content: { width: "100%", paddingHorizontal: 16, alignItems: "center" },
  card: {
    width: "100%",
    maxWidth: 560,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 22,
    marginBottom: 20,
  },
  title: { width: "100%", fontSize: 22, fontFamily: "Inter_700Bold", marginBottom: 4 },
  subtitle: {
    width: "100%",
    flexShrink: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginBottom: 20,
    lineHeight: 19,
  },
  fields: { width: "100%", gap: 14 },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 6 },
  input: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  passwordWrap: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    height: "100%",
  },
  eyeBtn: { paddingHorizontal: 14 },
  fieldError: {
    width: "100%",
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: "Inter_400Regular",
    marginTop: 5,
  },
  registerBtn: {
    height: 50,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    zIndex: 10,
    elevation: 4,
  },
  registerBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
  forgotBtn: { alignItems: "center", paddingVertical: 4 },
  forgotText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  terms: {
    width: "100%",
    flexShrink: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 18,
  },
  footer: {
    width: "100%",
    maxWidth: 560,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  footerText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  footerLink: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
