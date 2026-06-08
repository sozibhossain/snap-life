/**
 * Static Privacy Policy screen — multi-jurisdiction.
 *
 * Linked from the "Privacy & Data" settings screen and the onboarding
 * footer so App Store / Google Play / GDPR / CCPA / LGPD / PIPEDA
 * review processes can verify the policy is reachable from inside the
 * product (not only the marketing site).
 *
 * Coverage:
 *   - EU GDPR  (Regulation 2016/679)
 *   - UK GDPR + Data Protection Act 2018
 *   - California CCPA / CPRA
 *   - Brazil LGPD (Lei Geral de Proteção de Dados)
 *   - Canada PIPEDA
 *   - Australia Privacy Act 1988 (APPs)
 *   - Children: COPPA (US, under 13) + GDPR Art. 8 (under 16)
 *
 * Plain-language summary; full legal text lives on the marketing site
 * and is referenced at the bottom of the screen.
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
    title: "1. What we collect",
    body:
      "Account identity (email + display name via Clerk), the health data you log in-app (meals, activity, supplements, wellbeing entries, DEXA results), gamification state, support feedback, and basic device/usage telemetry. We do not collect contacts, microphone audio, or precise GPS.",
  },
  {
    title: "2. Why we collect it (lawful bases)",
    body:
      "We process your data to (a) deliver the contracted product (GDPR Art. 6(1)(b) / UK GDPR equivalent), (b) meet our legitimate interests in keeping the product safe and improving it (Art. 6(1)(f)), and (c) where required, on the basis of your explicit consent for special-category health data (Art. 9(2)(a)). California, Brazil, Canada, and Australia equivalents are recognised under the same processing purposes.",
  },
  {
    title: "3. Where it lives + cross-border transfers",
    body:
      "Application data lives in our managed Postgres database hosted on Replit (United States). Authentication is handled by Clerk (United States). Subscription entitlements run through RevenueCat (United States). AI conversations are processed by OpenAI under their enterprise data terms; transcripts are stored in our database, not used by OpenAI to train models. For users in the EEA, UK, Switzerland, or Brazil, transfers to the United States rely on Standard Contractual Clauses (SCCs) and the EU-U.S. Data Privacy Framework where applicable.",
  },
  {
    title: "4. Your rights — global summary",
    body:
      "Wherever you live, you can: access your data (export), correct it, delete it, restrict or object to processing, port it to another service, and lodge a complaint with a supervisory authority. EU/UK users contact your national DPA. California users invoke CCPA/CPRA rights including the right to know, delete, correct, and limit use of sensitive personal information. Brazil users invoke LGPD Art. 18 rights via the ANPD. Canadians may complain to the Office of the Privacy Commissioner; Australians to the OAIC.",
  },
  {
    title: "5. How to exercise those rights",
    body:
      "Settings → Privacy & Data → Export My Data downloads a JSON archive with every row tied to your account. Delete My Account immediately redacts personally identifiable text and starts a 30-day soft-delete window before permanent erasure. You can also email privacy@snaplife.app for any request; we identity-verify via your registered email and respond within 30 days (45 days CCPA, 15 days LGPD).",
  },
  {
    title: "6. Do Not Sell or Share / Sensitive Personal Information (CCPA/CPRA)",
    body:
      "We do not sell your personal information and we do not share it for cross-context behavioural advertising. We treat health data you log as Sensitive Personal Information under CPRA and use it only to provide the service you requested. California residents can confirm or change this preference any time at privacy@snaplife.app — no sign-in required.",
  },
  {
    title: "7. Retention",
    body:
      "Active accounts: data is kept for as long as the account exists, plus the duration required by tax/financial regulations for billing records (typically 7 years). After deletion: a 30-day soft-delete window during which you can email support to recover, then a hard purge by our scheduled worker. Server logs are kept for 14 days. Backups roll off within 35 days.",
  },
  {
    title: "8. Security",
    body:
      "All traffic is HTTPS-only with HSTS. Backend services apply CSP, X-Frame-Options, and other browser hardening headers. Per-user rate limits protect chat and event endpoints. Production data access follows least-privilege; engineers cannot read individual users' health data without a logged break-glass procedure. We notify affected users and the relevant supervisory authority within 72 hours of becoming aware of a personal-data breach (GDPR Art. 33–34, equivalent global obligations).",
  },
  {
    title: "9. Children",
    body:
      "SNAP Life is not directed at users under 16 (EEA/UK) or under 13 (United States, COPPA). We do not knowingly collect data from children. If you believe a child has signed up, email privacy@snaplife.app and we will delete the account and any associated data immediately.",
  },
  {
    title: "10. Automated decisions",
    body:
      "Bone Buddy is an AI assistant providing general bone-health guidance. It does not make decisions that produce legal or similarly significant effects on you (GDPR Art. 22). Always consult a qualified clinician before changing medical treatment.",
  },
  {
    title: "11. Contact + supervisory authorities",
    body:
      "Controller: SNAP Life — privacy@snaplife.app. EU representative + UK representative details and the address of our Data Protection Officer are published at snaplife.app/privacy. You always retain the right to complain to your local supervisory authority (ICO in the UK, your national DPA in the EEA, the California Privacy Protection Agency in California, the ANPD in Brazil, the OPC in Canada, the OAIC in Australia).",
  },
];

export default function PrivacyPolicyScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 16 : insets.top;

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
          Privacy Policy
        </Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          Last updated: May 2026. This policy describes how SNAP Life
          handles personal data under the EU GDPR, UK GDPR, California
          CCPA/CPRA, Brazil LGPD, Canada PIPEDA, and the Australian
          Privacy Act. The full legal text is at snaplife.app/privacy;
          this screen is the plain-language summary you can verify
          in-app.
        </Text>
        {SECTIONS.map((s) => (
          <Card key={s.title} style={styles.card}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              {s.title}
            </Text>
            <Text
              style={[
                styles.cardBody,
                { color: colors.mutedForeground },
              ]}
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
  headerTitle: { fontSize: 17, fontWeight: "600" },
  scroll: { padding: 16, paddingBottom: 40, gap: 12 },
  intro: { fontSize: 13, lineHeight: 19, marginBottom: 4 },
  card: { padding: 16, gap: 6 },
  cardTitle: { fontSize: 15, fontWeight: "600" },
  cardBody: { fontSize: 13, lineHeight: 19 },
});
