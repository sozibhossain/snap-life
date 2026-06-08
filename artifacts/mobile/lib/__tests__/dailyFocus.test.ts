import { beforeEach, describe, expect, it, vi } from "vitest";

// AsyncStorage is imported at module load by dailyFocus.ts but only used
// inside the persistence helpers. We stub it so the import succeeds in
// plain Node.
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import {
  pickAdaptiveTodaysFocus,
  pickTodaysFocus,
  type AdaptivePerKind,
  type FocusInputs,
} from "../dailyFocus";
import {
  EMPTY_BEHAVIOURAL_STATS,
  type BehaviouralStats,
} from "../behaviouralStats";

function behavioural(
  overrides: {
    nutritionLoggedDays7d?: number;
    wellbeingSessions7d?: number;
    activeDays7d?: number;
  } = {},
): BehaviouralStats {
  return {
    ...EMPTY_BEHAVIOURAL_STATS,
    nutrition: {
      ...EMPTY_BEHAVIOURAL_STATS.nutrition,
      loggedDays7d: overrides.nutritionLoggedDays7d ?? 0,
    },
    wellbeing: {
      ...EMPTY_BEHAVIOURAL_STATS.wellbeing,
      sessions7d: overrides.wellbeingSessions7d ?? 0,
    },
    activity: {
      ...EMPTY_BEHAVIOURAL_STATS.activity,
      activeDays7d: overrides.activeDays7d ?? 0,
    },
  };
}

const RECIPE = {
  id: "b1",
  name: "Greek Yogurt & Almond Parfait",
  mealType: "breakfast" as const,
  prepMins: 5,
  calories: 340,
  calcium: 350,
  vitD: 60,
  protein: 22,
  magnesium: 60,
  highlight: "High in calcium and protein.",
  ingredients: [],
  steps: [],
  tags: [],
  vegetarian: true,
  dairyFree: false,
  glutenFree: true,
};

function baseInputs(
  overrides: Partial<FocusInputs> = {},
): FocusInputs {
  return {
    isoDate: "2026-04-28",
    nutritionRecipe: RECIPE,
    nutritionSlot: "breakfast",
    wellbeingEntries: [],
    now: new Date("2026-04-28T08:00:00.000Z").getTime(),
    ...overrides,
  };
}

function stat(
  shown: number,
  completed: number,
  dismissed = 0,
): AdaptivePerKind {
  return {
    shown,
    completed,
    dismissed,
    rate: shown > 0 ? completed / shown : 0,
  };
}

describe("pickAdaptiveTodaysFocus", () => {
  it("falls back to deterministic order when there is no engagement data", () => {
    const inputs = baseInputs();
    const baseline = pickTodaysFocus(inputs);
    const result = pickAdaptiveTodaysFocus({ ...inputs, perKind: {} });

    expect(result.map((a) => a.kind)).toEqual(
      baseline.map((a) => a.kind),
    );
    expect(result.map((a) => a.kind)).toEqual([
      "nutrition",
      "wellbeing",
      "lifestyle",
    ]);
  });

  it("does not let a single 1/1 completion outrank a well-supported lower rate (Wilson shrinkage)", () => {
    // Nutrition is 8/10 = 80% with real sample weight. Wellbeing is 1/1
    // = 100% but on a single observation. Wilson must shrink the 1/1
    // enough that nutrition still leads.
    const result = pickAdaptiveTodaysFocus({
      ...baseInputs(),
      perKind: {
        nutrition: stat(10, 8),
        wellbeing: stat(1, 1),
      },
    });

    const order = result.map((a) => a.kind);
    expect(order[0]).toBe("nutrition");
    expect(order.indexOf("nutrition")).toBeLessThan(
      order.indexOf("wellbeing"),
    );
  });

  it("demotes a kind that the user has actively dismissed", () => {
    // Nutrition is mostly dismissed. Wellbeing has solid completions.
    // Lifestyle has no data and rides the deterministic tiebreak.
    const result = pickAdaptiveTodaysFocus({
      ...baseInputs(),
      perKind: {
        nutrition: stat(20, 2, 18),
        wellbeing: stat(20, 16, 0),
      },
    });

    const order = result.map((a) => a.kind);
    expect(order[0]).toBe("wellbeing");
    expect(order.indexOf("nutrition")).toBeGreaterThan(
      order.indexOf("wellbeing"),
    );
  });

  it("breaks ties by baseline (nutrition → wellbeing → lifestyle) when scores match", () => {
    // All three score 0 (no data, or zero completions). Order should be
    // exactly the deterministic baseline.
    const result = pickAdaptiveTodaysFocus({
      ...baseInputs(),
      perKind: {
        nutrition: stat(10, 0, 0),
        wellbeing: stat(10, 0, 0),
        lifestyle: stat(10, 0, 0),
      },
    });

    expect(result.map((a) => a.kind)).toEqual([
      "nutrition",
      "wellbeing",
      "lifestyle",
    ]);
  });

  it("preserves the one-of-each composition regardless of ordering", () => {
    const result = pickAdaptiveTodaysFocus({
      ...baseInputs(),
      perKind: {
        lifestyle: stat(50, 40, 0),
        wellbeing: stat(30, 20, 0),
      },
    });

    expect(result).toHaveLength(3);
    const kinds = result.map((a) => a.kind).sort();
    expect(kinds).toEqual(["lifestyle", "nutrition", "wellbeing"]);
  });

  // ---- behavioural bias ---------------------------------------------------

  it("ignores `behavioural: null` and behaves as if Wilson-only", () => {
    const result = pickAdaptiveTodaysFocus({
      ...baseInputs(),
      perKind: { nutrition: stat(10, 8) },
      behavioural: null,
    });
    expect(result.map((a) => a.kind)[0]).toBe("nutrition");
  });

  it("treats an empty behavioural snapshot as zero bias", () => {
    const result = pickAdaptiveTodaysFocus({
      ...baseInputs(),
      perKind: {},
      behavioural: EMPTY_BEHAVIOURAL_STATS,
    });
    expect(result.map((a) => a.kind)).toEqual([
      "nutrition",
      "wellbeing",
      "lifestyle",
    ]);
  });

  it("promotes wellbeing when the user has been doing sessions, even with no rec_* engagement", () => {
    // No rec_* events anywhere → all Wilson scores 0. Behavioural bias
    // is the only differentiator: a strong wellbeing habit (5+ sessions)
    // pulls wellbeing above the deterministic baseline.
    const result = pickAdaptiveTodaysFocus({
      ...baseInputs(),
      perKind: {},
      behavioural: behavioural({ wellbeingSessions7d: 5 }),
    });
    expect(result.map((a) => a.kind)[0]).toBe("wellbeing");
  });

  it("promotes lifestyle on top of an active week with no rec_* signal", () => {
    const result = pickAdaptiveTodaysFocus({
      ...baseInputs(),
      perKind: {},
      behavioural: behavioural({ activeDays7d: 6 }),
    });
    expect(result.map((a) => a.kind)[0]).toBe("lifestyle");
  });

  it("caps the behavioural bias at +0.25 so a clear Wilson lead still wins", () => {
    // Nutrition has a strong Wilson lead (8/10 ≈ 0.6 lower bound).
    // Wellbeing has no rec_* engagement but lots of sessions — bias
    // adds at most +0.25, which can't catch up to nutrition's Wilson.
    const result = pickAdaptiveTodaysFocus({
      ...baseInputs(),
      perKind: {
        nutrition: stat(10, 8),
      },
      behavioural: behavioural({ wellbeingSessions7d: 50 }),
    });
    expect(result.map((a) => a.kind)[0]).toBe("nutrition");
  });

  it("uses bias to break ties when Wilson scores are equal", () => {
    // Both nutrition and wellbeing have identical 5/10 Wilson scores.
    // Wellbeing has 4 sessions of behavioural support → bias tips it
    // above nutrition.
    const result = pickAdaptiveTodaysFocus({
      ...baseInputs(),
      perKind: {
        nutrition: stat(10, 5),
        wellbeing: stat(10, 5),
      },
      behavioural: behavioural({ wellbeingSessions7d: 4 }),
    });
    const order = result.map((a) => a.kind);
    expect(order.indexOf("wellbeing")).toBeLessThan(order.indexOf("nutrition"));
  });
});
