/**
 * QualitativeProgressStrip — the "what's quietly going right" line(s)
 * that appear above the Bone Density Overview card on the Health Hub.
 *
 * Pulls the same engine the dashboard uses, but renders only the top
 * 2-3 short, qualitative observations as inline prose (not cards). The
 * goal is to balance the otherwise number-heavy Health Hub with a
 * gentle reminder that progress also lives in habits, mood and
 * consistency — not just T-scores.
 */

import { Feather } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/ui/Card";
import { useAuth } from "@/context/AuthContext";
import { useHealth } from "@/context/HealthContext";
import { useNutrition } from "@/context/NutritionContext";
import { useWellbeing } from "@/context/WellbeingContext";
import { useColors } from "@/hooks/useColors";
import { generateRankedInsights } from "@/lib/insights";
import { deriveNervousSystem } from "@/lib/nervousSystem";

export function QualitativeProgressStrip() {
  const colors = useColors();
  const { user } = useAuth();
  const { dexaScans, todayNutrition, getFracturRisk, nutritionLogs } = useHealth();
  const { targets } = useNutrition();
  const { entries, currentStreak, weekCount, todayScore } = useWellbeing();

  const firstName = useMemo(
    () => (user?.name ?? "").trim().split(/\s+/)[0] || undefined,
    [user?.name],
  );

  const lines = useMemo(() => {
    const ns = deriveNervousSystem({
      entries: entries.map((e) => ({
        kind: e.kind,
        mood: e.mood,
        completedAt: e.completedAt,
      })),
    });
    const lastEntry = entries[0];
    const tScore = dexaScans[0]?.tScore ?? null;
    const usageDays = (() => {
      if (!user?.joinedAt) return undefined;
      const t = Date.parse(user.joinedAt);
      if (Number.isNaN(t)) return undefined;
      return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
    })();

    const target = targets?.calcium ?? 0;
    const cutoff = Date.now() - 7 * 86_400_000;
    let daysOnTarget = 0;
    if (target > 0) {
      const perDay = new Map<string, number>();
      for (const n of nutritionLogs) {
        const t = Date.parse(n.date);
        if (Number.isNaN(t) || t < cutoff) continue;
        perDay.set(n.date, (perDay.get(n.date) ?? 0) + (n.calcium ?? 0));
      }
      for (const [, total] of perDay) if (total >= target) daysOnTarget += 1;
    }

    return generateRankedInsights({
      firstName,
      appUsageDays: usageDays,
      wellbeingStreak: currentStreak,
      weekSessions: weekCount,
      todayScore,
      nervousState: ns.state,
      calciumTodayMg: todayNutrition?.calcium,
      calciumTargetMg: target,
      calciumDaysOnTarget7d: daysOnTarget,
      fractureRisk: tScore != null ? getFracturRisk() : undefined,
      hasDexa: dexaScans.length > 0,
      lastMood: lastEntry?.mood,
      lastActiveAt: lastEntry?.completedAt,
    }).slice(0, 3);
  }, [
    entries,
    dexaScans,
    user?.joinedAt,
    firstName,
    currentStreak,
    weekCount,
    todayScore,
    todayNutrition?.calcium,
    targets?.calcium,
    nutritionLogs,
    getFracturRisk,
  ]);

  if (lines.length === 0) return null;

  return (
    <Card variant="outlined" style={styles.card}>
      <View style={styles.headerRow}>
        <View style={[styles.iconWrap, { backgroundColor: colors.success + "20" }]}>
          <Feather name="trending-up" size={14} color={colors.success} />
        </View>
        <Text style={[styles.label, { color: colors.success }]}>How it's going</Text>
      </View>
      {lines.map((insight, idx) => (
        <Text
          key={insight.id}
          style={[
            styles.body,
            { color: colors.foreground, marginTop: idx === 0 ? 0 : 6 },
          ]}
        >
          {insight.text}
        </Text>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 6, marginBottom: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconWrap: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  body: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 19 },
});
