import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useRef, useState } from "react";
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
  View,
} from "react-native";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUser, useClerk } from "@clerk/expo";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { resolveApiBase } from "@/lib/serverIdentity";

const SNAP_ICON = require("@/assets/images/snap-icon.png");

const CONDITIONS = [
  {
    id: "osteoporosis",
    label: "Managing bone loss",
    description: "I have been told I have osteoporosis or significant bone thinning",
  },
  {
    id: "osteopenia",
    label: "Building stronger bones",
    description: "My bone density is lower than ideal and I want to improve it",
  },
  {
    id: "at_risk",
    label: "Staying ahead of the curve",
    description: "I have risk factors or family history I want to address proactively",
  },
  {
    id: "healthy",
    label: "Investing in my future",
    description: "I want to protect and maintain strong bones for life",
  },
] as const;

const GOALS = [
  { id: "track_density", label: "Track my bone density",      icon: "activity"       as const },
  { id: "nutrition",     label: "Improve my nutrition",        icon: "coffee"         as const },
  { id: "exercise",      label: "Build strength and movement", icon: "zap"            as const },
  { id: "understand",    label: "Understand my results",       icon: "bar-chart-2"    as const },
  { id: "community",     label: "Connect with others",         icon: "users"          as const },
  { id: "ai_coach",      label: "Personal AI coaching",        icon: "message-circle" as const },
];

function FieldLabel({ label, colors }: { label: string; colors: ReturnType<typeof useColors> }) {
  return (
    <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
      {label}
    </Text>
  );
}

interface InputFieldProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  keyboardType?: "default" | "numeric" | "email-address";
  maxLength?: number;
  colors: ReturnType<typeof useColors>;
  returnKeyType?: "next" | "done";
  onSubmitEditing?: () => void;
  inputRef?: React.RefObject<TextInput | null>;
}

function InputField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = "default",
  maxLength,
  colors,
  returnKeyType = "next",
  onSubmitEditing,
  inputRef,
}: InputFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.inputGroup}>
      <FieldLabel label={label} colors={colors} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground + "80"}
        keyboardType={keyboardType}
        maxLength={maxLength}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        blurOnSubmit={returnKeyType === "done"}
        style={[
          styles.textInput,
          {
            backgroundColor: colors.card,
            borderColor: focused ? colors.primary : colors.border,
            color: colors.foreground,
          },
        ]}
      />
    </View>
  );
}

// ── Date-of-birth helpers ─────────────────────────────────────────────────

/** Auto-inserts `/` separators as the user types DD/MM/YYYY. */
function formatDobInput(next: string): string {
  const digits = next.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** Parse DD/MM/YYYY → ISO YYYY-MM-DD, or undefined if incomplete / invalid. */
function dobToIso(dob: string): string | undefined {
  const parts = dob.split("/");
  if (parts.length !== 3) return undefined;
  const [d, m, y] = parts;
  if (d.length !== 2 || m.length !== 2 || y.length !== 4) return undefined;
  const iso = `${y}-${m}-${d}`;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return undefined;
  return iso;
}

/** Derive whole-year age from an ISO date string. */
function ageFromIso(iso: string): number | undefined {
  const birth = new Date(iso);
  if (isNaN(birth.getTime())) return undefined;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age >= 0 && age < 130 ? age : undefined;
}

export default function OnboardingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { completeOnboarding, user } = useAuth();

  const { user: clerkUser } = useUser();
  const { session } = useClerk();
  const clerkEmail = clerkUser?.emailAddresses?.[0]?.emailAddress ?? user?.email ?? "";

  const [step, setStep] = useState(0);

  // Step 0 — personal details
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState(clerkEmail);
  const [dob, setDob] = useState(""); // DD/MM/YYYY display string
  const [location, setLocation] = useState("");

  // Step 1 — condition
  const [condition, setCondition] = useState<string>("");
  // Step 2 — goals
  const [goals, setGoals] = useState<string[]>([]);

  // Step 3 — optional referral code
  const [referralExpanded, setReferralExpanded] = useState(false);
  const [referralCode, setReferralCode] = useState("");

  const lastNameRef   = useRef<TextInput>(null);
  const emailRef      = useRef<TextInput>(null);
  const dobRef        = useRef<TextInput>(null);
  const locationRef   = useRef<TextInput>(null);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const TOTAL_STEPS = 4; // 0: about you, 1: condition, 2: goals, 3: welcome

  function toggleGoal(id: string) {
    setGoals((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  }

  async function handleComplete() {
    const isoDate = dobToIso(dob.trim());
    const derivedAge = isoDate ? ageFromIso(isoDate) : undefined;

    // Fire-and-forget referral code redemption before navigating away
    const trimmedCode = referralCode.trim().toUpperCase();
    if (trimmedCode) {
      try {
        const token = await session?.getToken();
        const base = resolveApiBase() ?? "";
        void fetch(`${base}/api/referral/use`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ code: trimmedCode }),
        });
      } catch {
        // Best-effort — don't block onboarding completion
      }
    }

    await completeOnboarding({
      firstName: firstName.trim() || undefined,
      lastName: lastName.trim() || undefined,
      name: [firstName.trim(), lastName.trim()].filter(Boolean).join(" ") || undefined,
      dateOfBirth: isoDate,
      age: derivedAge,
      location: location.trim() || undefined,
      condition: condition as "osteoporosis" | "osteopenia" | "at_risk" | "healthy" | undefined,
    });
  }

  function handleNext() {
    Keyboard.dismiss();
    setStep((s) => s + 1);
  }

  // Step 0 can always proceed (all fields optional — low friction)
  const step0CanProceed = true;
  const step1CanProceed = Boolean(condition);
  const step2CanProceed = true; // goals are also optional

  const stepTitles = [
    { title: "Tell us a little about you", subtitle: "Help us personalise your SNAP experience, guidance, and recommendations." },
    { title: "Where are you on your journey?", subtitle: "Tell us a little about yourself so we can personalise every insight and recommendation." },
    { title: "What matters most to you?", subtitle: "Pick everything you'd love SNAP to help with — you can always update this later." },
    { title: "Your journey starts today", subtitle: "Welcome to SNAP Life — your healthy ageing companion." },
  ];

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Progress dots */}
        <View style={[styles.header, { paddingTop: topPad + 16 }]}>
          <View style={styles.stepDots}>
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  {
                    backgroundColor: i <= step ? colors.primary : colors.muted,
                    width: i === step ? 20 : 8,
                  },
                ]}
              />
            ))}
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 120 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {step < 3 && (
            <>
              <Text style={[styles.title, { color: colors.foreground }]}>
                {stepTitles[step].title}
              </Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                {stepTitles[step].subtitle}
              </Text>
            </>
          )}

          {/* ── Step 0: Complete your profile ─────────────────────── */}
          {step === 0 && (
            <View style={styles.aboutForm}>
              {/* Avatar preview — initials appear as the user types */}
              <View style={styles.avatarRow}>
                <LinearGradient
                  colors={["#F47530", "#3ABBD4"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.avatarCircle}
                >
                  {firstName.trim() || lastName.trim() ? (
                    <Text style={styles.avatarInitials}>
                      {[firstName.trim()[0], lastName.trim()[0]]
                        .filter(Boolean)
                        .join("")
                        .toUpperCase()}
                    </Text>
                  ) : (
                    <Feather name="user" size={30} color="rgba(255,255,255,0.75)" />
                  )}
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.avatarGreeting, { color: colors.foreground }]}>
                    {firstName.trim() ? `Hi, ${firstName.trim()} 👋` : "Complete your profile"}
                  </Text>
                  <Text style={[styles.avatarSub, { color: colors.mutedForeground }]}>
                    Profile · Step 1 of 3
                  </Text>
                </View>
              </View>

              {/* Name */}
              <View style={styles.nameRow}>
                <View style={{ flex: 1 }}>
                  <InputField
                    label="First name"
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder="Sarah"
                    colors={colors}
                    returnKeyType="next"
                    onSubmitEditing={() => lastNameRef.current?.focus()}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <InputField
                    label="Last name"
                    value={lastName}
                    onChangeText={setLastName}
                    placeholder="Smith"
                    colors={colors}
                    inputRef={lastNameRef}
                    returnKeyType="next"
                    onSubmitEditing={() => emailRef.current?.focus()}
                  />
                </View>
              </View>

              {/* Email — pre-filled from account creation */}
              <InputField
                label="Email address"
                value={email}
                onChangeText={setEmail}
                placeholder="sarah@example.com"
                keyboardType="email-address"
                colors={colors}
                inputRef={emailRef}
                returnKeyType="next"
                onSubmitEditing={() => dobRef.current?.focus()}
              />

              <InputField
                label="Date of birth (optional)"
                value={dob}
                onChangeText={(v) => setDob(formatDobInput(v))}
                placeholder="DD/MM/YYYY"
                keyboardType="numeric"
                maxLength={10}
                colors={colors}
                inputRef={dobRef}
                returnKeyType="next"
                onSubmitEditing={() => locationRef.current?.focus()}
              />

              <InputField
                label="Where are you based? (optional)"
                value={location}
                onChangeText={setLocation}
                placeholder="e.g. London, UK"
                colors={colors}
                inputRef={locationRef}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />

              {/* Privacy reassurance */}
              <View style={[styles.privacyNote, { backgroundColor: colors.primary + "0C", borderColor: colors.primary + "25" }]}>
                <Feather name="lock" size={13} color={colors.primary} />
                <Text style={[styles.privacyText, { color: colors.mutedForeground }]}>
                  Your information helps personalise your experience and remains private and secure.
                </Text>
              </View>
            </View>
          )}

          {/* ── Step 1: Condition ─────────────────────────────────── */}
          {step === 1 && (
            <View style={styles.optionsList}>
              {CONDITIONS.map((c) => (
                <Pressable
                  key={c.id}
                  style={[
                    styles.optionCard,
                    {
                      backgroundColor:
                        condition === c.id ? colors.primary + "14" : colors.card,
                      borderColor:
                        condition === c.id ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setCondition(c.id)}
                >
                  <View style={styles.optionContent}>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.optionLabel,
                          { color: condition === c.id ? colors.primary : colors.foreground },
                        ]}
                      >
                        {c.label}
                      </Text>
                      <Text style={[styles.optionDesc, { color: colors.mutedForeground }]}>
                        {c.description}
                      </Text>
                    </View>
                    {condition === c.id && (
                      <View style={[styles.checkmark, { backgroundColor: colors.primary }]}>
                        <Feather name="check" size={14} color="#fff" />
                      </View>
                    )}
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          {/* ── Step 2: Goals ─────────────────────────────────────── */}
          {step === 2 && (
            <View style={styles.goalsGrid}>
              {GOALS.map((g) => {
                const selected = goals.includes(g.id);
                return (
                  <Pressable
                    key={g.id}
                    style={[
                      styles.goalCard,
                      {
                        backgroundColor: selected ? colors.primary + "14" : colors.card,
                        borderColor: selected ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => toggleGoal(g.id)}
                  >
                    <Feather
                      name={g.icon}
                      size={22}
                      color={selected ? colors.primary : colors.mutedForeground}
                    />
                    <Text
                      style={[
                        styles.goalLabel,
                        { color: selected ? colors.primary : colors.foreground },
                      ]}
                    >
                      {g.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* ── Step 3: Welcome ───────────────────────────────────── */}
          {step === 3 && (
            <View style={styles.successContent}>
              <LinearGradient
                colors={["#1C3A4A", "#3ABBD4"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.successBadge}
              >
                <Image source={SNAP_ICON} style={styles.successBadgeIcon} resizeMode="contain" />
              </LinearGradient>

              <View style={styles.successHeading}>
                {firstName.trim() ? (
                  <Text style={[styles.successEyebrow, { color: colors.primary }]}>
                    Welcome, {firstName.trim()}
                  </Text>
                ) : (
                  <Text style={[styles.successEyebrow, { color: colors.primary }]}>
                    You've joined the
                  </Text>
                )}
                <Text style={[styles.successTitle, { color: colors.foreground }]}>
                  {"Bone Health\nMovement"}
                </Text>
              </View>

              <Text style={[styles.successText, { color: colors.mutedForeground }]}>
                Your path to stronger bones starts now — guided, personalised, and built around you.
              </Text>

              <View style={[styles.perksCard, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "30" }]}>
                {[
                  { icon: "book-open"      as const, text: "9 guided learning pathways — from basics to longevity" },
                  { icon: "message-circle" as const, text: "Bone Buddy AI coaching, personalised to your health data" },
                  { icon: "wind"           as const, text: "Breathing Studio and guided meditations" },
                  { icon: "activity"       as const, text: "DEXA tracking, bone scores and FRAX risk calculator" },
                  { icon: "award"          as const, text: "Daily habits, achievements and weekly SNAP Shots" },
                ].map(({ icon, text }) => (
                  <View key={text} style={styles.perkRow}>
                    <Feather name={icon} size={14} color={colors.primary} />
                    <Text style={[styles.perkText, { color: colors.foreground }]}>{text}</Text>
                  </View>
                ))}
              </View>

              {/* Optional referral code entry */}
              <Pressable
                onPress={() => setReferralExpanded((v) => !v)}
                style={[styles.referralToggle, { borderColor: colors.border }]}
                accessibilityRole="button"
                accessibilityLabel="Got a referral code?"
              >
                <Feather name="gift" size={14} color={colors.primary} />
                <Text style={[styles.referralToggleText, { color: colors.primary }]}>
                  Got a referral code?
                </Text>
                <Feather
                  name={referralExpanded ? "chevron-up" : "chevron-down"}
                  size={14}
                  color={colors.mutedForeground}
                />
              </Pressable>

              {referralExpanded && (
                <View style={[styles.referralBox, { backgroundColor: colors.primary + "08", borderColor: colors.primary + "25" }]}>
                  <Text style={[styles.referralLabel, { color: colors.mutedForeground }]}>
                    Enter your friend's code — they'll earn 250 XP when you join
                  </Text>
                  <TextInput
                    value={referralCode}
                    onChangeText={(v) => setReferralCode(v.toUpperCase())}
                    placeholder="e.g. SNAP1A2B"
                    placeholderTextColor={colors.mutedForeground + "70"}
                    autoCapitalize="characters"
                    maxLength={8}
                    returnKeyType="done"
                    onSubmitEditing={Keyboard.dismiss}
                    style={[
                      styles.referralInput,
                      {
                        backgroundColor: colors.card,
                        borderColor: referralCode.length === 8 ? colors.primary : colors.border,
                        color: colors.foreground,
                      },
                    ]}
                  />
                </View>
              )}
            </View>
          )}
        </ScrollView>

        {/* Footer */}
        <View style={[styles.footer, { paddingBottom: bottomPad + 16, borderTopColor: colors.border }]}>
          {step < 3 ? (
            <View style={styles.footerActions}>
              {/* Skip on step 0 and step 2 (optional steps) */}
              {(step === 0 || step === 2) && (
                <Pressable style={styles.skipBtn} onPress={handleNext}>
                  <Text style={[styles.skipText, { color: colors.mutedForeground }]}>
                    {step === 0 ? "Skip for now" : "Skip"}
                  </Text>
                </Pressable>
              )}
              <Pressable
                style={[
                  styles.nextBtn,
                  {
                    backgroundColor:
                      (step === 0 && step0CanProceed) ||
                      (step === 1 && step1CanProceed) ||
                      (step === 2 && step2CanProceed)
                        ? colors.primary
                        : colors.muted,
                    flex: step === 0 || step === 2 ? 1 : undefined,
                  },
                ]}
                onPress={handleNext}
                disabled={step === 1 && !step1CanProceed}
              >
                <Text
                  style={[
                    styles.nextBtnText,
                    {
                      color:
                        (step === 0 && step0CanProceed) ||
                        (step === 1 && step1CanProceed) ||
                        (step === 2 && step2CanProceed)
                          ? "#fff"
                          : colors.mutedForeground,
                    },
                  ]}
                >
                  Continue
                </Text>
                <Feather
                  name="arrow-right"
                  size={18}
                  color={
                    (step === 0 && step0CanProceed) ||
                    (step === 1 && step1CanProceed) ||
                    (step === 2 && step2CanProceed)
                      ? "#fff"
                      : colors.mutedForeground
                  }
                />
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={[styles.nextBtn, { backgroundColor: colors.primary }]}
              onPress={handleComplete}
            >
              <Text style={[styles.nextBtnText, { color: "#fff" }]}>
                Start My Journey
              </Text>
              <Feather name="arrow-right" size={18} color="#fff" />
            </Pressable>
          )}
          {step === 3 && (
            <Text style={[styles.legalLine, { color: colors.mutedForeground }]}>
              By continuing you agree to our{" "}
              <Text
                style={[styles.legalLink, { color: colors.primary }]}
                onPress={() => router.push("/settings/terms")}
              >
                Terms
              </Text>{" "}
              and{" "}
              <Text
                style={[styles.legalLink, { color: colors.primary }]}
                onPress={() => router.push("/settings/privacy-policy")}
              >
                Privacy Policy
              </Text>{" "}
              including the{" "}
              <Text
                style={[styles.legalLink, { color: colors.primary }]}
                onPress={() => router.push("/settings/disclaimer" as never)}
              >
                Medical, AI & Coaching Disclaimer
              </Text>
              .
            </Text>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 24, paddingBottom: 8 },
  stepDots: { flexDirection: "row", gap: 6, alignItems: "center" },
  dot: { height: 8, borderRadius: 4 },
  content: { paddingHorizontal: 24, paddingTop: 24 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", marginBottom: 8 },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 28, lineHeight: 20 },

  // About-you form (step 0)
  aboutForm: { gap: 16 },
  avatarRow: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 4 },
  avatarCircle: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  avatarInitials: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#fff" },
  avatarGreeting: { fontSize: 17, fontFamily: "Inter_700Bold", lineHeight: 22 },
  avatarSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  nameRow: { flexDirection: "row", gap: 12 },
  inputGroup: { gap: 6 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", letterSpacing: 0.3 },
  textInput: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  privacyNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
  },
  privacyText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },

  // Condition (step 1)
  optionsList: { gap: 12 },
  optionCard: { borderRadius: 14, borderWidth: 1.5, padding: 16 },
  optionContent: { flexDirection: "row", alignItems: "center" },
  optionLabel: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  optionDesc: { fontSize: 13, fontFamily: "Inter_400Regular" },
  checkmark: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },

  // Goals (step 2)
  goalsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  goalCard: {
    width: "47%",
    padding: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    gap: 8,
  },
  goalLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", textAlign: "center" },

  // Welcome (step 3)
  successContent: { alignItems: "center", gap: 16 },
  successBadge: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  successBadgeIcon: { width: 58, height: 58 },
  successHeading: { alignItems: "center", gap: 2 },
  successEyebrow: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  successTitle: {
    fontSize: 30,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    lineHeight: 36,
    letterSpacing: -0.5,
  },
  successText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  perksCard: {
    width: "100%",
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  perkRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  perkText: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  referralToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    width: "100%",
  },
  referralToggleText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  referralBox: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  referralLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
  referralInput: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    letterSpacing: 3,
    textAlign: "center",
  },

  // Footer
  footer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    gap: 8,
  },
  footerActions: { flexDirection: "row", gap: 10, alignItems: "center" },
  nextBtn: {
    height: 52,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  nextBtnText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  skipBtn: {
    height: 52,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  skipText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  legalLine: {
    marginTop: 4,
    textAlign: "center",
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
  },
  legalLink: { fontFamily: "Inter_600SemiBold", textDecorationLine: "underline" },
});
