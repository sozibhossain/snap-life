/**
 * NervousSystemPill — compact, intelligent dashboard signal that reads
 * the user's calm-studio activity & mood and surfaces a single clear
 * line plus a recommended session CTA.
 *
 * Displays one of three states:
 *   • Calm      — user has shown up and felt better
 *   • Balanced  — quiet day or mixed moods
 *   • Stressed  — long gap or run of "still tense"
 *
 * Subtle fade-in cross-transition when the state changes (mood logged,
 * session completed) so the change is felt without being attention-
 * grabbing. Tapping the pill routes to the recommended breathing or
 * meditation session.
 */

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";

import { useWellbeing } from "@/context/WellbeingContext";
import { useColors } from "@/hooks/useColors";
import { deriveNervousSystem, type NervousSystemState } from "@/lib/nervousSystem";

const HEADLINE: Record<NervousSystemState, string> = {
  calm: "You're feeling calm today",
  balanced: "You're balanced today",
  stressed: "You're a bit stressed today",
};

export function NervousSystemPill() {
  const colors = useColors();
  const router = useRouter();
  const { entries } = useWellbeing();

  const readout = useMemo(() => {
    const sessionEntries = entries.map((e) => ({
      kind: e.kind,
      mood: e.mood,
      completedAt: e.completedAt,
    }));
    return deriveNervousSystem({ entries: sessionEntries });
  }, [entries]);

  // Choose a calm tint per state — not loud or alarming, especially for
  // "stressed" which uses a warm orange (the app's accent), never red.
  const accent =
    readout.state === "calm"
      ? colors.success
      : readout.state === "balanced"
        ? colors.primary
        : colors.accent;
  const icon =
    readout.state === "calm"
      ? "feather"
      : readout.state === "balanced"
        ? "activity"
        : "wind";

  // Subtle opacity fade whenever the state token changes — lets the pill
  // visibly acknowledge a fresh mood log or completed session without
  // shouting about it.
  const fade = useRef(new Animated.Value(1)).current;
  const lastStateRef = useRef<NervousSystemState>(readout.state);
  useEffect(() => {
    if (lastStateRef.current === readout.state) return;
    lastStateRef.current = readout.state;
    fade.setValue(0.4);
    Animated.timing(fade, {
      toValue: 1,
      duration: 360,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [readout.state, fade]);

  const route =
    readout.recommendation.surface === "breathing"
      ? "/breathing-studio"
      : `/meditation?session=${encodeURIComponent(readout.recommendation.sessionHint)}`;

  return (
    <Animated.View style={{ opacity: fade }}>
      <Pressable
        onPress={() => router.push(route as never)}
        style={[
          styles.pill,
          { backgroundColor: accent + "10", borderColor: accent + "40" },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${HEADLINE[readout.state]}. ${readout.reason}`}
      >
        <View style={[styles.icon, { backgroundColor: accent + "22" }]}>
          <Feather name={icon as never} size={14} color={accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headline, { color: colors.foreground }]}>
            {HEADLINE[readout.state]}
          </Text>
          <Text
            style={[styles.reason, { color: colors.mutedForeground }]}
            numberOfLines={2}
          >
            {readout.reason}
          </Text>
        </View>
        <View style={[styles.cta, { backgroundColor: accent + "22" }]}>
          <Text style={[styles.ctaText, { color: accent }]} numberOfLines={1}>
            {readout.recommendation.surface === "breathing" ? "Breathe" : "Meditate"}
          </Text>
          <Feather name="chevron-right" size={12} color={accent} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  headline: { fontSize: 13, fontFamily: "Inter_700Bold" },
  reason: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1, lineHeight: 15 },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
  },
  ctaText: { fontSize: 11, fontFamily: "Inter_700Bold" },
});
