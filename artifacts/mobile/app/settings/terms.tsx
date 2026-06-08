/**
 * Static Terms of Service screen. Mirrors the structure of the Privacy
 * screen so the two read as a coherent pair from the settings menu and
 * the onboarding footer.
 *
 * The copy is deliberately concise + plain-language — full legal text
 * lives on the marketing site and a "View full terms" link routes
 * users there once that exists. For now we ship the key headings the
 * App Store + Google Play review processes look for.
 */

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/ui/Card";
import { useColors } from "@/hooks/useColors";

const SECTIONS: Array<{ title: string; body: string }> = [
  {
    title: "1. Service",
    body:
      "SNAP Life is a self-care companion for bone health. The app provides tracking, education and AI-coached nudges. It is not a medical device and does not diagnose, treat, or cure any condition.",
  },
  {
    title: "2. Your account",
    body:
      "You are responsible for the credentials you use to sign in (Clerk handles authentication on our behalf). Keep your device secure; you can revoke a session at any time from the Profile tab.",
  },
  {
    title: "3. Subscriptions",
    body:
      "Premium and Plus tiers renew automatically through the App Store, Google Play or your web billing provider. You can cancel anytime from your store account; access continues until the end of the paid period. Trials convert to a paid subscription unless you cancel beforehand.",
  },
  {
    title: "4. AI guidance",
    body:
      "Bone Buddy is an AI assistant trained on general bone-health information. Always consult a qualified clinician before changing your medical treatment. We log conversations to improve the assistant; you can request export or deletion of every message at any time.",
  },
  {
    title: "5. Acceptable use",
    body:
      "Don't reverse-engineer the app, abuse the rate limits, attempt to access another user's data, or use the platform to harass other community members. We may suspend accounts that breach these rules.",
  },
  {
    title: "6. Termination",
    body:
      "You can delete your account anytime from Profile → Privacy & Data. Your data is retained for a 30-day grace window during which you can email support to recover the account, then permanently removed.",
  },
  {
    title: "7. Liability",
    body:
      "To the maximum extent permitted by law, SNAP Life is provided as-is. We are not liable for indirect or consequential damages arising from use of the app.",
  },
  {
    title: "8. Changes",
    body:
      "We'll notify you in-app at least 14 days before any material change to these terms. Continued use after that date confirms acceptance.",
  },
];

export default function TermsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 8, borderBottomColor: colors.border },
        ]}
      >
        <Pressable onPress={() => router.back()} accessibilityLabel="Back">
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Terms of Service
        </Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <Card variant="outlined" style={styles.intro}>
          <Text style={[styles.introTitle, { color: colors.foreground }]}>
            SNAP Life Terms of Service
          </Text>
          <Text style={[styles.introMeta, { color: colors.mutedForeground }]}>
            Last updated 1 May 2026
          </Text>
        </Card>

        {SECTIONS.map((s) => (
          <Card key={s.title} variant="outlined" style={styles.sectionCard}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              {s.title}
            </Text>
            <Text
              style={[styles.sectionBody, { color: colors.mutedForeground }]}
            >
              {s.body}
            </Text>
          </Card>
        ))}
      </ScrollView>
    </View>
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
  },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  content: { padding: 16, gap: 12 },
  intro: { padding: 16, gap: 4 },
  introTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  introMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  sectionCard: { padding: 14, gap: 6 },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  sectionBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
});
