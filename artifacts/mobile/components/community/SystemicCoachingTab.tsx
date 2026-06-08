import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/ui/Card";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { resolveApiBase } from "@/lib/serverIdentity";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SessionType {
  id: string;
  label: string;
  duration: string;
  price: string;
  isFree: boolean;
  purpose: string[];
  accent: string;
}

const SESSIONS: SessionType[] = [
  {
    id: "consultation",
    label: "Free Consultation",
    duration: "30 minutes",
    price: "FREE",
    isFree: true,
    purpose: [
      "Introduction and connection",
      "Understanding your goals",
      "Suitability discussion",
    ],
    accent: "#3ABBD4",
  },
  {
    id: "focus",
    label: "Focus Session",
    duration: "45 minutes",
    price: "£65",
    isFree: false,
    purpose: [
      "Focused support and accountability",
      "Confidence and mindset",
      "Wellbeing support",
    ],
    accent: "#F47530",
  },
  {
    id: "deep",
    label: "Deep Support Session",
    duration: "60 minutes",
    price: "£85",
    isFree: false,
    purpose: [
      "Deeper reflection",
      "Healthy ageing transitions",
      "Stress and emotional wellbeing",
    ],
    accent: "#9C59B5",
  },
  {
    id: "transformation",
    label: "Transformation Session",
    duration: "90 minutes",
    price: "£125",
    isFree: false,
    purpose: [
      "Deeper life transitions",
      "Diagnosis adjustment and menopause support",
      "Identity, confidence, and transformational conversations",
    ],
    accent: "#C0392B",
  },
];

const WHO_ITEMS = [
  { icon: "heart" as const,     label: "Newly diagnosed with osteoporosis" },
  { icon: "sun" as const,       label: "Navigating menopause transitions" },
  { icon: "shield" as const,    label: "Rebuilding confidence" },
  { icon: "wind" as const,      label: "Managing stress and overwhelm" },
  { icon: "trending-up" as const, label: "Healthy ageing lifestyle changes" },
  { icon: "smile" as const,     label: "Emotional wellbeing support" },
  { icon: "zap" as const,       label: "Motivation and consistency" },
  { icon: "user" as const,      label: "Identity changes through ageing" },
];

const FAQ_ITEMS = [
  {
    q: "Is coaching the same as therapy?",
    a: "No. Coaching focuses on the present and future — helping you move forward with clarity, confidence, and intention. It is not a clinical or therapeutic service.",
  },
  {
    q: "What happens in the free consultation?",
    a: "We meet for 30 minutes so you can share what's on your mind, ask questions, and explore whether coaching feels right for you. There is no obligation whatsoever.",
  },
  {
    q: "Do I need to have a diagnosis to benefit from coaching?",
    a: "Not at all. Coaching supports anyone navigating healthy ageing, life transitions, confidence, stress, or wellbeing — with or without a medical diagnosis.",
  },
  {
    q: "How do sessions take place?",
    a: "Sessions are held via video call, making them accessible from anywhere in the world and especially convenient for busy schedules.",
  },
  {
    q: "How many sessions will I need?",
    a: "This is entirely individual. Some people benefit from a single focused session; others prefer an ongoing journey. We'll explore what feels right for you.",
  },
  {
    q: "Is everything I share confidential?",
    a: "Yes. All sessions are held in strict confidence and in line with ICF coaching ethics and GDPR guidelines.",
  },
];

// ─── Booking Modal ────────────────────────────────────────────────────────────

interface BookingModalProps {
  visible: boolean;
  session: SessionType | null;
  onClose: () => void;
}

function BookingModal({ visible, session, onClose }: BookingModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [name, setName]           = useState(`${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim());
  const [email, setEmail]         = useState(user?.email ?? "");
  const [preferred, setPreferred] = useState("");
  const [message, setMessage]     = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);
  const [sendError, setSendError]   = useState<string | null>(null);

  async function handleSubmit() {
    if (!name.trim() || !email.trim() || !session || submitting) return;
    setSubmitting(true);
    setSendError(null);
    try {
      const base = resolveApiBase() ?? "";
      const res = await fetch(`${base}/api/coaching/booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          name: name.trim(),
          email: email.trim(),
          preferred: preferred.trim(),
          message: message.trim(),
        }),
      });
      if (!res.ok) {
        setSendError("Something went wrong. Please try again or email teamsnap@snaplife.co.uk directly.");
      } else {
        setSubmitted(true);
      }
    } catch {
      setSendError("Could not connect. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    setSubmitted(false);
    setSendError(null);
    setName(`${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim());
    setEmail(user?.email ?? "");
    setPreferred("");
    setMessage("");
    onClose();
  }

  const accentColor = session?.accent ?? "#F47530";

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable style={styles.modalOverlay} onPress={handleClose} />
        <View
          style={[
            styles.modalSheet,
            {
              backgroundColor: colors.card,
              paddingBottom: insets.bottom + 24,
            },
          ]}
        >
          {/* Handle */}
          <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />

          {submitted ? (
            /* ── Confirmation ── */
            <View style={styles.confirmContent}>
              <LinearGradient
                colors={["#F47530", "#3ABBD4"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.confirmBadge}
              >
                <Feather name="check" size={28} color="#fff" />
              </LinearGradient>
              <Text style={[styles.confirmTitle, { color: colors.foreground }]}>
                Request sent
              </Text>
              <Text style={[styles.confirmBody, { color: colors.mutedForeground }]}>
                Thank you, {name.split(" ")[0] || "there"}. Catherine will be in touch within 24 hours to confirm your{" "}
                <Text style={{ color: accentColor, fontFamily: "Inter_600SemiBold" }}>
                  {session?.label}
                </Text>
                .
              </Text>
              <Text style={[styles.confirmNote, { color: colors.mutedForeground }]}>
                A confirmation will be sent to{" "}
                <Text style={{ fontFamily: "Inter_600SemiBold", color: colors.foreground }}>
                  {email}
                </Text>
                .
              </Text>
              <Pressable
                style={[styles.confirmBtn, { backgroundColor: accentColor }]}
                onPress={handleClose}
              >
                <Text style={styles.confirmBtnText}>Close</Text>
              </Pressable>
            </View>
          ) : (
            /* ── Booking form ── */
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Header */}
              <View style={styles.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
                    {session?.label}
                  </Text>
                  <Text style={[styles.sheetSub, { color: colors.mutedForeground }]}>
                    {session?.duration} · {session?.price} · with Catherine Shaw
                  </Text>
                </View>
                <Pressable onPress={handleClose} hitSlop={12}>
                  <Feather name="x" size={20} color={colors.mutedForeground} />
                </Pressable>
              </View>

              <View style={styles.formFields}>
                <BookingField label="Your name" value={name} onChangeText={setName} placeholder="Sarah Smith" colors={colors} />
                <BookingField label="Email address" value={email} onChangeText={setEmail} placeholder="sarah@example.com" keyboardType="email-address" colors={colors} />
                <BookingField
                  label="Preferred date or time (optional)"
                  value={preferred}
                  onChangeText={setPreferred}
                  placeholder="e.g. weekday mornings, or a specific date"
                  colors={colors}
                />
                <BookingField
                  label="Anything you'd like to share? (optional)"
                  value={message}
                  onChangeText={setMessage}
                  placeholder="A little context helps Catherine prepare…"
                  multiline
                  colors={colors}
                />
              </View>

              {/* Privacy */}
              <View style={[styles.modalPrivacy, { backgroundColor: accentColor + "0D", borderColor: accentColor + "28" }]}>
                <Feather name="lock" size={12} color={accentColor} />
                <Text style={[styles.modalPrivacyText, { color: colors.mutedForeground }]}>
                  All information shared is treated with strict confidence in line with ICF coaching ethics.
                </Text>
              </View>

              {sendError && (
                <View style={[styles.errorBox, { backgroundColor: "#FEE2E2", borderColor: "#FCA5A5" }]}>
                  <Feather name="alert-circle" size={13} color="#DC2626" />
                  <Text style={styles.errorText}>{sendError}</Text>
                </View>
              )}

              <Pressable
                style={[
                  styles.submitBtn,
                  {
                    backgroundColor:
                      name.trim() && email.trim() && !submitting ? accentColor : colors.muted,
                  },
                ]}
                onPress={handleSubmit}
                disabled={!name.trim() || !email.trim() || submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Text
                      style={[
                        styles.submitBtnText,
                        {
                          color:
                            name.trim() && email.trim() ? "#fff" : colors.mutedForeground,
                        },
                      ]}
                    >
                      {session?.isFree ? "Request Free Consultation" : "Request Session"}
                    </Text>
                    <Feather
                      name="arrow-right"
                      size={18}
                      color={name.trim() && email.trim() ? "#fff" : colors.mutedForeground}
                    />
                  </>
                )}
              </Pressable>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function BookingField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = "default",
  multiline = false,
  colors,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  keyboardType?: "default" | "email-address";
  multiline?: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground + "60"}
        keyboardType={keyboardType}
        autoCapitalize={keyboardType === "email-address" ? "none" : "words"}
        multiline={multiline}
        style={[
          styles.fieldInput,
          multiline && styles.fieldInputMulti,
          {
            backgroundColor: colors.background,
            borderColor: colors.border,
            color: colors.foreground,
          },
        ]}
      />
    </View>
  );
}

// ─── FAQ Accordion ────────────────────────────────────────────────────────────

function FAQItem({ q, a, colors }: { q: string; a: string; colors: ReturnType<typeof useColors> }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      onPress={() => setOpen((v) => !v)}
      style={[styles.faqItem, { borderColor: colors.border }]}
    >
      <View style={styles.faqRow}>
        <Text style={[styles.faqQ, { color: colors.foreground, flex: 1 }]}>{q}</Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
      </View>
      {open && (
        <Text style={[styles.faqA, { color: colors.mutedForeground }]}>{a}</Text>
      )}
    </Pressable>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export function SystemicCoachingTab() {
  const colors = useColors();
  const [bookingSession, setBookingSession] = useState<SessionType | null>(null);

  return (
    <>
      {/* ── 1. Welcome Hero ───────────────────────────────────── */}
      <Card
        variant="gradient"
        gradient={colors.gradients.warmth}
        style={styles.heroCard}
      >
        <Text style={styles.heroEyebrow}>SNAP · Human Support</Text>
        <Text style={styles.heroTitle}>
          {"Support for the person\nbehind the health journey."}
        </Text>
        <Text style={styles.heroBody}>
          Supportive conversations designed to help you navigate healthy ageing, confidence, wellbeing, and meaningful lifestyle change.
        </Text>
        <Pressable
          style={styles.heroCta}
          onPress={() => setBookingSession(SESSIONS[0])}
        >
          <Feather name="calendar" size={15} color="#F47530" />
          <Text style={styles.heroCtaText}>Book Your Free Consultation</Text>
        </Pressable>
      </Card>

      {/* ── 2. About Catherine ────────────────────────────────── */}
      <Card variant="elevated" style={styles.sectionCard}>
        <View style={styles.catherineRow}>
          <LinearGradient
            colors={["#F47530", "#FFB07A"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.catherineAvatar}
          >
            <Text style={styles.catherineInitials}>CS</Text>
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={[styles.catherineName, { color: colors.foreground }]}>
              Catherine Shaw
            </Text>
            <Text style={[styles.catherineRole, { color: colors.primary }]}>
              Founder of SNAP Life
            </Text>
            <Text style={[styles.catherineCred, { color: colors.mutedForeground }]}>
              ICF Diploma in Systemic Coaching (2025)
            </Text>
          </View>
        </View>
        <Text style={[styles.catherineBio, { color: colors.mutedForeground }]}>
          Catherine founded SNAP Life with a deep passion for healthy ageing and emotional wellbeing. Her coaching approach is warm, non-judgemental, and firmly grounded in supporting the whole person — not just the health condition.
        </Text>
        <View style={[styles.credBadge, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
          <Feather name="award" size={13} color={colors.primary} />
          <Text style={[styles.credBadgeText, { color: colors.primary }]}>
            International Coaching Federation · Systemic Coaching Diploma
          </Text>
        </View>
      </Card>

      {/* ── 3. What is Systemic Coaching? ─────────────────────── */}
      <View style={styles.sectionBlock}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          What is Systemic Coaching?
        </Text>
        <Text style={[styles.sectionBody, { color: colors.mutedForeground }]}>
          Systemic Coaching is a reflective, forward-focused conversation that helps you gain clarity, identify patterns, and move towards meaningful change — at your own pace, in your own way.
        </Text>
        {[
          { icon: "eye"           as const, text: "Supports reflection and self-awareness" },
          { icon: "repeat"        as const, text: "Helps identify patterns and behaviours" },
          { icon: "trending-up"   as const, text: "Supports confidence and life transitions" },
          { icon: "check-circle"  as const, text: "Encourages sustainable, healthy change" },
        ].map(({ icon, text }) => (
          <View key={text} style={styles.bulletRow}>
            <View style={[styles.bulletIcon, { backgroundColor: colors.primary + "14" }]}>
              <Feather name={icon} size={14} color={colors.primary} />
            </View>
            <Text style={[styles.bulletText, { color: colors.foreground }]}>{text}</Text>
          </View>
        ))}
      </View>

      {/* ── 4. Who This Supports ──────────────────────────────── */}
      <View style={styles.sectionBlock}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          Who coaching supports
        </Text>
        <View style={styles.whoGrid}>
          {WHO_ITEMS.map(({ icon, label }) => (
            <View
              key={label}
              style={[styles.whoChip, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Feather name={icon} size={13} color={colors.accent} />
              <Text style={[styles.whoChipText, { color: colors.foreground }]}>{label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── 5. Sessions & Pricing ─────────────────────────────── */}
      <View style={styles.sectionBlock}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          Sessions & pricing
        </Text>

        {SESSIONS.map((session) => (
          <View
            key={session.id}
            style={[
              styles.sessionCard,
              {
                backgroundColor: colors.card,
                borderColor: session.isFree ? session.accent + "55" : colors.border,
                borderWidth: session.isFree ? 1.5 : 1,
              },
            ]}
          >
            {/* Header row */}
            <View style={styles.sessionHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sessionLabel, { color: colors.foreground }]}>
                  {session.label}
                </Text>
                <Text style={[styles.sessionDuration, { color: colors.mutedForeground }]}>
                  {session.duration}
                </Text>
              </View>
              <View style={[styles.pricePill, { backgroundColor: session.accent + "16" }]}>
                <Text style={[styles.priceText, { color: session.accent }]}>
                  {session.price}
                </Text>
              </View>
            </View>

            {/* Purpose bullets */}
            {session.purpose.map((p) => (
              <View key={p} style={styles.sessionPurposeRow}>
                <View style={[styles.sessionDot, { backgroundColor: session.accent }]} />
                <Text style={[styles.sessionPurposeText, { color: colors.mutedForeground }]}>
                  {p}
                </Text>
              </View>
            ))}

            {/* CTA */}
            <Pressable
              style={[styles.sessionBtn, { backgroundColor: session.accent }]}
              onPress={() => setBookingSession(session)}
            >
              <Feather name="calendar" size={14} color="#fff" />
              <Text style={styles.sessionBtnText}>
                {session.isFree ? "Book Free Consultation" : "Book This Session"}
              </Text>
            </Pressable>
          </View>
        ))}
      </View>

      {/* ── 6. FAQ ────────────────────────────────────────────── */}
      <View style={styles.sectionBlock}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          Frequently asked questions
        </Text>
        {FAQ_ITEMS.map((item) => (
          <FAQItem key={item.q} q={item.q} a={item.a} colors={colors} />
        ))}
      </View>

      {/* ── 7. Testimonials (placeholder) ─────────────────────── */}
      <Card
        variant="outlined"
        style={styles.testimonialsPlaceholder}
      >
        <Feather name="message-square" size={22} color={colors.mutedForeground} />
        <Text style={[styles.testimonialsLabel, { color: colors.mutedForeground }]}>
          Client stories coming soon
        </Text>
        <Text style={[styles.testimonialsBody, { color: colors.mutedForeground + "99" }]}>
          Real experiences from SNAP community members will appear here once sessions begin.
        </Text>
      </Card>

      {/* ── 8. Trust footer ───────────────────────────────────── */}
      <View style={[styles.trustFooter, { borderTopColor: colors.border }]}>
        <Feather name="lock" size={13} color={colors.mutedForeground} />
        <Text style={[styles.trustText, { color: colors.mutedForeground }]}>
          All sessions are fully confidential. Coaching is not a clinical or therapeutic service and does not replace medical care.
        </Text>
      </View>
    </>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Welcome hero
  heroCard: { marginBottom: 16 },
  heroEyebrow: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "rgba(255,255,255,0.75)",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    lineHeight: 30,
    marginBottom: 10,
  },
  heroBody: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.85)",
    lineHeight: 21,
    marginBottom: 16,
  },
  heroCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fff",
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  heroCtaText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#F47530" },

  // Section common
  sectionCard: { marginBottom: 16 },
  sectionBlock: { marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 10 },
  sectionBody: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21, marginBottom: 14 },

  // Catherine
  catherineRow: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 14 },
  catherineAvatar: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  catherineInitials: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  catherineName: { fontSize: 17, fontFamily: "Inter_700Bold", marginBottom: 2 },
  catherineRole: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 1 },
  catherineCred: { fontSize: 12, fontFamily: "Inter_400Regular" },
  catherineBio: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22, marginBottom: 12 },
  credBadge: { flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderRadius: 8, padding: 10 },
  credBadgeText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1, lineHeight: 17 },

  // What is Coaching bullets
  bulletRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  bulletIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  bulletText: { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1 },

  // Who chips
  whoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  whoChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  whoChipText: { fontSize: 13, fontFamily: "Inter_400Regular" },

  // Sessions
  sessionCard: { borderRadius: 14, padding: 16, marginBottom: 12 },
  sessionHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  sessionLabel: { fontSize: 15, fontFamily: "Inter_700Bold", marginBottom: 2 },
  sessionDuration: { fontSize: 12, fontFamily: "Inter_400Regular" },
  pricePill: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },
  priceText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  sessionPurposeRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  sessionDot: { width: 6, height: 6, borderRadius: 3 },
  sessionPurposeText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 19 },
  sessionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 44,
    borderRadius: 10,
    marginTop: 12,
  },
  sessionBtnText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },

  // FAQ
  faqItem: { borderBottomWidth: 1, paddingVertical: 14 },
  faqRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  faqQ: { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 21 },
  faqA: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20, marginTop: 8 },

  // Testimonials placeholder
  testimonialsPlaceholder: { alignItems: "center", gap: 8, paddingVertical: 28, marginBottom: 16, borderStyle: "dashed" },
  testimonialsLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  testimonialsBody: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },

  // Trust footer
  trustFooter: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderTopWidth: 1, paddingTop: 16, marginBottom: 8 },
  trustText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, flex: 1 },

  // Booking modal
  modalOverlay: { flex: 1 },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: "90%",
  },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  sheetHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 20 },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 3 },
  sheetSub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  formFields: { gap: 14, marginBottom: 16 },
  fieldGroup: { gap: 5 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", letterSpacing: 0.3 },
  fieldInput: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  fieldInputMulti: { height: 88, paddingTop: 12, textAlignVertical: "top" },
  modalPrivacy: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
  },
  modalPrivacyText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, flex: 1 },
  errorBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 12 },
  errorText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, flex: 1, color: "#DC2626" },
  submitBtn: {
    height: 52,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  submitBtnText: { fontSize: 16, fontFamily: "Inter_700Bold" },

  // Confirmation
  confirmContent: { alignItems: "center", gap: 12, paddingVertical: 28, paddingHorizontal: 8 },
  confirmBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  confirmTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  confirmBody: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 23, textAlign: "center" },
  confirmNote: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  confirmBtn: {
    height: 50,
    borderRadius: 14,
    paddingHorizontal: 32,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  confirmBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
});
