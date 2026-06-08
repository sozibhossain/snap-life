/**
 * Personalisation engine for the SNAP Life Meal Plan & Nutrition section.
 *
 * Pure, side-effect-free helpers that:
 *   - derive sensible daily nutritional targets from the user's profile
 *     (age / gender / bone-health condition / FRAX risk band)
 *   - suggest supplement support when the user's profile or condition
 *     warrants extra cover
 *   - assemble a deterministic "today's plan" from the recipe library that
 *     respects vegetarian / dairy-free preferences and feels different on
 *     each regenerate (via a seed) without becoming chaotic
 *   - select a swap candidate for any meal slot
 *
 * Targets follow widely cited UK / NHS-aligned guidance for adult bone
 * health and are intentionally rounded for clarity. They are NOT medical
 * advice — the UI presents them as supportive daily goals, not prescriptions.
 */

import type { MealType, Recipe } from "./nutritionData";
import { RECIPES } from "./nutritionData";

export type FractureRisk = "low" | "moderate" | "high";
export type Condition = "osteoporosis" | "osteopenia" | "at_risk" | "healthy";

export interface ProfileInputs {
  age?: number;
  gender?: string;
  condition?: Condition;
  fractureRisk: FractureRisk;
}

export interface NutritionTargets {
  /** mg/day */
  calcium: number;
  /** IU/day */
  vitaminD: number;
  /** g/day */
  protein: number;
  /** mg/day */
  magnesium: number;
  /** kcal/day — soft anchor used to size the daily plan */
  calories: number;
}

export interface SupplementSuggestion {
  id: string;
  name: string;
  reason: string;
  /** Optional dosing hint, kept general — not medical advice. */
  hint?: string;
}

export interface DietaryPreferences {
  vegetarian: boolean;
  dairyFree: boolean;
  glutenFree: boolean;
}

export interface DailyPlan {
  /** YYYY-MM-DD */
  date: string;
  recipes: Record<MealType, string>;
  /** Used to vary plans on regenerate. */
  regenSeed: number;
}

// ---- Targets --------------------------------------------------------------

/**
 * Derives a target object the user can comfortably aim for. Bumps calcium and
 * vitamin D when osteopenia / osteoporosis is reported or when the calculated
 * fracture-risk band is elevated, and nudges protein up for older adults
 * (1.0–1.2 g per kg body weight, assuming a 65kg reference).
 */
export function deriveTargets(inputs: ProfileInputs): NutritionTargets {
  const age = inputs.age ?? 50;
  const female = (inputs.gender ?? "").toLowerCase().startsWith("f");

  // Calcium baseline 1000mg, raised for older adults and elevated bone risk.
  let calcium = 1000;
  if (age >= 50 && female) calcium = 1200;
  if (age >= 70) calcium = 1200;
  if (inputs.condition === "osteopenia") calcium = Math.max(calcium, 1200);
  if (inputs.condition === "osteoporosis" || inputs.fractureRisk === "high") {
    calcium = 1300;
  }

  // Vitamin D — UK NHS baseline is 400 IU; bone health guidance commonly sits
  // at 800 IU+, with higher cover for osteoporosis or high-risk individuals.
  let vitaminD = 800;
  if (age >= 70) vitaminD = 1000;
  if (inputs.condition === "osteoporosis" || inputs.fractureRisk === "high") {
    vitaminD = 2000;
  }

  // Protein — 0.8 g/kg general; older adults benefit from 1.0–1.2 g/kg.
  // Reference body weight 65kg; gives a clean integer goal we can present.
  let proteinPerKg = 0.8;
  if (age >= 60) proteinPerKg = 1.0;
  if (age >= 70 || inputs.condition === "osteoporosis") proteinPerKg = 1.2;
  const protein = Math.round(65 * proteinPerKg);

  // Magnesium — 320mg women / 420mg men is a common adult RDA.
  const magnesium = female ? 320 : 420;

  // Calories — used only to anchor the size of a balanced day in the UI.
  const calories = female ? 1900 : 2200;

  return { calcium, vitaminD, protein, magnesium, calories };
}

// ---- Supplements ----------------------------------------------------------

/**
 * Returns supportive, general-population supplement suggestions tailored to
 * the user's profile. Phrased as gentle suggestions, never instructions.
 */
export function suggestSupplements(inputs: ProfileInputs): SupplementSuggestion[] {
  const out: SupplementSuggestion[] = [];

  // The UK NHS suggests a daily 10µg / 400 IU vitamin D for everyone in
  // autumn/winter — we always surface this as supportive guidance.
  out.push({
    id: "vitd",
    name: "Vitamin D3",
    reason: "Supports calcium absorption — UK guidance recommends a daily top-up, especially in autumn and winter.",
    hint: "10–25 μg (400–1000 IU) daily",
  });

  if (
    inputs.condition === "osteoporosis" ||
    inputs.condition === "osteopenia" ||
    inputs.fractureRisk === "high"
  ) {
    out.push({
      id: "ca",
      name: "Calcium (top-up)",
      reason: "Considered when food alone doesn't reliably reach your daily target.",
      hint: "500 mg with a meal",
    });
  }

  if ((inputs.age ?? 0) >= 60 || inputs.condition === "osteoporosis") {
    out.push({
      id: "mg",
      name: "Magnesium",
      reason: "Works with calcium and vitamin D — quietly supports bone metabolism.",
      hint: "200–300 mg daily",
    });
  }

  if (inputs.condition === "osteoporosis" || inputs.fractureRisk === "high") {
    out.push({
      id: "k2",
      name: "Vitamin K2",
      reason: "Helps direct calcium toward bones rather than soft tissue.",
      hint: "100 μg daily",
    });
  }

  return out;
}

// ---- Filtering ------------------------------------------------------------

/**
 * Multi-axis dietary filter: every active preference must be satisfied
 * (logical AND). With all three on, the user only sees vegetarian +
 * dairy-free + gluten-free recipes.
 */
export function filterRecipes(
  pool: Recipe[],
  prefs: DietaryPreferences,
): Recipe[] {
  return pool.filter((r) => {
    if (prefs.vegetarian && !r.vegetarian) return false;
    if (prefs.dairyFree && !r.dairyFree) return false;
    if (prefs.glutenFree && !r.glutenFree) return false;
    return true;
  });
}

// ---- Plan generation ------------------------------------------------------

/**
 * Tiny deterministic hash so the same (date + seed) combination always yields
 * the same plan — important for the "swap is sticky for today" UX.
 */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

/**
 * Picks a meal of `mealType` from the filtered pool using a deterministic
 * index derived from (date, seed, mealType). Falls back to the unfiltered
 * pool for that meal type if filters leave nothing — the user always gets a
 * plan, even with strict dietary settings and a small library.
 */
function pickMeal(
  mealType: MealType,
  prefs: DietaryPreferences,
  date: string,
  seed: number,
): Recipe {
  const allOfType = RECIPES.filter((r) => r.mealType === mealType);
  let pool = filterRecipes(allOfType, prefs);
  if (pool.length === 0) pool = allOfType;
  const idx = (hashString(`${date}|${seed}|${mealType}`) % pool.length + pool.length) % pool.length;
  return pool[idx];
}

export function generatePlan(
  date: string,
  prefs: DietaryPreferences,
  seed: number,
): DailyPlan {
  const recipes = {} as Record<MealType, string>;
  for (const mt of MEAL_TYPES) {
    recipes[mt] = pickMeal(mt, prefs, date, seed).id;
  }
  return { date, recipes, regenSeed: seed };
}

/**
 * Returns a different recipe of the same meal type that respects current
 * preferences and isn't already in the plan. Cycles back to the start if
 * everything has been seen.
 */
export function pickSwap(
  currentRecipeId: string,
  mealType: MealType,
  prefs: DietaryPreferences,
  inPlanIds: string[],
): Recipe | null {
  const allOfType = RECIPES.filter((r) => r.mealType === mealType);
  let pool = filterRecipes(allOfType, prefs);
  if (pool.length === 0) pool = allOfType;
  if (pool.length <= 1) return null;

  const currentIndex = pool.findIndex((r) => r.id === currentRecipeId);
  // Walk the pool from the next index, skipping any recipe already in the
  // user's current plan so swaps move the day forward, not sideways.
  for (let step = 1; step <= pool.length; step++) {
    const candidate = pool[(currentIndex + step + pool.length) % pool.length];
    if (candidate.id === currentRecipeId) continue;
    if (inPlanIds.includes(candidate.id)) continue;
    return candidate;
  }
  // Fallback: any recipe other than the current one.
  return pool.find((r) => r.id !== currentRecipeId) ?? null;
}

// ---- Totals ---------------------------------------------------------------

export interface PlanTotals {
  calcium: number;
  vitaminD: number;
  protein: number;
  magnesium: number;
  calories: number;
}

export function computeTotals(plan: DailyPlan): PlanTotals {
  const totals: PlanTotals = {
    calcium: 0,
    vitaminD: 0,
    protein: 0,
    magnesium: 0,
    calories: 0,
  };
  for (const mt of MEAL_TYPES) {
    const r = RECIPES.find((x) => x.id === plan.recipes[mt]);
    if (!r) continue;
    totals.calcium += r.calcium;
    totals.vitaminD += r.vitD;
    totals.protein += r.protein;
    totals.magnesium += r.magnesium;
    totals.calories += r.calories;
  }
  return totals;
}

export const MEAL_TYPE_ORDER = MEAL_TYPES;
