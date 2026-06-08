import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  FEEDBACK_TAGS,
  type FeedbackTag,
  type FeedbackType,
  submitFeedback,
} from "@/lib/feedback";
import { useSubscription } from "@/lib/revenuecat";

const TYPE_META: Record<
  FeedbackType,
  { title: string; subtitle: string; prompt: string; cta: string; icon: keyof typeof Feather.glyphMap }
> = {
  general: {
    title: "Share feedback",
    subtitle: "Help us improve SNAP Life",
    prompt: "How can we improve the app?",
    cta: "Send feedback",
    icon: "message-circle",
  },
  testimonial: {
    title: "Share your story",
    subtitle: "Tell us what you love",
    prompt: "What are you enjoying about SNAP Life?",
    cta: "Send testimonial",
    icon: "heart",
  },
  experience: {
    title: "How's it going?",
    subtitle: "Quick check-in",
    prompt: "Are you having fun? What do you like most?",
    cta: "Send",
    icon: "smile",
  },
};

const TYPE_OPTIONS: { id: FeedbackType; label: string }[] = [
  { id: "general", label: "Improve" },
  { id: "testimonial", label: "Love" },
  { id: "experience", label: "Vibe" },
];

export default function FeedbackScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { tier, tierLabel } = useSubscription();
  const params = useLocalSearchParams<{ type?: string }>();

  const initialType: FeedbackType = useMemo(() => {
    const t = String(params.type ?? "general");
    return (["general", "testimonial", "experience"] as const).includes(t as FeedbackType)
      ? (t as FeedbackType)
      : "general";
  }, [params.type]);

  const [type, setType] = useState<FeedbackType>(initialType);
  const [message, setMessage] = useState("");
  const [tags, setTags] = useState<FeedbackTag[]>([]);
  const [allowTestimonial, setAllowTestimonial] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset consent flag if user switches away from testimonial
  useEffect(() => {
    if (type !== "testimonial") setAllowTestimonial(false);
  }, [type]);

  const meta = TYPE_META[type];
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const trimmed = message.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  function toggleTag(t: FeedbackTag) {
    setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const res = await submitFeedback({
      feedbackType: type,
      message: trimmed,
      tier,
      tags,
      allowTestimonialUse: type === "testimonial" ? allowTestimonial : false,
      appUserId: user?.id ?? null,
    });
    setSubmitting(false);
    if (res.ok) {
      setSuccess(true);
    } else {
      setError(res.error ?? "Something went wrong. Please try again.");
    }
  }

  if (success) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad + 24 }]}>
        <View style={styles.successWrap}>
          <View style={[styles.successIcon, { backgroundColor: colors.primary + "18" }]}>
            <Feather name="check" size={28} color={colors.primary} />
          </View>
          <Text style={[styles.successTitle, { color: colors.foreground }]}>Thanks for sharing</Text>
          <Text style={[styles.successBody, { color: colors.mutedForeground }]}>
            {type === "testimonial"
              ? "We read every story. We won't publish anything without your permission."
              : "Your input shapes what we build next."}
          </Text>
          <Pressable
            style={[styles.successBtn, { backgroundColor: colors.primary }]}
            onPress={() => router.back()}
          >
            <Text style={styles.successBtnText}>Done</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Feedback</Text>
        <View style={[styles.tierPill, { backgroundColor: colors.primary + "18" }]}>
          <Text style={[styles.tierPillText, { color: colors.primary }]}>{tierLabel}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Type selector ----------------------------------------------- */}
        <View style={[styles.typeRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {TYPE_OPTIONS.map((opt) => {
            const selected = opt.id === type;
            return (
              <Pressable
                key={opt.id}
                onPress={() => setType(opt.id)}
                style={[
                  styles.typeChip,
                  { backgroundColor: selected ? colors.primary : "transparent" },
                ]}
              >
                <Text
                  style={[
                    styles.typeChipText,
                    { color: selected ? "#fff" : colors.foreground },
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Hero -------------------------------------------------------- */}
        <View style={styles.heroBlock}>
          <View style={[styles.heroIcon, { backgroundColor: colors.primary + "18" }]}>
            <Feather name={meta.icon} size={20} color={colors.primary} />
          </View>
          <Text style={[styles.heroTitle, { color: colors.foreground }]}>{meta.title}</Text>
          <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>{meta.subtitle}</Text>
        </View>

        {/* Prompt + textarea ------------------------------------------- */}
        <Text style={[styles.label, { color: colors.foreground }]}>{meta.prompt}</Text>
        <TextInput
          style={[
            styles.textarea,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              color: colors.foreground,
            },
          ]}
          value={message}
          onChangeText={setMessage}
          placeholder="Type your message…"
          placeholderTextColor={colors.mutedForeground}
          multiline
          textAlignVertical="top"
          maxLength={2000}
        />
        <Text style={[styles.charCount, { color: colors.mutedForeground }]}>
          {message.length} / 2000
        </Text>

        {/* Quick tags -------------------------------------------------- */}
        <Text style={[styles.label, { color: colors.foreground, marginTop: 8 }]}>
          Quick tags <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>(optional)</Text>
        </Text>
        <View style={styles.tagRow}>
          {FEEDBACK_TAGS.map((t) => {
            const active = tags.includes(t);
            return (
              <Pressable
                key={t}
                onPress={() => toggleTag(t)}
                style={[
                  styles.tagChip,
                  {
                    backgroundColor: active ? colors.primary : "transparent",
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.tagChipText,
                    { color: active ? "#fff" : colors.foreground },
                  ]}
                >
                  {t}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Testimonial consent ---------------------------------------- */}
        {type === "testimonial" && (
          <Pressable
            style={[styles.consentRow, { borderColor: colors.border, backgroundColor: colors.card }]}
            onPress={() => setAllowTestimonial((v) => !v)}
          >
            <View
              style={[
                styles.checkbox,
                {
                  backgroundColor: allowTestimonial ? colors.primary : "transparent",
                  borderColor: allowTestimonial ? colors.primary : colors.border,
                },
              ]}
            >
              {allowTestimonial && <Feather name="check" size={12} color="#fff" />}
            </View>
            <Text style={[styles.consentText, { color: colors.foreground }]}>
              I'm happy for this to be used as a testimonial
            </Text>
          </Pressable>
        )}

        {error && <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>}

        <Pressable
          style={[
            styles.submitBtn,
            { backgroundColor: colors.primary, opacity: canSubmit ? 1 : 0.5 },
          ]}
          onPress={handleSubmit}
          disabled={!canSubmit}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitBtnText}>{meta.cta}</Text>
          )}
        </Pressable>

        <Text style={[styles.privacyNote, { color: colors.mutedForeground }]}>
          Stored securely. Tied to your account so we can follow up if needed.
          We never share testimonials publicly without consent.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  headerTitle: { flex: 1, fontSize: 17, fontFamily: "Inter_700Bold" },
  tierPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  tierPillText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },

  content: { padding: 16, gap: 12 },
  typeRow: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  typeChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: "center",
  },
  typeChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  heroBlock: { alignItems: "center", gap: 6, paddingVertical: 8 },
  heroIcon: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
  },
  heroTitle: { fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  heroSub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },

  label: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: 8 },
  textarea: {
    minHeight: 120,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  charCount: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "right", marginTop: -4 },

  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tagChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  tagChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },

  consentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  checkbox: {
    width: 20, height: 20, borderRadius: 6, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
  },
  consentText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },

  errorText: { fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center" },

  submitBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  submitBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
  privacyNote: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 16, marginTop: 4 },

  successWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  successIcon: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: "center", justifyContent: "center",
  },
  successTitle: { fontSize: 22, fontFamily: "Inter_700Bold", textAlign: "center" },
  successBody: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  successBtn: {
    marginTop: 16,
    height: 50,
    paddingHorizontal: 36,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  successBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
});
