/**
 * TrialPromptCard — server-cascaded nudges shown on the dashboard during
 * the 30-day SNAP Premium free trial.
 *
 * Three variants (priority: endOfTrial > payment > midTrialEncouragement —
 * later in the trial wins, see `useSubscription` for the cascade math):
 *
 *   - "midTrialEncouragement" (Day 14)
 *       Calm, supportive: "You've been consistent — great progress so far."
 *       No CTA pressure; tap still opens /subscription so the user can
 *       upgrade if they want, but the messaging stays celebratory.
 *
 *   - "payment" (Day 15..21)
 *       Practical: "To ensure uninterrupted access after your trial ends,
 *       please add your payment details." Surfaces the paywall so the
 *       user can choose a plan well before the deadline.
 *
 *   - "endOfTrial" (Day 25..28)
 *       Stronger styling, urgent without being alarmist: "Your trial is
 *       ending soon — choose how you continue your journey."
 *
 * Behaviour:
 *   - Self-renders nothing if the user is not on a trial, or no variant
 *     matches the current day-of, or the user has dismissed this variant
 *     for the current trial cycle.
 *   - Dismissals are stored in AsyncStorage keyed by user id + variant +
 *     trial-cycle-end so a re-trial wouldn't permanently silence the prompt.
 *   - Tapping the body opens `/subscription`; the small × dismisses.
 */

import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useSubscription } from "@/lib/revenuecat";

type Variant = "midTrialEncouragement" | "payment" | "endOfTrial";

interface VariantCopy {
  title: string;
  body: string;
  cta: string;
  iconName: string;
  /** "primary" → calm; "accent" → urgent. */
  tone: "primary" | "accent";
}

const VARIANT_COPY: Record<Variant, VariantCopy> = {
  midTrialEncouragement: {
    title: "You've been consistent — great progress so far",
    body: "Halfway through your trial. Keep the momentum and explore everything Premium unlocks for you.",
    cta: "Explore your plan",
    iconName: "award",
    tone: "primary",
  },
  payment: {
    title: "Add your payment details",
    body: "To ensure uninterrupted access after your trial ends, please add your payment details.",
    cta: "Add payment details",
    iconName: "credit-card",
    tone: "primary",
  },
  endOfTrial: {
    title: "Your trial is ending soon",
    body: "Choose how you continue your journey — flexible plans, cancel anytime.",
    cta: "Choose your plan",
    iconName: "alert-circle",
    tone: "accent",
  },
};

function dismissalKey(userId: string, variant: Variant, cycleId?: string | null) {
  // Bind dismissal to the specific trial cycle (its end date). A new trial
  // (different end date) re-shows the prompt.
  const cycle = cycleId ?? "no-cycle";
  return `snap_trial_prompt_seen:${userId}:${variant}:${cycle}`;
}

export function TrialPromptCard() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const {
    isOnTrial,
    trialDayLabel,
    trialPromptVariant,
    trialEndsAt,
  } = useSubscription();

  const variant: Variant | null = trialPromptVariant;

  const [dismissed, setDismissed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate dismissal state from storage whenever the active variant changes.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!variant || !user?.id) {
        if (!cancelled) {
          setDismissed(false);
          setHydrated(true);
        }
        return;
      }
      try {
        const key = dismissalKey(user.id, variant, trialEndsAt);
        const v = await AsyncStorage.getItem(key);
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
  }, [variant, user?.id, trialEndsAt]);

  if (!isOnTrial || !variant || !hydrated || dismissed) return null;

  const copy = VARIANT_COPY[variant];
  const accent = copy.tone === "accent" ? colors.accent : colors.primary;

  async function dismiss() {
    if (!user?.id || !variant) return;
    try {
      const key = dismissalKey(user.id, variant, trialEndsAt);
      await AsyncStorage.setItem(key, "1");
    } catch {
      // Even if storage fails, hide it for the rest of this session.
    }
    setDismissed(true);
  }

  function openPaywall() {
    router.push("/subscription");
  }

  const dayLabel = trialDayLabel ?? "Free trial";

  return (
    <Pressable
      onPress={openPaywall}
      style={[
        styles.card,
        {
          backgroundColor: accent + "10",
          borderColor: accent + "55",
        },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: accent + "22" }]}>
        <Feather name={copy.iconName as any} size={18} color={accent} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.foreground }]}>{copy.title}</Text>
          <View style={[styles.dayPill, { backgroundColor: accent + "22" }]}>
            <Text style={[styles.dayPillText, { color: accent }]}>{dayLabel}</Text>
          </View>
        </View>
        <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>{copy.body}</Text>
        <View style={styles.ctaRow}>
          <Text style={[styles.ctaText, { color: accent }]}>{copy.cta}</Text>
          <Feather name="chevron-right" size={14} color={accent} />
        </View>
      </View>
      <Pressable
        onPress={dismiss}
        hitSlop={10}
        style={[styles.closeBtn, { backgroundColor: colors.muted }]}
        accessibilityLabel="Dismiss prompt"
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
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  title: { fontSize: 14, fontFamily: "Inter_700Bold", flexShrink: 1 },
  dayPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  dayPillText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
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
