import { describe, expect, it } from "vitest";
import { buildWeeklySnap, summariseWeekSources, todayLocalISO } from "../weeklySnap";
import type { NutritionLog } from "@/context/HealthContext";
import type { ActivityLog } from "@/context/HealthContext";
import type { WellbeingEntry } from "@/context/WellbeingContext";
import { ZERO_TOTALS } from "../nutritionBridge";

/** Tiny factory so each test only specifies what matters. */
function log(date: string, source: NutritionLog["source"]): NutritionLog {
  return {
    id: `${date}-${source}`,
    date,
    calcium: 0,
    vitaminD: 0,
    protein: 0,
    magnesium: 0,
    calories: 0,
    meals: [],
    source,
    mealsCompleted: {},
    planTotals: { ...ZERO_TOTALS },
    mealsContributions: {},
    mealPortions: {},
  };
}

function nDaysAgo(n: number, now: Date): string {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return todayLocalISO(d);
}

describe("summariseWeekSources", () => {
  const NOW = new Date("2026-04-28T12:00:00.000Z");

  it("returns all-zero counts for an empty log list", () => {
    expect(summariseWeekSources([], NOW)).toEqual({
      planOnlyDays: 0,
      manualOnlyDays: 0,
      mixedDays: 0,
      totalLoggedDays: 0,
    });
  });

  it("buckets a mix of plan / manual / mixed days inside the 7-day window", () => {
    const logs = [
      log(nDaysAgo(0, NOW), "manual+plan"),
      log(nDaysAgo(1, NOW), "meal_plan"),
      log(nDaysAgo(2, NOW), "meal_plan"),
      log(nDaysAgo(3, NOW), "manual"),
      log(nDaysAgo(6, NOW), "meal_plan"),
    ];
    expect(summariseWeekSources(logs, NOW)).toEqual({
      planOnlyDays: 3,
      manualOnlyDays: 1,
      mixedDays: 1,
      totalLoggedDays: 5,
    });
  });

  it("ignores logs older than the 7-day window", () => {
    const logs = [
      log(nDaysAgo(0, NOW), "manual"),
      log(nDaysAgo(7, NOW), "meal_plan"), // out of window
      log(nDaysAgo(20, NOW), "manual+plan"), // out of window
    ];
    expect(summariseWeekSources(logs, NOW)).toEqual({
      planOnlyDays: 0,
      manualOnlyDays: 1,
      mixedDays: 0,
      totalLoggedDays: 1,
    });
  });

  it("collapses duplicate logs for the same date and lets the FIRST entry win", () => {
    // HealthContext prepends new logs (`[newLog, ...existing]`), so the
    // entry that appears FIRST in the input array is the most recently
    // written one — that's the source we keep. Here the user typed
    // totals manually first, then went and ticked breakfast, which got
    // prepended → the array starts with "manual+plan" and the day
    // classifies as mixed.
    const today = nDaysAgo(0, NOW);
    const logs = [
      log(today, "manual+plan"),
      log(today, "manual"),
    ];
    expect(summariseWeekSources(logs, NOW)).toEqual({
      planOnlyDays: 0,
      manualOnlyDays: 0,
      mixedDays: 1,
      totalLoggedDays: 1,
    });
  });
});

// ---- buildWeeklySnap with server aggregates ------------------------------

describe("buildWeeklySnap — server aggregates override", () => {
  const NOW = new Date("2026-04-28T12:00:00.000Z").getTime();

  function activity(date: string, mins: number): ActivityLog {
    return {
      id: `${date}-act`,
      date,
      activeMinutes: mins,
      steps: 0,
      calories: 0,
      distance: 0,
    };
  }

  function wellbeing(when: number): WellbeingEntry {
    return {
      id: `wb-${when}`,
      kind: "breathing",
      sessionId: "box-breath",
      sessionName: "Box breath",
      mood: "calm",
      durationSec: 120,
      completedAt: when,
    };
  }

  function nutrition(date: string, calcium: number): NutritionLog {
    return {
      ...log(date, "manual"),
      calcium,
    };
  }

  it("uses client-side computations when no serverAggregates are supplied", () => {
    const snap = buildWeeklySnap({
      now: NOW,
      wellbeingEntries: [wellbeing(NOW - 86_400_000), wellbeing(NOW - 2 * 86_400_000)],
      activityLogs: [
        activity(nDaysAgo(1, new Date(NOW)), 30),
        activity(nDaysAgo(2, new Date(NOW)), 15),
      ],
      nutritionLogs: [
        nutrition(nDaysAgo(0, new Date(NOW)), 1300),
        nutrition(nDaysAgo(1, new Date(NOW)), 800),
      ],
      calciumTargetMg: 1200,
      currentStreak: 4,
      emotionalInsight: "x",
    });
    expect(snap.sessionsCompleted).toBe(2);
    expect(snap.activeMinutes).toBe(45);
    expect(snap.calciumDaysOnTarget).toBe(1);
    expect(snap.calciumTargetMg).toBe(1200);
    expect(snap.currentStreak).toBe(4);
    // Mean per logged day: (1300 + 800) / 2 = 1050.
    expect(snap.averageCalciumMg).toBe(1050);
  });

  it("returns 0 average calcium when there are no logged days", () => {
    const snap = buildWeeklySnap({
      now: NOW,
      wellbeingEntries: [],
      activityLogs: [],
      nutritionLogs: [],
      calciumTargetMg: 1200,
      currentStreak: 0,
      emotionalInsight: "x",
    });
    expect(snap.averageCalciumMg).toBe(0);
  });

  it("uses the server's averageCalciumMg over the client computation", () => {
    const snap = buildWeeklySnap({
      now: NOW,
      wellbeingEntries: [],
      activityLogs: [],
      // Client view says 800 mg / day; server view (other devices) says 1100.
      nutritionLogs: [nutrition(nDaysAgo(0, new Date(NOW)), 800)],
      calciumTargetMg: 1200,
      currentStreak: 0,
      emotionalInsight: "x",
      serverAggregates: { averageCalciumMg: 1100 },
    });
    expect(snap.averageCalciumMg).toBe(1100);
  });

  it("respects an explicit server averageCalciumMg of 0 (no logs server-side)", () => {
    const snap = buildWeeklySnap({
      now: NOW,
      wellbeingEntries: [],
      activityLogs: [],
      // Client thinks there's a log; server says no logs at all.
      nutritionLogs: [nutrition(nDaysAgo(0, new Date(NOW)), 800)],
      calciumTargetMg: 1200,
      currentStreak: 0,
      emotionalInsight: "x",
      serverAggregates: { averageCalciumMg: 0 },
    });
    // 0 is an explicit signal, NOT undefined → server wins.
    expect(snap.averageCalciumMg).toBe(0);
  });

  it("overrides each headline value when the corresponding server field is set", () => {
    const snap = buildWeeklySnap({
      now: NOW,
      // Client-side evidence would say 0/0/0 — server overrides win.
      wellbeingEntries: [],
      activityLogs: [],
      nutritionLogs: [],
      calciumTargetMg: 1200,
      currentStreak: 0,
      emotionalInsight: "x",
      serverAggregates: {
        sessionsCompleted: 6,
        activeMinutes: 145,
        calciumDaysOnTarget: 4,
        calciumTargetMg: 1500,
        currentStreak: 9,
      },
    });
    expect(snap.sessionsCompleted).toBe(6);
    expect(snap.activeMinutes).toBe(145);
    expect(snap.calciumDaysOnTarget).toBe(4);
    expect(snap.calciumTargetMg).toBe(1500);
    expect(snap.currentStreak).toBe(9);
  });

  it("uses server longestStreak when supplied", () => {
    const snap = buildWeeklySnap({
      now: NOW,
      wellbeingEntries: [wellbeing(NOW - 86_400_000)],
      activityLogs: [],
      nutritionLogs: [],
      calciumTargetMg: 1200,
      currentStreak: 1,
      emotionalInsight: "x",
      serverAggregates: { currentStreak: 1, longestStreak: 21 },
    });
    expect(snap.currentStreak).toBe(1);
    expect(snap.longestStreak).toBe(21);
  });

  it("falls back to currentStreak for longestStreak when server does not supply it", () => {
    const snap = buildWeeklySnap({
      now: NOW,
      wellbeingEntries: [],
      activityLogs: [],
      nutritionLogs: [],
      calciumTargetMg: 1200,
      currentStreak: 5,
      emotionalInsight: "x",
      serverAggregates: { currentStreak: 5 },
    });
    // longestStreak not in serverAggregates → falls back to currentStreak.
    expect(snap.longestStreak).toBe(5);
  });

  it("longestStreak is currentStreak when no serverAggregates at all", () => {
    const snap = buildWeeklySnap({
      now: NOW,
      wellbeingEntries: [],
      activityLogs: [],
      nutritionLogs: [],
      calciumTargetMg: 1200,
      currentStreak: 3,
      emotionalInsight: "x",
    });
    expect(snap.longestStreak).toBe(3);
  });

  it("falls back to client values for fields the server didn't supply", () => {
    const snap = buildWeeklySnap({
      now: NOW,
      wellbeingEntries: [wellbeing(NOW - 86_400_000)],
      activityLogs: [activity(nDaysAgo(0, new Date(NOW)), 22)],
      nutritionLogs: [nutrition(nDaysAgo(0, new Date(NOW)), 1300)],
      calciumTargetMg: 1200,
      currentStreak: 5,
      emotionalInsight: "x",
      // Server only has the calcium agg.
      serverAggregates: { calciumDaysOnTarget: 7 },
    });
    // Client values for the un-overridden fields.
    expect(snap.sessionsCompleted).toBe(1);
    expect(snap.activeMinutes).toBe(22);
    expect(snap.currentStreak).toBe(5);
    expect(snap.calciumTargetMg).toBe(1200);
    // Server override for the supplied field.
    expect(snap.calciumDaysOnTarget).toBe(7);
  });

  it("ignores a non-positive server calcium target and keeps the client value", () => {
    const snap = buildWeeklySnap({
      now: NOW,
      wellbeingEntries: [],
      activityLogs: [],
      nutritionLogs: [nutrition(nDaysAgo(0, new Date(NOW)), 1300)],
      calciumTargetMg: 1200,
      currentStreak: 0,
      emotionalInsight: "x",
      serverAggregates: { calciumTargetMg: 0 },
    });
    expect(snap.calciumTargetMg).toBe(1200);
    // ...and the on-target count must still respect the client target.
    expect(snap.calciumDaysOnTarget).toBe(1);
  });

  it("re-computes calciumDaysOnTarget against the server's higher target when no on-target override is given", () => {
    const snap = buildWeeklySnap({
      now: NOW,
      wellbeingEntries: [],
      activityLogs: [],
      nutritionLogs: [
        nutrition(nDaysAgo(0, new Date(NOW)), 1300),
        nutrition(nDaysAgo(1, new Date(NOW)), 1600),
      ],
      calciumTargetMg: 1200,
      currentStreak: 0,
      emotionalInsight: "x",
      // Higher target — only the 1600 day clears it now.
      serverAggregates: { calciumTargetMg: 1500 },
    });
    expect(snap.calciumTargetMg).toBe(1500);
    expect(snap.calciumDaysOnTarget).toBe(1);
  });
});
