import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
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
import { Card } from "@/components/ui/Card";
import { useColors } from "@/hooks/useColors";

const FAQS = [
  { q: "How do I log a DEXA scan?", a: "Go to the Health tab, select 'DEXA Scans', then tap 'Log New DEXA Scan'. Enter your T-score, Z-score, and BMD from your scan report." },
  { q: "What is a T-score?", a: "A T-score measures your bone density compared to a healthy young adult. Normal is -1.0 or above. Osteopenia is -1.0 to -2.5. Osteoporosis is -2.5 or below." },
  { q: "How does Bone Buddy AI work?", a: "Bone Buddy is powered by AI and provides personalised bone health guidance. It uses your profile and health data to give context-aware advice. Always consult your doctor for medical decisions." },
  { q: "How do I earn XP?", a: "You earn XP by logging health data, completing daily challenges, taking supplements, maintaining streaks, and chatting with Bone Buddy." },
  { q: "Is my data secure?", a: "Yes. All health data is encrypted and stored securely. We are GDPR compliant and never sell or share your personal data." },
];

export default function HelpScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [expanded, setExpanded] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Help & Support</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 20 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.sectionLabel, { color: colors.foreground }]}>
          Frequently Asked Questions
        </Text>
        <Card variant="outlined">
          {FAQS.map((faq, i) => (
            <Pressable
              key={i}
              style={[styles.faqRow, i < FAQS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
              onPress={() => setExpanded(expanded === i ? null : i)}
            >
              <View style={styles.faqHeader}>
                <Text style={[styles.faqQuestion, { color: colors.foreground, flex: 1 }]}>
                  {faq.q}
                </Text>
                <Feather
                  name={expanded === i ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={colors.mutedForeground}
                />
              </View>
              {expanded === i && (
                <Text style={[styles.faqAnswer, { color: colors.mutedForeground }]}>
                  {faq.a}
                </Text>
              )}
            </Pressable>
          ))}
        </Card>

        <Text style={[styles.sectionLabel, { color: colors.foreground }]}>
          Contact Support
        </Text>
        <Card variant="outlined" style={styles.contactCard}>
          <TextInput
            style={[styles.textarea, { backgroundColor: colors.muted, color: colors.foreground }]}
            value={message}
            onChangeText={setMessage}
            placeholder="Describe your issue or question..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={4}
          />
          <Pressable style={[styles.sendBtn, { backgroundColor: colors.primary }]}>
            <Feather name="send" size={16} color="#fff" />
            <Text style={styles.sendBtnText}>Send Message</Text>
          </Pressable>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  content: { padding: 16, gap: 14 },
  sectionLabel: { fontSize: 17, fontFamily: "Inter_700Bold" },
  faqRow: { padding: 14, gap: 8 },
  faqHeader: { flexDirection: "row", alignItems: "center" },
  faqQuestion: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  faqAnswer: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  contactCard: { gap: 12 },
  textarea: {
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    minHeight: 100,
    textAlignVertical: "top",
  },
  sendBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 14,
    borderRadius: 10,
  },
  sendBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
});
