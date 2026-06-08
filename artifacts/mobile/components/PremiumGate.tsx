/**
 * PremiumGate — wrap any Premium-only sub-feature.
 *
 * Renders `children` for users who hold a Premium-tier entitlement (paid
 * Premium OR active free trial). For Plus / Free users, renders a soft
 * lock card with the spec's upgrade copy and a CTA to `/subscription`.
 *
 * Usage:
 *   <PremiumGate feature="Bone Health Tracking">
 *     <BoneHealthTrackingPanel />
 *   </PremiumGate>
 *
 * Design intent (per spec):
 *   - "No forced upgrade" — gates are informational, not blocking.
 *   - "Reinforce flexibility" — copy reads "Cancel anytime" near the CTA.
 *   - Single canonical message: "Unlock your full personalised experience
 *     with Premium"
 */

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useSubscription } from "@/lib/revenuecat";

interface PremiumGateProps {
  /** Short feature label shown in the lock chip (e.g. "Bone Health Tracking"). */
  feature?: string;
  /** Custom secondary line (defaults to the spec copy). */
  description?: string;
  /** Children rendered only when the user has Premium-equivalent access. */
  children?: React.ReactNode;
}

export function PremiumGate({ feature, description, children }: PremiumGateProps) {
  const colors = useColors();
  const router = useRouter();
  const { hasPremiumOrTrial, billingIssue } = useSubscription();
  const isWeb = Platform.OS === "web";

  // During an open billing-issue grace window we keep granting access
  // (the server keeps `isActive=true` until `gracePeriodEndsAt`). We
  // still render an inline soft notice above the unlocked children so
  // the user understands their access is at risk on every gated
  // surface — not just the dashboard banner.
  if (hasPremiumOrTrial) {
    if (billingIssue) {
      return (
        <>
          <View
            style={[
              styles.graceNotice,
              {
                backgroundColor:
                  ((colors as unknown as { destructive?: string }).destructive ??
                    colors.accent) + "10",
                borderColor:
                  ((colors as unknown as { destructive?: string }).destructive ??
                    colors.accent) + "44",
              },
            ]}
          >
            <Feather
              name="alert-triangle"
              size={13}
              color={
                (colors as unknown as { destructive?: string }).destructive ??
                colors.accent
              }
            />
            <Text
              style={[
                styles.graceNoticeText,
                { color: colors.foreground },
              ]}
            >
              Payment issue — update your payment method to keep this
              feature past your grace period.
            </Text>
          </View>
          {children}
        </>
      );
    }
    return <>{children}</>;
  }

  // On the PWA the in-app purchase flow doesn't run (Web Billing is out of
  // scope for this milestone). Show the same lock card but route the CTA
  // to a friendly cross-promo for the native apps instead of the paywall.
  const Container = isWeb ? View : Pressable;
  const containerProps = isWeb
    ? {}
    : ({ onPress: () => router.push("/subscription") } as const);

  return (
    <Container
      {...(containerProps as object)}
      style={[
        styles.card,
        { backgroundColor: colors.accent + "0E", borderColor: colors.accent + "55" },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.accent + "22" }]}>
        <Feather name="lock" size={18} color={colors.accent} />
      </View>
      <View style={styles.body}>
        {feature && (
          <View style={[styles.chip, { backgroundColor: colors.accent + "20" }]}>
            <Text style={[styles.chipText, { color: colors.accent }]}>
              {feature.toUpperCase()}
            </Text>
          </View>
        )}
        <Text style={[styles.title, { color: colors.foreground }]}>
          {isWeb
            ? "Premium features live in the SNAP Life mobile app"
            : "Unlock your full personalised experience with Premium"}
        </Text>
        {isWeb ? (
          <Text style={[styles.body2, { color: colors.mutedForeground }]}>
            Open SNAP Life on iOS or Android to start a Premium trial — your
            account and progress will sync automatically.
          </Text>
        ) : description ? (
          <Text style={[styles.body2, { color: colors.mutedForeground }]}>{description}</Text>
        ) : null}
        {isWeb ? null : (
          <View style={styles.ctaRow}>
            <Text style={[styles.ctaText, { color: colors.accent }]}>See plans</Text>
            <Feather name="chevron-right" size={14} color={colors.accent} />
            <Text style={[styles.cancelNote, { color: colors.mutedForeground }]}>
              · Cancel anytime
            </Text>
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
  body: { flex: 1, gap: 6 },
  chip: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  chipText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  title: { fontSize: 14, fontFamily: "Inter_700Bold", lineHeight: 19 },
  body2: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  ctaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
    flexWrap: "wrap",
  },
  ctaText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  cancelNote: { fontSize: 11, fontFamily: "Inter_400Regular" },
  graceNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10,
  },
  graceNoticeText: {
    flex: 1,
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    lineHeight: 15,
  },
});
