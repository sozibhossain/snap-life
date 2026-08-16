import { Feather } from "@expo/vector-icons";
import { useSignIn } from "@clerk/expo";
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
import { requestPasswordOnlySignInTicket } from "@/lib/serverIdentity";

const SNAP_ICON = require("@/assets/images/snap-icon.png");
const PASSWORD_ONLY_EMAIL = "rabby.raziul@gmail.com";
const ACCESSIBLE_ACTION_COLOR = "#08758E";

const HERO_PILLS = [
  { icon: "message-circle" as const, label: "Bone Buddy AI" },
  { icon: "book-open"      as const, label: "Guided Learning" },
  { icon: "wind"           as const, label: "Guided Wellness"},
  { icon: "activity"       as const, label: "Progress Tracker"},
];

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn, fetchStatus } = useSignIn();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");
  const [debugMessage, setDebugMessage] = useState("");
  const [isVerifyingClient, setIsVerifyingClient] = useState(false);
  const signInReady = Boolean(signIn);


  async function finalizeSignIn() {
    if (!signIn) return;
    setDebugMessage("Finalizing Clerk session...");
    const finalized = await signIn.finalize({
      // Keep navigation in Expo Router. Clerk only needs to activate the
      // newly-created session; RootLayout redirects when auth state updates.
      navigate: () => {},
    });
    if (finalized.error) {
      setError(
        (finalized.error as { message?: string })?.message ??
          "Sign in could not be completed. Please try again.",
      );
      setDebugMessage("Clerk finalize failed.");
      return;
    }
    setDebugMessage("Clerk sign-in complete. Loading profile...");
  }

  async function startEmailSecondFactor() {
    if (!signIn) return false;
    const emailCodeFactor = signIn.supportedSecondFactors.find(
      (factor) => factor.strategy === "email_code",
    );
    if (!emailCodeFactor) {
      const strategies = signIn.supportedSecondFactors
        .map((factor) => factor.strategy)
        .join(", ");
      setError("This sign in requires an extra verification step that is not available.");
      setDebugMessage(
        strategies
          ? `No email_code second factor available. Supported: ${strategies}`
          : "No supported second factors returned by Clerk.",
      );
      return false;
    }
    const sent = await signIn.mfa.sendEmailCode();
    if (sent.error) {
      setError(
        (sent.error as { message?: string })?.message ??
          "Could not send the verification code. Please try again.",
      );
      return false;
    }
    setCode("");
    setIsVerifyingClient(true);
    setError("We sent a verification code to your email.");
    return true;
  }

  async function handleLogin() {
    if (!signInReady) {
      setError("Sign in is still starting. Please wait a moment and try again.");
      return;
    }
    if (!email.trim() || !password.trim()) {
      setError("Please enter your email and password");
      return;
    }
    setError("");
    const normalizedEmail = email.trim().toLowerCase();
    setDebugMessage("Submitting sign-in request...");
    try {
      await AsyncStorage.setItem(
        "@snaplife/rememberMe/v1",
        rememberMe ? "true" : "false",
      );
      if (normalizedEmail === PASSWORD_ONLY_EMAIL) {
        const ticketResponse = await requestPasswordOnlySignInTicket(
          normalizedEmail,
          password,
        );
        if (!ticketResponse.ok || !ticketResponse.ticket) {
          setError(
            ticketResponse.status === 429
              ? "Too many sign-in attempts. Please wait a minute and try again."
              : ticketResponse.status === 0 || ticketResponse.status >= 500
                ? "Sign in is temporarily unavailable. Please try again."
                : "Sign in failed. Please check your email and password.",
          );
          setDebugMessage("Password-only sign-in could not be completed.");
          return;
        }
        const ticketResult = await signIn.create({
          strategy: "ticket",
          ticket: ticketResponse.ticket,
        });
        if (ticketResult.error) {
          setError(
            (ticketResult.error as { message?: string })?.message ??
              "Sign in could not be completed. Please try again.",
          );
          setDebugMessage("Clerk ticket sign-in returned an error.");
          return;
        }
        if (signIn.status === "complete") {
          await finalizeSignIn();
        } else {
          setError("Sign in could not be completed. Please try again.");
          setDebugMessage(
            `Unexpected Clerk ticket status: ${signIn.status ?? "unknown"}`,
          );
        }
        return;
      }

      const created = await signIn.password({
        emailAddress: normalizedEmail,
        password,
      });
      setDebugMessage(`Clerk response received. Status: ${signIn.status ?? "unknown"}`);

      if (created.error) {
        setError(
          (created.error as { message?: string })?.message ??
            "Sign in failed. Please check your email and password.",
        );
        setDebugMessage("Clerk password sign-in returned an error.");
        return;
      }

      if (signIn.status === "complete") {
        await finalizeSignIn();
      } else if (
        signIn.status === "needs_client_trust" ||
        signIn.status === "needs_second_factor"
      ) {
        setDebugMessage(`Clerk requires email verification code. Status: ${signIn.status}`);
        await startEmailSecondFactor();
      } else {
        setError("Sign in could not be completed. Please try again.");
        setDebugMessage(`Unexpected Clerk status: ${signIn.status ?? "unknown"}`);
      }
    } catch (e: unknown) {
      const msg = (e as { errors?: { message?: string }[] })?.errors?.[0]?.message
        ?? (e as Error)?.message
        ?? "Something went wrong. Please try again in a moment.";
      setError(msg);
      setDebugMessage("Sign-in request threw an exception.");
    }
  }

  async function handleVerifyClientTrust() {
    if (!signInReady) {
      setError("Sign in is still starting. Please wait a moment and try again.");
      return;
    }
    if (!code.trim()) {
      setError("Please enter the verification code from your email.");
      return;
    }
    setError("");
    setDebugMessage("Verifying email code with Clerk...");
    try {
      const verified = await signIn.mfa.verifyEmailCode({ code: code.trim() });
      if (verified.error) {
        setError(
          (verified.error as { message?: string })?.message ??
            "Verification failed. Please check the code and try again.",
        );
        setDebugMessage("Clerk code verification returned an error.");
        return;
      }
      if (signIn.status === "complete") {
        await finalizeSignIn();
      } else {
        setError("Verification could not be completed. Please try again.");
        setDebugMessage(`Unexpected Clerk verification status: ${signIn.status ?? "unknown"}`);
      }
    } catch (e: unknown) {
      const msg = (e as { errors?: { message?: string }[] })?.errors?.[0]?.message
        ?? (e as Error)?.message
        ?? "Something went wrong. Please try again in a moment.";
      setError(msg);
      setDebugMessage("Code verification threw an exception.");
    }
  }

  async function handleResendClientTrustCode() {
    if (!signInReady) return;
    setError("");
    try {
      const sent = await signIn.mfa.sendEmailCode();
      if (sent.error) {
        setError(
          (sent.error as { message?: string })?.message ??
            "Could not send a new code. Please try again.",
        );
        return;
      }
      setError("We sent a new verification code to your email.");
    } catch (e: unknown) {
      const msg = (e as { errors?: { message?: string }[] })?.errors?.[0]?.message
        ?? (e as Error)?.message
        ?? "Something went wrong. Please try again in a moment.";
      setError(msg);
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
          <Text style={styles.heroEyebrow}>Welcome to the</Text>
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

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>Welcome back</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Sign in to continue your bone health journey
          </Text>

          <View style={styles.fields}>
            {isVerifyingClient ? (
              <>
                <View>
                  <Text style={[styles.label, { color: colors.foreground }]}>Verification code</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.muted, borderColor: colors.border, color: colors.foreground }]}
                    placeholder="Enter email code"
                    placeholderTextColor={colors.mutedForeground}
                    value={code}
                    onChangeText={setCode}
                    keyboardType="number-pad"
                    autoComplete="one-time-code"
                    returnKeyType="done"
                    onSubmitEditing={handleVerifyClientTrust}
                  />
                </View>

                {error.length > 0 && (
                  <AuthMessage message={error} color={colors.destructive} />
                )}
                {debugMessage.length > 0 && (
                  <Text style={[styles.debug, { color: colors.mutedForeground }]}>
                    {debugMessage}
                  </Text>
                )}

                <TouchableOpacity
                  activeOpacity={0.8}
                  style={[styles.loginBtn, { backgroundColor: colors.primary, opacity: isLoading ? 0.75 : 1 }]}
                  onPressIn={Keyboard.dismiss}
                  onPress={handleVerifyClientTrust}
                  disabled={isLoading}
                  hitSlop={8}
                >
                  <Text style={styles.loginBtnText}>
                    {isLoading ? "Verifying…" : "Verify & Sign In"}
                  </Text>
                </TouchableOpacity>

                <Pressable style={styles.forgotBtn} onPress={handleResendClientTrustCode}>
                  <Text style={[styles.forgotText, { color: colors.primary }]}>Resend code</Text>
                </Pressable>

                <Pressable
                  style={styles.forgotBtn}
                  onPress={() => {
                    signIn?.reset();
                    setIsVerifyingClient(false);
                    setCode("");
                    setError("");
                  }}
                >
                  <Text style={[styles.forgotText, { color: colors.mutedForeground }]}>Use a different email</Text>
                </Pressable>
              </>
            ) : (
              <>
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
            </View>

            <View>
              <Text style={[styles.label, { color: colors.foreground }]}>Password</Text>
              <View style={[styles.passwordWrap, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <TextInput
                  style={[styles.passwordInput, { color: colors.foreground }]}
                  placeholder="••••••••"
                  placeholderTextColor={colors.mutedForeground}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPw}
                  autoComplete="password"
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                />
                <Pressable onPress={() => setShowPw((v) => !v)} style={styles.eyeBtn}>
                  <Feather name={showPw ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
                </Pressable>
              </View>
            </View>

            <Pressable
              style={styles.rememberRow}
              onPress={() => setRememberMe((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: rememberMe }}
              aria-checked={rememberMe}
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    borderColor: rememberMe ? colors.primary : colors.border,
                    backgroundColor: rememberMe ? colors.primary : "transparent",
                  },
                ]}
              >
                {rememberMe && <Feather name="check" size={14} color="#fff" />}
              </View>
              <Text style={[styles.rememberText, { color: colors.foreground }]}>
                Keep me signed in
              </Text>
            </Pressable>

            {error.length > 0 && (
              <AuthMessage message={error} color={colors.destructive} />
            )}
            {debugMessage.length > 0 && (
              <Text style={[styles.debug, { color: colors.mutedForeground }]}>
                {debugMessage}
              </Text>
            )}

            <TouchableOpacity
              activeOpacity={0.8}
              style={[styles.loginBtn, { backgroundColor: ACCESSIBLE_ACTION_COLOR, opacity: isLoading ? 0.75 : 1 }]}
              onPressIn={Keyboard.dismiss}
              onPress={handleLogin}
              disabled={isLoading}
              hitSlop={8}
            >
              <Text style={styles.loginBtnText}>
                {isLoading ? "Signing in…" : "Sign In"}
              </Text>
            </TouchableOpacity>

            <Pressable
              style={styles.forgotBtn}
              onPress={() => router.push("/auth/forgot-password")}
            >
              <Text style={[styles.forgotText, { color: colors.primary }]}>Forgot password?</Text>
            </Pressable>
              </>
            )}
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
            Don't have an account?{" "}
          </Text>
          <Pressable onPress={() => router.push("/auth/register")}>
            <Text style={[styles.footerLink, { color: colors.accent }]}>Sign up free</Text>
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
    width: 85,
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
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginBottom: 20,
    lineHeight: 20,
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
  rememberRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  rememberText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  debug: {
    width: "100%",
    flexShrink: 1,
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "left",
    lineHeight: 16,
  },
  loginBtn: {
    height: 50,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  loginBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
  forgotBtn: { alignItems: "center", paddingVertical: 4 },
  forgotText: { fontSize: 14, fontFamily: "Inter_500Medium" },
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
