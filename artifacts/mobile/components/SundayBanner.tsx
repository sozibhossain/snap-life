/**
 * SundayBanner — a calm, one-tap entry-point to the Weekly SNAP Shot.
 *
 * Renders only on Sunday and Monday (one-day grace). Tapping it routes
 * to `/snap-shot`. If the user has already claimed the bonus for the
 * current ISO week we soften the tone ("Look back at your week").
 */

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useGamification } from "@/context/GamificationContext";
import { useColors } from "@/hooks/useColors";
import { logInteractionEvent } from "@/lib/events";
import { isWeeklySnapWindow, isoYearWeek } from "@/lib/weeklySnap";

export function SundayBanner() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const { isWeeklyBonusClaimed } = useGamification();

  const [claimed, setClaimed] = useState<boolean | null>(null);
  const inWindow = isWeeklySnapWindow();
  const week = isoYearWeek();

  useEffect(() => {
    let cancelled = false;
    if (!inWindow) {
      setClaimed(null);
      return;
    }
    void (async () => {
      const v = await isWeeklyBonusClaimed(week);
      if (!cancelled) setClaimed(v);
    })();
    return () => {
      cancelled = true;
    };
  }, [inWindow, week, user?.id, isWeeklyBonusClaimed]);

  // rec_shown — once per (user, ISO week) per app session. The banner
  // re-renders on every dashboard update, so we debounce via a ref.
  // surface = "sunday_banner" so we can distinguish a banner impression
  // from the snap-shot screen impression (which uses "weekly_snap").
  const shownKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!inWindow || !user?.id) return;
    const key = `${user.id}:${week}`;
    if (shownKeyRef.current === key) return;
    shownKeyRef.current = key;
    logInteractionEvent({
      appUserId: user.id,
      kind: "rec_shown",
      payload: {
        surface: "sunday_banner",
        recId: `sunday_banner:${week}`,
        recKind: "weekly_snap",
      },
    });
  }, [inWindow, week, user?.id]);

  if (!inWindow) return null;

  const heading = claimed
    ? "Look back at your week"
    : "Your weekly SNAP Shot is ready";
  const sub = claimed
    ? "Quietly notice what shifted — no pressure to do more."
    : "A calm two-minute look at how the week went.";

  return (
    <Pressable
      onPress={() => router.push("/snap-shot")}
      style={[
        styles.banner,
        {
          backgroundColor: colors.accent + "15",
          borderColor: colors.accent + "40",
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${heading}. ${sub}`}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.accent + "26" }]}>
        <Feather name="bar-chart-2" size={20} color={colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: colors.foreground }]}>{heading}</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>{sub}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 14, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
