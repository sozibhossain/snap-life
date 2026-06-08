
export const NUTRITION_DAILY_XP = 25;

/** Per-day, per-user storage key for the daily nutrition XP claim. */
export function nutritionXPClaimKey(
  userId: string | null | undefined,
  isoDate: string,
): string {
  return `snap_nutrition_xp:${userId ?? "anon"}:${isoDate}`;
}

/** Subset of NutritionLog this module needs. Kept narrow so it can be
 *  exercised from tests without importing the React context. */
export interface NutritionStreakLog {
  date: string;
  calcium: number;
  vitaminD: number;
  protein: number;
  magnesium: number;
  calories: number;
}

/** True when a log has any nutrient > 0. The empty / zeroed-out shape
 *  represents "ticked then untoggled, no manual entry" — which the task
 *  explicitly wants treated as un-credited. */
export function hasNonZeroTotals(log: NutritionStreakLog): boolean {
  return (
    log.calcium > 0 ||
    log.vitaminD > 0 ||
    log.protein > 0 ||
    log.magnesium > 0 ||
    log.calories > 0
  );
}

/** Did the user log nutrition (any source: manual, plan-tick, or both)
 *  on `isoDate`? */
export function isLoggedDay(
  logs: NutritionStreakLog[],
  isoDate: string,
): boolean {
  const day = logs.find((l) => l.date === isoDate);
  return !!day && hasNonZeroTotals(day);
}

/** Add `deltaDays` to a YYYY-MM-DD string, returning YYYY-MM-DD.
 *  Constructed in local time so it agrees with the rest of the app's
 *  `todayLocalISO` convention. */
function shiftIsoDay(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + deltaDays);
  const ny = date.getFullYear();
  const nm = String(date.getMonth() + 1).padStart(2, "0");
  const nd = String(date.getDate()).padStart(2, "0");
  return `${ny}-${nm}-${nd}`;
}

export function computeNutritionStreak(
  logs: NutritionStreakLog[],
  todayISO: string,
): number {
  let anchor = todayISO;
  if (!isLoggedDay(logs, anchor)) {
    anchor = shiftIsoDay(todayISO, -1);
    if (!isLoggedDay(logs, anchor)) return 0;
  }
  let streak = 0;
  let cursor = anchor;
  // Hard ceiling so a corrupted log set can't loop forever — way larger
  // than any real-world streak we'd ever see.
  for (let i = 0; i < 3650 && isLoggedDay(logs, cursor); i++) {
    streak += 1;
    cursor = shiftIsoDay(cursor, -1);
  }
  return streak;
}

/** Subset of `User` that XP arithmetic touches. */
export interface XPState {
  xp: number;
  level: number;
  xpToNextLevel: number;
  totalPoints: number;
}

export function applyXPDelta(state: XPState, delta: number): XPState {
  if (delta === 0) return state;
  let xp = state.xp + delta;
  let level = state.level;
  let xpToNext = state.xpToNextLevel || 500;

  if (delta > 0) {
    while (xp >= xpToNext) {
      xp -= xpToNext;
      level += 1;
      xpToNext = 500;
    }
  } else {
    while (xp < 0) {
      if (level <= 1) {
        xp = 0;
        xpToNext = 500;
        break;
      }
      level -= 1;
      xpToNext = 500;
      xp += xpToNext;
    }
  }

  return {
    xp,
    level,
    xpToNextLevel: xpToNext,
    totalPoints: Math.max(0, state.totalPoints + delta),
  };
}

export type NutritionXPAction = "award" | "refund" | "noop";

export function decideNutritionXPAction(
  loggedToday: boolean,
  hasClaim: boolean,
): NutritionXPAction {
  if (loggedToday && !hasClaim) return "award";
  if (!loggedToday && hasClaim) return "refund";
  return "noop";
}

export interface NutritionXPStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export async function reconcileNutritionXPOnce(args: {
  user: XPState;
  userId: string;
  loggedToday: boolean;
  isoDate: string;
  storage: NutritionXPStorage;
}): Promise<XPState | null> {
  const key = nutritionXPClaimKey(args.userId, args.isoDate);
  const hasClaim = (await args.storage.getItem(key)) !== null;
  const action = decideNutritionXPAction(args.loggedToday, hasClaim);
  if (action === "award") {
    await args.storage.setItem(key, "1");
    return applyXPDelta(args.user, NUTRITION_DAILY_XP);
  }
  if (action === "refund") {
    await args.storage.removeItem(key);
    return applyXPDelta(args.user, -NUTRITION_DAILY_XP);
  }
  return null;
}

export async function runNutritionXPReconciliation(args: {
  initialUser: XPState;
  userId: string;
  isoDate: string;
  storage: NutritionXPStorage;
  /** Re-read each iteration so signal flips during awaits are
   *  reflected in the next pass's decision. */
  getLoggedToday: () => boolean;
  /** Persist the next user shape. Caller is responsible for the
   *  actual setState/AsyncStorage write. */
  applyUser: (next: XPState) => Promise<void>;
  /** Identity guard. Return false the moment the active user is
   *  no longer the one we started reconciling for — the loop
   *  will abort without persisting any further mutation. */
  isSameActor: () => boolean;
  /** Hydration guard. Return false while the caller's persisted
   *  state (e.g. AsyncStorage-backed nutrition logs) has not yet
   *  loaded for the current user. The reconciler MUST NOT run
   *  before hydration: `getLoggedToday()` would report stale
   *  pre-hydration values, causing a spurious refund of an
   *  already-claimed day (the storage marker exists but the
   *  in-memory log is still []). When false, the loop bails
   *  without reading or writing storage; caller is expected to
   *  re-trigger once hydration completes. Optional — defaults to
   *  always-ready so existing tests / callers are unaffected. */
  isReady?: () => boolean;
  /** Pending semaphore accessor. True means "another trigger
   *  fired while we were running; please loop again". */
  isPending: () => boolean;
  /** Clear the pending flag at the start of each iteration. */
  resetPending: () => void;
  /** Belt-and-braces ceiling so a buggy caller can't spin
   *  forever. Real-world convergence is 1–2 iterations. */
  maxIters?: number;
}): Promise<XPState> {
  const max = args.maxIters ?? 16;
  const isReady = args.isReady ?? (() => true);
  let workingUser = args.initialUser;
  // Hydration gate runs before anything else: if persisted state
  // hasn't loaded yet, even reading the marker is unsafe because
  // we'd act on a stale `getLoggedToday()` that still reflects the
  // empty initial array. Bail early — the caller will re-trigger
  // once hydration completes via the same effect deps.
  if (!isReady()) return workingUser;
  for (let i = 0; i < max; i++) {
    args.resetPending();
    if (!args.isSameActor()) return workingUser;
    const next = await reconcileNutritionXPOnce({
      user: workingUser,
      userId: args.userId,
      loggedToday: args.getLoggedToday(),
      isoDate: args.isoDate,
      storage: args.storage,
    });
    if (next) {
      // Re-check identity AFTER the storage await — the active
      // user may have changed during the round-trip. If so, we
      // keep the marker write we just made (it's namespaced by
      // userId so it can't pollute another account) but skip the
      // user mutation and bail out.
      if (!args.isSameActor()) return workingUser;
      await args.applyUser(next);
      workingUser = { ...workingUser, ...next };
    }
    if (!args.isPending()) break;
  }
  return workingUser;
}
