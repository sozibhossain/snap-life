import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
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
import { logInteractionEvent } from "@/lib/events";

// ─── Consultant data ──────────────────────────────────────────────────────────
// To add a new consultant: add one entry here. The API mirrors this in
// artifacts/api-server/src/routes/expertSupport.ts (CONSULTANTS map).

interface Consultant {
  id: string;
  name: string;
  title: string;
  specialisms: string[];
  supports: string[];
  bio: string;
  initials: string;
  gradientColors: readonly [string, string];
  accentColor: string;
}

const CONSULTANTS: Consultant[] = [
  {
    id: "maria",
    name: "Maria",
    title: "Bone Health Consultant",
    specialisms: ["Bone Health Specialist", "Osteoporosis Support"],
    supports: [
      "Bone health education & awareness",
      "Osteoporosis guidance",
      "Healthy ageing support",
      "Supportive wellbeing conversations",
    ],
    bio: "Maria is a dedicated Bone Health Consultant with specialist expertise in osteoporosis awareness and healthy ageing. She provides warm, evidence-informed guidance to help you understand and support your bone health journey with confidence.",
    initials: "M",
    gradientColors: ["#1C3A4A", "#3ABBD4"],
    accentColor: "#3ABBD4",
  },
  {
    id: "faye",
    name: "Faye",
    title: "Nutritionist — Lift Nutrition",
    specialisms: ["Nutritionist", "Healthy Ageing Nutrition"],
    supports: [
      "Bone-supportive nutrition",
      "Protein intake & muscle health",
      "Menopause nutrition guidance",
      "Supplement & lifestyle support",
    ],
    bio: "Faye is a specialist nutritionist at Lift Nutrition, focused on healthy ageing, bone health, and menopause support. She helps you build a practical, nourishing approach to nutrition that works for your body and your life.",
    initials: "F",
    gradientColors: ["#F47530", "#FFB07A"],
    accentColor: "#F47530",
  },
];

// ─── Request Modal ────────────────────────────────────────────────────────────

interface RequestModalProps {
  visible: boolean;
  preselectedConsultant: Consultant | null;
  onClose: () => void;
}

function RequestModal({ visible, preselectedConsultant, onClose }: RequestModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const [name, setName]             = useState(`${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim());
  const [email, setEmail]           = useState(user?.email ?? "");
  const [phone, setPhone]           = useState("");
  const [consultantId, setConsultantId] = useState(preselectedConsultant?.id ?? CONSULTANTS[0].id);
  const [preferred, setPreferred]   = useState("");
  const [reason, setReason]         = useState("");
  const [consent, setConsent]       = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);
  const [sendError, setSendError]   = useState<string | null>(null);

  // Sync consultant selection when modal opens with a pre-selected consultant
  React.useEffect(() => {
    if (visible && preselectedConsultant) {
      setConsultantId(preselectedConsultant.id);
    }
  }, [visible, preselectedConsultant]);

  const selectedConsultant = CONSULTANTS.find((c) => c.id === consultantId) ?? CONSULTANTS[0];
  const accentColor = selectedConsultant.accentColor;

  async function handleSubmit() {
    if (!name.trim() || !email.trim() || !consent || submitting) return;
    setSubmitting(true);
    setSendError(null);
    try {
      const base = resolveApiBase();
      if (!base && Platform.OS !== "web") {
        throw new Error("missing api base");
      }
      const apiBase = base ?? "";
      const res = await fetch(`${apiBase}/api/expert-support/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          consultantId,
          preferred: preferred.trim(),
          reason: reason.trim(),
        }),
      });
      if (!res.ok) {
        let apiError: { error?: string; message?: string } | null = null;
        try {
          apiError = await res.json();
        } catch {
          apiError = null;
        }
        console.warn("[expert-support] request failed", {
          status: res.status,
          error: apiError?.error,
          message: apiError?.message,
        });
        setSendError(
          res.status === 502 && apiError?.error === "email_delivery_failed"
            ? "We couldn't send your request by email right now. Please contact teamsnap@snaplife.co.uk."
            : "Something went wrong. Please try again or contact teamsnap@snaplife.co.uk.",
        );
      } else {
        logInteractionEvent({
          appUserId: user?.id,
          kind: "expert_support_requested",
          payload: {
            consultantId,
            consultantName: selectedConsultant.name,
          },
        });
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
    setPhone("");
    setPreferred("");
    setReason("");
    setConsent(false);
    onClose();
  }

  const canSubmit = name.trim().length > 0 && email.trim().length > 0 && consent && !submitting;

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
            { backgroundColor: colors.card, paddingBottom: insets.bottom + 24 },
          ]}
        >
          <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />

          {submitted ? (
            /* ── Confirmation ── */
            <View style={styles.confirmContent}>
              <LinearGradient
                colors={["#1C3A4A", "#3ABBD4"]}
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
                Thank you, {name.split(" ")[0] || "there"}. A member of the SNAP Expert Support team will be in touch shortly.
              </Text>
              <Text style={[styles.confirmNote, { color: colors.mutedForeground }]}>
                A confirmation has been sent to{" "}
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
            /* ── Request form ── */
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Header */}
              <View style={styles.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
                    Request Expert Support
                  </Text>
                  <Text style={[styles.sheetSub, { color: colors.mutedForeground }]}>
                    Fill in your details and we'll connect you shortly
                  </Text>
                </View>
                <Pressable onPress={handleClose} hitSlop={12}>
                  <Feather name="x" size={20} color={colors.mutedForeground} />
                </Pressable>
              </View>

              <View style={styles.formFields}>

                {/* Consultant selector */}
                <View style={styles.fieldGroup}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                    Preferred consultant
                  </Text>
                  <View style={styles.consultantSelector}>
                    {CONSULTANTS.map((c) => (
                      <Pressable
                        key={c.id}
                        style={[
                          styles.consultantOption,
                          {
                            borderColor: consultantId === c.id ? c.accentColor : colors.border,
                            backgroundColor: consultantId === c.id ? c.accentColor + "0F" : colors.background,
                          },
                        ]}
                        onPress={() => setConsultantId(c.id)}
                      >
                        <LinearGradient
                          colors={c.gradientColors}
                          style={styles.consultantOptionAvatar}
                        >
                          <Text style={styles.consultantOptionInitial}>{c.initials}</Text>
                        </LinearGradient>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.consultantOptionName, { color: colors.foreground }]}>
                            {c.name}
                          </Text>
                          <Text style={[styles.consultantOptionTitle, { color: colors.mutedForeground }]}>
                            {c.title}
                          </Text>
                        </View>
                        {consultantId === c.id && (
                          <Feather name="check-circle" size={18} color={c.accentColor} />
                        )}
                      </Pressable>
                    ))}
                  </View>
                </View>

                <RequestField
                  label="Full name"
                  value={name}
                  onChangeText={setName}
                  placeholder="Your full name"
                  colors={colors}
                />
                <RequestField
                  label="Email address"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  colors={colors}
                />
                <RequestField
                  label="Phone number (optional)"
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="+44 7700 000000"
                  keyboardType="phone-pad"
                  colors={colors}
                />
                <RequestField
                  label="Preferred days or times (optional)"
                  value={preferred}
                  onChangeText={setPreferred}
                  placeholder="e.g. weekday mornings, or a specific date"
                  colors={colors}
                />
                <RequestField
                  label="Reason for support (optional)"
                  value={reason}
                  onChangeText={setReason}
                  placeholder="A little context helps your consultant prepare…"
                  multiline
                  colors={colors}
                />

                {/* Consent */}
                <Pressable
                  style={styles.consentRow}
                  onPress={() => setConsent((v) => !v)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: consent }}
                >
                  <View
                    style={[
                      styles.consentBox,
                      {
                        borderColor: consent ? accentColor : colors.border,
                        backgroundColor: consent ? accentColor : "transparent",
                      },
                    ]}
                  >
                    {consent && <Feather name="check" size={12} color="#fff" />}
                  </View>
                  <Text style={[styles.consentText, { color: colors.mutedForeground }]}>
                    I consent to my details being shared with the selected consultant and the SNAP Life team for the purpose of this support request.
                  </Text>
                </Pressable>
              </View>

              {/* Privacy note */}
              <View style={[styles.privacyBox, { backgroundColor: accentColor + "0D", borderColor: accentColor + "28" }]}>
                <Feather name="lock" size={12} color={accentColor} />
                <Text style={[styles.privacyText, { color: colors.mutedForeground }]}>
                  All information shared is kept strictly confidential and handled in line with GDPR guidelines.{" "}
                  <Text
                    style={{ color: accentColor, fontFamily: "Inter_600SemiBold" }}
                    onPress={() => router.push("/settings/privacy-policy" as never)}
                  >
                    Privacy policy
                  </Text>
                  {" "}·{" "}
                  <Text
                    style={{ color: accentColor, fontFamily: "Inter_600SemiBold" }}
                    onPress={() => router.push("/settings/disclaimer" as never)}
                  >
                    Medical disclaimer
                  </Text>
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
                  { backgroundColor: canSubmit ? accentColor : colors.muted },
                ]}
                onPress={handleSubmit}
                disabled={!canSubmit}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Text style={[styles.submitBtnText, { color: canSubmit ? "#fff" : colors.mutedForeground }]}>
                      Send Request
                    </Text>
                    <Feather name="arrow-right" size={18} color={canSubmit ? "#fff" : colors.mutedForeground} />
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

function RequestField({
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
  keyboardType?: "default" | "email-address" | "phone-pad";
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

// ─── Consultant Card ──────────────────────────────────────────────────────────

function ConsultantCard({
  consultant,
  onRequest,
  colors,
}: {
  consultant: Consultant;
  onRequest: (c: Consultant) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.consultantCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Avatar + name */}
      <View style={styles.consultantCardHeader}>
        <LinearGradient
          colors={consultant.gradientColors}
          style={styles.consultantCardAvatar}
        >
          <Text style={styles.consultantCardInitials}>{consultant.initials}</Text>
        </LinearGradient>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={[styles.consultantCardName, { color: colors.foreground }]}>
            {consultant.name}
          </Text>
          <Text style={[styles.consultantCardTitle, { color: consultant.accentColor }]}>
            {consultant.title}
          </Text>
        </View>
      </View>

      {/* Specialisms */}
      <View style={styles.specialismRow}>
        {consultant.specialisms.map((s) => (
          <View
            key={s}
            style={[styles.specialismChip, { backgroundColor: consultant.accentColor + "14", borderColor: consultant.accentColor + "30" }]}
          >
            <Text style={[styles.specialismChipText, { color: consultant.accentColor }]}>{s}</Text>
          </View>
        ))}
      </View>

      {/* Bio */}
      <Text style={[styles.consultantCardBio, { color: colors.mutedForeground }]}>
        {consultant.bio}
      </Text>

      {/* Areas of support */}
      <View style={styles.supportsBlock}>
        <Text style={[styles.supportsTitle, { color: colors.foreground }]}>Areas of support</Text>
        {consultant.supports.map((s) => (
          <View key={s} style={styles.supportRow}>
            <View style={[styles.supportDot, { backgroundColor: consultant.accentColor }]} />
            <Text style={[styles.supportText, { color: colors.mutedForeground }]}>{s}</Text>
          </View>
        ))}
      </View>

      {/* CTA */}
      <Pressable
        style={[styles.consultantCta, { backgroundColor: consultant.accentColor }]}
        onPress={() => onRequest(consultant)}
      >
        <Feather name="send" size={14} color="#fff" />
        <Text style={styles.consultantCtaText}>Request Support</Text>
      </Pressable>
    </View>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export function ExpertSupportTab() {
  const colors = useColors();
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedConsultant, setSelectedConsultant] = useState<Consultant | null>(null);

  function openModal(consultant: Consultant) {
    setSelectedConsultant(consultant);
    setModalOpen(true);
  }

  return (
    <>
      {/* ── Hero ────────────────────────────────────────────────── */}
      <Card variant="gradient" gradient={["#1C3A4A", "#0D2530"]} style={styles.heroCard}>
        <Text style={styles.heroEyebrow}>SNAP · Expert Support</Text>
        <Text style={styles.heroTitle}>{"A trusted support\nnetwork inside SNAP."}</Text>
        <Text style={styles.heroBody}>
          Connect with our specialist consultants for personalised guidance across bone health, nutrition, and healthy ageing.
        </Text>
        <Pressable style={styles.heroCta} onPress={() => openModal(CONSULTANTS[0])}>
          <Feather name="send" size={15} color="#3ABBD4" />
          <Text style={styles.heroCtaText}>Request Support</Text>
        </Pressable>
      </Card>

      {/* ── What to expect ──────────────────────────────────────── */}
      <View style={styles.sectionBlock}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          What to expect
        </Text>
        {[
          { icon: "user-check" as const, text: "A warm, personalised response from your chosen consultant" },
          { icon: "shield"     as const, text: "Strict confidentiality — all requests are handled with care" },
          { icon: "mail"       as const, text: "Your request is also shared with the SNAP team for oversight" },
          { icon: "clock"      as const, text: "We aim to respond within 2 working days" },
        ].map(({ icon, text }) => (
          <View key={text} style={styles.bulletRow}>
            <View style={[styles.bulletIcon, { backgroundColor: colors.primary + "14" }]}>
              <Feather name={icon} size={14} color={colors.primary} />
            </View>
            <Text style={[styles.bulletText, { color: colors.foreground }]}>{text}</Text>
          </View>
        ))}
      </View>

      {/* ── Consultant profiles ──────────────────────────────────── */}
      <View style={styles.sectionBlock}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          Meet our consultants
        </Text>
        {CONSULTANTS.map((c) => (
          <ConsultantCard key={c.id} consultant={c} onRequest={openModal} colors={colors} />
        ))}
      </View>

      {/* ── Ecosystem callout ────────────────────────────────────── */}
      <Card variant="outlined" style={styles.ecosystemCard}>
        <Feather name="users" size={20} color={colors.primary} style={{ marginBottom: 8 }} />
        <Text style={[styles.ecosystemTitle, { color: colors.foreground }]}>
          Growing our expert network
        </Text>
        <Text style={[styles.ecosystemBody, { color: colors.mutedForeground }]}>
          We're continually expanding our team of specialists — including movement coaches, physiotherapists, and menopause consultants. Watch this space.
        </Text>
      </Card>

      <RequestModal
        visible={modalOpen}
        preselectedConsultant={selectedConsultant}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Hero
  heroCard: { marginBottom: 20 },
  heroEyebrow: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "#3ABBD4",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  heroTitle: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    lineHeight: 32,
    letterSpacing: -0.3,
    marginBottom: 10,
  },
  heroBody: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.75)",
    lineHeight: 20,
    marginBottom: 18,
  },
  heroCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
  },
  heroCtaText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  // Sections
  sectionBlock: { marginBottom: 20 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 14 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 10 },
  bulletIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  bulletText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, marginTop: 5 },
  // Consultant card
  consultantCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    marginBottom: 14,
  },
  consultantCardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  consultantCardAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  consultantCardInitials: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff" },
  consultantCardName: { fontSize: 17, fontFamily: "Inter_700Bold", marginBottom: 2 },
  consultantCardTitle: { fontSize: 13, fontFamily: "Inter_500Medium" },
  specialismRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  specialismChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  specialismChipText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  consultantCardBio: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    marginBottom: 14,
  },
  supportsBlock: { marginBottom: 16 },
  supportsTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  supportRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 6 },
  supportDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  supportText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  consultantCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 46,
    borderRadius: 12,
  },
  consultantCtaText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  // Ecosystem callout
  ecosystemCard: { marginBottom: 8, alignItems: "center" },
  ecosystemTitle: { fontSize: 15, fontFamily: "Inter_700Bold", marginBottom: 6, textAlign: "center" },
  ecosystemBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, textAlign: "center" },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "92%",
    paddingTop: 12,
    paddingHorizontal: 20,
  },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  sheetHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 20 },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 2 },
  sheetSub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  // Form
  formFields: { gap: 14, marginBottom: 14 },
  fieldGroup: { gap: 6 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  fieldInput: {
    height: 46,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 13,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  fieldInputMulti: { height: 88, paddingTop: 12, textAlignVertical: "top" },
  // Consultant selector within form
  consultantSelector: { gap: 8 },
  consultantOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  consultantOptionAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  consultantOptionInitial: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  consultantOptionName: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 1 },
  consultantOptionTitle: { fontSize: 12, fontFamily: "Inter_400Regular" },
  // Consent
  consentRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  consentBox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
    flexShrink: 0,
  },
  consentText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  // Privacy / error
  privacyBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  privacyText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#DC2626" },
  // Submit
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 52,
    borderRadius: 14,
    marginBottom: 8,
  },
  submitBtnText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  // Confirmation
  confirmContent: { alignItems: "center", paddingVertical: 24, paddingHorizontal: 8 },
  confirmBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  confirmTitle: { fontSize: 22, fontFamily: "Inter_700Bold", marginBottom: 10, textAlign: "center" },
  confirmBody: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 22, textAlign: "center", marginBottom: 8 },
  confirmNote: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 24 },
  confirmBtn: { height: 50, paddingHorizontal: 32, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  confirmBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
});
