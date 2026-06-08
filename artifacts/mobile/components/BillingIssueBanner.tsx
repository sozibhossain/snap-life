/**
 * BillingIssueBanner — payment-failed grace-window dashboard banner.
 *
 * Shown when the server reports an open billing-issue grace window
 * (`billingIssue` non-null on /api/subscription/me). The user keeps
 * full access during the window; the banner asks them to update their
 * payment method via the native subscription management page before
 * the grace period expires.
 *
 * Behaviour:
 *   - Self-renders nothing when there's no open billing issue.
 *   - Tap routes the user to the native subscription management page
 *     via the shared `openManageSubscription` helper (App Store /
 *     Play Store deep link, RC `managementURL` when available).
 *   - No dismiss control: the banner is high-priority and disappears
 *     on its own once payment recovers (RC RENEWAL clears the flag)
 *     or the grace window elapses.
 */

import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { openManageSubscription } from "@/lib/manageSubscription";
import { useSubscription } from "@/lib/revenuecat";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysRemaining(graceEndsAtIso: string): number {
  const end = new Date(graceEndsAtIso).getTime();
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.ceil((end - Date.now()) / DAY_MS));
}

export function BillingIssueBanner() {
  const colors = useColors();
  const { billingIssue, customerInfo, entitlement, tierLabel, tier } =
    useSubscription();
  // Plus users see "Plus access", Premium/trial users see "Premium access".
  const accessLabel =
    tier === "plus" ? "Plus access" : tier === "trial" ? "trial access" : "Premium access";
  void tierLabel;

  // PWA: in-app purchase flow doesn't run on web yet, so don't push the
  // user toward a deep link they can't action. We keep the warning
  // visible (so they know access is at risk) but skip the CTA chevron.
  const isWeb = Platform.OS === "web";

  if (!billingIssue) return null;

  const remaining = daysRemaining(billingIssue.gracePeriodEndsAt);

  function handlePress() {
    if (isWeb) return;
    openManageSubscription({
      managementUrl: customerInfo?.managementURL,
      purchaseStore: entitlement?.store,
    });
  }

  // Use the destructive accent (red) so this reads as urgent but stays
  // within the design system. Falls back to the regular accent if the
  // destructive token isn't on the colors palette.
  const accent =
    (colors as unknown as { destructive?: string }).destructive ?? colors.accent;

  const Container = isWeb ? View : Pressable;
  const containerProps = isWeb
    ? {}
    : ({
        onPress: handlePress,
        accessibilityRole: "button" as const,
        accessibilityLabel:
          "Payment failed. Update your payment method to keep Premium.",
      } as const);

  return (
    <Container
      {...(containerProps as object)}
      style={[
        styles.card,
        {
          backgroundColor: accent + "12",
          borderColor: accent + "55",
        },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: accent + "22" }]}>
        <Feather name="alert-triangle" size={18} color={accent} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          We couldn{"\u2019"}t process your last payment
        </Text>
        <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
          {remaining > 0
            ? `Update your payment method in the next ${remaining} ${
                remaining === 1 ? "day" : "days"
              } to keep your ${accessLabel}.`
            : `Update your payment method now to keep your ${accessLabel}.`}
        </Text>
        {!isWeb && (
          <View style={styles.ctaRow}>
            <Text style={[styles.ctaText, { color: accent }]}>
              Update payment method
            </Text>
            <Feather name="chevron-right" size={14} color={accent} />
          </View>
        )}
      </View>
    </Container>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, gap: 4 },
  title: { fontSize: 14, fontFamily: "Inter_700Bold" },
  bodyText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  ctaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  ctaText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
