import { describe, expect, it } from "vitest";
import {
  applyXPDelta,
  computeNutritionStreak,
  decideNutritionXPAction,
  hasNonZeroTotals,
  isLoggedDay,
  NUTRITION_DAILY_XP,
  nutritionXPClaimKey,
  reconcileNutritionXPOnce,
  runNutritionXPReconciliation,
  type NutritionStreakLog,
  type NutritionXPStorage,
  type XPState,
} from "../nutritionStreak";

function log(
  date: string,
  totals: Partial<Omit<NutritionStreakLog, "date">> = {},
): NutritionStreakLog {
  return {
    date,
    calcium: 0,
    vitaminD: 0,
    protein: 0,
    magnesium: 0,
    calories: 0,
    ...totals,
  };
}

describe("hasNonZeroTotals", () => {
  it("is false for an all-zero log (post-untoggle, no manual entry)", () => {
    expect(hasNonZeroTotals(log("2026-04-30"))).toBe(false);
  });

  it("is true when any single nutrient is non-zero", () => {
    expect(hasNonZeroTotals(log("2026-04-30", { calcium: 200 }))).toBe(true);
    expect(hasNonZeroTotals(log("2026-04-30", { vitaminD: 50 }))).toBe(true);
    expect(hasNonZeroTotals(log("2026-04-30", { protein: 5 }))).toBe(true);
    expect(hasNonZeroTotals(log("2026-04-30", { magnesium: 10 }))).toBe(true);
    expect(hasNonZeroTotals(log("2026-04-30", { calories: 100 }))).toBe(true);
  });
});

describe("isLoggedDay", () => {
  it("is false when no log exists for the date", () => {
    expect(isLoggedDay([log("2026-04-29", { calcium: 200 })], "2026-04-30"))
      .toBe(false);
  });

  it("is false when the date's log has all-zero totals", () => {
    expect(isLoggedDay([log("2026-04-30")], "2026-04-30")).toBe(false);
  });

  it("is true when the date's log has any non-zero total", () => {
    expect(
      isLoggedDay([log("2026-04-30", { calcium: 200 })], "2026-04-30"),
    ).toBe(true);
  });
});

describe("computeNutritionStreak", () => {
  it("returns 0 for an empty log set", () => {
    expect(computeNutritionStreak([], "2026-04-30")).toBe(0);
  });

  it("returns 1 when only today is logged", () => {
    const logs = [log("2026-04-30", { calcium: 200 })];
    expect(computeNutritionStreak(logs, "2026-04-30")).toBe(1);
  });

  it("counts consecutive logged days back from today", () => {
    const logs = [
      log("2026-04-30", { calcium: 200 }),
      log("2026-04-29", { calcium: 150 }),
      log("2026-04-28", { calcium: 100 }),
    ];
    expect(computeNutritionStreak(logs, "2026-04-30")).toBe(3);
  });

  it("survives 'haven't logged today yet' via the yesterday-grace anchor", () => {
    const logs = [
      log("2026-04-29", { calcium: 200 }),
      log("2026-04-28", { calcium: 200 }),
    ];
    expect(computeNutritionStreak(logs, "2026-04-30")).toBe(2);
  });

  it("breaks the streak on a missing day", () => {
    const logs = [
      log("2026-04-30", { calcium: 200 }),
      log("2026-04-29", { calcium: 200 }),
      // gap on 2026-04-28
      log("2026-04-27", { calcium: 200 }),
    ];
    expect(computeNutritionStreak(logs, "2026-04-30")).toBe(2);
  });

  it("treats an all-zero day as a break in the streak", () => {
    // Mirrors the un-credit case: user ticked breakfast yesterday, then
    // un-ticked it. Yesterday's log exists but is all zero — the streak
    // should NOT count it.
    const logs = [
      log("2026-04-30", { calcium: 200 }),
      log("2026-04-29"), // zeroed-out — un-credited
      log("2026-04-28", { calcium: 200 }),
    ];
    expect(computeNutritionStreak(logs, "2026-04-30")).toBe(1);
  });

  it("returns 0 when neither today nor yesterday is logged", () => {
    const logs = [log("2026-04-27", { calcium: 200 })];
    expect(computeNutritionStreak(logs, "2026-04-30")).toBe(0);
  });

  it("handles month boundaries via local-date arithmetic", () => {
    const logs = [
      log("2026-05-01", { calcium: 200 }),
      log("2026-04-30", { calcium: 200 }),
      log("2026-04-29", { calcium: 200 }),
    ];
    expect(computeNutritionStreak(logs, "2026-05-01")).toBe(3);
  });
});

describe("applyXPDelta", () => {
  const base = { xp: 100, level: 1, xpToNextLevel: 500, totalPoints: 100 };

  it("returns the same state for delta=0", () => {
    expect(applyXPDelta(base, 0)).toEqual(base);
  });

  it("adds XP without leveling up when below the next-level threshold", () => {
    const next = applyXPDelta(base, NUTRITION_DAILY_XP);
    expect(next.xp).toBe(125);
    expect(next.level).toBe(1);
    expect(next.xpToNextLevel).toBe(500);
    expect(next.totalPoints).toBe(125);
  });

  it("rolls over a level when XP crosses the threshold", () => {
    // 480 + 25 = 505 → level 2, xp 5
    const next = applyXPDelta(
      { xp: 480, level: 1, xpToNextLevel: 500, totalPoints: 480 },
      NUTRITION_DAILY_XP,
    );
    expect(next.level).toBe(2);
    expect(next.xp).toBe(5);
    expect(next.xpToNextLevel).toBe(500);
    expect(next.totalPoints).toBe(505);
  });

  it("refunds XP without going negative on totalPoints", () => {
    const next = applyXPDelta(base, -NUTRITION_DAILY_XP);
    expect(next.xp).toBe(75);
    expect(next.level).toBe(1);
    expect(next.totalPoints).toBe(75);
  });

  it("walks the level back down when refund pushes XP below 0", () => {
    // level 2, xp 5, refund 25 → level 1, xp 480 (5 - 25 + 500)
    const start = { xp: 5, level: 2, xpToNextLevel: 500, totalPoints: 505 };
    const next = applyXPDelta(start, -NUTRITION_DAILY_XP);
    expect(next.level).toBe(1);
    expect(next.xp).toBe(480);
    expect(next.totalPoints).toBe(480);
  });

  it("clamps at level 1 / xp 0 — never goes below the floor", () => {
    const start = { xp: 10, level: 1, xpToNextLevel: 500, totalPoints: 10 };
    const next = applyXPDelta(start, -NUTRITION_DAILY_XP);
    expect(next.level).toBe(1);
    expect(next.xp).toBe(0);
    expect(next.totalPoints).toBe(0);
  });

  it("award then refund is a perfect round-trip on XP", () => {
    const awarded = applyXPDelta(base, NUTRITION_DAILY_XP);
    const refunded = applyXPDelta(awarded, -NUTRITION_DAILY_XP);
    expect(refunded.xp).toBe(base.xp);
    expect(refunded.level).toBe(base.level);
    // totalPoints is monotonic by design (running counter), so after
    // refund it ends up where we started — net delta zero.
    expect(refunded.totalPoints).toBe(base.totalPoints);
  });
});

describe("nutritionXPClaimKey", () => {
  it("namespaces by user and date so two users on the same day don't collide", () => {
    expect(nutritionXPClaimKey("u1", "2026-04-30"))
      .toBe("snap_nutrition_xp:u1:2026-04-30");
    expect(nutritionXPClaimKey("u2", "2026-04-30"))
      .toBe("snap_nutrition_xp:u2:2026-04-30");
  });

  it("falls back to 'anon' when no userId is available", () => {
    expect(nutritionXPClaimKey(null, "2026-04-30"))
      .toBe("snap_nutrition_xp:anon:2026-04-30");
    expect(nutritionXPClaimKey(undefined, "2026-04-30"))
      .toBe("snap_nutrition_xp:anon:2026-04-30");
  });
});

describe("decideNutritionXPAction", () => {
  it("awards on the first credit of the day (logged && !claim)", () => {
    expect(decideNutritionXPAction(true, false)).toBe("award");
  });

  it("refunds when the user un-credits (!logged && claim)", () => {
    expect(decideNutritionXPAction(false, true)).toBe("refund");
  });

  it("is a no-op when already in sync (claimed for a logged day)", () => {
    expect(decideNutritionXPAction(true, true)).toBe("noop");
  });

  it("is a no-op when neither side has anything to do", () => {
    expect(decideNutritionXPAction(false, false)).toBe("noop");
  });
});

/**
 * In-memory AsyncStorage-shaped fake. Lets the integration tests
 * drive the reconciliation helper exactly the way HealthContext
 * does, without spinning up React.
 */
function makeMemoryStorage(): NutritionXPStorage & {
  snapshot: () => Record<string, string>;
} {
  const map = new Map<string, string>();
  return {
    async getItem(key) {
      return map.has(key) ? map.get(key)! : null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
    snapshot() {
      return Object.fromEntries(map.entries());
    },
  };
}

const baseUser: XPState = {
  xp: 0,
  level: 1,
  xpToNextLevel: 500,
  totalPoints: 0,
};

describe("reconcileNutritionXPOnce", () => {
  const userId = "user-1";
  const isoDate = "2026-04-30";
  const key = nutritionXPClaimKey(userId, isoDate);

  it("awards XP and writes the claim marker on the first logged pass", async () => {
    const storage = makeMemoryStorage();
    const next = await reconcileNutritionXPOnce({
      user: baseUser,
      userId,
      loggedToday: true,
      isoDate,
      storage,
    });
    expect(next).not.toBeNull();
    expect(next!.xp).toBe(NUTRITION_DAILY_XP);
    expect(next!.totalPoints).toBe(NUTRITION_DAILY_XP);
    expect(storage.snapshot()[key]).toBe("1");
  });

  it("returns null and leaves the marker in place when already claimed", async () => {
    const storage = makeMemoryStorage();
    await storage.setItem(key, "1");
    const credited: XPState = { ...baseUser, xp: 25, totalPoints: 25 };
    const next = await reconcileNutritionXPOnce({
      user: credited,
      userId,
      loggedToday: true,
      isoDate,
      storage,
    });
    expect(next).toBeNull();
    expect(storage.snapshot()[key]).toBe("1");
  });

  it("refunds XP and clears the marker when the user un-credits", async () => {
    const storage = makeMemoryStorage();
    await storage.setItem(key, "1");
    const credited: XPState = { ...baseUser, xp: 25, totalPoints: 25 };
    const next = await reconcileNutritionXPOnce({
      user: credited,
      userId,
      loggedToday: false,
      isoDate,
      storage,
    });
    expect(next).not.toBeNull();
    expect(next!.xp).toBe(0);
    expect(next!.totalPoints).toBe(0);
    expect(storage.snapshot()[key]).toBeUndefined();
  });

  it("is a no-op when nothing was ever claimed and nothing is logged", async () => {
    const storage = makeMemoryStorage();
    const next = await reconcileNutritionXPOnce({
      user: baseUser,
      userId,
      loggedToday: false,
      isoDate,
      storage,
    });
    expect(next).toBeNull();
    expect(storage.snapshot()[key]).toBeUndefined();
  });
});

/**
 * End-to-end shape tests for the reconciliation loop pattern that
 * HealthContext uses (semaphore + rerun on pending). We re-implement
 * the loop here, driving it manually, to prove that any rapid
 * tick / untick / re-tick sequence converges to a marker-vs-XP
 * state that matches the `loggedToday` signal and never
 * double-credits or over-refunds.
 */
describe("reconcileNutritionXPOnce — rapid toggle integration", () => {
  const userId = "user-1";
  const isoDate = "2026-04-30";
  const key = nutritionXPClaimKey(userId, isoDate);

  /** Mirrors HealthContext's semaphore loop. Keeps reconciling
   *  until `getLoggedToday()` agrees with the persisted marker. */
  async function runLoop(
    initial: XPState,
    storage: NutritionXPStorage,
    getLoggedToday: () => boolean,
    maxIters = 20,
  ) {
    let workingUser = { ...initial };
    const applied: XPState[] = [];
    for (let i = 0; i < maxIters; i++) {
      const next = await reconcileNutritionXPOnce({
        user: workingUser,
        userId,
        loggedToday: getLoggedToday(),
        isoDate,
        storage,
      });
      if (!next) break;
      workingUser = { ...workingUser, ...next };
      applied.push(workingUser);
    }
    return { user: workingUser, applied };
  }

  it("tick → untick → tick converges to a single net award", async () => {
    const storage = makeMemoryStorage();
    let logged = true;
    // First pass: award.
    let result = await runLoop(baseUser, storage, () => logged);
    expect(result.user.xp).toBe(25);
    expect(storage.snapshot()[key]).toBe("1");

    // Untick before any more triggers.
    logged = false;
    result = await runLoop(result.user, storage, () => logged);
    expect(result.user.xp).toBe(0);
    expect(storage.snapshot()[key]).toBeUndefined();

    // Re-tick.
    logged = true;
    result = await runLoop(result.user, storage, () => logged);
    expect(result.user.xp).toBe(25);
    expect(storage.snapshot()[key]).toBe("1");
  });

  it("converges when the logged signal flips during the awaited pass", async () => {
    const storage = makeMemoryStorage();
    // Simulate the user untoggling DURING the first storage await:
    // first call sees logged=true, by the second iteration the
    // signal has flipped to false. The semaphore-loop pattern
    // handles this by re-evaluating with the freshest signal.
    const signals = [true, false, false];
    let i = 0;
    const result = await runLoop(baseUser, storage, () => {
      const v = signals[Math.min(i, signals.length - 1)];
      i += 1;
      return v;
    });
    // Final state: marker cleared, XP back to 0 — net no-op.
    expect(result.user.xp).toBe(0);
    expect(result.user.totalPoints).toBe(0);
    expect(storage.snapshot()[key]).toBeUndefined();
  });

  it("never double-awards when the loop runs many extra passes", async () => {
    const storage = makeMemoryStorage();
    // Loop should bail after the first award because subsequent
    // passes see `claimed=true` and return null.
    const result = await runLoop(baseUser, storage, () => true, 10);
    expect(result.user.xp).toBe(25);
    expect(result.user.totalPoints).toBe(25);
    // Exactly one mutation was applied.
    expect(result.applied).toHaveLength(1);
    expect(storage.snapshot()[key]).toBe("1");
  });

  it("never over-refunds when a refund pass is followed by extra triggers", async () => {
    const storage = makeMemoryStorage();
    await storage.setItem(key, "1");
    const credited: XPState = { ...baseUser, xp: 25, totalPoints: 25 };
    const result = await runLoop(credited, storage, () => false, 10);
    expect(result.user.xp).toBe(0);
    expect(result.user.totalPoints).toBe(0);
    expect(result.applied).toHaveLength(1);
    expect(storage.snapshot()[key]).toBeUndefined();
  });

  it("does not refund a previously-claimed day before hydration completes", async () => {
    // Reviewer-flagged regression: on app startup the in-memory
    // `nutritionLogs` is `[]` until AsyncStorage hydrates. If the
    // reconciler runs in that window with a pre-existing claim
    // marker (the user really DID log yesterday/today), it would
    // see `getLoggedToday=false` + claim → refund → wipe marker,
    // costing the user 25 XP. The hydration `isReady` gate must
    // bail before reading or writing storage.
    const storage = makeMemoryStorage();
    // Pre-existing claim from a previous session for this user.
    const claimKey = nutritionXPClaimKey("user-A", "2026-05-02");
    await storage.setItem(claimKey, "1");
    // User profile already reflects the prior award.
    const claimedUser: XPState = {
      xp: 25,
      level: 1,
      xpToNextLevel: 500,
      totalPoints: 25,
    };
    const appliedNexts: XPState[] = [];
    let hydrated = false; // gate stays closed for this run

    const result = await runNutritionXPReconciliation({
      initialUser: claimedUser,
      userId: "user-A",
      isoDate: "2026-05-02",
      storage,
      // Pre-hydration: logs are still [], so this is a false negative.
      getLoggedToday: () => false,
      applyUser: async (next) => {
        appliedNexts.push(next);
      },
      isSameActor: () => true,
      isReady: () => hydrated,
      isPending: () => false,
      resetPending: () => {},
    });

    // The gate prevents any storage read or user mutation.
    expect(appliedNexts).toHaveLength(0);
    // Marker is intact — credit preserved across the gated mount.
    expect(storage.snapshot()[claimKey]).toBe("1");
    // Working user is unchanged from the initial claimed state.
    expect(result).toEqual(claimedUser);

    // Now simulate hydration completing: logs are loaded and the
    // real `loggedToday` signal is available. Re-running should
    // be a no-op because marker AND loggedToday already agree.
    hydrated = true;
    const result2 = await runNutritionXPReconciliation({
      initialUser: claimedUser,
      userId: "user-A",
      isoDate: "2026-05-02",
      storage,
      getLoggedToday: () => true, // post-hydration: real signal
      applyUser: async (next) => {
        appliedNexts.push(next);
      },
      isSameActor: () => true,
      isReady: () => hydrated,
      isPending: () => false,
      resetPending: () => {},
    });
    // Marker present + loggedToday=true → noop. No XP movement.
    expect(appliedNexts).toHaveLength(0);
    expect(storage.snapshot()[claimKey]).toBe("1");
    expect(result2).toEqual(claimedUser);
  });

  it("aborts on a user switch mid-flight without applying user A's delta to user B", async () => {
    // The original race the reviewer flagged: user A starts a
    // reconciliation, user A logs out and user B logs in before
    // the awaited storage round-trip resolves. Without an identity
    // guard, the loop would call updateUser with user A's XP
    // delta — but updateUser closes over whatever user is current
    // at call time (user B), bleeding XP across accounts.
    const storage = makeMemoryStorage();
    let activeUserId = "user-A";
    const appliedTo: { userId: string; next: XPState }[] = [];
    const result = await runNutritionXPReconciliation({
      initialUser: baseUser,
      userId: "user-A",
      isoDate: "2026-04-30",
      storage,
      getLoggedToday: () => true,
      applyUser: async (next) => {
        // Caller's persistence layer would write to whichever user
        // is currently active. We just record what it was.
        appliedTo.push({ userId: activeUserId, next });
      },
      isSameActor: () => activeUserId === "user-A",
      isPending: () => false,
      resetPending: () => {},
    });
    // First pass would award XP; we simulate the user switch by
    // making isSameActor flip to false RIGHT after the first
    // marker write. Re-run with the switch:
    activeUserId = "user-B";
    const result2 = await runNutritionXPReconciliation({
      initialUser: baseUser,
      userId: "user-A",
      isoDate: "2026-05-01",
      storage,
      getLoggedToday: () => true,
      applyUser: async (next) => {
        appliedTo.push({ userId: activeUserId, next });
      },
      isSameActor: () => activeUserId === "user-A",
      isPending: () => false,
      resetPending: () => {},
    });
    // First call ran while user A was active → applied to user A.
    expect(appliedTo[0]).toEqual({
      userId: "user-A",
      next: result,
    });
    // Second call ran with user B active → identity guard tripped
    // before any apply. Nothing was persisted to user B.
    expect(appliedTo).toHaveLength(1);
    // The returned working user from the aborted run is just the
    // initial — caller is told "do not trust" by the absence of a
    // matching applyUser call.
    expect(result2).toEqual(baseUser);
    // The user-A marker for the second day was never written
    // (identity guard bailed on the first pre-await check).
    expect(
      storage.snapshot()[nutritionXPClaimKey("user-A", "2026-05-01")],
    ).toBeUndefined();
  });

  it("does not apply when identity changes during the awaited storage call", async () => {
    // Simulates the harder race: identity is still user A when the
    // loop enters reconcileNutritionXPOnce, the marker write (an
    // await) succeeds, but the user has switched to B by the time
    // we'd call applyUser. The post-await identity re-check must
    // catch this and bail without persisting.
    const storage = makeMemoryStorage();
    let identitySwitched = false;
    const appliedNexts: XPState[] = [];

    // Wrap setItem so we can flip identity during the await.
    const slowStorage: NutritionXPStorage = {
      ...storage,
      async setItem(key, value) {
        identitySwitched = true; // mimic switch happening mid-write
        await storage.setItem(key, value);
      },
    };

    const result = await runNutritionXPReconciliation({
      initialUser: baseUser,
      userId: "user-A",
      isoDate: "2026-05-02",
      storage: slowStorage,
      getLoggedToday: () => true,
      applyUser: async (next) => {
        appliedNexts.push(next);
      },
      // Same actor only until the storage write fires.
      isSameActor: () => !identitySwitched,
      isPending: () => false,
      resetPending: () => {},
    });

    // Marker WAS written (it is namespaced by userId so it can't
    // pollute user B), but applyUser was NEVER called because the
    // post-await identity re-check tripped.
    expect(appliedNexts).toHaveLength(0);
    expect(
      storage.snapshot()[nutritionXPClaimKey("user-A", "2026-05-02")],
    ).toBe("1");
    // Returned working user is the initial — nothing applied.
    expect(result).toEqual(baseUser);
  });

  it("keeps marker and XP consistent when an award completes mid-untick", async () => {
    // Reproduces the original race: trigger fires for tick (logged=true),
    // we read the marker (none), commit award + write marker. Before the
    // updateUser would propagate, a second trigger fires for untick. The
    // loop's second pass MUST see the just-written marker AND the new
    // logged=false signal and refund. Net result: zero-zero, marker gone.
    const storage = makeMemoryStorage();
    let logged = true;
    let pass = 0;
    const result = await runLoop(baseUser, storage, () => {
      // Flip to false right after the first award commits.
      const v = pass === 0 ? true : false;
      pass += 1;
      return v;
    });
    expect(result.user.xp).toBe(0);
    expect(result.user.totalPoints).toBe(0);
    expect(storage.snapshot()[key]).toBeUndefined();
    // Two mutations: award then immediate refund.
    expect(result.applied).toHaveLength(2);
    expect(result.applied[0].xp).toBe(25);
    expect(result.applied[1].xp).toBe(0);
    // Reference 'logged' so lint doesn't complain about the let.
    expect(logged).toBe(true);
  });
});
