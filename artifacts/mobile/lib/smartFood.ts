/**
 * Smart Food — curated bone-friendly suggestion lists for the
 * "What can I eat today?" module on the meal-plan screen.
 *
 * The user picks one of three contexts:
 *   • At home    — quick, kitchen-led ideas
 *   • On the go  — packable / one-handed options
 *   • Eating out — restaurant-friendly orders that quietly hit calcium /
 *                  vitamin-D / protein without making a fuss
 *
 * Each suggestion carries dietary tags so the existing
 * `DietaryPreferences` flags filter the list down naturally — a strict
 * vegetarian-and-dairy-free user will see only items that satisfy both.
 *
 * Suggestions also carry a `nutrients` array describing which bone
 * nutrients they meaningfully deliver, so `prioritiseSmartFood` can
 * surface options that cover whatever the user is actually short on
 * this past week (from `BehaviouralStats`).
 *
 * Pure data + a small set of helpers; no React imports so the same
 * module can power tests, the dashboard, and the meal plan.
 */

import type { DietaryPreferences } from "./nutritionPlan";
import type { BehaviouralStats } from "./behaviouralStats";

export type SmartFoodContext = "home" | "on_the_go" | "eating_out";

/**
 * Bone-supporting nutrients each suggestion meaningfully delivers.
 * Used by `prioritiseSmartFood` to surface items that cover whatever
 * the user's actual logs show they're short on this past week.
 */
export type BoneNutrient = "calcium" | "vitaminD" | "protein" | "magnesium";

export interface SmartFoodSuggestion {
  id: string;
  /** What to actually eat — short, scannable. */
  title: string;
  /** Why it supports bones — one line, calm, not preachy. */
  why: string;
  vegetarian: boolean;
  dairyFree: boolean;
  glutenFree: boolean;
  /** Bone-supporting nutrients this suggestion meaningfully delivers. */
  nutrients: BoneNutrient[];
}

const HOME: SmartFoodSuggestion[] = [
  {
    id: "home_yogurt_almond",
    title: "Greek yogurt with almonds and berries",
    why: "Calcium, protein and a small magnesium top-up in five minutes.",
    vegetarian: true,
    dairyFree: false,
    glutenFree: true,
    nutrients: ["calcium", "protein", "magnesium"],
  },
  {
    id: "home_sardines_toast",
    title: "Tinned sardines on rye toast",
    why: "Sardines bring calcium and vitamin D — bones love them both.",
    vegetarian: false,
    dairyFree: true,
    glutenFree: false,
    nutrients: ["calcium", "vitaminD", "protein"],
  },
  {
    id: "home_tofu_stir_fry",
    title: "Quick tofu and broccoli stir-fry",
    why: "Calcium-set tofu plus broccoli gives you a plant-led bone boost.",
    vegetarian: true,
    dairyFree: true,
    glutenFree: true,
    nutrients: ["calcium", "protein"],
  },
  {
    id: "home_omelette",
    title: "Three-egg cheese and spinach omelette",
    why: "Protein for bone matrix, calcium from cheese, vitamin D from yolks.",
    vegetarian: true,
    dairyFree: false,
    glutenFree: true,
    nutrients: ["calcium", "vitaminD", "protein"],
  },
  {
    id: "home_kefir_oats",
    title: "Overnight oats with kefir and chia",
    why: "Fermented dairy and chia together carry calcium, magnesium and protein.",
    vegetarian: true,
    dairyFree: false,
    glutenFree: false,
    nutrients: ["calcium", "magnesium", "protein"],
  },
  {
    id: "home_lentil_soup",
    title: "Lentil and kale soup",
    why: "Plant protein, magnesium, and vitamin K from kale to keep bones working.",
    vegetarian: true,
    dairyFree: true,
    glutenFree: true,
    nutrients: ["protein", "magnesium"],
  },
  {
    id: "home_salmon_greens",
    title: "Pan-fried salmon with greens",
    why: "Vitamin D, protein and a quiet anti-inflammatory edge for bone turnover.",
    vegetarian: false,
    dairyFree: true,
    glutenFree: true,
    nutrients: ["vitaminD", "protein"],
  },
  {
    id: "home_chickpea_bowl",
    title: "Roasted chickpea bowl with tahini",
    why: "Tahini is one of the best plant sources of calcium — pairs nicely here.",
    vegetarian: true,
    dairyFree: true,
    glutenFree: true,
    nutrients: ["calcium", "protein"],
  },
  {
    id: "home_paneer_curry",
    title: "Paneer and spinach curry with rice",
    why: "Paneer carries calcium; spinach adds magnesium and vitamin K.",
    vegetarian: true,
    dairyFree: false,
    glutenFree: true,
    nutrients: ["calcium", "magnesium", "protein"],
  },
];

const ON_THE_GO: SmartFoodSuggestion[] = [
  {
    id: "otg_yogurt_pot",
    title: "A pot of plain Greek yogurt",
    why: "200g already gives you most of the day's calcium in one go.",
    vegetarian: true,
    dairyFree: false,
    glutenFree: true,
    nutrients: ["calcium", "protein"],
  },
  {
    id: "otg_almonds_pack",
    title: "A handful of almonds",
    why: "Pocket-sized magnesium, protein and a touch of calcium.",
    vegetarian: true,
    dairyFree: true,
    glutenFree: true,
    nutrients: ["magnesium", "protein", "calcium"],
  },
  {
    id: "otg_cheese_oatcakes",
    title: "Cheese and oatcakes",
    why: "A quietly balanced bone snack — calcium plus slow-release oats.",
    vegetarian: true,
    dairyFree: false,
    glutenFree: false,
    nutrients: ["calcium"],
  },
  {
    id: "otg_egg_pots",
    title: "Boiled eggs and a banana",
    why: "Protein, vitamin D from yolks, and potassium for bone metabolism.",
    vegetarian: true,
    dairyFree: true,
    glutenFree: true,
    nutrients: ["protein", "vitaminD"],
  },
  {
    id: "otg_tuna_pouch",
    title: "Tuna pouch with crackers",
    why: "Lean protein and a small dose of vitamin D, ready in seconds.",
    vegetarian: false,
    dairyFree: true,
    glutenFree: false,
    nutrients: ["protein", "vitaminD"],
  },
  {
    id: "otg_smoothie",
    title: "Kefir smoothie with frozen berries",
    why: "Fermented dairy gives calcium and a friendly gut nudge.",
    vegetarian: true,
    dairyFree: false,
    glutenFree: true,
    nutrients: ["calcium", "protein"],
  },
  {
    id: "otg_hummus_carrots",
    title: "Hummus with carrot sticks and seeded crackers",
    why: "Sesame in tahini quietly boosts calcium without dairy.",
    vegetarian: true,
    dairyFree: true,
    glutenFree: false,
    nutrients: ["calcium"],
  },
  {
    id: "otg_chia_pudding",
    title: "Chia pudding with fortified plant milk",
    why: "Chia plus fortified milk delivers calcium and magnesium together.",
    vegetarian: true,
    dairyFree: true,
    glutenFree: true,
    nutrients: ["calcium", "magnesium"],
  },
  {
    id: "otg_bean_wrap",
    title: "Black bean and avocado wrap",
    why: "Plant protein, magnesium, and slow-release energy.",
    vegetarian: true,
    dairyFree: true,
    glutenFree: false,
    nutrients: ["protein", "magnesium"],
  },
  {
    id: "otg_seed_bar",
    title: "Seed bar (pumpkin, sunflower, chia)",
    why: "A bone-friendly snack with magnesium, zinc and a little plant protein.",
    vegetarian: true,
    dairyFree: true,
    glutenFree: true,
    nutrients: ["magnesium", "protein"],
  },
];

const EATING_OUT: SmartFoodSuggestion[] = [
  {
    id: "out_grilled_salmon",
    title: "Grilled salmon with greens",
    why: "Vitamin D and protein in one classic order — easy to find anywhere.",
    vegetarian: false,
    dairyFree: true,
    glutenFree: true,
    nutrients: ["vitaminD", "protein"],
  },
  {
    id: "out_paneer_saag",
    title: "Paneer saag with rice",
    why: "Calcium from paneer and magnesium from spinach — Indian menus do this well.",
    vegetarian: true,
    dairyFree: false,
    glutenFree: true,
    nutrients: ["calcium", "magnesium", "protein"],
  },
  {
    id: "out_caprese",
    title: "Caprese salad with extra mozzarella",
    why: "Mozzarella is a quiet calcium win when you're at an Italian.",
    vegetarian: true,
    dairyFree: false,
    glutenFree: true,
    nutrients: ["calcium", "protein"],
  },
  {
    id: "out_sushi_salmon",
    title: "Salmon sushi with edamame",
    why: "Vitamin D from salmon, plant protein and calcium from soy beans.",
    vegetarian: false,
    dairyFree: true,
    glutenFree: true,
    nutrients: ["vitaminD", "protein", "calcium"],
  },
  {
    id: "out_steak_broccoli",
    title: "Steak with steamed broccoli",
    why: "Protein for bone matrix; broccoli adds calcium and vitamin K.",
    vegetarian: false,
    dairyFree: true,
    glutenFree: true,
    nutrients: ["protein", "calcium"],
  },
  {
    id: "out_tofu_thai",
    title: "Thai tofu and Asian greens",
    why: "Calcium-set tofu and bok choi give a plant-only bone-friendly plate.",
    vegetarian: true,
    dairyFree: true,
    glutenFree: true,
    nutrients: ["calcium", "protein"],
  },
  {
    id: "out_cheese_omelette",
    title: "Cheese omelette with side salad",
    why: "An easy brunch order that brings calcium, vitamin D and protein.",
    vegetarian: true,
    dairyFree: false,
    glutenFree: true,
    nutrients: ["calcium", "vitaminD", "protein"],
  },
  {
    id: "out_lentil_dahl",
    title: "Lentil dahl with brown rice",
    why: "Plant protein, magnesium, and steady fuel — kind to bones and gut.",
    vegetarian: true,
    dairyFree: true,
    glutenFree: true,
    nutrients: ["protein", "magnesium"],
  },
  {
    id: "out_burrito_bowl",
    title: "Burrito bowl with beans, cheese and greens",
    why: "Calcium from cheese, plant protein from beans — build it tall.",
    vegetarian: true,
    dairyFree: false,
    glutenFree: true,
    nutrients: ["calcium", "protein"],
  },
];

const CATALOG: Record<SmartFoodContext, SmartFoodSuggestion[]> = {
  home: HOME,
  on_the_go: ON_THE_GO,
  eating_out: EATING_OUT,
};

export const SMART_FOOD_CONTEXT_LABEL: Record<SmartFoodContext, string> = {
  home: "At home",
  on_the_go: "On the go",
  eating_out: "Eating out",
};

/**
 * Returns the list of suggestions for `context`, narrowed by any active
 * dietary preferences (logical AND across vegetarian / dairy-free /
 * gluten-free). If filters reduce the list to nothing — unlikely with
 * the curated set above — the unfiltered list is returned so the UI is
 * never blank.
 */
export function getSmartFoodSuggestions(
  context: SmartFoodContext,
  prefs: DietaryPreferences,
): SmartFoodSuggestion[] {
  const pool = CATALOG[context];
  const filtered = pool.filter((s) => {
    if (prefs.vegetarian && !s.vegetarian) return false;
    if (prefs.dairyFree && !s.dairyFree) return false;
    if (prefs.glutenFree && !s.glutenFree) return false;
    return true;
  });
  return filtered.length > 0 ? filtered : pool;
}

// ---- Behavioural prioritisation -----------------------------------------

/**
 * Daily intake floors used to decide which nutrients are "short" this
 * past week. Conservative on purpose — the goal is to *gently re-rank*
 * the curated list, not gate it. Defaults sit at the same calcium
 * target the rest of the app uses (1200 mg) and at common adult
 * adequacy floors for vitamin D (10 µg) and protein (50 g).
 */
const VITAMIN_D_FLOOR_UG = 10;
const PROTEIN_FLOOR_G = 50;

/**
 * Decide which bone nutrients the user is short on this past week,
 * derived purely from `BehaviouralStats.nutrition` averages. A nutrient
 * is "short" when the 7-day mean sits at less than 80% of its target /
 * floor. Shortness is meaningless without any logging at all, so an
 * empty week returns an empty set — the curated list keeps its
 * original order.
 */
export function shortNutrients(b: BehaviouralStats | null | undefined): Set<BoneNutrient> {
  const out = new Set<BoneNutrient>();
  if (!b) return out;
  if (b.nutrition.loggedDays7d <= 0) return out;
  const target = b.nutrition.calciumTargetMg > 0 ? b.nutrition.calciumTargetMg : 1200;
  if (b.nutrition.avgCalciumMg7d < target * 0.8) out.add("calcium");
  if (b.nutrition.avgVitaminDUg7d < VITAMIN_D_FLOOR_UG * 0.8) out.add("vitaminD");
  if (b.nutrition.avgProteinG7d < PROTEIN_FLOOR_G * 0.8) out.add("protein");
  // Magnesium isn't tracked in the log payload yet — never marked short
  // until we add a column for it. Listed here so the type signature is
  // honest about the four nutrients.
  return out;
}

/**
 * Gently reorder a Smart Food list so suggestions that cover whatever
 * the user is short on this past week surface first. Pure: returns a
 * NEW array, leaves order stable for items with the same coverage
 * count. When `behavioural` is null/empty, returns the input unchanged.
 *
 * Ranking is a single integer score = number of short nutrients each
 * suggestion covers; ties keep their original index so the curated
 * order is preserved within a tier.
 */
export function prioritiseSmartFood(
  list: SmartFoodSuggestion[],
  behavioural: BehaviouralStats | null | undefined,
): SmartFoodSuggestion[] {
  const short = shortNutrients(behavioural);
  if (short.size === 0) return list.slice();
  const ranked = list.map((s, idx) => {
    let coverage = 0;
    for (const n of s.nutrients) {
      if (short.has(n)) coverage += 1;
    }
    return { s, coverage, idx };
  });
  ranked.sort((a, b) => {
    if (b.coverage !== a.coverage) return b.coverage - a.coverage;
    return a.idx - b.idx;
  });
  return ranked.map((r) => r.s);
}
