/**
 * TrialEndedBanner — one-time post-trial-ended dashboard banner.
 *
 * Shown when:
 *   - The user's 30-day server-managed Premium trial ended within the
 *     last 7 days (the server returns a non-null `trialEndedAt`), AND
 *   - The user is currently on the free tier (no paid entitlement and
 *     no fresh store-side trial). The server already encodes both of
 *     these conditions in `trialEndedAt`, so we just check the field.
 *
 * Behaviour:
 *   - One-time per trial cycle: dismissals are keyed by user id +
 *     trialEndedAt so a different ended-trial timestamp re-shows the
 *     banner. (In normal use, the banner is shown for at most 7 days
 *     anyway, after which the server stops returning `trialEndedAt`.)
 *   - Tap opens /subscription so the user can pick a plan to continue.
 *   - The small × dismisses without opening the paywall.
 */

import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useSubscription } from "@/lib/revenuecat";

function dismissalKey(userId: string, cycleId: string) {
  return `snap_trial_ended_seen:${userId}:${cycleId}`;
}

export function TrialEndedBanner() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const { trialEndedAt } = useSubscription();

  const [dismissed, setDismissed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!trialEndedAt || !user?.id) {
        if (!cancelled) {
          setDismissed(false);
          setHydrated(true);
        }
        return;
      }
      try {
        const v = await AsyncStorage.getItem(dismissalKey(user.id, trialEndedAt));
        if (!cancelled) {
          setDismissed(v === "1");
          setHydrated(true);
        }
      } catch {
        if (!cancelled) {
          setDismissed(false);
          setHydrated(true);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [trialEndedAt, user?.id]);

  if (!trialEndedAt || !hydrated || dismissed) return null;

  // Use the orange accent so the banner reads as "needs attention" without
  // mimicking a destructive/error state.
  const accent = colors.accent;

  async function dismiss() {
    if (!user?.id || !trialEndedAt) return;
    try {
      await AsyncStorage.setItem(dismissalKey(user.id, trialEndedAt), "1");
    } catch {
      // Storage write failed — still dismiss for the rest of this session.
    }
    setDismissed(true);
  }

  function openPaywall() {
    router.push("/subscription");
  }

  return (
    <Pressable
      onPress={openPaywall}
      style={[
        styles.card,
        {
          backgroundColor: accent + "12",
          borderColor: accent + "55",
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel="Your free trial has ended. Pick a plan to continue."
    >
      <View style={[styles.iconWrap, { backgroundColor: accent + "22" }]}>
        <Feather name="clock" size={18} color={accent} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Your free trial has ended
        </Text>
        <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
          Pick a plan to continue with full Premium access — flexible plans, cancel anytime.
        </Text>
        <View style={styles.ctaRow}>
          <Text style={[styles.ctaText, { color: accent }]}>Choose your plan</Text>
          <Feather name="chevron-right" size={14} color={accent} />
        </View>
      </View>
      <Pressable
        onPress={dismiss}
        hitSlop={10}
        style={[styles.closeBtn, { backgroundColor: colors.muted }]}
        accessibilityLabel="Dismiss banner"
      >
        <Feather name="x" size={12} color={colors.mutedForeground} />
      </Pressable>
    </Pressable>
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
  closeBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
});
