import { describe, expect, it } from "vitest";
import {
  EMPTY_LOG,
  ZERO_TOTALS,
  applyMealToggle,
  applyManualUpsert,
  deriveManualTotals,
  hydrateNutritionLog,
  scaleContribution,
} from "../nutritionBridge";

const yogurt = {
  calcium: 200,
  vitaminD: 60,
  protein: 8,
  magnesium: 30,
  calories: 150,
  recipeName: "Greek Yogurt Bowl",
};

describe("applyMealToggle", () => {
  it("adds the contribution when ticking an unticked slot", () => {
    const next = applyMealToggle(EMPTY_LOG, "breakfast", yogurt);
    expect(next.calcium).toBe(200);
    expect(next.vitaminD).toBe(60);
    expect(next.protein).toBe(8);
    expect(next.magnesium).toBe(30);
    expect(next.calories).toBe(150);
    expect(next.mealsCompleted.breakfast).toBe(true);
    expect(next.meals).toEqual([
      { name: "breakfast", items: ["Greek Yogurt Bowl"] },
    ]);
    expect(next.source).toBe("meal_plan");
  });

  it("subtracts and untoggles on a re-tap (idempotent)", () => {
    const ticked = applyMealToggle(EMPTY_LOG, "lunch", yogurt);
    const untapped = applyMealToggle(ticked, "lunch", yogurt);
    expect(untapped.calcium).toBe(0);
    expect(untapped.protein).toBe(0);
    expect(untapped.magnesium).toBe(0);
    expect(untapped.mealsCompleted.lunch).toBe(false);
    expect(untapped.meals).toEqual([]);
  });

  it("clamps totals at zero so manual edits cannot drive a re-tap negative", () => {
    // Edge case: user ticks a meal (calcium → 200), then manually
    // overrides calcium down to 50, then re-taps the meal to untick.
    // Without clamping the result would be -150; the bridge must hold
    // it at 0 so downstream rings/percentages stay sane.
    const ticked = applyMealToggle(EMPTY_LOG, "snack", yogurt);
    const overridden = applyManualUpsert(ticked, { calcium: 50 });
    const untapped = applyMealToggle(overridden, "snack", yogurt);
    expect(untapped.calcium).toBe(0);
  });

  it("flips source to manual+plan when the day already had manual entries", () => {
    const manualOnly = applyManualUpsert(EMPTY_LOG, {
      calcium: 400,
      source: "manual",
    });
    const ticked = applyMealToggle(manualOnly, "dinner", yogurt);
    expect(ticked.source).toBe("manual+plan");
  });

  it("falls back to manual when all plan ticks are removed but manual existed", () => {
    const manualOnly = applyManualUpsert(EMPTY_LOG, {
      calcium: 400,
      source: "manual",
    });
    const ticked = applyMealToggle(manualOnly, "dinner", yogurt);
    const untapped = applyMealToggle(ticked, "dinner", yogurt);
    expect(untapped.source).toBe("manual");
  });

  it("supports multiple slots ticked at the same time", () => {
    const a = applyMealToggle(EMPTY_LOG, "breakfast", yogurt);
    const b = applyMealToggle(a, "dinner", { ...yogurt, calcium: 300 });
    expect(b.calcium).toBe(500);
    expect(b.mealsCompleted.breakfast).toBe(true);
    expect(b.mealsCompleted.dinner).toBe(true);
  });
});

describe("applyManualUpsert", () => {
  it("replaces numeric fields rather than adding to them", () => {
    const initial = applyMealToggle(EMPTY_LOG, "breakfast", yogurt);
    const after = applyManualUpsert(initial, { calcium: 1000 });
    expect(after.calcium).toBe(1000);
    expect(after.protein).toBe(8);
  });

  it("preserves the meals[] log when not explicitly overridden", () => {
    const ticked = applyMealToggle(EMPTY_LOG, "breakfast", yogurt);
    const after = applyManualUpsert(ticked, { calcium: 500 });
    expect(after.meals).toEqual(ticked.meals);
    expect(after.mealsCompleted.breakfast).toBe(true);
  });

  it("preserves planTotals through a manual edit (does not zero them out)", () => {
    const ticked = applyMealToggle(EMPTY_LOG, "breakfast", yogurt);
    expect(ticked.planTotals.calcium).toBe(200);
    const after = applyManualUpsert(ticked, { calcium: 500 });
    // Provenance line on Bone Tracker depends on this — manual edits
    // must NEVER reset the plan-attributed share.
    expect(after.planTotals.calcium).toBe(200);
    expect(after.calcium).toBe(500);
  });
});

describe("applyMealToggle: swap-after-marked safety", () => {
  // The reviewer's blocking concern: if the user marks Breakfast as
  // eaten, then swaps the recipe (regenerate or manual swap), then
  // un-taps, we MUST subtract the originally-credited contribution —
  // not the new recipe's nutrients — otherwise totals/planTotals get
  // corrupted (stuck high, or driven negative-then-clamped).
  it("subtracts the ORIGINAL contribution on un-tap even after swap", () => {
    const ticked = applyMealToggle(EMPTY_LOG, "breakfast", yogurt);
    expect(ticked.calcium).toBe(200);
    expect(ticked.mealsContributions.breakfast).toEqual({ ...yogurt });

    // User swaps the breakfast recipe; the next tap on the same slot
    // passes a DIFFERENT contribution.
    const swappedRecipe = {
      calcium: 500,
      vitaminD: 0,
      protein: 20,
      magnesium: 5,
      calories: 800,
      recipeName: "Cheesy Omelette",
    };
    const untapped = applyMealToggle(ticked, "breakfast", swappedRecipe);

    // Totals should snap exactly back to zero — proving we used the
    // frozen yogurt contribution, NOT the swapped one. With the bug,
    // calcium would clamp to 0 but the planTotals math would silently
    // be wrong on subsequent re-taps.
    expect(untapped.calcium).toBe(0);
    expect(untapped.protein).toBe(0);
    expect(untapped.planTotals).toEqual(ZERO_TOTALS);
    // Frozen snapshot is cleared on un-tap.
    expect(untapped.mealsContributions.breakfast).toBeUndefined();
    // And the original recipe entry is removed from meals[].
    expect(untapped.meals).toEqual([]);
  });

  it("does NOT corrupt totals when re-tap-after-swap-after-untap", () => {
    // Mark yogurt → un-tap (clean) → mark a new swapped recipe → un-tap
    // again. Each cycle should net to zero on its own.
    const t1 = applyMealToggle(EMPTY_LOG, "lunch", yogurt);
    const u1 = applyMealToggle(t1, "lunch", yogurt);
    expect(u1.calcium).toBe(0);

    const swapped = {
      calcium: 350,
      vitaminD: 100,
      protein: 25,
      magnesium: 60,
      calories: 500,
      recipeName: "Salmon Bowl",
    };
    const t2 = applyMealToggle(u1, "lunch", swapped);
    expect(t2.calcium).toBe(350);
    expect(t2.mealsContributions.lunch).toEqual({ ...swapped });

    // Now hand applyMealToggle a THIRD different contribution — should
    // still be ignored in favour of the frozen `swapped` snapshot.
    const u2 = applyMealToggle(t2, "lunch", { calcium: 9999, protein: 0 });
    expect(u2.calcium).toBe(0);
    expect(u2.protein).toBe(0);
    expect(u2.planTotals).toEqual(ZERO_TOTALS);
  });

  it("preserves swap safety alongside manual edits", () => {
    const ticked = applyMealToggle(EMPTY_LOG, "dinner", yogurt);
    // User manually adds 300 mg calcium on top of the 200 mg yogurt
    const after = applyManualUpsert(ticked, { calcium: 500 });
    expect(after.mealsContributions.dinner).toEqual({ ...yogurt });

    // Slot gets swapped; user un-taps with a wildly different recipe.
    const u = applyMealToggle(after, "dinner", {
      calcium: 50,
      protein: 1,
      recipeName: "Wrong Recipe",
    });
    // Yogurt's 200 mg removed cleanly → 500 - 200 = 300 mg of MANUAL
    // calcium remains, planTotals goes to 0, manual share is the full
    // residual.
    expect(u.calcium).toBe(300);
    expect(u.planTotals.calcium).toBe(0);
    expect(deriveManualTotals(u).calcium).toBe(300);
  });

  it("hydrates legacy logs without mealsContributions and still works", () => {
    const legacy = hydrateNutritionLog({
      id: "old",
      date: "2026-04-29",
      calcium: 200,
      protein: 8,
      magnesium: 30,
      vitaminD: 60,
      calories: 150,
      mealsCompleted: { breakfast: true },
      planTotals: { calcium: 200, vitaminD: 60, protein: 8, magnesium: 30, calories: 150 },
      // no mealsContributions
    });
    expect(legacy.mealsContributions).toEqual({});
    // Legacy back-compat path: with no frozen snapshot, applyMealToggle
    // falls back to the live contribution (best effort for old logs).
    const untapped = applyMealToggle(legacy, "breakfast", yogurt);
    expect(untapped.calcium).toBe(0);
  });
});

describe("planTotals tracking on toggles", () => {
  it("starts at zero for an empty log", () => {
    expect(EMPTY_LOG.planTotals).toEqual(ZERO_TOTALS);
  });

  it("adds to planTotals when a meal is ticked", () => {
    const next = applyMealToggle(EMPTY_LOG, "lunch", yogurt);
    expect(next.planTotals.calcium).toBe(200);
    expect(next.planTotals.vitaminD).toBe(60);
    expect(next.planTotals.magnesium).toBe(30);
  });

  it("subtracts from planTotals on re-tap (idempotent)", () => {
    const ticked = applyMealToggle(EMPTY_LOG, "snack", yogurt);
    const untapped = applyMealToggle(ticked, "snack", yogurt);
    expect(untapped.planTotals).toEqual(ZERO_TOTALS);
  });

  it("clamps planTotals at zero on re-tap even after manual override", () => {
    const ticked = applyMealToggle(EMPTY_LOG, "dinner", yogurt);
    // User manually drives totals down; planTotals stay tracked
    const overridden = applyManualUpsert(ticked, { calcium: 50 });
    expect(overridden.planTotals.calcium).toBe(200);
    // Re-tapping the meal must not push planTotals into the negatives
    const untapped = applyMealToggle(overridden, "dinner", yogurt);
    expect(untapped.planTotals.calcium).toBe(0);
  });

  it("accumulates planTotals across multiple ticked slots", () => {
    const a = applyMealToggle(EMPTY_LOG, "breakfast", yogurt);
    const b = applyMealToggle(a, "dinner", { ...yogurt, calcium: 300 });
    expect(b.planTotals.calcium).toBe(500);
    expect(b.planTotals.protein).toBe(16);
  });
});

describe("deriveManualTotals", () => {
  it("returns zeros when totals equal planTotals (pure plan day)", () => {
    const ticked = applyMealToggle(EMPTY_LOG, "breakfast", yogurt);
    const manual = deriveManualTotals(ticked);
    expect(manual).toEqual(ZERO_TOTALS);
  });

  it("returns the delta when manual edits add on top of a plan tick", () => {
    const ticked = applyMealToggle(EMPTY_LOG, "breakfast", yogurt);
    // Manual edit pushes calcium to 500 (200 plan + 300 manual)
    const after = applyManualUpsert(ticked, { calcium: 500 });
    const manual = deriveManualTotals(after);
    expect(manual.calcium).toBe(300);
    // Other fields unchanged → manual portion is zero
    expect(manual.protein).toBe(0);
  });

  it("clamps at zero when user manually drove totals BELOW plan share", () => {
    const ticked = applyMealToggle(EMPTY_LOG, "breakfast", yogurt);
    const after = applyManualUpsert(ticked, { calcium: 50 });
    const manual = deriveManualTotals(after);
    // Provenance must never go negative; the visible "manual"
    // contribution is pinned at 0 in this rare case.
    expect(manual.calcium).toBe(0);
  });
});

describe("scaleContribution", () => {
  it("multiplies every numeric field by the multiplier", () => {
    const scaled = scaleContribution(yogurt, 0.5);
    expect(scaled.calcium).toBe(100);
    expect(scaled.vitaminD).toBe(30);
    expect(scaled.protein).toBe(4);
    expect(scaled.magnesium).toBe(15);
    expect(scaled.calories).toBe(75);
  });

  it("preserves recipeName untouched", () => {
    const scaled = scaleContribution(yogurt, 2);
    expect(scaled.recipeName).toBe("Greek Yogurt Bowl");
  });

  it("leaves undefined fields undefined", () => {
    const scaled = scaleContribution({ calcium: 200 }, 2);
    expect(scaled.calcium).toBe(400);
    expect(scaled.protein).toBeUndefined();
  });
});

describe("applyMealToggle: portion multipliers", () => {
  it("scales the contribution by portionMultiplier when ticking", () => {
    const next = applyMealToggle(EMPTY_LOG, "breakfast", yogurt, 2);
    expect(next.calcium).toBe(400);
    expect(next.vitaminD).toBe(120);
    expect(next.protein).toBe(16);
    expect(next.magnesium).toBe(60);
    expect(next.calories).toBe(300);
    expect(next.mealsCompleted.breakfast).toBe(true);
    expect(next.mealPortions.breakfast).toBe(2);
    // Frozen snapshot stores the SCALED contribution so a future
    // un-tap reverses the right amount.
    expect(next.mealsContributions.breakfast?.calcium).toBe(400);
  });

  it("supports half portions (0.5×)", () => {
    const next = applyMealToggle(EMPTY_LOG, "lunch", yogurt, 0.5);
    expect(next.calcium).toBe(100);
    expect(next.protein).toBe(4);
    expect(next.planTotals.calcium).toBe(100);
    expect(next.mealPortions.lunch).toBe(0.5);
  });

  it("defaults to 1× when portionMultiplier is omitted", () => {
    const next = applyMealToggle(EMPTY_LOG, "breakfast", yogurt);
    expect(next.calcium).toBe(200);
    // mealPortions is back-filled to 1 for ticked slots so the UI
    // can reflect the implicit default on the stepper.
    expect(next.mealPortions.breakfast).toBe(1);
  });

  it("subtracts the SCALED contribution on a same-portion re-tap", () => {
    const ticked = applyMealToggle(EMPTY_LOG, "snack", yogurt, 1.5);
    expect(ticked.calcium).toBe(300);
    const untapped = applyMealToggle(ticked, "snack", yogurt, 1.5);
    expect(untapped.calcium).toBe(0);
    expect(untapped.planTotals).toEqual(ZERO_TOTALS);
    expect(untapped.mealsCompleted.snack).toBe(false);
    expect(untapped.mealPortions.snack).toBeUndefined();
    expect(untapped.mealsContributions.snack).toBeUndefined();
  });

  it("re-applies in place when the portion changes (does not toggle off)", () => {
    // User ticks breakfast at 1× → 200 mg calcium.
    const ticked = applyMealToggle(EMPTY_LOG, "breakfast", yogurt, 1);
    expect(ticked.calcium).toBe(200);
    // User then bumps the portion to 2× — totals should jump from
    // 200 to 400 (NOT zero out and re-add — this is what proves the
    // bridge subtracted the previous 200 before adding the new 400).
    const repointed = applyMealToggle(ticked, "breakfast", yogurt, 2);
    expect(repointed.calcium).toBe(400);
    expect(repointed.protein).toBe(16);
    expect(repointed.planTotals.calcium).toBe(400);
    expect(repointed.mealsCompleted.breakfast).toBe(true);
    expect(repointed.mealPortions.breakfast).toBe(2);
    expect(repointed.mealsContributions.breakfast?.calcium).toBe(400);
  });

  it("can scale DOWN (1× → ½×) without drifting totals", () => {
    const ticked = applyMealToggle(EMPTY_LOG, "dinner", yogurt, 1);
    const halved = applyMealToggle(ticked, "dinner", yogurt, 0.5);
    expect(halved.calcium).toBe(100);
    expect(halved.protein).toBe(4);
    expect(halved.planTotals.calcium).toBe(100);
    expect(halved.mealsCompleted.dinner).toBe(true);
    expect(halved.mealPortions.dinner).toBe(0.5);
  });

  it("does not double-count after bouncing between portions", () => {
    // 1× → 2× → ½× → un-tap. Each step should net to the right
    // total; final un-tap must zero everything out cleanly.
    const a = applyMealToggle(EMPTY_LOG, "lunch", yogurt, 1);
    expect(a.calcium).toBe(200);
    const b = applyMealToggle(a, "lunch", yogurt, 2);
    expect(b.calcium).toBe(400);
    const c = applyMealToggle(b, "lunch", yogurt, 0.5);
    expect(c.calcium).toBe(100);
    const d = applyMealToggle(c, "lunch", yogurt, 0.5);
    expect(d.calcium).toBe(0);
    expect(d.planTotals).toEqual(ZERO_TOTALS);
    expect(d.mealsCompleted.lunch).toBe(false);
  });

  it("preserves swap-safety when changing portion (subtracts FROZEN snapshot, not live recipe)", () => {
    // Tick yogurt at 1× → 200 mg. Then user swaps the recipe AND
    // bumps to 2× in the same re-tap. The bridge must subtract the
    // frozen yogurt 1× snapshot (200), not the live swappedRecipe.
    const ticked = applyMealToggle(EMPTY_LOG, "breakfast", yogurt, 1);
    const swappedRecipe = {
      calcium: 500,
      vitaminD: 0,
      protein: 20,
      magnesium: 5,
      calories: 800,
      recipeName: "Cheesy Omelette",
    };
    const next = applyMealToggle(ticked, "breakfast", swappedRecipe, 2);
    // 200 (subtract yogurt 1×) + 1000 (add swappedRecipe 2×) = 1000
    expect(next.calcium).toBe(1000);
    expect(next.protein).toBe(40);
    expect(next.planTotals.calcium).toBe(1000);
    expect(next.mealsCompleted.breakfast).toBe(true);
    expect(next.mealPortions.breakfast).toBe(2);
    // Snapshot is updated to the new scaled contribution
    expect(next.mealsContributions.breakfast?.calcium).toBe(1000);
    // meals[] swaps the recipe entry too: old yogurt removed, new
    // omelette added.
    expect(next.meals).toEqual([
      { name: "breakfast", items: ["Cheesy Omelette"] },
    ]);
  });

  it("preserves planTotals provenance through portion changes (Bone Tracker bridge math holds)", () => {
    // Tick yogurt at 1× plan share (200 mg), then user adds 300 mg
    // calcium manually on top → totals 500, planTotals 200,
    // manual = 300.
    const ticked = applyMealToggle(EMPTY_LOG, "lunch", yogurt, 1);
    const withManual = applyManualUpsert(ticked, { calcium: 500 });
    expect(deriveManualTotals(withManual).calcium).toBe(300);

    // Now user bumps lunch to 2× → plan share should be 400, manual
    // share should still be 300 (unchanged — manual edits don't move
    // when plan portion does), totals 700.
    const repointed = applyMealToggle(withManual, "lunch", yogurt, 2);
    expect(repointed.calcium).toBe(700);
    expect(repointed.planTotals.calcium).toBe(400);
    expect(deriveManualTotals(repointed).calcium).toBe(300);
  });

  it("hydrates legacy logs without mealPortions and applies sensible defaults", () => {
    const legacy = hydrateNutritionLog({
      id: "old",
      date: "2026-04-29",
      calcium: 200,
      vitaminD: 60,
      protein: 8,
      magnesium: 30,
      calories: 150,
      mealsCompleted: { breakfast: true },
      planTotals: {
        calcium: 200,
        vitaminD: 60,
        protein: 8,
        magnesium: 30,
        calories: 150,
      },
      mealsContributions: { breakfast: { ...yogurt } },
      // no mealPortions
    });
    expect(legacy.mealPortions).toEqual({});
    // Re-tap with default portion 1 should still cleanly zero out.
    const untapped = applyMealToggle(legacy, "breakfast", yogurt, 1);
    expect(untapped.calcium).toBe(0);
    expect(untapped.mealsCompleted.breakfast).toBe(false);
  });
});

describe("hydrateNutritionLog", () => {
  it("backfills planTotals = ZERO_TOTALS for legacy persisted logs", () => {
    const legacy = {
      id: "1",
      date: "2026-04-29",
      calcium: 400,
      vitaminD: 200,
      protein: 30,
      calories: 800,
      meals: [],
      // no magnesium, no source, no mealsCompleted, no planTotals
    };
    const hydrated = hydrateNutritionLog(legacy);
    expect(hydrated.magnesium).toBe(0);
    expect(hydrated.source).toBe("manual");
    expect(hydrated.mealsCompleted).toEqual({});
    expect(hydrated.planTotals).toEqual(ZERO_TOTALS);
    // Existing fields preserved
    expect(hydrated.calcium).toBe(400);
    expect(hydrated.protein).toBe(30);
  });

  it("preserves planTotals when persisted by a newer build", () => {
    const persisted = {
      id: "2",
      date: "2026-04-29",
      calcium: 500,
      vitaminD: 300,
      protein: 40,
      magnesium: 80,
      calories: 900,
      meals: [],
      source: "manual+plan",
      mealsCompleted: { breakfast: true },
      planTotals: {
        calcium: 200,
        vitaminD: 60,
        protein: 8,
        magnesium: 30,
        calories: 150,
      },
    };
    const hydrated = hydrateNutritionLog(persisted);
    expect(hydrated.planTotals.calcium).toBe(200);
    expect(hydrated.planTotals.vitaminD).toBe(60);
    expect(hydrated.source).toBe("manual+plan");
    expect(hydrated.mealsCompleted.breakfast).toBe(true);
    // deriveManualTotals from the hydrated log should give the manual share
    const manual = deriveManualTotals(hydrated);
    expect(manual.calcium).toBe(300);
    expect(manual.vitaminD).toBe(240);
  });

  it("coerces invalid source values back to 'manual'", () => {
    const garbage = { id: "3", date: "2026-04-29", source: "wat" };
    const hydrated = hydrateNutritionLog(garbage);
    expect(hydrated.source).toBe("manual");
  });
});
