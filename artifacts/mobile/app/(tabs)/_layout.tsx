import { BlurView } from "@/lib/web-shims/blur";
import { isLiquidGlassAvailable } from "@/lib/web-shims/glassEffect";
import { Tabs } from "expo-router";
import { Badge, Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "@/lib/web-shims/symbols";
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useHealth } from "@/context/HealthContext";
import { useNutrition } from "@/context/NutritionContext";
import { useWellbeing } from "@/context/WellbeingContext";
import { useColors } from "@/hooks/useColors";
import {
  loadLastSeenDate,
  subscribeCoachBadge,
} from "@/lib/coachBadge";
import { generateRankedInsights } from "@/lib/insights";
import {
  activeInsights,
  loadDismissals,
  subscribeDismissals,
} from "@/lib/insightsState";
import { deriveNervousSystem } from "@/lib/nervousSystem";
import { todayLocalISO } from "@/lib/weeklySnap";

/**
 * Coach tab badge predicate.
 *
 * Truth = "the user hasn't opened Coach yet today AND there is at least
 * one currently-actionable insight or recommendation to surface".
 *
 * This avoids the prior bug where the badge stayed up even when every
 * insight had been dismissed for the day. If nothing is actionable, the
 * tab stays calm and badge-free.
 *
 * - "Opened today" comes from `loadLastSeenDate` (stamped by Coach on
 *   focus). Subscribers re-evaluate on stamp updates.
 * - "Has actionable insight" runs the same engine InsightsStrip uses
 *   and filters by the persisted 24h dismissal map.
 */
function useCoachBadgePending(): boolean {
  const { user } = useAuth();
  const { dexaScans, todayNutrition, getFracturRisk, nutritionLogs } =
    useHealth();
  const { targets } = useNutrition();
  const { entries, currentStreak, weekCount, todayScore } = useWellbeing();

  const [openedToday, setOpenedToday] = useState(false);
  const [hasActiveInsight, setHasActiveInsight] = useState(false);
  // Bumped whenever a dismissal happens anywhere in the app — forces
  // the active-insight effect to re-run so the badge clears immediately
  // when the user dismisses their last visible insight.
  const [dismissalTick, setDismissalTick] = useState(0);
  useEffect(() => {
    const unsub = subscribeDismissals(() => {
      setDismissalTick((n) => n + 1);
    });
    return unsub;
  }, []);

  // Track "opened today" via the badge stamp + subscription bus.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (!user?.id) {
        if (!cancelled) setOpenedToday(false);
        return;
      }
      const last = await loadLastSeenDate(user.id);
      if (cancelled) return;
      setOpenedToday(last === todayLocalISO());
    };
    void refresh();
    const unsub = subscribeCoachBadge(() => {
      void refresh();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [user?.id]);

  // Compute whether at least one ranked insight survives the dismissal
  // filter. Re-runs on context changes (and once on mount when storage
  // resolves). Cheap — the engine returns at most a handful of items.
  useEffect(() => {
    let cancelled = false;
    const compute = async () => {
      const uid = user?.id ?? null;
      const dismissals = await loadDismissals(uid);
      if (cancelled) return;
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
      const ranked = generateRankedInsights({
        firstName: (user?.name ?? "").trim().split(/\s+/)[0] || undefined,
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
      });
      const surviving = activeInsights(ranked, dismissals);
      if (!cancelled) setHasActiveInsight(surviving.length > 0);
    };
    void compute();
    return () => {
      cancelled = true;
    };
  }, [
    user?.id,
    user?.joinedAt,
    user?.name,
    entries,
    dexaScans,
    currentStreak,
    weekCount,
    todayScore,
    todayNutrition?.calcium,
    targets?.calcium,
    nutritionLogs,
    getFracturRisk,
    dismissalTick,
  ]);

  return !openedToday && hasActiveInsight;
}

function NativeTabLayout() {
  const coachPending = useCoachBadgePending();
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "house", selected: "house.fill" }} />
        <Label>Home</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="health">
        <Icon sf={{ default: "heart", selected: "heart.fill" }} />
        <Label>Health</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="coach">
        <Icon sf={{ default: "bubble.left", selected: "bubble.left.fill" }} />
        <Label>Bone Buddy</Label>
        {/*
          A single calm character renders as a tiny indicator on iOS and a
          small numeric/dot badge on Android. Omitting the Badge child
          (or hiding it) removes the indicator entirely. The Coach
          screen clears the underlying date stamp on focus, which fires
          the subscriber and re-renders this layout without the badge.
        */}
        {coachPending ? <Badge>·</Badge> : <Badge hidden>·</Badge>}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="wellness">
        <Icon sf={{ default: "figure.mind.and.body", selected: "figure.mind.and.body" }} />
        <Label>Wellness</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="learn">
        <Icon sf={{ default: "book", selected: "book.fill" }} />
        <Label>Learn</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const coachPending = useCoachBadgePending();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarHideOnKeyboard: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.background },
              ]}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="house" tintColor={color} size={24} />
            ) : (
              <Feather name="home" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="health"
        options={{
          title: "Health",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="heart" tintColor={color} size={24} />
            ) : (
              <Feather name="activity" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          title: "Bone Buddy",
          // Calm dot — never red — to nudge that there's a fresh
          // proactive recommendation today. Cleared on Coach open.
          tabBarBadge: coachPending ? "·" : undefined,
          tabBarBadgeStyle: {
            backgroundColor: colors.primary,
            color: "#fff",
            fontSize: 10,
            minWidth: 14,
            height: 14,
            borderRadius: 7,
            lineHeight: 14,
          },
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="bubble.left" tintColor={color} size={24} />
            ) : (
              <Feather name="message-circle" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="wellness"
        options={{
          title: "Wellness",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="figure.mind.and.body" tintColor={color} size={24} />
            ) : (
              <Feather name="heart" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="learn"
        options={{
          title: "Learn",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="book" tintColor={color} size={24} />
            ) : (
              <Feather name="book-open" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="community"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="profile"
        options={{ href: null }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  // Keep TestFlight builds on the proven tab renderer. The iOS native-tabs
  // API is still unstable and can render a blank surface on some devices.
  return <ClassicTabLayout />;
}
