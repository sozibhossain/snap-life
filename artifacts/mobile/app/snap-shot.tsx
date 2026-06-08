/**
 * Weekly SNAP Shot — calm, non-gamified review of the past 7 days.
 *
 * Sections (in order):
 *   1. Mood arc   — small bar / dot chart of session valence per day.
 *   2. Sessions   — total wellbeing sessions completed.
 *   3. Nutrition  — calcium days-on-target out of 7.
 *   4. Streak     — current calm-studio streak.
 *   5. Insight    — one line from the InsightsEngine.
 *   6. Identity   — softer "who you're becoming" line.
 *   7. Claim      — Single 125 XP bonus, idempotent per ISO week.
 *
 * Tone is calm and unhurried — no red, no congratulatory shouting.
 * Bonus is opt-in: the user must tap to claim it, and replays return
 * `false` so the button shows "Already noted this week".
 */

import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { useAuth } from "@/context/AuthContext";
import { useGamification } from "@/context/GamificationContext";
import { useHealth } from "@/context/HealthContext";
import { useNutrition } from "@/context/NutritionContext";
import { useWellbeing } from "@/context/WellbeingContext";
import { useColors } from "@/hooks/useColors";
import type { BehaviouralStats } from "@/lib/behaviouralStats";
import { fetchEngagementProfile } from "@/lib/engagementProfile";
import { logInteractionEvent } from "@/lib/events";
import { generateRankedInsights } from "@/lib/insights";
import { deriveNervousSystem } from "@/lib/nervousSystem";
import {
  buildWeeklySnap,
  isoYearWeek,
  type WeeklyServerAggregates,
} from "@/lib/weeklySnap";

const WEEKLY_BONUS_XP = 125;

export default function WeeklySnapShotScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const {
    activityLogs,
    nutritionLogs,
    dexaScans,
    fraxResults,
    todayNutrition,
    getFracturRisk,
  } = useHealth();
  const { targets } = useNutrition();
  const { entries, currentStreak, weekCount, todayScore } = useWellbeing();
  const { awardWeeklyBonus, isWeeklyBonusClaimed } = useGamification();

  const firstName = useMemo(
    () => (user?.name ?? "").trim().split(/\s+/)[0] || undefined,
    [user?.name],
  );

  const week = isoYearWeek();
  const [claimed, setClaimed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  // Surface a one-time success message after a fresh claim.
  const [justAwarded, setJustAwarded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const v = await isWeeklyBonusClaimed(week);
      if (!cancelled) setClaimed(v);
    })();
    return () => {
      cancelled = true;
    };
  }, [week, user?.id, isWeeklyBonusClaimed]);

  // rec_shown — once per (user, week) per mount. The screen is opened
  // explicitly, so a single emit on first render is correct.
  const shownEmittedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user?.id) return;
    const key = `${user.id}:${week}`;
    if (shownEmittedRef.current === key) return;
    shownEmittedRef.current = key;
    logInteractionEvent({
      appUserId: user.id,
      kind: "rec_shown",
      payload: {
        surface: "weekly_snap",
        recId: `weekly_snap:${week}`,
        recKind: "weekly_snap",
      },
    });
  }, [user?.id, week]);

  // Re-render the insight in step with the dashboard.
  const insightText = useMemo(() => {
    const ns = deriveNervousSystem({
      entries: entries.map((e) => ({
        kind: e.kind,
        mood: e.mood,
        completedAt: e.completedAt,
      })),
    });
    const lastEntry = entries[0];
    const tScore = dexaScans[0]?.tScore ?? null;
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
    const ranked = generateRankedInsights({
      firstName,
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
    });
    return ranked[0]?.text ?? "";
  }, [
    entries,
    currentStreak,
    weekCount,
    todayScore,
    todayNutrition,
    targets,
    nutritionLogs,
    dexaScans,
    firstName,
    getFracturRisk,
  ]);

  // Pull the server-side behavioural snapshot so the SNAP Shot can
  // reflect what the persistence layer agrees happened — the user may
  // have logged from another device, or local state may have been
  // pruned. Each defined field overrides the equivalent client
  // computation; undefined falls back. No Premium gate (the endpoint
  // is auth-gated only and behavioural facts belong to the user).
  const [behavioural, setBehavioural] = useState<BehaviouralStats | null>(null);
  useEffect(() => {
    if (!user?.id) {
      setBehavioural(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const p = await fetchEngagementProfile(user.id);
      if (!cancelled) setBehavioural(p?.behavioural ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const serverAggregates = useMemo<WeeklyServerAggregates | undefined>(() => {
    if (!behavioural) return undefined;
    return {
      sessionsCompleted: behavioural.wellbeing.sessions7d,
      activeMinutes: behavioural.activity.activeMinutes7d,
      calciumDaysOnTarget: behavioural.nutrition.calciumDaysOnTarget7d,
      calciumTargetMg: behavioural.nutrition.calciumTargetMg,
      averageCalciumMg: behavioural.nutrition.avgCalciumMg7d,
      currentStreak: behavioural.wellbeing.currentStreak,
      longestStreak: behavioural.wellbeing.longestStreak,
    };
  }, [behavioural]);

  const snap = useMemo(
    () =>
      buildWeeklySnap({
        wellbeingEntries: entries,
        activityLogs,
        nutritionLogs,
        calciumTargetMg: targets?.calcium ?? 0,
        currentStreak,
        firstName,
        emotionalInsight: insightText,
        serverAggregates,
      }),
    [
      entries,
      activityLogs,
      nutritionLogs,
      targets,
      currentStreak,
      firstName,
      insightText,
      serverAggregates,
    ],
  );

  const onClaim = async () => {
    if (claimed || busy) return;
    setBusy(true);
    try {
      const ok = await awardWeeklyBonus(week, WEEKLY_BONUS_XP);
      if (ok) {
        setClaimed(true);
        setJustAwarded(true);
        if (user?.id) {
          logInteractionEvent({
            appUserId: user.id,
            kind: "rec_completed",
            payload: {
              surface: "weekly_snap",
              recId: `weekly_snap:${week}`,
              recKind: "weekly_snap",
            },
          });
        }
        return;
      }
      // Award returned false — either it was already claimed (someone
      // else's tab/race) or storage failed. Re-check the persisted
      // marker so we don't lock the user out of a future retry just
      // because of a transient write error.
      const persisted = await isWeeklyBonusClaimed(week);
      setClaimed(persisted);
    } finally {
      setBusy(false);
    }
  };

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  // Highest-valence day in the arc, used to scale the chart bars.
  const maxValence = Math.max(0.001, ...snap.moodArc.map((p) => p.valence ?? 0));

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <LinearGradient
          colors={colors.gradients.calm}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.topBar,
            { paddingTop: topPadding + 10 },
            colors.shadows.sm,
          ]}
        >
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
            <Feather name="chevron-left" size={22} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>
              Weekly SNAP Shot
            </Text>
            <Text style={styles.subtitle}>
              Your past seven days, gently summarised.
            </Text>
          </View>
        </LinearGradient>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 32 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Mood arc */}
          <Card variant="elevated" style={styles.card}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              How you've felt
            </Text>
            <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
              Mood after each calm-studio session.
            </Text>
            <View style={styles.chartRow}>
              {snap.moodArc.map((p) => {
                const h = p.valence == null
                  ? 6
                  : Math.max(8, Math.round((p.valence / maxValence) * 64));
                return (
                  <View key={p.date} style={styles.chartCol}>
                    <View
                      style={[
                        styles.chartBar,
                        {
                          height: h,
                          backgroundColor:
                            p.valence == null
                              ? colors.muted
                              : p.valence >= 0.7
                                ? colors.primary
                                : colors.accent,
                          opacity: p.valence == null ? 0.7 : 1,
                        },
                      ]}
                    />
                    <Text style={[styles.chartLabel, { color: colors.mutedForeground }]}>
                      {p.weekday[0]}
                    </Text>
                  </View>
                );
              })}
            </View>
          </Card>

          {/* Stats row — sessions / nutrition days / streak */}
          <View style={styles.statsRow}>
            <View style={[styles.statTile, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "33" }]}>
              <Text style={[styles.statValue, { color: colors.primary }]}>
                {snap.sessionsCompleted}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                {snap.sessionsCompleted === 1 ? "Session" : "Sessions"}
              </Text>
            </View>
            <View style={[styles.statTile, { backgroundColor: colors.success + "10", borderColor: colors.success + "33" }]}>
              <Text style={[styles.statValue, { color: colors.success }]}>
                {snap.calciumDaysOnTarget}/7
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                Calcium days
              </Text>
            </View>
            <View style={[styles.statTile, { backgroundColor: colors.accent + "10", borderColor: colors.accent + "33" }]}>
              <Text style={[styles.statValue, { color: colors.accent }]}>
                {snap.currentStreak}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                Day streak
              </Text>
            </View>
          </View>

          {/* Streak detail row — current vs longest, only when longest is meaningful */}
          {snap.longestStreak > 0 ? (
            <View style={styles.streakDetailRow}>
              <View style={[styles.streakDetailTile, { borderColor: colors.border }]}>
                <Text style={[styles.streakDetailValue, { color: colors.foreground }]}>
                  {snap.currentStreak}
                </Text>
                <Text style={[styles.streakDetailLabel, { color: colors.mutedForeground }]}>
                  Current streak
                </Text>
              </View>
              <View style={[styles.streakDetailDivider, { backgroundColor: colors.border }]} />
              <View style={[styles.streakDetailTile, { borderColor: colors.border }]}>
                <Text style={[styles.streakDetailValue, { color: colors.foreground }]}>
                  {snap.longestStreak}
                </Text>
                <Text style={[styles.streakDetailLabel, { color: colors.mutedForeground }]}>
                  Longest streak
                </Text>
              </View>
            </View>
          ) : null}

          {/* Average calcium intake (compact, small footnote) — sits with
              the active-minutes line so the screen still reads as a
              calm, non-gamified summary. Only show when there's a real
              number to share so empty weeks don't look judgemental. */}
          {snap.averageCalciumMg > 0 ? (
            <Text style={[styles.activeNote, { color: colors.mutedForeground }]}>
              Average calcium {Math.round(snap.averageCalciumMg)} mg / logged day.
            </Text>
          ) : null}

          {/* Movement minutes (compact, small footnote) */}
          {snap.activeMinutes > 0 ? (
            <Text style={[styles.activeNote, { color: colors.mutedForeground }]}>
              {snap.activeMinutes} active minutes logged this week.
            </Text>
          ) : null}

          {/* FRAX fracture risk — only shown when a result is on file */}
          {fraxResults.length > 0 && (() => {
            const fr = fraxResults[0];
            const riskColor =
              fr.majorFractureRisk < 10 ? colors.success :
              fr.majorFractureRisk < 20 ? colors.warning :
              colors.destructive;
            const riskLabel =
              fr.majorFractureRisk < 10 ? "Low" :
              fr.majorFractureRisk < 20 ? "Moderate" : "Higher";
            return (
              <Card variant="outlined" style={styles.card}>
                <View style={styles.insightHeader}>
                  <View style={[styles.insightIcon, { backgroundColor: riskColor + "18" }]}>
                    <Feather name="shield" size={14} color={riskColor} />
                  </View>
                  <Text style={[styles.insightLabel, { color: riskColor }]}>
                    FRAX — Fracture Risk
                  </Text>
                </View>
                <View style={styles.fraxRow}>
                  <View style={styles.fraxCell}>
                    <Text style={[styles.fraxValue, { color: colors.foreground }]}>{fr.majorFractureRisk}%</Text>
                    <Text style={[styles.fraxSub, { color: colors.mutedForeground }]}>Major fracture{"\n"}10-yr risk</Text>
                  </View>
                  <View style={[styles.fraxDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.fraxCell}>
                    <Text style={[styles.fraxValue, { color: colors.foreground }]}>{fr.hipFractureRisk}%</Text>
                    <Text style={[styles.fraxSub, { color: colors.mutedForeground }]}>Hip fracture{"\n"}10-yr risk</Text>
                  </View>
                  <View style={[styles.fraxDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.fraxCell}>
                    <Text style={[styles.fraxValue, { color: riskColor }]}>{riskLabel}</Text>
                    <Text style={[styles.fraxSub, { color: colors.mutedForeground }]}>Overall{"\n"}risk level</Text>
                  </View>
                </View>
                <Text style={[styles.fraxNote, { color: colors.mutedForeground }]}>
                  Based on your FRAX calculator result from {new Date(fr.date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.
                </Text>
              </Card>
            );
          })()}

          {/* Emotional insight */}
          {snap.emotionalInsight ? (
            <Card variant="outlined" style={styles.card}>
              <View style={styles.insightHeader}>
                <View style={[styles.insightIcon, { backgroundColor: colors.primary + "18" }]}>
                  <Feather name="sun" size={14} color={colors.primary} />
                </View>
                <Text style={[styles.insightLabel, { color: colors.primary }]}>
                  Insight
                </Text>
              </View>
              <Text style={[styles.insightText, { color: colors.foreground }]}>
                {snap.emotionalInsight}
              </Text>
            </Card>
          ) : null}

          {/* Identity line */}
          <Card variant="outlined" style={styles.card}>
            <Text style={[styles.identityText, { color: colors.foreground }]}>
              {snap.identityLine}
            </Text>
          </Card>

          {/* Bonus claim */}
          <Card variant="elevated" style={styles.card}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              {claimed ? "Already noted this week" : "Mark the week complete"}
            </Text>
            <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
              {claimed
                ? justAwarded
                  ? `+${WEEKLY_BONUS_XP} XP added — quietly noted.`
                  : "You've already taken your weekly moment."
                : `Take a small moment of credit — +${WEEKLY_BONUS_XP} XP.`}
            </Text>
            <Pressable
              disabled={!!claimed || busy}
              onPress={onClaim}
              style={[
                styles.claimBtn,
                {
                  backgroundColor: claimed
                    ? colors.muted
                    : colors.primary,
                  opacity: busy ? 0.7 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !!claimed }}
            >
              <Feather
                name={claimed ? "check" : "award"}
                size={16}
                color={claimed ? colors.mutedForeground : "#fff"}
              />
              <Text
                style={[
                  styles.claimBtnText,
                  { color: claimed ? colors.mutedForeground : "#fff" },
                ]}
              >
                {claimed ? "Noted" : busy ? "Saving…" : "Note this week"}
              </Text>
            </Pressable>
          </Card>

          {/* Bone Buddy weekly check-in prompt */}
          <Pressable
            onPress={() => router.push("/(tabs)/coach" as any)}
            style={({ pressed }) => [
              styles.buddyCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <View style={[styles.buddyAvatar, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "30" }]}>
              <Text style={styles.buddyEmoji}>🦴</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.buddyTitle, { color: colors.foreground }]}>
                Talk it through with Bone Buddy
              </Text>
              <Text style={[styles.buddySub, { color: colors.mutedForeground }]}>
                Ask about your week, get personalised tips, or just check in.
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
        </ScrollView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 18,
    gap: 4,
  },
  backBtn: { padding: 6, marginRight: 4 },
  title: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.78)",
    marginTop: 2,
  },
  scrollContent: { padding: 16, gap: 12 },
  card: { gap: 6 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  cardSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  chartRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginTop: 12,
    gap: 6,
    height: 90,
  },
  chartCol: { flex: 1, alignItems: "center", justifyContent: "flex-end", gap: 6 },
  chartBar: { width: "70%", borderRadius: 6 },
  chartLabel: { fontSize: 10, fontFamily: "Inter_500Medium" },
  statsRow: { flexDirection: "row", gap: 10 },
  statTile: {
    flex: 1,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    gap: 4,
  },
  statValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "center" },
  activeNote: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: -4,
  },
  insightHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  insightIcon: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  insightLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  insightText: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 19, marginTop: 4 },
  identityText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    lineHeight: 21,
  },
  claimBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    marginTop: 8,
  },
  claimBtnText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  fraxRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  fraxCell: { flex: 1, alignItems: "center", gap: 4 },
  fraxValue: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  fraxSub: { fontSize: 10, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 14 },
  fraxDivider: { width: 1, height: 36, marginHorizontal: 8 },
  fraxNote: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 10, lineHeight: 16 },
  streakDetailRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    marginTop: -4,
  },
  streakDetailTile: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    gap: 2,
  },
  streakDetailDivider: { width: 1, height: 32 },
  streakDetailValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  streakDetailLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },
  buddyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  buddyAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  buddyEmoji: { fontSize: 20 },
  buddyTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  buddySub: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
});
