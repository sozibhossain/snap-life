/**
 * InsightsStrip — calm, rotating insight cards on the dashboard.
 *
 * Reads ranked insights from the existing engine and filters by the
 * 24h-dismissal map. Renders the active set as a horizontally swipeable
 * pager (1..3 cards). Dismissing a card writes the dismissal locally
 * and the strip rotates to the next active insight; if none remain it
 * fades out for the rest of the session.
 *
 * The component is intentionally side-effect free beyond AsyncStorage —
 * insight selection is deterministic, so this won't cause render-loop
 * surprises if the parent re-renders on context changes.
 */

import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  type AppStateStatus,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Card } from "@/components/ui/Card";
import { useAuth } from "@/context/AuthContext";
import { useHealth } from "@/context/HealthContext";
import { useNutrition } from "@/context/NutritionContext";
import { useWellbeing } from "@/context/WellbeingContext";
import { useColors } from "@/hooks/useColors";
import { logInteractionEvent } from "@/lib/events";
import { generateRankedInsights, type Insight } from "@/lib/insights";
import {
  activeInsights,
  dismissInsight,
  loadDismissals,
  selectDailyRotation,
} from "@/lib/insightsState";
import { deriveNervousSystem } from "@/lib/nervousSystem";
import { todayLocalISO } from "@/lib/weeklySnap";

interface DismissalState {
  byId: Record<string, number>;
}

/**
 * Returns the current local-date ISO string and re-renders whenever it
 * changes. Two triggers:
 *   1. A timer that fires at the next local midnight (single-shot then
 *      reschedules itself for the following midnight).
 *   2. AppState `active` transitions — covers the case where the device
 *      sleeps through midnight and the timer doesn't fire.
 *
 * Keeping the date in component state means consumers can list it in
 * memo deps and rotation/refilter logic is correctly invalidated.
 */
function useLocalDate(): string {
  const [date, setDate] = useState<string>(() => todayLocalISO());
  const dateRef = useRef(date);
  dateRef.current = date;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      const next = todayLocalISO();
      if (!cancelled && next !== dateRef.current) setDate(next);
    };

    const scheduleMidnight = () => {
      if (cancelled) return;
      const now = new Date();
      const tomorrow = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        2, // 2s buffer past midnight to avoid TZ edge races
        0,
      );
      const ms = Math.max(1_000, tomorrow.getTime() - now.getTime());
      timer = setTimeout(() => {
        refresh();
        scheduleMidnight();
      }, ms);
    };

    scheduleMidnight();
    const sub = AppState.addEventListener(
      "change",
      (status: AppStateStatus) => {
        if (status === "active") refresh();
      },
    );

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, []);

  return date;
}

export function InsightsStrip() {
  const colors = useColors();
  const { user } = useAuth();
  const isoDate = useLocalDate();
  const { todayNutrition, getFracturRisk, dexaScans } = useHealth();
  const { targets, nutritionLogs7d } = useDerivedNutrition();
  const { entries, currentStreak, weekCount, todayScore } = useWellbeing();

  const userId = user?.id ?? null;
  const firstName = useMemo(
    () => (user?.name ?? "").trim().split(/\s+/)[0] || undefined,
    [user?.name],
  );

  const [dismissals, setDismissals] = useState<DismissalState | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDismissals(null);
    void (async () => {
      const s = await loadDismissals(userId);
      if (!cancelled) setDismissals(s);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Build the ranked set from the engine (same one the rest of the app uses).
  const ranked: Insight[] = useMemo(() => {
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
    return generateRankedInsights({
      firstName,
      appUsageDays: usageDays,
      wellbeingStreak: currentStreak,
      weekSessions: weekCount,
      todayScore,
      nervousState: ns.state,
      calciumTodayMg: todayNutrition?.calcium,
      calciumTargetMg: targets?.calcium,
      calciumDaysOnTarget7d: nutritionLogs7d.daysOnTarget,
      fractureRisk: tScore != null ? getFracturRisk() : undefined,
      hasDexa: dexaScans.length > 0,
      lastMood: lastEntry?.mood,
      lastActiveAt: lastEntry?.completedAt,
    });
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
    nutritionLogs7d.daysOnTarget,
    getFracturRisk,
  ]);

  // Filter out cards the user dismissed in the past 24h, then
  // deterministically pick today's 1–2 from whatever remains. The
  // selection is seeded by `userId + today's local date` so it's
  // stable across re-renders within the day and rotates at midnight.
  // `isoDate` comes from useLocalDate(), which re-renders on midnight
  // and on app foreground — so this memo correctly invalidates on
  // day rollover even if the dashboard stays mounted overnight.
  const visible = useMemo(() => {
    const surviving = activeInsights(ranked, dismissals);
    return selectDailyRotation(surviving, {
      userId,
      isoDate,
      take: 2,
    });
  }, [ranked, dismissals, userId, isoDate]);

  // Emit rec_shown once per insight id per session. Debounced via a Set
  // so re-renders (every context change feeds this strip) don't re-fire.
  const shownEmittedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!userId) return;
    for (const insight of visible) {
      if (shownEmittedRef.current.has(insight.id)) continue;
      shownEmittedRef.current.add(insight.id);
      logInteractionEvent({
        appUserId: userId,
        kind: "rec_shown",
        payload: {
          surface: "insights",
          recId: insight.id,
          recKind: "insight",
        },
      });
    }
  }, [visible, userId]);

  if (!dismissals || visible.length === 0) return null;

  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {visible.map((insight) => (
          <Card key={insight.id} style={styles.card} variant="outlined">
            <View style={styles.row}>
              <View style={[styles.iconWrap, { backgroundColor: colors.primary + "18" }]}>
                <Feather name="sun" size={14} color={colors.primary} />
              </View>
              <Text style={[styles.label, { color: colors.primary }]}>
                Insight
              </Text>
              <Pressable
                onPress={() => {
                  if (Platform.OS !== "web") {
                    Haptics.selectionAsync().catch(() => {});
                  }
                  void dismissInsight(userId, insight.id).then(setDismissals);
                  logInteractionEvent({
                    appUserId: userId,
                    kind: "rec_dismissed",
                    payload: {
                      surface: "insights",
                      recId: insight.id,
                      recKind: "insight",
                    },
                  });
                }}
                hitSlop={10}
                style={styles.dismiss}
                accessibilityRole="button"
                accessibilityLabel="Dismiss insight"
              >
                <Feather name="x" size={14} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <Text style={[styles.body, { color: colors.foreground }]}>
              {insight.text}
            </Text>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * Tiny derived hook — pulls the calcium-on-target count for the past 7
 * days off NutritionContext. Inlined as a hook so InsightsStrip stays
 * self-contained.
 */
function useDerivedNutrition() {
  const { targets } = useNutrition();
  const { nutritionLogs } = useHealth();
  return useMemo(() => {
    const target = targets?.calcium ?? 0;
    if (target <= 0) return { targets, nutritionLogs7d: { daysOnTarget: 0 } };
    const cutoff = Date.now() - 7 * 86_400_000;
    const perDay = new Map<string, number>();
    for (const n of nutritionLogs) {
      const t = Date.parse(n.date);
      if (Number.isNaN(t) || t < cutoff) continue;
      perDay.set(n.date, (perDay.get(n.date) ?? 0) + (n.calcium ?? 0));
    }
    let daysOnTarget = 0;
    for (const [, total] of perDay) if (total >= target) daysOnTarget += 1;
    return { targets, nutritionLogs7d: { daysOnTarget } };
  }, [targets, nutritionLogs]);
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, gap: 10, paddingVertical: 2 },
  card: { width: 280, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconWrap: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.5, flex: 1 },
  dismiss: { padding: 2 },
  body: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 18 },
});
