
export type NutritionMealKey = "breakfast" | "lunch" | "dinner" | "snack";

export type NutritionSource = "manual" | "meal_plan" | "manual+plan";

/** Subset of a NutritionLog's numeric fields. Stored separately for the
 *  meal-plan tick contribution so the Bone Tracker can render a
 *  quantified "X mg from meal plan, Y added manually" provenance line.
 *  Manual contribution is derived as `max(0, total - planTotals)`. */
export interface NutritionTotals {
  calcium: number;
  vitaminD: number;
  /** Vitamin K2 in micrograms. Optional on legacy meal-plan payloads. */
  vitaminK2?: number;
  protein: number;
  magnesium: number;
  calories: number;
}

export const ZERO_TOTALS: NutritionTotals = {
  calcium: 0,
  vitaminD: 0,
  vitaminK2: 0,
  protein: 0,
  magnesium: 0,
  calories: 0,
};

export interface BridgeNutritionLog extends NutritionTotals {
  /** Optional manually tracked nutrients that are not part of meal-plan maths. */
  otherNutrients?: Record<string, number>;
  source: NutritionSource;
  mealsCompleted: Partial<Record<NutritionMealKey, boolean>>;
  meals: { name: string; items: string[] }[];
  /** Per-nutrient sum of contributions added by Mark-as-eaten ticks.
   *  Reduced (clamped at 0) when a tick is undone. */
  planTotals: NutritionTotals;
  /** Frozen snapshot of the contribution that was credited when each
   *  slot was marked eaten. Used on un-toggle so we subtract the
   *  ORIGINAL nutrients credited, not whatever recipe is currently
   *  rendered on screen (the user might have swapped/regenerated the
   *  slot in between). Cleared per-slot when the slot is un-toggled.
   *  Values are already scaled by the selected portionMultiplier. */
  mealsContributions: Partial<Record<NutritionMealKey, MealContribution>>;
  /** Portion multiplier (½, 1, 1½, 2 …) the user picked for each
   *  ticked slot. Used to detect a "change portion while eaten"
   *  re-tap so we can subtract the previous portion's contribution
   *  before applying the new one (totals never drift). Cleared when
   *  the slot is un-ticked. Older logs persisted before this field
   *  existed are back-filled to {} on hydration. */
  mealPortions: Partial<Record<NutritionMealKey, number>>;
}

export interface MealContribution {
  calcium?: number;
  vitaminD?: number;
  vitaminK2?: number;
  protein?: number;
  magnesium?: number;
  calories?: number;
  recipeName?: string;
}

export const EMPTY_LOG: BridgeNutritionLog = {
  calcium: 0,
  vitaminD: 0,
  vitaminK2: 0,
  protein: 0,
  magnesium: 0,
  calories: 0,
  source: "meal_plan",
  mealsCompleted: {},
  meals: [],
  planTotals: { ...ZERO_TOTALS },
  mealsContributions: {},
  mealPortions: {},
};

/** Multiply each numeric field of a meal contribution by a portion
 *  multiplier (e.g. 0.5 for "½" or 2 for "double"). recipeName is
 *  preserved untouched so meals[] bookkeeping still works. */
export function scaleContribution(
  contribution: MealContribution,
  portionMultiplier: number,
): MealContribution {
  return {
    calcium:
      contribution.calcium != null
        ? contribution.calcium * portionMultiplier
        : undefined,
    vitaminD:
      contribution.vitaminD != null
        ? contribution.vitaminD * portionMultiplier
        : undefined,
    vitaminK2:
      contribution.vitaminK2 != null
        ? contribution.vitaminK2 * portionMultiplier
        : undefined,
    protein:
      contribution.protein != null
        ? contribution.protein * portionMultiplier
        : undefined,
    magnesium:
      contribution.magnesium != null
        ? contribution.magnesium * portionMultiplier
        : undefined,
    calories:
      contribution.calories != null
        ? contribution.calories * portionMultiplier
        : undefined,
    recipeName: contribution.recipeName,
  };
}

/** Manual contribution = the part of today's totals NOT explained by
 *  meal-plan ticks. Clamped at 0 because a manual override could push
 *  totals below planTotals (e.g. the user ticked breakfast → 350mg Ca,
 *  then manually overwrote calcium to 100). */
export function deriveManualTotals(log: BridgeNutritionLog): NutritionTotals {
  return {
    calcium: Math.max(0, log.calcium - log.planTotals.calcium),
    vitaminD: Math.max(0, log.vitaminD - log.planTotals.vitaminD),
    vitaminK2: Math.max(0, (log.vitaminK2 ?? 0) - (log.planTotals.vitaminK2 ?? 0)),
    protein: Math.max(0, log.protein - log.planTotals.protein),
    magnesium: Math.max(0, log.magnesium - log.planTotals.magnesium),
    calories: Math.max(0, log.calories - log.planTotals.calories),
  };
}

export function applyMealToggle(
  existing: BridgeNutritionLog,
  mealType: NutritionMealKey,
  contribution: MealContribution,
  portionMultiplier: number = 1,
): BridgeNutritionLog {
  const wasMarked = !!existing.mealsCompleted[mealType];
  const prevPortion = existing.mealPortions[mealType] ?? 1;
  const samePortion = portionMultiplier === prevPortion;

  // CRITICAL: when subtracting (un-mark or re-portion) we use the
  // ORIGINAL frozen snapshot — not whatever recipe is currently on
  // screen. The user may have swapped or regenerated the slot in
  // between, or just changed portion. Falls back to the passed
  // contribution scaled by the last-known portion only for legacy
  // logs that predate the snapshot field.
  const prevSnapshot: MealContribution | null = wasMarked
    ? existing.mealsContributions[mealType] ??
      scaleContribution(contribution, prevPortion)
    : null;

  // Toggle off only when the slot is already marked AND the user
  // re-tapped with the same portion. Otherwise we are either turning
  // the slot ON for the first time, or RE-applying it with a new
  // portion (still ON, but different amount).
  const willBeMarked = !wasMarked || !samePortion;
  const newSnapshot: MealContribution | null = willBeMarked
    ? scaleContribution(contribution, portionMultiplier)
    : null;

  const subC = prevSnapshot?.calcium ?? 0;
  const subVD = prevSnapshot?.vitaminD ?? 0;
  const subVK2 = prevSnapshot?.vitaminK2 ?? 0;
  const subP = prevSnapshot?.protein ?? 0;
  const subM = prevSnapshot?.magnesium ?? 0;
  const subK = prevSnapshot?.calories ?? 0;

  const addC = newSnapshot?.calcium ?? 0;
  const addVD = newSnapshot?.vitaminD ?? 0;
  const addVK2 = newSnapshot?.vitaminK2 ?? 0;
  const addP = newSnapshot?.protein ?? 0;
  const addM = newSnapshot?.magnesium ?? 0;
  const addK = newSnapshot?.calories ?? 0;

  const calcium = Math.max(0, existing.calcium - subC + addC);
  const vitaminD = Math.max(0, existing.vitaminD - subVD + addVD);
  const vitaminK2 = Math.max(0, (existing.vitaminK2 ?? 0) - subVK2 + addVK2);
  const protein = Math.max(0, existing.protein - subP + addP);
  const magnesium = Math.max(0, existing.magnesium - subM + addM);
  const calories = Math.max(0, existing.calories - subK + addK);

  // Track the plan-only contribution separately so the Bone Tracker
  // can split totals into "from meal plan" vs "added manually". A
  // manual override on the Log Nutrition screen does NOT touch this,
  // so a re-tap (or portion change) still subtracts the right amount.
  const planTotals: NutritionTotals = {
    calcium: Math.max(0, existing.planTotals.calcium - subC + addC),
    vitaminD: Math.max(0, existing.planTotals.vitaminD - subVD + addVD),
    vitaminK2: Math.max(0, (existing.planTotals.vitaminK2 ?? 0) - subVK2 + addVK2),
    protein: Math.max(0, existing.planTotals.protein - subP + addP),
    magnesium: Math.max(0, existing.planTotals.magnesium - subM + addM),
    calories: Math.max(0, existing.planTotals.calories - subK + addK),
  };

  const mealsCompleted = {
    ...existing.mealsCompleted,
    [mealType]: willBeMarked,
  };

  // Snapshot the contribution + portion we just credited (so a future
  // un-toggle / re-portion reverses exactly), or clear them on
  // un-toggle.
  const mealsContributions = { ...existing.mealsContributions };
  const mealPortions = { ...existing.mealPortions };
  if (willBeMarked && newSnapshot) {
    mealsContributions[mealType] = newSnapshot;
    mealPortions[mealType] = portionMultiplier;
  } else {
    delete mealsContributions[mealType];
    delete mealPortions[mealType];
  }

  // Recipe-name bookkeeping in `meals[]`. Remove the previously-stored
  // recipe entry (using the frozen snapshot's name so a swap doesn't
  // leave a stale entry behind), then add the new one if the slot
  // stays/becomes marked. A pure portion change effectively replaces
  // the entry with itself, which is a no-op.
  let meals = existing.meals;
  const prevName = prevSnapshot?.recipeName;
  if (prevName) {
    const lastIdx = [...meals]
      .map((m, i) => ({ m, i }))
      .reverse()
      .find(({ m }) => m.name === mealType && m.items.includes(prevName))?.i;
    if (lastIdx != null) meals = meals.filter((_, i) => i !== lastIdx);
  }
  const newName = newSnapshot?.recipeName;
  if (willBeMarked && newName) {
    meals = [...meals, { name: mealType, items: [newName] }];
  }

  const anyPlanTicked = Object.values(mealsCompleted).some((v) => !!v);
  const hadManual = existing.source === "manual" || existing.source === "manual+plan";
  let source: NutritionSource;
  if (anyPlanTicked && hadManual) source = "manual+plan";
  else if (anyPlanTicked) source = "meal_plan";
  else if (hadManual) source = "manual";
  else source = "meal_plan";

  return {
    ...existing,
    calcium,
    vitaminD,
    vitaminK2,
    protein,
    magnesium,
    calories,
    planTotals,
    mealsCompleted,
    mealsContributions,
    mealPortions,
    meals,
    source,
  };
}

export function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function hydrateNutritionLog(raw: any): BridgeNutritionLog & {
  id: string;
  date: string;
  meals: { name: string; items: string[] }[];
} {
  const planTotalsRaw =
    raw?.planTotals && typeof raw.planTotals === "object" ? raw.planTotals : {};
  return {
    id: String(raw?.id ?? Date.now()),
    date: String(raw?.date ?? todayLocalISO()),
    calcium: Number(raw?.calcium ?? 0),
    vitaminD: Number(raw?.vitaminD ?? 0),
    vitaminK2: Number(raw?.vitaminK2 ?? 0),
    protein: Number(raw?.protein ?? 0),
    magnesium: Number(raw?.magnesium ?? 0),
    calories: Number(raw?.calories ?? 0),
    meals: Array.isArray(raw?.meals) ? raw.meals : [],
    otherNutrients:
      raw?.otherNutrients && typeof raw.otherNutrients === "object"
        ? raw.otherNutrients
        : {},
    source:
      raw?.source === "meal_plan" || raw?.source === "manual+plan"
        ? raw.source
        : "manual",
    mealsCompleted:
      raw?.mealsCompleted && typeof raw.mealsCompleted === "object"
        ? raw.mealsCompleted
        : {},
    planTotals: {
      calcium: Number(planTotalsRaw.calcium ?? 0),
      vitaminD: Number(planTotalsRaw.vitaminD ?? 0),
      vitaminK2: Number(planTotalsRaw.vitaminK2 ?? 0),
      protein: Number(planTotalsRaw.protein ?? 0),
      magnesium: Number(planTotalsRaw.magnesium ?? 0),
      calories: Number(planTotalsRaw.calories ?? 0),
    },
    mealsContributions:
      raw?.mealsContributions && typeof raw.mealsContributions === "object"
        ? raw.mealsContributions
        : {},
    mealPortions:
      raw?.mealPortions && typeof raw.mealPortions === "object"
        ? raw.mealPortions
        : {},
  };
}

export function applyManualUpsert(
  existing: BridgeNutritionLog,
  partial: Partial<BridgeNutritionLog>,
): BridgeNutritionLog {
  return {
    ...existing,
    ...partial,
    meals: partial.meals ?? existing.meals,
    mealsCompleted:
      partial.mealsCompleted !== undefined
        ? { ...existing.mealsCompleted, ...partial.mealsCompleted }
        : existing.mealsCompleted,
    source: partial.source ?? existing.source,
    // Manual edits never alter the meal-plan share. The provenance
    // line on Bone Tracker derives "manual" as `total - planTotals`,
    // so leaving planTotals untouched is what makes "X mg from meal
    // plan, Y added manually" arithmetic correct.
    planTotals: partial.planTotals ?? existing.planTotals,
    // Manual edits also never touch the per-slot frozen contributions
    // or the chosen portions — those are owned exclusively by
    // applyMealToggle and must remain intact so a future un-tap or
    // portion change subtracts the correct amount.
    mealsContributions:
      partial.mealsContributions ?? existing.mealsContributions,
    mealPortions: partial.mealPortions ?? existing.mealPortions,
  };
}
