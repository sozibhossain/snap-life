/**
 * Daily Focus picker — chooses the three actions that lead today's
 * dashboard ("Today's focus").
 *
 * Composition is deliberate and constant:
 *   • one nutrition tile  — derived from the user's meal plan
 *   • one wellbeing tile  — derived from the Nervous System helper
 *   • one lifestyle tile  — cycled deterministically from a small static set
 *
 * The picker is pure: it takes a snapshot of context state and returns
 * three plain `FocusAction` objects. Persistence (per-ISO-date completion)
 * lives alongside as `loadCompletion` / `saveCompletion` so the UI layer
 * stays declarative and testable. Mood-into-plan is handled implicitly
 * because the wellbeing tile reads the Nervous System readout, which
 * already factors in the user's latest mood.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Recipe, MealType } from "./nutritionData";
import {
  deriveNervousSystem,
  type NervousSystemEntry,
  type NervousSystemReadout,
} from "./nervousSystem";
import type { BehaviouralStats } from "./behaviouralStats";

export type FocusKind = "nutrition" | "wellbeing" | "lifestyle";

export interface FocusAction {
  /** Stable id used for completion persistence and event payloads. */
  id: string;
  kind: FocusKind;
  /** Short calm one-liner shown on the tile. */
  title: string;
  /** Optional supporting context line (≤ ~70 chars). */
  subtitle?: string;
  /** Feather icon name. */
  icon: string;
  /** Accent token from the colour palette ("primary" | "accent" | "success" | "xpGold"). */
  accent: "primary" | "accent" | "success" | "xpGold";
  /** Where tapping the body of the tile should send the user. */
  route: string;
  /** Short label for the CTA chevron row. */
  ctaLabel: string;
}

// ---- Lifestyle pool -------------------------------------------------------

interface LifestyleSeed {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  ctaLabel: string;
}

/**
 * Small, intentionally generic lifestyle prompts the dashboard cycles
 * through deterministically by ISO date. Kept short so they read like
 * gentle cues, not chores.
 */
const LIFESTYLE_POOL: LifestyleSeed[] = [
  {
    id: "lifestyle:walk",
    title: "Take a 10-minute walk",
    subtitle: "Weight-bearing movement quietly supports bone strength.",
    icon: "navigation",
    ctaLabel: "Open activity",
  },
  {
    id: "lifestyle:sunlight",
    title: "Catch 10 minutes of sunlight",
    subtitle: "Daylight on your skin gives your vitamin D a small lift.",
    icon: "sun",
    ctaLabel: "Open activity",
  },
  {
    id: "lifestyle:hydration",
    title: "Top up your water",
    subtitle: "A glass now keeps your joints and bones working easily.",
    icon: "droplet",
    ctaLabel: "Open activity",
  },
  {
    id: "lifestyle:posture",
    title: "Reset your posture",
    subtitle: "Stand tall, roll the shoulders back — 30 seconds is enough.",
    icon: "user",
    ctaLabel: "Open activity",
  },
];

// ---- ISO date helpers -----------------------------------------------------

/**
 * Local-date YYYY-MM-DD. Mirrors the helper inside `NutritionContext` so
 * "today" agrees across the dashboard, the meal plan and the persistence
 * key — using `toISOString` (UTC) would cause day-boundary disagreement
 * in non-UTC timezones.
 */
export function todayLocalISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Tiny FNV-1a hash so the same ISO date always maps to the same lifestyle. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---- Nutrition tile -------------------------------------------------------

/** Pick the next meal slot for the current local hour. Defaults to breakfast at midnight. */
export function nextMealSlot(now: Date = new Date()): MealType {
  const h = now.getHours();
  if (h < 10) return "breakfast";
  if (h < 14) return "lunch";
  if (h < 19) return "dinner";
  return "snack";
}

interface NutritionTileInput {
  recipe: Recipe | null;
  slot: MealType;
}

function nutritionTile(input: NutritionTileInput): FocusAction {
  const slotLabel =
    input.slot === "breakfast"
      ? "breakfast"
      : input.slot === "lunch"
        ? "lunch"
        : input.slot === "dinner"
          ? "dinner"
          : "snack";

  if (!input.recipe) {
    // No plan loaded yet (rare) — keep the tile useful by sending the user
    // into the meal plan to set up.
    return {
      id: `nutrition:${input.slot}`,
      kind: "nutrition",
      title: `Plan today's ${slotLabel}`,
      subtitle: "Open your personalised meal plan.",
      icon: "book-open",
      accent: "primary",
      route: "/health/meal-plan",
      ctaLabel: "Open meal plan",
    };
  }
  return {
    id: `nutrition:${input.slot}:${input.recipe.id}`,
    kind: "nutrition",
    title: `Have ${input.recipe.name} for ${slotLabel}`,
    subtitle: input.recipe.highlight,
    icon: "book-open",
    accent: "primary",
    route: `/recipe/${input.recipe.id}`,
    ctaLabel: "Open recipe",
  };
}

// ---- Wellbeing tile -------------------------------------------------------

function wellbeingTile(
  readout: NervousSystemReadout,
  isoDate: string,
): FocusAction {
  const r = readout.recommendation;
  return {
    // Bind the id to the date so toggling the check yesterday doesn't
    // pre-tick today's tile.
    id: `wellbeing:${isoDate}:${r.surface}:${r.sessionHint}`,
    kind: "wellbeing",
    title: r.title,
    subtitle: readout.reason,
    icon: r.surface === "breathing" ? "wind" : "headphones",
    accent: r.surface === "breathing" ? "accent" : "primary",
    route:
      r.surface === "breathing"
        ? "/breathing-studio"
        : `/meditation?session=${encodeURIComponent(r.sessionHint)}`,
    ctaLabel: r.surface === "breathing" ? "Start breathing" : "Start meditation",
  };
}

// ---- Lifestyle tile -------------------------------------------------------

function lifestyleTile(isoDate: string): FocusAction {
  const seed = LIFESTYLE_POOL[hashString(isoDate) % LIFESTYLE_POOL.length];
  return {
    id: `${seed.id}:${isoDate}`,
    kind: "lifestyle",
    title: seed.title,
    subtitle: seed.subtitle,
    icon: seed.icon,
    accent: "success",
    route: "/health/activity",
    ctaLabel: seed.ctaLabel,
  };
}

// ---- Composer -------------------------------------------------------------

export interface FocusInputs {
  /** YYYY-MM-DD — the day these picks belong to. */
  isoDate: string;
  /** Today's chosen recipe for the nutrition tile (next meal slot). */
  nutritionRecipe: Recipe | null;
  /** Slot the nutrition tile is built around. */
  nutritionSlot: MealType;
  /** Recent calm-studio sessions used to derive the wellbeing state. */
  wellbeingEntries: NervousSystemEntry[];
  /** Override "now" for deterministic tests. */
  now?: number;
}

/**
 * Returns exactly three `FocusAction`s in display order: nutrition,
 * wellbeing, lifestyle. Pure & deterministic for the same inputs.
 */
export function pickTodaysFocus(input: FocusInputs): FocusAction[] {
  const nutrition = nutritionTile({
    recipe: input.nutritionRecipe,
    slot: input.nutritionSlot,
  });
  const readout = deriveNervousSystem({
    entries: input.wellbeingEntries,
    now: input.now,
  });
  const wellbeing = wellbeingTile(readout, input.isoDate);
  const lifestyle = lifestyleTile(input.isoDate);
  return [nutrition, wellbeing, lifestyle];
}

// ---- Adaptive composer (Premium) -----------------------------------------

/** Per-kind 7-day completion counts read from the engagement profile. */
export interface AdaptivePerKind {
  shown: number;
  completed: number;
  dismissed: number;
  rate: number;
}

/**
 * Wilson lower-bound score for a single binomial proportion. With z=1.96
 * (95% confidence) this returns a conservative estimate of the
 * "true" success rate given `successes` out of `total` trials. Stops a
 * single 1/1 completion shooting a kind to the top with no statistical
 * weight behind it.
 *
 * Reference:
 * Wilson, E.B. (1927). Probable Inference, the Law of Succession, and
 * Statistical Inference.
 */
function wilsonLowerBound(successes: number, total: number): number {
  if (total <= 0) return 0;
  const z = 1.96;
  const p = successes / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const centre = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
  return Math.max(0, Math.min(1, (centre - margin) / denom));
}

/**
 * Maximum behavioural-bias bonus added to a Wilson score. Picked so the
 * bias can break ties and outweigh small Wilson differences, but never
 * dominate a clear engagement signal (Wilson is in [0, 1]).
 */
const BEHAVIOURAL_BIAS_CAP = 0.25;
/** Per-completed-day weight feeding the cap above. 5 days × 0.05 = cap. */
const BEHAVIOURAL_BIAS_PER_DAY = 0.05;

/**
 * Behavioural bias per focus kind, derived from server-persisted
 * activity (NOT rec_* engagement). The signal is "is the user actually
 * doing this kind of thing this past week?" — log days for nutrition,
 * sessions for wellbeing, active days for lifestyle. Capped at +0.25 so
 * it can't outvote a clear Wilson signal but quietly keeps a sustained
 * habit surfaced even when the rec_* tile gets ignored.
 */
function behaviouralBias(
  kind: FocusKind,
  b: BehaviouralStats | null | undefined,
): number {
  if (!b) return 0;
  const days =
    kind === "nutrition"
      ? b.nutrition.loggedDays7d
      : kind === "wellbeing"
        ? b.wellbeing.sessions7d
        : b.activity.activeDays7d;
  return Math.min(BEHAVIOURAL_BIAS_CAP, Math.max(0, days) * BEHAVIOURAL_BIAS_PER_DAY);
}

/**
 * Adaptive variant of `pickTodaysFocus` for Premium users. Same three
 * tiles (one nutrition, one wellbeing, one lifestyle — composition is
 * preserved so the user always gets a balanced day) but reordered by
 * a Wilson-lower-bound completion rate per kind, descending. The Wilson
 * bound shrinks small samples toward zero so a single completion can't
 * promote a kind to the top with no statistical weight behind it.
 *
 * Dismissals act as additional "failures" in the binomial — a kind the
 * user actively rejects gets pushed down even if they've also
 * occasionally completed it.
 *
 * When a `behavioural` snapshot is supplied, each kind also gets a
 * small additive bias proportional to how many days the user has
 * actually been doing that activity this past week. This grounds the
 * ranker in real behaviour, not just whether a tile got tapped — a
 * user who's been silently logging nutrition every day still sees the
 * nutrition tile lead even on a quiet rec_* week.
 *
 * Kinds with no engagement data fall back to their deterministic order
 * (nutrition → wellbeing → lifestyle), and ties break the same way.
 */
export function pickAdaptiveTodaysFocus(
  input: FocusInputs & {
    /**
     * Per-recommendation-kind 7-day stats from /api/engagement/profile.
     * Keys mirror the `recKind` we attach when emitting rec_* events
     * ("nutrition", "wellbeing", "lifestyle"). Missing keys are treated
     * as zero engagement.
     */
    perKind: Partial<Record<FocusKind, AdaptivePerKind>>;
    /**
     * Optional behavioural snapshot from /api/engagement/profile. When
     * present, supplies the additive per-kind bias described above.
     * Older server builds that don't ship `behavioural` should pass
     * `null` / `undefined` and the ranker degrades to Wilson-only.
     */
    behavioural?: BehaviouralStats | null;
  },
): FocusAction[] {
  const baseline = pickTodaysFocus(input);
  // Anchor each kind to its current display index — the tiebreaker for
  // kinds with no data, so we always degrade to the deterministic order.
  const ranked = baseline.map((action, idx) => {
    const stats = input.perKind[action.kind];
    const shown = stats?.shown ?? 0;
    const completed = stats?.completed ?? 0;
    const dismissed = stats?.dismissed ?? 0;
    // Treat shown as the trial count, completed as successes, and add
    // dismissals as extra failures so explicit rejections weigh in.
    const trials = shown + dismissed;
    const wilson = wilsonLowerBound(completed, trials);
    const bias = behaviouralBias(action.kind, input.behavioural);
    return { action, score: wilson + bias, idx };
  });
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.idx - b.idx;
  });
  return ranked.map((r) => r.action);
}

// ---- Persistence ----------------------------------------------------------

/**
 * Storage key per user + ISO date. Mirrors NutritionContext.keysFor so a
 * shared device never bleeds completion state across accounts.
 */
function focusKey(userId: string | null, isoDate: string): string {
  const suffix = userId ? `:${userId}` : ":anon";
  return `snap_today_focus${suffix}:${isoDate}`;
}

export interface CompletionState {
  /** Map of action id → `true` (only completed actions are stored). */
  done: Record<string, true>;
  /**
   * Map of action id → `true` for tiles the user has actively dismissed
   * today. Dismissed tiles are hidden from the card for the rest of the
   * ISO day and feed the engagement profile as `rec_dismissed` events so
   * the adaptive engine can deprioritise that kind tomorrow. Optional in
   * persisted JSON for backward-compatibility with pre-existing saves.
   */
  dismissed?: Record<string, true>;
}

const EMPTY_COMPLETION: CompletionState = { done: {}, dismissed: {} };

export async function loadCompletion(
  userId: string | null,
  isoDate: string,
): Promise<CompletionState> {
  try {
    const raw = await AsyncStorage.getItem(focusKey(userId, isoDate));
    if (!raw) return EMPTY_COMPLETION;
    const parsed = JSON.parse(raw) as Partial<CompletionState>;
    const done: Record<string, true> = {};
    const dismissed: Record<string, true> = {};
    if (parsed && typeof parsed.done === "object" && parsed.done) {
      for (const k of Object.keys(parsed.done)) {
        if ((parsed.done as Record<string, unknown>)[k] === true) done[k] = true;
      }
    }
    if (parsed && typeof parsed.dismissed === "object" && parsed.dismissed) {
      for (const k of Object.keys(parsed.dismissed)) {
        if ((parsed.dismissed as Record<string, unknown>)[k] === true) {
          dismissed[k] = true;
        }
      }
    }
    return { done, dismissed };
  } catch {
    return EMPTY_COMPLETION;
  }
}

export async function saveCompletion(
  userId: string | null,
  isoDate: string,
  state: CompletionState,
): Promise<void> {
  try {
    await AsyncStorage.setItem(focusKey(userId, isoDate), JSON.stringify(state));
  } catch {
    // Swallow — completion is a UX nicety, not load-bearing.
  }
}

export const __test__ = { hashString, LIFESTYLE_POOL };
