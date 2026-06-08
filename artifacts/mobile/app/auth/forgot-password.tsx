import { Feather } from "@expo/vector-icons";
import { useSignIn } from "@clerk/expo";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

const SNAP_ICON = require("@/assets/images/snap-icon.png");

type Stage = "request" | "reset";

export default function ForgotPasswordScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn, errors, fetchStatus } = useSignIn();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [stage, setStage] = useState<Stage>("request");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function handleRequestCode() {
    if (!email.trim()) {
      setError("Enter your account email");
      return;
    }
    setError("");
    setInfo("");
    try {
      const created = await signIn.create({ identifier: email.trim() });
      if (created.error) {
        setError(
          (created.error as { message?: string })?.message ??
            "We couldn't find an account with that email.",
        );
        return;
      }
      const sent = await signIn.resetPasswordEmailCode.sendCode();
      if (sent.error) {
        setError(
          (sent.error as { message?: string })?.message ??
            "We couldn't send a reset code right now.",
        );
        return;
      }
      setInfo("Check your email for a 6-digit reset code.");
      setStage("reset");
    } catch (e) {
      setError(
        (e as Error)?.message ??
          "Something went wrong. Please try again in a moment.",
      );
    }
  }

  async function handleSubmitNewPassword() {
    if (code.trim().length === 0) {
      setError("Enter the code from your email");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setError("");
    setInfo("");
    try {
      const verified = await signIn.resetPasswordEmailCode.verifyCode({
        code: code.trim(),
      });
      if (verified.error) {
        setError(
          (verified.error as { message?: string })?.message ??
            "That code is invalid or expired.",
        );
        return;
      }
      const submitted = await signIn.resetPasswordEmailCode.submitPassword({
        password,
      });
      if (submitted.error) {
        setError(
          (submitted.error as { message?: string })?.message ??
            "We couldn't set your new password. Please try again.",
        );
        return;
      }
      if (signIn.status === "complete") {
        await signIn.finalize({
          // The root navigator handles the redirect once the Clerk session
          // becomes active.
          navigate: () => {},
        });
      } else {
        setError("Password reset could not be completed. Please try again.");
      }
    } catch (e) {
      setError(
        (e as Error)?.message ??
          "Something went wrong. Please try again in a moment.",
      );
    }
  }

  async function handleResendCode() {
    setError("");
    setInfo("");
    try {
      const sent = await signIn.resetPasswordEmailCode.sendCode();
      if (sent.error) {
        setError(
          (sent.error as { message?: string })?.message ??
            "We couldn't resend the reset code.",
        );
      } else {
        setInfo("A new code is on its way.");
      }
    } catch (e) {
      setError((e as Error)?.message ?? "Could not resend the code.");
    }
  }

  const isLoading = fetchStatus === "fetching";
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  function handleBack() {
    if (stage === "reset") {
      // Let user correct their email without losing the flow entirely
      setStage("request");
      setCode("");
      setError("");
      setInfo("");
    } else {
      router.replace("/auth/login");
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
    >
      {/* Back arrow — anchored to safe-area top so it's always reachable */}
      <Pressable
        onPress={handleBack}
        hitSlop={12}
        style={[styles.backBtn, { top: topPad + 12 }]}
        accessibilityLabel={stage === "reset" ? "Back to email" : "Back to sign in"}
      >
        <Feather name="arrow-left" size={22} color={colors.foreground} />
      </Pressable>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: topPad + 32, paddingBottom: bottomPad + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoBlock}>
          <Image source={SNAP_ICON} style={styles.logoIcon} resizeMode="contain" />
          <Text style={[styles.brandName, { color: colors.navy }]}>SNAP</Text>
          <Text style={[styles.brandTagline, { color: colors.primary }]}>Bone Health for Life</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>Reset password</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {stage === "request"
              ? "Enter your account email and we'll send you a code to set a new password."
              : "Enter the code from your email and choose a new password."}
          </Text>

          {stage === "request" && (
            <View style={styles.fields}>
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
                {errors.fields.identifier && (
                  <Text style={[styles.fieldError, { color: colors.destructive }]}>
                    {errors.fields.identifier.message}
                  </Text>
                )}
              </View>

              {error.length > 0 && (
                <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
              )}

              <Pressable
                style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: isLoading ? 0.75 : 1 }]}
                onPress={handleRequestCode}
                disabled={isLoading}
              >
                <Text style={styles.primaryBtnText}>
                  {isLoading ? "Sending…" : "Send reset code"}
                </Text>
              </Pressable>
            </View>
          )}

          {stage === "reset" && (
            <View style={styles.fields}>
              <View>
                <Text style={[styles.label, { color: colors.foreground }]}>Reset code</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.muted, borderColor: colors.border, color: colors.foreground }]}
                  placeholder="123456"
                  placeholderTextColor={colors.mutedForeground}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  maxLength={6}
                />
                {errors.fields.code && (
                  <Text style={[styles.fieldError, { color: colors.destructive }]}>
                    {errors.fields.code.message}
                  </Text>
                )}
              </View>

              <View>
                <Text style={[styles.label, { color: colors.foreground }]}>New password</Text>
                <View style={[styles.passwordWrap, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                  <TextInput
                    style={[styles.passwordInput, { color: colors.foreground }]}
                    placeholder="Minimum 8 characters"
                    placeholderTextColor={colors.mutedForeground}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPw}
                    autoComplete="new-password"
                  />
                  <Pressable onPress={() => setShowPw((v) => !v)} style={styles.eyeBtn}>
                    <Feather name={showPw ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
                  </Pressable>
                </View>
                {errors.fields.password && (
                  <Text style={[styles.fieldError, { color: colors.destructive }]}>
                    {errors.fields.password.message}
                  </Text>
                )}
              </View>

              {info.length > 0 && (
                <Text style={[styles.info, { color: colors.primary }]}>{info}</Text>
              )}
              {error.length > 0 && (
                <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
              )}

              <Pressable
                style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: isLoading ? 0.75 : 1 }]}
                onPress={handleSubmitNewPassword}
                disabled={isLoading}
              >
                <Text style={styles.primaryBtnText}>
                  {isLoading ? "Saving…" : "Set new password"}
                </Text>
              </Pressable>

              <Pressable style={styles.linkBtn} onPress={handleResendCode} disabled={isLoading}>
                <Text style={[styles.linkText, { color: colors.primary }]}>Resend code</Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <Pressable onPress={() => router.replace("/auth/login")}>
            <Text style={[styles.footerLink, { color: colors.primary }]}>Back to sign in</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 24, alignItems: "center" },
  logoBlock: { alignItems: "center", marginBottom: 28, gap: 4 },
  logoIcon: { width: 64, height: 64, marginBottom: 8 },
  brandName: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: 2 },
  brandTagline: { fontSize: 13, fontFamily: "Inter_500Medium", letterSpacing: 0.3 },
  card: {
    width: "100%",
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    marginBottom: 24,
  },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", marginBottom: 4 },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 24, lineHeight: 19 },
  fields: { gap: 14 },
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
  fieldError: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4 },
  info: { fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center" },
  error: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  primaryBtn: {
    height: 50,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
  linkBtn: { alignItems: "center", paddingVertical: 4 },
  linkText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  footerLink: { fontSize: 14, fontFamily: "Inter_700Bold" },
  backBtn: { position: "absolute", left: 20, zIndex: 10, padding: 4 },
});
