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
  { category: "Getting started", q: "Where should I begin?", a: "Complete your profile, then use Today for your daily focus. Health is where you record activity, nutrition, supplements, DEXA and FRAX. Learn offers guided lessons at your own pace." },
  { category: "Bone Buddy", q: "How does Bone Buddy use my information?", a: "Bone Buddy uses relevant information already saved in your SNAP account to answer your question in context. It identifies missing information instead of guessing. It is a companion, not a clinician, and cannot diagnose or change treatment." },
  { category: "Learning", q: "How do lessons and pathways work?", a: "Open Learn, choose an available lesson and complete its sections and action. Progress and XP are calculated from the currently published lesson catalogue, so new pathways can be added without changing your earlier completions." },
  { category: "Tracking", q: "How do I log or correct a DEXA scan?", a: "Go to Health, choose DEXA Scans, then Log DEXA Scan. Enter the lumbar-spine and/or total-hip T-score exactly as shown on your report. Height can be cm or ft/in, weight can be kg or lb, and BMI is calculated automatically. Use Edit or Delete on a saved record to correct it." },
  { category: "Tracking", q: "What is FRAX in SNAP Life?", a: "FRAX records a 10-year major osteoporotic fracture probability and hip fracture probability. The in-app calculator is an estimate and not a clinical diagnosis. Saved results can be edited, recalculated or deleted from Health." },
  { category: "Insights", q: "What does My Bone Journey show?", a: "Premium Insights plots your recorded lumbar-spine and total-hip DEXA values separately, and your major and hip FRAX values separately. Tap a point for its exact date and value. Missing dates are never estimated, and change wording is numerical rather than clinical." },
  { category: "Wellness", q: "How do breathing and meditation sessions work?", a: "Choose a breathing or meditation session in Wellness, follow the paced guidance, then record how you feel. Completed sessions contribute to your wellbeing history, calm streak and relevant achievements." },
  { category: "Community", q: "How do Progress, achievements and XP update?", a: "Progress is reconciled from your saved DEXA records, activity streaks and steps, calcium logs, meal-plan use, wellbeing sessions and Bone Buddy messages. An achievement or recurring challenge awards XP only once for its eligible period." },
  { category: "Coaching & experts", q: "How do coaching and Expert Support bookings work?", a: "Free consultations submit a request for confirmation. Paid coaching continues to a secure browser checkout; SNAP Life does not store card details. Expert Support shares only the contact, service and message fields shown before consent—no SNAP health data is shared automatically." },
  { category: "Subscriptions", q: "How do I subscribe or restore a purchase?", a: "Open Subscription from your profile to view plans. Purchases use Apple or Google billing on mobile. If you reinstall or change device, sign into the same account and choose Restore Purchases." },
  { category: "Notifications", q: "How do I control reminders?", a: "Open Profile, Settings, then Notifications. You can enable or disable daily Bone Buddy nudges and other available reminders. Device notification permission must also be enabled." },
  { category: "Privacy", q: "How do I export or delete my data?", a: "Open Profile, Settings, Privacy. You can review consent controls, request a data export, reset testing data, or delete your account. Account data is redacted immediately and scheduled for permanent deletion after the stated grace period; contact support within that period if you need help reversing the request." },
  { category: "Support", q: "What should I send when reporting a problem?", a: "Describe what you expected, what happened, the screen you were on and whether retrying helped. Do not include passwords, card details or information you do not want included in the support record." },
];

const GUIDE_LINKS = [
  { label: "Health tracking", icon: "activity" as const, route: "/(tabs)/health" },
  { label: "Learning", icon: "book-open" as const, route: "/(tabs)/learn" },
  { label: "Bone Buddy", icon: "message-circle" as const, route: "/(tabs)/coach" },
  { label: "Privacy controls", icon: "shield" as const, route: "/settings/privacy" },
];

export default function HelpScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const query = search.trim().toLowerCase();
  const visibleFaqs = query
    ? FAQS.filter((faq) => `${faq.category} ${faq.q} ${faq.a}`.toLowerCase().includes(query))
    : FAQS;

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
        <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Guides</Text>
        <View style={styles.guideGrid}>
          {GUIDE_LINKS.map((guide) => (
            <Pressable
              key={guide.label}
              onPress={() => router.push(guide.route as never)}
              style={[styles.guideCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Feather name={guide.icon} size={18} color={colors.primary} />
              <Text style={[styles.guideLabel, { color: colors.foreground }]}>{guide.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Frequently Asked Questions</Text>
        <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search help topics"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
          />
        </View>
        <Card variant="outlined">
          {visibleFaqs.map((faq, i) => (
            <Pressable
              key={faq.q}
              style={[styles.faqRow, i < visibleFaqs.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
              onPress={() => setExpanded(expanded === faq.q ? null : faq.q)}
            >
              <Text style={[styles.category, { color: colors.primary }]}>{faq.category}</Text>
              <View style={styles.faqHeader}>
                <Text style={[styles.faqQuestion, { color: colors.foreground, flex: 1 }]}>
                  {faq.q}
                </Text>
                <Feather
                  name={expanded === faq.q ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={colors.mutedForeground}
                />
              </View>
              {expanded === faq.q && (
                <Text style={[styles.faqAnswer, { color: colors.mutedForeground }]}>
                  {faq.a}
                </Text>
              )}
            </Pressable>
          ))}
          {visibleFaqs.length === 0 && <Text style={[styles.noResults, { color: colors.mutedForeground }]}>No matching help topic. Send us a message below.</Text>}
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
          <Pressable
            disabled={!message.trim()}
            onPress={() => router.push({ pathname: "/feedback", params: { type: "general", message: message.trim() } } as never)}
            style={[styles.sendBtn, { backgroundColor: colors.primary, opacity: message.trim() ? 1 : 0.5 }]}
          >
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
  guideGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  guideCard: { width: "48%", minHeight: 78, borderWidth: 1, borderRadius: 12, padding: 12, justifyContent: "center", gap: 8 },
  guideLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  searchBox: { height: 46, borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  faqRow: { padding: 14, gap: 8 },
  category: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.7, textTransform: "uppercase" },
  faqHeader: { flexDirection: "row", alignItems: "center" },
  faqQuestion: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  faqAnswer: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  noResults: { padding: 16, textAlign: "center", fontSize: 13, fontFamily: "Inter_400Regular" },
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
