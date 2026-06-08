/**
 * NutritionContext — owner of the user's personalised meal-plan state.
 *
 * Responsibilities:
 *   - Load & persist dietary preferences, today's plan, and favourites
 *     scoped to the active account (mirrors HealthContext.keysFor).
 *   - Auto-regenerate the plan when the date rolls over or the user
 *     changes their dietary preferences, so "Today" always means today.
 *   - Provide `swapMeal`, `regenerate`, and `toggleFavourite` actions.
 *
 * The context reads the user's profile (age / gender / condition) from
 * AuthContext and the calculated FRAX risk band from HealthContext and
 * exposes the derived daily targets, supplement suggestions, today's plan,
 * and totals so screens stay slim.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, type AppStateStatus } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useHealth } from "@/context/HealthContext";
import {
  RECIPES,
  type MealType,
  type Recipe,
} from "@/lib/nutritionData";
import {
  computeTotals,
  deriveTargets,
  generatePlan,
  pickSwap,
  suggestSupplements,
  type DailyPlan,
  type DietaryPreferences,
  type NutritionTargets,
  type PlanTotals,
  type SupplementSuggestion,
} from "@/lib/nutritionPlan";
import { enqueueSync, SyncPaths } from "@/lib/syncClient";

interface NutritionState {
  preferences: DietaryPreferences;
  plan: DailyPlan | null;
  favourites: string[];
}

interface NutritionContextType {
  preferences: DietaryPreferences;
  plan: DailyPlan | null;
  favourites: string[];
  targets: NutritionTargets;
  totals: PlanTotals;
  supplements: SupplementSuggestion[];
  isHydrated: boolean;
  /** Returns the resolved Recipe for a meal slot (or null). */
  recipeFor: (mealType: MealType) => Recipe | null;
  isFavourite: (recipeId: string) => boolean;
  toggleFavourite: (recipeId: string) => Promise<void>;
  setPreferences: (prefs: DietaryPreferences) => Promise<void>;
  regenerate: () => Promise<void>;
  swapMeal: (mealType: MealType) => Promise<void>;
}

const NutritionContext = createContext<NutritionContextType | null>(null);

const DEFAULT_PREFS: DietaryPreferences = {
  vegetarian: false,
  dairyFree: false,
  glutenFree: false,
};

/**
 * Coerce a partial / older `preferences` blob loaded from AsyncStorage into
 * the current shape. Existing users on older app builds will have a stored
 * payload without `glutenFree`; this fills in safe defaults so we never
 * read `undefined` into a boolean filter check.
 */
function normalisePrefs(input: Partial<DietaryPreferences> | undefined): DietaryPreferences {
  return {
    vegetarian: !!input?.vegetarian,
    dairyFree: !!input?.dairyFree,
    glutenFree: !!input?.glutenFree,
  };
}

function keysFor(userId: string | null) {
  const suffix = userId ? `:${userId}` : ":anon";
  return {
    state: `snap_nutrition_state${suffix}`,
  };
}

/**
 * Local-time YYYY-MM-DD. We deliberately avoid `toISOString` (which is UTC)
 * because the en-GB UI labels "Today" using the user's local date — keying
 * the plan in UTC would cause the plan and the visible date to disagree
 * around midnight in non-UTC timezones.
 */
function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function NutritionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { getFracturRisk } = useHealth();
  const userId = user?.id ?? null;

  const [preferences, setPreferencesState] = useState<DietaryPreferences>(DEFAULT_PREFS);
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [favourites, setFavourites] = useState<string[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  // Tracks the local date the running effects have observed. When this ticks
  // (midnight rollover, or app foregrounded after a day) we re-run the
  // freshness effect to roll the plan over without requiring user interaction.
  const [currentDate, setCurrentDate] = useState<string>(() => todayLocalISO());

  // `stateOwnerId` records which user the in-memory state belongs to. We only
  // ever persist when this matches the active `userId`, which closes the
  // window where stale state from a previous account could be flushed into
  // the new account's storage key during the brief moment between
  // userId-change and the hydration effect resetting state.
  const stateOwnerIdRef = useRef<string | null>(userId);

  // Hydrate state whenever the active user changes — gives every freshly
  // signed-in user a clean slate even on a shared device.
  useEffect(() => {
    let cancelled = false;
    // Synchronously invalidate the in-memory state for the previous owner so
    // the persistence effect cannot write old-user data under the new key
    // before hydration completes.
    setIsHydrated(false);
    setPreferencesState(DEFAULT_PREFS);
    setFavourites([]);
    setPlan(null);
    stateOwnerIdRef.current = null;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(keysFor(userId).state);
        if (cancelled) return;
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<NutritionState>;
          const prefs = normalisePrefs(parsed.preferences);
          const favs = Array.isArray(parsed.favourites) ? parsed.favourites : [];
          let nextPlan = parsed.plan ?? null;
          // If the plan is from a different day, throw it away — it'll be
          // freshly generated by the effect below.
          if (nextPlan && nextPlan.date !== todayLocalISO()) {
            nextPlan = null;
          }
          setPreferencesState(prefs);
          setFavourites(favs);
          setPlan(nextPlan);
        }
        // (else state is already at defaults from above)
      } catch {
        // Defaults already in place.
      } finally {
        if (!cancelled) {
          stateOwnerIdRef.current = userId;
          setIsHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Persist state whenever it meaningfully changes (after hydration so we
  // don't immediately flush the loaded value back over itself, and only
  // when the in-memory state actually belongs to the active user).
  useEffect(() => {
    if (!isHydrated) return;
    if (stateOwnerIdRef.current !== userId) return;
    const payload: NutritionState = { preferences, plan, favourites };
    AsyncStorage.setItem(keysFor(userId).state, JSON.stringify(payload)).catch(() => {});
    // Mirror the meal-plan/prefs/favourites blob to the server keyed
    // by the plan's local-date. Skip when no plan has been generated
    // yet (still warming up on a fresh hydrate).
    if (plan?.date && userId) {
      enqueueSync({
        appUserId: userId,
        domain: "meal-plan",
        modifier: plan.date,
        method: "PUT",
        path: SyncPaths.mealPlanDay(plan.date),
        body: { data: payload, updatedAtMs: Date.now() },
      });
    }
  }, [isHydrated, preferences, plan, favourites, userId]);

  // Date rollover: poll the local date once a minute and re-check when the
  // app returns to the foreground, so a long-lived session crossing midnight
  // still ends up on the correct day.
  useEffect(() => {
    function tick() {
      const t = todayLocalISO();
      setCurrentDate((prev) => (prev === t ? prev : t));
    }
    const interval = setInterval(tick, 60_000);
    const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
      if (s === "active") tick();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, []);

  // Make sure today's plan exists & is for today. If preferences or the local
  // date change while a plan exists, we regenerate so the day reflects the
  // new filters / date.
  useEffect(() => {
    if (!isHydrated) return;
    if (!plan || plan.date !== currentDate) {
      setPlan(generatePlan(currentDate, preferences, 0));
    }
  }, [isHydrated, plan, preferences, currentDate]);

  // ---- Derivations --------------------------------------------------------

  const targets = useMemo<NutritionTargets>(() => {
    return deriveTargets({
      age: user?.age,
      gender: user?.gender,
      condition: user?.condition,
      fractureRisk: getFracturRisk(),
    });
    // getFracturRisk is recreated on each HealthContext render but the dep on
    // the underlying scans is what matters; tying to user fields keeps this
    // stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.age, user?.gender, user?.condition, getFracturRisk]);

  const supplements = useMemo<SupplementSuggestion[]>(() => {
    return suggestSupplements({
      age: user?.age,
      gender: user?.gender,
      condition: user?.condition,
      fractureRisk: getFracturRisk(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.age, user?.gender, user?.condition, getFracturRisk]);

  const totals = useMemo<PlanTotals>(() => {
    if (!plan) return { calcium: 0, vitaminD: 0, protein: 0, magnesium: 0, calories: 0 };
    return computeTotals(plan);
  }, [plan]);

  // ---- Actions ------------------------------------------------------------

  const recipeFor = useCallback(
    (mealType: MealType): Recipe | null => {
      if (!plan) return null;
      return RECIPES.find((r) => r.id === plan.recipes[mealType]) ?? null;
    },
    [plan],
  );

  const isFavourite = useCallback(
    (recipeId: string) => favourites.includes(recipeId),
    [favourites],
  );

  const toggleFavourite = useCallback(
    async (recipeId: string) => {
      setFavourites((prev) =>
        prev.includes(recipeId)
          ? prev.filter((id) => id !== recipeId)
          : [recipeId, ...prev],
      );
    },
    [],
  );

  const setPreferences = useCallback(
    async (next: DietaryPreferences) => {
      setPreferencesState(next);
      // Force-regenerate so the visible plan immediately reflects the filter.
      setPlan(generatePlan(todayLocalISO(), next, 0));
    },
    [],
  );

  const regenerate = useCallback(async () => {
    setPlan((prev) => {
      const seed = (prev?.regenSeed ?? 0) + 1;
      return generatePlan(todayLocalISO(), preferences, seed);
    });
  }, [preferences]);

  const swapMeal = useCallback(
    async (mealType: MealType) => {
      setPlan((prev) => {
        if (!prev) return prev;
        const currentId = prev.recipes[mealType];
        const inPlanIds = Object.values(prev.recipes);
        const swap = pickSwap(currentId, mealType, preferences, inPlanIds);
        if (!swap) return prev;
        return {
          ...prev,
          recipes: { ...prev.recipes, [mealType]: swap.id },
        };
      });
    },
    [preferences],
  );

  const value = useMemo<NutritionContextType>(
    () => ({
      preferences,
      plan,
      favourites,
      targets,
      totals,
      supplements,
      isHydrated,
      recipeFor,
      isFavourite,
      toggleFavourite,
      setPreferences,
      regenerate,
      swapMeal,
    }),
    [
      preferences,
      plan,
      favourites,
      targets,
      totals,
      supplements,
      isHydrated,
      recipeFor,
      isFavourite,
      toggleFavourite,
      setPreferences,
      regenerate,
      swapMeal,
    ],
  );

  return <NutritionContext.Provider value={value}>{children}</NutritionContext.Provider>;
}

export function useNutrition() {
  const ctx = useContext(NutritionContext);
  if (!ctx) throw new Error("useNutrition must be used within a NutritionProvider");
  return ctx;
}
