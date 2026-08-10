import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  applyMealToggle,
  applyManualUpsert,
  deriveManualTotals,
  hydrateNutritionLog as hydrateBridgeLog,
  todayLocalISO,
  ZERO_TOTALS,
  type MealContribution as BridgeMealContribution,
  type NutritionMealKey as BridgeMealKey,
  type NutritionTotals,
} from "@/lib/nutritionBridge";
import {
  computeNutritionStreak,
  hasNonZeroTotals,
  runNutritionXPReconciliation,
} from "@/lib/nutritionStreak";
import { enqueueSync, SyncPaths } from "@/lib/syncClient";
import { logInteractionEvent } from "@/lib/events";
import { calcFrax, type FraxInputs } from "@/lib/frax";
export { calcFrax, type FraxInputs };

export interface DexaScan {
  id: string;
  date: string;
  /** Spine L1–L4 T-score (new multi-site model) */
  spineTScore?: number;
  /** Total hip / femoral neck T-score (new multi-site model) */
  hipTScore?: number;
  // ── Legacy single-site fields — kept for backward compat with stored data ──
  site?: "lumbar_spine" | "femoral_neck" | "total_hip" | "forearm";
  tScore?: number;
  zScore?: number;
  bmd?: number;
  /** 10-year major osteoporotic fracture risk % (from DEXA report) */
  majorFractureRisk?: number;
  /** 10-year hip fracture risk % (from DEXA report) */
  hipFractureRisk?: number;
  /** BMI at time of scan */
  bmi?: number;
  notes?: string;
}

/** Classify a T-score per WHO criteria. */
export function classifyTScore(t: number): "Normal" | "Osteopenia" | "Osteoporosis" {
  if (t >= -1.0) return "Normal";
  if (t >= -2.5) return "Osteopenia";
  return "Osteoporosis";
}

/** Return the worst (lowest) T-score from a scan, checking new fields first. */
export function worstTScore(scan: DexaScan): number | null {
  const scores = [scan.spineTScore, scan.hipTScore, scan.tScore].filter(
    (v): v is number => v != null,
  );
  return scores.length > 0 ? Math.min(...scores) : null;
}

export interface FraxResult {
  id: string;
  date: string;
  majorFractureRisk: number;
  hipFractureRisk: number;
  inputs: FraxInputs;
}

export interface ActivityLog {
  id: string;
  date: string;
  steps: number;
  calories: number;
  activeMinutes: number;
  distance: number;
  exerciseSessions?: Array<{
    kind:
      | "walking"
      | "resistance"
      | "weight_bearing"
      | "balance"
      | "yoga"
      | "pilates"
      | "tai_chi";
    durationMinutes: number;
  }>;
}

export type NutritionMealKey = BridgeMealKey;

export interface NutritionLog {
  id: string;
  date: string;
  calcium: number;
  vitaminD: number;
  protein: number;
  /** Magnesium in mg. Older logs persisted before this field existed are
   *  back-filled to 0 on hydration. */
  magnesium: number;
  calories: number;
  meals: { name: string; items: string[] }[];
  /**
   * Where this log's totals came from. `manual` = user typed them in on
   * Log Nutrition. `meal_plan` = built up automatically from Mark-as-eaten
   * taps on the meal plan. `manual+plan` = both contributed today (e.g.
   * user ticked breakfast then added a snack manually). Used by the Bone
   * Tracker provenance line so users understand why their numbers move
   * without them logging anything. */
  source: "manual" | "meal_plan" | "manual+plan";
  /** Per-slot record of which meals from today's plan have been ticked
   *  off as eaten. Used as the visual state on the meal plan row AND the
   *  idempotency check in `markMealEaten` (re-tap subtracts). */
  mealsCompleted: Partial<Record<NutritionMealKey, boolean>>;
  /** Sum of nutrient contributions credited to meal-plan ticks today.
   *  Used by the Bone Tracker provenance line ("X mg from meal plan, Y
   *  added manually"). Manual contribution is derived as
   *  `max(0, totals - planTotals)`. */
  planTotals: NutritionTotals;
  /** Frozen snapshot of the contribution credited per slot when it was
   *  marked eaten. Keyed by NutritionMealKey. Used so an un-tap
   *  subtracts the ORIGINAL nutrients credited, not whatever recipe is
   *  currently rendered (the slot may have been swapped or
   *  regenerated in between). Values are already scaled by the chosen
   *  portion multiplier. */
  mealsContributions: Partial<Record<NutritionMealKey, BridgeMealContribution>>;
  /** Portion multiplier the user picked per slot when ticking it
   *  eaten (½, 1, 1½, 2 …). Cleared when the slot is un-ticked. Used
   *  by the meal-plan UI to pre-select the stepper, and by the bridge
   *  to detect a "change portion while eaten" re-tap so totals don't
   *  drift. */
  mealPortions: Partial<Record<NutritionMealKey, number>>;
}

export type SupplementUnit = "mg" | "mcg" | "IU" | "g" | "ml" | "as prescribed";
export type SupplementFrequency = "daily" | "twice daily" | "alternate days" | "weekly" | "as needed";
export type SupplementTiming = "morning" | "afternoon" | "evening" | "bedtime";
export type SupplementCategory = "supplement" | "medication";

export interface Supplement {
  id: string;
  name: string;
  /** Formatted display string e.g. "500mg". Derived from doseAmount + unit on
   *  new entries; kept as a raw string for backwards-compat with existing data. */
  dose: string;
  doseAmount?: number;
  unit?: SupplementUnit;
  frequency: string;
  timing?: SupplementTiming;
  /** "supplement" (default) | "medication". Backfilled to "supplement" on
   *  hydration for items saved before this field existed. */
  category: SupplementCategory;
  isCustom?: boolean;
  taken: boolean;
  takenAt?: string;
  missedCount?: number;
  lastMissedAt?: string;
}

/** Numeric contribution from a single meal — what gets added to (or
 *  subtracted from) today's running totals when the user toggles
 *  "Mark as eaten" on the meal plan. Re-exported from the pure bridge
 *  helper so any caller can grab it from `useHealth`'s module. */
export type MealContribution = BridgeMealContribution;

interface HealthContextType {
  dexaScans: DexaScan[];
  fraxResults: FraxResult[];
  activityLogs: ActivityLog[];
  nutritionLogs: NutritionLog[];
  supplements: Supplement[];
  todayActivity: ActivityLog | null;
  todayNutrition: NutritionLog | null;
  /** Plan-only contribution to today's totals. Convenience accessor —
   *  same numbers as `todayNutrition?.planTotals` but always non-null
   *  (zeros when no log exists yet) so consumers can just read it. */
  todayPlanTotals: NutritionTotals;
  /** Manual contribution = `today.totals - today.planTotals`, clamped
   *  at 0 per nutrient. Convenience accessor for the Bone Tracker
   *  provenance line. */
  todayManualTotals: NutritionTotals;
  /** True when today's nutrition has any non-zero total — i.e. the
   *  user has either manually saved Log Nutrition OR ticked at least
   *  one meal as eaten on the meal plan. The shared "logged today"
   *  signal that drives streak / XP / daily-focus credit. */
  loggedNutritionToday: boolean;
  /** Consecutive logged-nutrition days ending today (or yesterday if
   *  the user hasn't logged anything today yet — one-day grace). The
   *  number rendered in the dashboard streak pill and the Profile
   *  "Day Streak" stat. */
  nutritionStreak: number;
  addDexaScan: (scan: Omit<DexaScan, "id">) => Promise<void>;
  addFraxResult: (result: Omit<FraxResult, "id">) => Promise<void>;
  logActivity: (activity: Omit<ActivityLog, "id">) => Promise<void>;
  logNutrition: (nutrition: Omit<NutritionLog, "id" | "magnesium" | "source" | "mealsCompleted"> & Partial<Pick<NutritionLog, "magnesium" | "source" | "mealsCompleted">>) => Promise<void>;
  upsertTodayNutrition: (
    partial: Partial<Omit<NutritionLog, "id" | "date">>,
  ) => Promise<void>;
  markMealEaten: (
    mealType: NutritionMealKey,
    contribution: MealContribution,
    portionMultiplier?: number,
  ) => Promise<void>;
  markSupplementTaken: (id: string) => Promise<void>;
  markMedicationMissed: (id: string) => Promise<void>;
  addSupplement: (item: Omit<Supplement, "id" | "taken" | "takenAt">) => Promise<void>;
  removeSupplement: (id: string) => Promise<void>;
  getLatestDexaScore: () => number | null;
  getFracturRisk: () => "low" | "moderate" | "high";
}

const HealthContext = createContext<HealthContextType | null>(null);

const DEFAULT_SUPPLEMENTS: Supplement[] = [
  { id: "s1", name: "Calcium Carbonate", dose: "500mg", doseAmount: 500, unit: "mg", frequency: "twice daily", category: "supplement", taken: false },
  { id: "s2", name: "Vitamin D3", dose: "2000 IU", doseAmount: 2000, unit: "IU", frequency: "daily", category: "supplement", taken: false },
  { id: "s3", name: "Magnesium", dose: "200mg", doseAmount: 200, unit: "mg", frequency: "daily", category: "supplement", taken: false },
  { id: "s4", name: "Vitamin K2", dose: "100mcg", doseAmount: 100, unit: "mcg", frequency: "daily", category: "supplement", taken: false },
];

/** Back-fill `category: "supplement"` on items persisted before the field existed. */
function hydrateSupplements(raw: unknown[]): Supplement[] {
  return raw.map((s: any) => ({
    ...s,
    category: s.category ?? "supplement",
  }));
}

function keysFor(userId: string | null) {
  const suffix = userId ? `:${userId}` : ":anon";
  return {
    dexa: `snap_dexa${suffix}`,
    frax: `snap_frax${suffix}`,
    activity: `snap_activity${suffix}`,
    nutrition: `snap_nutrition${suffix}`,
    supplements: `snap_supplements${suffix}`,
  };
}

export const hydrateNutritionLog = hydrateBridgeLog as (raw: any) => NutritionLog;

export function HealthProvider({ children }: { children: React.ReactNode }) {
  const { user, updateUser } = useAuth();
  const userId = user?.id ?? null;
  // Pin updateUser through a ref so the streak/XP sync effects below
  // don't re-fire on every AuthProvider re-render. AuthContext doesn't
  // memoise updateUser, so listing it directly in deps would loop.
  const updateUserRef = useRef(updateUser);
  useEffect(() => {
    updateUserRef.current = updateUser;
  }, [updateUser]);

  // New users start with zero entries for everything they log themselves —
  // DEXA scans, activity, and nutrition. Supplements get a default checklist
  // (still unticked) so the screen isn't empty on first launch.
  const [dexaScans, setDexaScans] = useState<DexaScan[]>([]);
  const [fraxResults, setFraxResults] = useState<FraxResult[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [nutritionLogs, setNutritionLogs] = useState<NutritionLog[]>([]);
  const [supplements, setSupplements] =
    useState<Supplement[]>(DEFAULT_SUPPLEMENTS);

  // Track which userId's nutrition logs are currently loaded into
  // `nutritionLogs`. Initially null, set to the userId after the
  // AsyncStorage load (or its catch fallback) has resolved. Both
  // the streak-sync and XP-reconciliation effects gate on this:
  // before hydration finishes, `nutritionLogs` is still `[]` from
  // the previous render's initial state, so `loggedNutritionToday`
  // would be a false negative — running the reconciler then would
  // refund a previously-claimed day's XP and clear the marker
  // before the real logs land. We re-trigger naturally on hydrate
  // because this state is in the XP effect's dep list.
  const [nutritionHydratedFor, setNutritionHydratedFor] =
    useState<string | null>(null);

  // Reload (or reset) state whenever the active account changes. This is what
  // gives every fresh user a clean slate even on a shared device.
  useEffect(() => {
    let cancelled = false;
    // Mark the current user as not-yet-hydrated until the storage
    // load below resolves. On a user switch this immediately
    // re-arms the gate so the new account doesn't act on the
    // outgoing user's still-mounted nutritionLogs.
    setNutritionHydratedFor(null);
    (async () => {
      const k = keysFor(userId);
      try {
        const [storedDexa, storedFrax, storedActivity, storedNutrition, storedSupplements] =
          await Promise.all([
            AsyncStorage.getItem(k.dexa),
            AsyncStorage.getItem(k.frax),
            AsyncStorage.getItem(k.activity),
            AsyncStorage.getItem(k.nutrition),
            AsyncStorage.getItem(k.supplements),
          ]);
        if (cancelled) return;
        setDexaScans(storedDexa ? JSON.parse(storedDexa) : []);
        setFraxResults(storedFrax ? JSON.parse(storedFrax) : []);
        setActivityLogs(storedActivity ? JSON.parse(storedActivity) : []);
        setNutritionLogs(
          storedNutrition
            ? (JSON.parse(storedNutrition) as unknown[]).map(hydrateNutritionLog)
            : [],
        );
        setSupplements(
          storedSupplements ? hydrateSupplements(JSON.parse(storedSupplements)) : DEFAULT_SUPPLEMENTS,
        );
        // Open the hydration gate AFTER the logs have been
        // committed so the next render of the XP effect sees the
        // real `loggedNutritionToday` value.
        setNutritionHydratedFor(userId);
      } catch {
        if (cancelled) return;
        setDexaScans([]);
        setActivityLogs([]);
        setNutritionLogs([]);
        setSupplements(DEFAULT_SUPPLEMENTS);
        // Even on failure we mark hydration done — `nutritionLogs`
        // is now the real state for this user (an empty list),
        // and the reconciler can run safely against it.
        setNutritionHydratedFor(userId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function addDexaScan(scan: Omit<DexaScan, "id">) {
    const newScan = { ...scan, id: Date.now().toString() };
    const updated = [newScan, ...dexaScans];
    setDexaScans(updated);
    await AsyncStorage.setItem(keysFor(userId).dexa, JSON.stringify(updated));
    // Append-only on the server — POST per scan, idempotent on resultId.
    enqueueSync({
      appUserId: userId,
      domain: "assessment",
      modifier: newScan.id,
      method: "POST",
      path: SyncPaths.assessment(),
      body: {
        resultId: newScan.id,
        kind: "dexa",
        payload: newScan,
        takenAtMs: newScan.date
          ? new Date(newScan.date).getTime() || Date.now()
          : Date.now(),
      },
    });
    logInteractionEvent({
      appUserId: userId,
      kind: "dexa_logged",
      payload: {
        scanId: newScan.id,
        date: newScan.date,
        tScore: worstTScore(newScan),
        site: newScan.site,
      },
    });
  }

  async function addFraxResult(result: Omit<FraxResult, "id">) {
    const newResult: FraxResult = { ...result, id: Date.now().toString() };
    const updated = [newResult, ...fraxResults];
    setFraxResults(updated);
    await AsyncStorage.setItem(keysFor(userId).frax, JSON.stringify(updated));
    enqueueSync({
      appUserId: userId,
      domain: "assessment",
      modifier: newResult.id,
      method: "POST",
      path: SyncPaths.assessment(),
      body: {
        resultId: newResult.id,
        kind: "frax",
        payload: newResult,
        takenAtMs: newResult.date
          ? new Date(newResult.date).getTime() || Date.now()
          : Date.now(),
      },
    });
    logInteractionEvent({
      appUserId: userId,
      kind: "frax_logged",
      payload: {
        resultId: newResult.id,
        date: newResult.date,
        majorFractureRisk: newResult.majorFractureRisk,
        hipFractureRisk: newResult.hipFractureRisk,
      },
    });
  }

  async function logActivity(activity: Omit<ActivityLog, "id">) {
    const existingIdx = activityLogs.findIndex((a) => a.date === activity.date);
    let updated: ActivityLog[];
    if (existingIdx >= 0) {
      // Preserve the original id so any external references stay stable.
      const merged: ActivityLog = {
        ...activityLogs[existingIdx],
        ...activity,
        id: activityLogs[existingIdx].id,
      };
      updated = [...activityLogs];
      updated[existingIdx] = merged;
    } else {
      const newLog: ActivityLog = { ...activity, id: Date.now().toString() };
      updated = [newLog, ...activityLogs];
    }
    setActivityLogs(updated);
    await AsyncStorage.setItem(keysFor(userId).activity, JSON.stringify(updated));
    // Mirror just the affected day — server stores per (userId, day).
    const dayLog = updated.find((a) => a.date === activity.date);
    if (dayLog) {
      enqueueSync({
        appUserId: userId,
        domain: "activity",
        modifier: dayLog.date,
        method: "PUT",
        path: SyncPaths.activityDay(dayLog.date),
        body: { data: dayLog, updatedAtMs: Date.now() },
      });
      logInteractionEvent({
        appUserId: userId,
        kind: "activity_logged",
        payload: {
          date: dayLog.date,
          steps: dayLog.steps,
          activeMinutes: dayLog.activeMinutes,
        },
      });
    }
  }

  async function persistNutrition(updated: NutritionLog[], dayHint?: string) {
    setNutritionLogs(updated);
    await AsyncStorage.setItem(keysFor(userId).nutrition, JSON.stringify(updated));
    // Mirror just the day that changed (caller passes a hint; default to
    // today since markMealEaten / upsertTodayNutrition only edit today).
    const day = dayHint ?? todayLocalISO();
    const dayLog = updated.find((n) => n.date === day);
    if (dayLog) {
      enqueueSync({
        appUserId: userId,
        domain: "nutrition",
        modifier: dayLog.date,
        method: "PUT",
        path: SyncPaths.nutritionDay(dayLog.date),
        body: { data: dayLog, updatedAtMs: Date.now() },
      });
      if (hasNonZeroTotals(dayLog)) {
        logInteractionEvent({
          appUserId: userId,
          kind: "nutrition_logged",
          payload: {
            date: dayLog.date,
            source: dayLog.source,
            calcium: dayLog.calcium,
            vitaminD: dayLog.vitaminD,
            protein: dayLog.protein,
          },
        });
      }
    }
  }

  async function logNutrition(
    nutrition: Omit<NutritionLog, "id" | "magnesium" | "source" | "mealsCompleted"> &
      Partial<Pick<NutritionLog, "magnesium" | "source" | "mealsCompleted">>,
  ) {
    const newLog: NutritionLog = {
      id: Date.now().toString(),
      date: nutrition.date,
      calcium: nutrition.calcium,
      vitaminD: nutrition.vitaminD,
      protein: nutrition.protein,
      calories: nutrition.calories,
      meals: nutrition.meals ?? [],
      magnesium: nutrition.magnesium ?? 0,
      source: nutrition.source ?? "manual",
      mealsCompleted: nutrition.mealsCompleted ?? {},
      planTotals: { ...ZERO_TOTALS },
      mealsContributions: {},
      mealPortions: {},
    };
    await persistNutrition([newLog, ...nutritionLogs], newLog.date);
  }

  async function upsertTodayNutrition(
    partial: Partial<Omit<NutritionLog, "id" | "date">>,
  ) {
    const today = todayLocalISO();
    const idx = nutritionLogs.findIndex((n) => n.date === today);
    if (idx >= 0) {
      const existing = nutritionLogs[idx];
      const merged = applyManualUpsert(existing, partial);
      const nextLog: NutritionLog = {
        ...merged,
        id: existing.id,
        date: existing.date,
      };
      const updated = [...nutritionLogs];
      updated[idx] = nextLog;
      await persistNutrition(updated);
    } else {
      const nextLog: NutritionLog = {
        id: Date.now().toString(),
        date: today,
        calcium: partial.calcium ?? 0,
        vitaminD: partial.vitaminD ?? 0,
        protein: partial.protein ?? 0,
        magnesium: partial.magnesium ?? 0,
        calories: partial.calories ?? 0,
        meals: partial.meals ?? [],
        source: partial.source ?? "manual",
        mealsCompleted: partial.mealsCompleted ?? {},
        planTotals: partial.planTotals ?? { ...ZERO_TOTALS },
        mealsContributions: partial.mealsContributions ?? {},
        mealPortions: partial.mealPortions ?? {},
      };
      await persistNutrition([nextLog, ...nutritionLogs]);
    }
  }

  async function markMealEaten(
    mealType: NutritionMealKey,
    contribution: MealContribution,
    portionMultiplier: number = 1,
  ) {
    const today = todayLocalISO();
    const idx = nutritionLogs.findIndex((n) => n.date === today);
    const existing: NutritionLog =
      idx >= 0
        ? nutritionLogs[idx]
        : {
            id: Date.now().toString(),
            date: today,
            calcium: 0,
            vitaminD: 0,
            protein: 0,
            magnesium: 0,
            calories: 0,
            meals: [],
            source: "meal_plan",
            mealsCompleted: {},
            planTotals: { ...ZERO_TOTALS },
            mealsContributions: {},
            mealPortions: {},
          };

    const merged = applyMealToggle(
      existing,
      mealType,
      contribution,
      portionMultiplier,
    );
    const nextLog: NutritionLog = {
      ...merged,
      id: existing.id,
      date: existing.date,
    };

    if (idx >= 0) {
      const updated = [...nutritionLogs];
      updated[idx] = nextLog;
      await persistNutrition(updated);
    } else {
      await persistNutrition([nextLog, ...nutritionLogs]);
    }
    if (nextLog.mealsCompleted?.[mealType]) {
      logInteractionEvent({
        appUserId: userId,
        kind: "meal_plan_completed",
        payload: {
          date: today,
          mealType,
          portionMultiplier,
        },
      });
    }
  }

  async function markSupplementTaken(id: string) {
    const updated = supplements.map((s) =>
      s.id === id
        ? {
            ...s,
            taken: true,
            takenAt: new Date().toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            }),
          }
        : s
    );
    setSupplements(updated);
    await AsyncStorage.setItem(keysFor(userId).supplements, JSON.stringify(updated));
    enqueueSync({
      appUserId: userId,
      domain: "supplements",
      modifier: null,
      method: "PUT",
      path: SyncPaths.supplements(),
      body: { state: { supplements: updated }, updatedAtMs: Date.now() },
    });
    const takenItem = updated.find((s) => s.id === id);
    if (takenItem) {
      logInteractionEvent({
        appUserId: userId,
        kind: takenItem.category === "medication" ? "medication_taken" : "supplement_taken",
        payload: {
          id: takenItem.id,
          name: takenItem.name,
          category: takenItem.category,
        },
      });
    }
  }

  async function markMedicationMissed(id: string) {
    const missedItem = supplements.find(
      (item) => item.id === id && item.category === "medication",
    );
    if (!missedItem) return;

    const updated = supplements.map((item) =>
      item.id === id
        ? {
            ...item,
            taken: false,
            takenAt: undefined,
            missedCount: (item.missedCount ?? 0) + 1,
            lastMissedAt: new Date().toISOString(),
          }
        : item,
    );
    setSupplements(updated);
    await AsyncStorage.setItem(
      keysFor(userId).supplements,
      JSON.stringify(updated),
    );
    enqueueSync({
      appUserId: userId,
      domain: "supplements",
      modifier: null,
      method: "PUT",
      path: SyncPaths.supplements(),
      body: { state: { supplements: updated }, updatedAtMs: Date.now() },
    });
    logInteractionEvent({
      appUserId: userId,
      kind: "medication_missed",
      payload: { id: missedItem.id, name: missedItem.name },
    });
  }

  async function addSupplement(item: Omit<Supplement, "id" | "taken" | "takenAt">) {
    const newItem: Supplement = {
      ...item,
      id: `u_${Date.now()}`,
      taken: false,
    };
    const updated = [...supplements, newItem];
    setSupplements(updated);
    await AsyncStorage.setItem(keysFor(userId).supplements, JSON.stringify(updated));
    enqueueSync({
      appUserId: userId,
      domain: "supplements",
      modifier: null,
      method: "PUT",
      path: SyncPaths.supplements(),
      body: { state: { supplements: updated }, updatedAtMs: Date.now() },
    });
  }

  async function removeSupplement(id: string) {
    const updated = supplements.filter((s) => s.id !== id);
    setSupplements(updated);
    await AsyncStorage.setItem(keysFor(userId).supplements, JSON.stringify(updated));
    enqueueSync({
      appUserId: userId,
      domain: "supplements",
      modifier: null,
      method: "PUT",
      path: SyncPaths.supplements(),
      body: { state: { supplements: updated }, updatedAtMs: Date.now() },
    });
  }

  function getLatestDexaScore() {
    if (dexaScans.length === 0) return null;
    return worstTScore(dexaScans[0]);
  }

  function getFracturRisk(): "low" | "moderate" | "high" {
    const latest = getLatestDexaScore();
    if (latest === null) return "moderate";
    if (latest >= -1.0) return "low";
    if (latest >= -2.5) return "moderate";
    return "high";
  }

  const today = todayLocalISO();
  const todayActivity = activityLogs.find((a) => a.date === today) ?? null;
  const todayNutrition = nutritionLogs.find((n) => n.date === today) ?? null;
  const todayPlanTotals: NutritionTotals =
    todayNutrition?.planTotals ?? { ...ZERO_TOTALS };
  const todayManualTotals: NutritionTotals = todayNutrition
    ? deriveManualTotals(todayNutrition)
    : { ...ZERO_TOTALS };
  // Shared "logged today" signal — the same boolean drives streak,
  // XP, and the daily-focus nutrition-tile auto-complete. A meal-plan
  // tick and a manual Save both land here because they both write to
  // `todayNutrition`. An un-tick that drops the totals back to zero
  // (with no manual entry) flips this back to false → un-credits.
  const loggedNutritionToday = !!todayNutrition && hasNonZeroTotals(todayNutrition);
  const nutritionStreak = computeNutritionStreak(nutritionLogs, today);

  // Refs that always reflect the latest external state. Used by the
  // async XP reconciliation loop and the cross-account identity
  // guard so a user switch mid-flight (logout/login on a shared
  // device) cannot apply user A's pending XP delta to user B.
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);
  const loggedNutritionTodayRef = useRef(loggedNutritionToday);
  useEffect(() => {
    loggedNutritionTodayRef.current = loggedNutritionToday;
  }, [loggedNutritionToday]);
  // Mirror the hydration gate into a ref so the reconciler's
  // `isReady()` callback always sees the latest value, even if the
  // hydration completes during one of its awaited storage calls.
  const nutritionHydratedForRef = useRef(nutritionHydratedFor);
  useEffect(() => {
    nutritionHydratedForRef.current = nutritionHydratedFor;
  }, [nutritionHydratedFor]);

  // Sync `user.streakDays` with the derived nutrition streak. This is
  // what wires the dashboard pill and the Profile "Day Streak" stat to
  // automatically reflect a meal-plan tick. Guarded by an equality
  // check so we don't write on every render, and by an identity
  // re-check so a user switch between scheduling and the AsyncStorage
  // round-trip inside `updateUser` cannot bleed user A's streak into
  // user B's profile.
  useEffect(() => {
    if (!user) return;
    // Hydration gate: before nutrition logs have loaded for the
    // current user, `nutritionStreak` is computed from `[]` and
    // would clobber a real persisted streak with 0 on first mount.
    // Wait for the loader to finish — the effect re-fires on
    // `nutritionHydratedFor` change.
    if (nutritionHydratedFor !== user.id) return;
    if (user.streakDays === nutritionStreak) return;
    const actorUserId = user.id;
    void (async () => {
      // Re-check identity before writing — `updateUser` closes over
      // whatever user is current in AuthContext at call time, so
      // calling it after a switch would merge the streak into the
      // new user.
      if (userRef.current?.id !== actorUserId) return;
      await updateUserRef.current({ streakDays: nutritionStreak });
    })();
    // Intentionally not depending on the full `user` object — only
    // its streakDays / id — and updateUser is read through a ref to
    // keep the effect stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nutritionStreak, user?.streakDays, user?.id, nutritionHydratedFor]);

  // Award (or refund) the daily nutrition XP once per local day. The
  // marker key is per-user-per-day so:
  //   • multiple logs on the same day don't double-award
  //   • un-ticking the last meal (loggedToday → false) refunds + clears
  //     the marker so a re-tick later in the day re-awards exactly once
  //   • a manual save and a meal-plan tick on the same day produce a
  //     single XP credit between them (whichever happens first)
  //
  // The reconciliation runs through `runNutritionXPReconciliation`,
  // which owns the semaphore-with-rerun loop and the `isSameActor`
  // identity guard. Each iteration is atomic
  // (`reconcileNutritionXPOnce` writes the marker before returning
  // the next user XP), so the marker and the user XP can never be
  // mid-applied at iteration boundaries — and a user switch during
  // any await aborts the loop without persisting user B's profile.
  const xpSemaphoreRef = useRef({ inFlight: false, pending: false });
  // Reset the semaphore whenever the active account changes. The
  // previous user's loop will see `isSameActor()=false` on its next
  // iteration and bail naturally; resetting `inFlight` lets the new
  // user's effect kick off its own loop instead of just queueing a
  // pending pass for the old one. Declared BEFORE the XP effect so
  // it runs first in commit order on a user switch.
  useEffect(() => {
    xpSemaphoreRef.current = { inFlight: false, pending: false };
  }, [user?.id]);
  useEffect(() => {
    if (!user) return;
    // Hydration gate: skip until nutrition logs have loaded for
    // this user. Without this, the first mount would observe
    // `loggedNutritionToday=false` (logs still []) AND a possibly-
    // existing storage marker from a prior session — the
    // reconciler would then refund a day the user already claimed,
    // and clear the marker. The effect re-fires the moment the
    // hydration gate flips because `nutritionHydratedFor` is in
    // the dep list.
    if (nutritionHydratedFor !== user.id) return;
    const sem = xpSemaphoreRef.current;
    if (sem.inFlight) {
      // A reconciliation is already running; ask it to take another
      // pass once it finishes so we converge to the latest state.
      sem.pending = true;
      return;
    }
    const actorUserId = user.id;
    const actorInitial = {
      xp: user.xp,
      level: user.level,
      xpToNextLevel: user.xpToNextLevel,
      totalPoints: user.totalPoints,
    };
    void (async () => {
      sem.inFlight = true;
      try {
        await runNutritionXPReconciliation({
          initialUser: actorInitial,
          userId: actorUserId,
          isoDate: todayLocalISO(),
          storage: AsyncStorage,
          getLoggedToday: () => loggedNutritionTodayRef.current,
          applyUser: async (next) => {
            await updateUserRef.current(next);
          },
          isSameActor: () => userRef.current?.id === actorUserId,
          // Belt-and-braces: even though the effect is gated above,
          // a hydration reset triggered by a user switch mid-flight
          // would still be caught here before any storage write.
          isReady: () => nutritionHydratedForRef.current === actorUserId,
          isPending: () => sem.pending,
          resetPending: () => {
            sem.pending = false;
          },
        });
      } finally {
        sem.inFlight = false;
      }
    })();
    // We intentionally watch `loggedNutritionToday` and the user's
    // identity / current XP shape so a refund-then-re-award cycle
    // stays consistent. updateUser comes from the ref to keep the
    // effect stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    loggedNutritionToday,
    user?.id,
    user?.xp,
    user?.level,
    user?.xpToNextLevel,
    user?.totalPoints,
    nutritionHydratedFor,
  ]);

  return (
    <HealthContext.Provider
      value={{
        dexaScans,
        fraxResults,
        activityLogs,
        nutritionLogs,
        supplements,
        todayActivity,
        todayNutrition,
        todayPlanTotals,
        todayManualTotals,
        loggedNutritionToday,
        nutritionStreak,
        addDexaScan,
        addFraxResult,
        logActivity,
        logNutrition,
        upsertTodayNutrition,
        markMealEaten,
        markSupplementTaken,
        markMedicationMissed,
        addSupplement,
        removeSupplement,
        getLatestDexaScore,
        getFracturRisk,
      }}
    >
      {children}
    </HealthContext.Provider>
  );
}

export function useHealth() {
  const ctx = useContext(HealthContext);
  if (!ctx) throw new Error("useHealth must be used within HealthProvider");
  return ctx;
}
