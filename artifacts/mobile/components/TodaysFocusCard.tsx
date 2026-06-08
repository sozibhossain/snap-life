
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  type AppStateStatus,
  Platform,
  Pressable,
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
import {
  loadCompletion,
  nextMealSlot,
  pickAdaptiveTodaysFocus,
  pickTodaysFocus,
  saveCompletion,
  todayLocalISO,
  type AdaptivePerKind,
  type CompletionState,
  type FocusAction,
  type FocusKind,
} from "@/lib/dailyFocus";
import {
  fetchEngagementProfile,
  type EngagementProfile,
} from "@/lib/engagementProfile";
import { logInteractionEvent } from "@/lib/events";
import { useSubscription } from "@/lib/revenuecat";

export function TodaysFocusCard() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const { recipeFor } = useNutrition();
  const { entries } = useWellbeing();
  const { loggedNutritionToday } = useHealth();
  const { hasPremiumOrTrial } = useSubscription();

  const userId = user?.id ?? null;

  // Day + meal-slot are time-derived. Tab screens stay mounted across
  // midnight and across meal windows, so we can't freeze these at first
  // render. Refresh on:
  //   • a periodic minute tick
  //   • the app coming back to the foreground
  //   • whenever the values actually change (cheap state setter)
  const [{ isoDate, slot }, setDayState] = useState(() => ({
    isoDate: todayLocalISO(),
    slot: nextMealSlot(),
  }));
  useEffect(() => {
    const refresh = () => {
      const nextIso = todayLocalISO();
      const nextSlot = nextMealSlot();
      setDayState((prev) =>
        prev.isoDate === nextIso && prev.slot === nextSlot
          ? prev
          : { isoDate: nextIso, slot: nextSlot },
      );
    };
    const interval = setInterval(refresh, 60_000);
    const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
      if (s === "active") refresh();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, []);

  // Load persisted completion when the user / day changes. Treats the
  // initial unhydrated render as "nothing done yet" so the UI shape is
  // stable from frame one — and resets cleanly when the day rolls over.
  const [completion, setCompletion] = useState<CompletionState>({ done: {} });
  useEffect(() => {
    let cancelled = false;
    setCompletion({ done: {} });
    void (async () => {
      const c = await loadCompletion(userId, isoDate);
      if (!cancelled) setCompletion(c);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, isoDate]);

  // Premium-only: pull the engagement profile so we can reorder tiles.
  // Plus / free users skip the fetch entirely (and we still skip if
  // there's no user). Refetched on user / date change so a day rollover
  // re-uses today's freshest data.
  const [profile, setProfile] = useState<EngagementProfile | null>(null);
  useEffect(() => {
    if (!hasPremiumOrTrial || !userId) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const p = await fetchEngagementProfile(userId);
      if (!cancelled) setProfile(p);
    })();
    return () => {
      cancelled = true;
    };
  }, [hasPremiumOrTrial, userId, isoDate]);

  // Recompute the three tiles whenever the inputs change. Wellbeing
  // entries flowing in (e.g. after a breathing session) will refresh the
  // wellbeing tile automatically — that's the "mood-into-plan" signal.
  // Premium users go through the adaptive picker; everyone else gets
  // the deterministic ordering.
  const actions: FocusAction[] = useMemo(() => {
    const recipe = recipeFor(slot);
    const sessionEntries = entries.map((e) => ({
      kind: e.kind,
      mood: e.mood,
      completedAt: e.completedAt,
    }));
    const baseInputs = {
      isoDate,
      nutritionRecipe: recipe,
      nutritionSlot: slot,
      wellbeingEntries: sessionEntries,
    };
    if (hasPremiumOrTrial && profile) {
      const perKind: Partial<Record<FocusKind, AdaptivePerKind>> = {};
      for (const kind of ["nutrition", "wellbeing", "lifestyle"] as const) {
        const stats = profile.sevenDay.byKind[kind];
        if (stats) perKind[kind] = stats;
      }
      // Behavioural snapshot biases ordering toward the kind the user
      // has *actually* engaged with on persisted surfaces (logged a meal,
      // finished a session, walked active minutes). The bias is capped
      // at +0.25 so a strong Wilson lead still wins — this only nudges
      // ties and near-ties.
      return pickAdaptiveTodaysFocus({
        ...baseInputs,
        perKind,
        behavioural: profile.behavioural ?? null,
      });
    }
    return pickTodaysFocus(baseInputs);
  }, [recipeFor, slot, isoDate, entries, hasPremiumOrTrial, profile]);

  // Adaptive label only shows when Premium is on AND the profile loaded
  // successfully AND we actually have at least *some* engagement data
  // to reorder by. Showing "Adapted to you" on a brand-new account with
  // no events would be misleading.
  const isAdapted =
    hasPremiumOrTrial &&
    !!profile &&
    profile.sevenDay.totalShown >= 3;

  // Derive first name for personalised messages.
  const firstName = useMemo(
    () => (user?.name ?? "").trim().split(/\s+/)[0] || "",
    [user?.name],
  );

  // Dismissed and completed tiles are both hidden from the list.
  // When ALL tiles are complete the card switches to a celebration
  // state instead of an empty tile list. Dismissed tiles follow the
  // same logic: we never show an empty list — if somehow everything
  // is dismissed-and-done we fall back to the full actions list.
  const visibleActions = useMemo(() => {
    const dismissed = completion.dismissed ?? {};
    const remaining = actions.filter((a) => {
      if (dismissed[a.id]) return false;
      if (completion.done[a.id]) return false;
      // Nutrition auto-complete: hide the tile once it's effectively done
      if (a.kind === "nutrition" && loggedNutritionToday) return false;
      return true;
    });
    return remaining;
  }, [actions, completion.dismissed, completion.done, loggedNutritionToday]);

  // Emit rec_shown for each tile that's currently visible. Debounced via
  // a Set so the same tile id only logs once per app session — re-renders
  // (date tick, completion toggle) don't re-emit. We key off the visible
  // (post-dismissal) list so a hidden tile doesn't get a misleading
  // impression.
  const shownEmittedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!userId) return;
    for (const a of visibleActions) {
      if (shownEmittedRef.current.has(a.id)) continue;
      shownEmittedRef.current.add(a.id);
      logInteractionEvent({
        appUserId: userId,
        kind: "rec_shown",
        payload: {
          surface: "today_focus",
          recId: a.id,
          recKind: a.kind,
          adapted: isAdapted,
        },
      });
    }
  }, [visibleActions, userId, isAdapted]);

  // The nutrition tile auto-completes whenever the user has logged
  // any nutrition today — manual save OR a meal-plan tick. This is
  // what makes the daily-focus card "reflect the new credit instantly"
  // when the user marks a meal as eaten without ever opening the
  // tile. Other kinds (wellbeing, lifestyle) only flip via the manual
  // check.
  const isEffectivelyDone = useCallback(
    (action: FocusAction) => {
      if (completion.done[action.id]) return true;
      if (action.kind === "nutrition" && loggedNutritionToday) return true;
      return false;
    },
    [completion.done, loggedNutritionToday],
  );

  // Count from the full actions list, not visibleActions, so the
  // "X of 3" counter reflects total progress even as tiles disappear.
  const completedCount = actions.filter(isEffectivelyDone).length;
  const allDone = completedCount === actions.length;

  const accentColor = useCallback(
    (token: FocusAction["accent"]) => colors[token],
    [colors],
  );

  const handleOpen = useCallback(
    (action: FocusAction) => {
      router.push(action.route as never);
    },
    [router],
  );

  // Keep latest day/user/completion in refs so the toggle handler can
  // read the freshest values synchronously without re-creating itself
  // on every render. Side effects live OUTSIDE the state updater so a
  // React concurrent re-execution of the updater can't double-emit the
  // event or double-write to AsyncStorage.
  const isoDateRef = useRef(isoDate);
  const userIdRef = useRef(userId);
  const completionRef = useRef(completion);
  const adaptedRef = useRef(isAdapted);
  useEffect(() => {
    isoDateRef.current = isoDate;
    userIdRef.current = userId;
  }, [isoDate, userId]);
  useEffect(() => {
    completionRef.current = completion;
  }, [completion]);
  useEffect(() => {
    adaptedRef.current = isAdapted;
  }, [isAdapted]);

  // Track loggedNutritionToday in a ref so the toggle handler can
  // short-circuit on an auto-completed nutrition tile without
  // re-creating itself on every render.
  const loggedNutritionTodayRef = useRef(loggedNutritionToday);
  useEffect(() => {
    loggedNutritionTodayRef.current = loggedNutritionToday;
  }, [loggedNutritionToday]);

  const handleToggle = useCallback((action: FocusAction) => {
    // Re-read the day at the instant of the tap. If the local day has
    // rolled over since the last render, the action.id is stamped with
    // yesterday's date — which would silently save under the wrong key.
    // Bail out, force a refresh, and let the user tap the freshly
    // rendered tile. This is an extreme edge case (tap exactly at
    // midnight/slot rollover) but the abort is the safe behaviour.
    const currentIso = todayLocalISO();
    if (currentIso !== isoDateRef.current) {
      setDayState({ isoDate: currentIso, slot: nextMealSlot() });
      return;
    }

    const currentUserId = userIdRef.current;
    const prev = completionRef.current;
    // The nutrition tile auto-completes from the shared "logged today"
    // signal (manual save OR meal-plan tick). A tap on the
    // auto-completed nutrition tile is a true no-op — early return
    // before any state, storage, or analytics touch — so the tile's
    // displayed "done" state stays sourced solely from
    // loggedNutritionToday and the user can't accidentally
    // un-complete it (or double-credit themselves) by tapping. Manual
    // un-completion only makes sense if the user actually un-logs
    // their nutrition (which they do from the meal plan / log
    // nutrition screens, not from this tile).
    if (action.kind === "nutrition" && loggedNutritionTodayRef.current) {
      return;
    }
    const wasDone = !!prev.done[action.id];
    // Carry forward the dismissed map — losing it here would resurrect
    // tiles the user dismissed earlier in the day and let the same tile
    // be re-dismissed (re-emitting rec_dismissed) on the next render.
    const next: CompletionState = {
      done: { ...prev.done },
      dismissed: { ...(prev.dismissed ?? {}) },
    };
    if (wasDone) {
      delete next.done[action.id];
    } else {
      next.done[action.id] = true;
    }

    // Commit state first (pure updater), then run side effects exactly
    // once, after we know the transition resolved.
    setCompletion(next);
    completionRef.current = next;
    void saveCompletion(currentUserId, currentIso, next);

    if (!wasDone) {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      // Only emit on the toggle-on edge — re-tapping to undo doesn't
      // need to log a "completed" event. We emit BOTH the legacy
      // today_focus_completed event (kept for backward-compat with the
      // weekly aggregate) AND the rec_completed lifecycle event the
      // adaptive engagement profile groups by.
      logInteractionEvent({
        appUserId: currentUserId,
        kind: "today_focus_completed",
        payload: {
          actionId: action.id,
          kind: action.kind,
          isoDate: currentIso,
        },
      });
      logInteractionEvent({
        appUserId: currentUserId,
        kind: "rec_completed",
        payload: {
          surface: "today_focus",
          recId: action.id,
          recKind: action.kind,
          adapted: adaptedRef.current,
        },
      });
    }
  }, []);

  // Dismiss handler — hides the tile for the rest of the local day and
  // emits a rec_dismissed event so the adaptive engine can demote that
  // kind tomorrow (Wilson lower-bound treats dismissals as failures).
  // Never emits twice for the same tile in the same day.
  const handleDismiss = useCallback((action: FocusAction) => {
    const currentIso = todayLocalISO();
    if (currentIso !== isoDateRef.current) {
      setDayState({ isoDate: currentIso, slot: nextMealSlot() });
      return;
    }
    const currentUserId = userIdRef.current;
    const prev = completionRef.current;
    const prevDismissed = prev.dismissed ?? {};
    if (prevDismissed[action.id]) return; // already dismissed today
    const next: CompletionState = {
      done: { ...prev.done },
      dismissed: { ...prevDismissed, [action.id]: true },
    };
    setCompletion(next);
    completionRef.current = next;
    void saveCompletion(currentUserId, currentIso, next);
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
    logInteractionEvent({
      appUserId: currentUserId,
      kind: "rec_dismissed",
      payload: {
        surface: "today_focus",
        recId: action.id,
        recKind: action.kind,
        adapted: adaptedRef.current,
      },
    });
  }, []);

  return (
    <Card variant="elevated" style={styles.card}>
      {/* 3px brand-gradient ribbon at the top of the card. Card already
          clips to its rounded corners (overflow: "hidden") so the ribbon
          sits flush with the corner radius. Pure decoration — gives this
          card the visual weight that signals "this is the lead block on
          the screen" without changing any of the layout below. */}
      <LinearGradient
        colors={colors.gradients.primary}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.topStripe}
        pointerEvents="none"
      />
      <View style={styles.header}>
        <View
          style={[
            styles.titleIcon,
            { backgroundColor: colors.primary + "1A" },
          ]}
        >
          <Feather name="sun" size={14} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Today's focus
          </Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            Three small things — pick what fits today.
          </Text>
          {isAdapted ? (
            <View style={styles.adaptedRow}>
              <Feather name="zap" size={10} color={colors.primary} />
              <Text style={[styles.adaptedText, { color: colors.primary }]}>
                Adapted to you
              </Text>
            </View>
          ) : null}
        </View>
        <View style={[styles.counter, { backgroundColor: colors.muted }]}>
          <Text style={[styles.counterText, { color: colors.mutedForeground }]}>
            {completedCount} of {actions.length}
          </Text>
        </View>
      </View>

      {allDone ? (
        /* ── All-done celebration state ─────────────────────────────── */
        <View style={[styles.celebration, { backgroundColor: colors.primary + "0D", borderColor: colors.primary + "25" }]}>
          <LinearGradient
            colors={[colors.primary + "18", colors.primary + "06"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.celebrationGrad}
          >
            <Text style={styles.celebrationEmoji}>🎉</Text>
            <Text style={[styles.celebrationTitle, { color: colors.foreground }]}>
              {firstName ? `Well done, ${firstName}!` : "All done for today!"}
            </Text>
            <Text style={[styles.celebrationSub, { color: colors.mutedForeground }]}>
              You've completed today's focus. Check back tomorrow for new recommendations.
            </Text>
          </LinearGradient>
        </View>
      ) : (
        /* ── Tile list (remaining / undone tiles only) ───────────────── */
        <View style={styles.tiles}>
          {visibleActions.map((a) => {
            const accent = accentColor(a.accent);
            return (
              <View
                key={a.id}
                style={[
                  styles.tile,
                  { backgroundColor: colors.muted + "55", borderColor: colors.border },
                ]}
              >
                <Pressable
                  onPress={() => handleOpen(a)}
                  style={styles.tileBody}
                  accessibilityRole="button"
                  accessibilityLabel={`${a.title}. ${a.subtitle ?? ""}`}
                >
                  <View style={[styles.tileIcon, { backgroundColor: accent + "22" }]}>
                    <Feather name={a.icon as never} size={16} color={accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.tileTitle, { color: colors.foreground }]}
                      numberOfLines={2}
                    >
                      {a.title}
                    </Text>
                    {a.subtitle ? (
                      <Text
                        style={[styles.tileSub, { color: colors.mutedForeground }]}
                        numberOfLines={2}
                      >
                        {a.subtitle}
                      </Text>
                    ) : null}
                    <View style={styles.ctaRow}>
                      <Text style={[styles.ctaText, { color: accent }]}>{a.ctaLabel}</Text>
                      <Feather name="chevron-right" size={12} color={accent} />
                    </View>
                  </View>
                </Pressable>
                <View style={styles.tileActions}>
                  <Pressable
                    onPress={() => handleDismiss(a)}
                    hitSlop={10}
                    style={styles.dismissBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Not for today"
                  >
                    <Feather name="x" size={14} color={colors.mutedForeground} />
                  </Pressable>
                  <Pressable
                    onPress={() => handleToggle(a)}
                    hitSlop={10}
                    style={[
                      styles.checkBtn,
                      { backgroundColor: "transparent", borderColor: colors.border },
                    ]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: false }}
                    accessibilityLabel="Mark as done"
                  >
                    {null}
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 14 },
  topStripe: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  titleIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  adaptedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
  },
  adaptedText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  counter: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  counterText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  celebration: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  celebrationGrad: {
    alignItems: "center",
    paddingVertical: 24,
    paddingHorizontal: 16,
    gap: 8,
  },
  celebrationEmoji: { fontSize: 32 },
  celebrationTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  celebrationSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 19,
    marginTop: 2,
  },

  tiles: { gap: 10 },
  tile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  tileBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  tileIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  tileTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", lineHeight: 18 },
  tileSub: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    lineHeight: 15,
    marginTop: 2,
  },
  ctaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
  },
  ctaText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  tileActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  dismissBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  checkBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
});
