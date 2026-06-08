import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mock the `@workspace/db` import out before the engagementProfile module
 * is evaluated. The real module attempts to spin up a pg Pool from
 * `DATABASE_URL` at import time, which we don't want in unit tests.
 *
 * The module fires two kinds of queries against the same chained `db`
 * proxy:
 *   • `rec_*` aggregations on interaction_events — terminate with
 *     `.groupBy(...)`, dispatched through `groupBySpy`.
 *   • Per-table behavioural reads (nutrition_logs, wellbeing_entries,
 *     activity_logs, user_profile) — terminate with either an awaited
 *     `.where(...)` chain or `.limit(1)`, dispatched through
 *     `tableRowsSpy`. The spy receives the table sentinel so each test
 *     can return different rows per table.
 */
const groupBySpy = vi.fn();
const tableRowsSpy = vi.fn();

vi.mock("@workspace/db", () => {
  const interactionEventsTable = {
    __t: "interaction_events",
    kind: "kind",
    appUserId: "appUserId",
    receivedAt: "receivedAt",
    payload: "payload",
  };
  const nutritionLogsTable = {
    __t: "nutrition_logs",
    appUserId: "n.appUserId",
    day: "n.day",
    log: "n.log",
  };
  const wellbeingEntriesTable = {
    __t: "wellbeing_entries",
    appUserId: "w.appUserId",
    entry: "w.entry",
    completedAtMs: "w.completedAtMs",
  };
  const activityLogsTable = {
    __t: "activity_logs",
    appUserId: "a.appUserId",
    day: "a.day",
    log: "a.log",
  };
  const userProfileTable = {
    __t: "user_profile",
    appUserId: "u.appUserId",
    level: "u.level",
    xp: "u.xp",
    streakDays: "u.streakDays",
    totalPoints: "u.totalPoints",
    preferences: "u.preferences",
  };

  // CRITICAL: each `db.select()` must return a FRESH chain. Earlier we
  // shared a single chain across calls, but `Promise.allSettled` builds
  // all four sub-queries synchronously before any awaits, so a shared
  // `activeTable` gets clobbered by the last `.from(...)` call and every
  // query ends up reading rows for the wrong table.
  function makeChain(): Record<string, unknown> {
    let activeTable: unknown = null;
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      from: (tbl: unknown) => {
        activeTable = tbl;
        return chain;
      },
      where: (..._args: unknown[]) => chain,
      groupBy: (...args: unknown[]) => groupBySpy(...args),
      limit: (_n: number) => Promise.resolve(tableRowsSpy(activeTable)),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(tableRowsSpy(activeTable)).then(resolve, reject),
    });
    return chain;
  }

  const db = {
    select: (..._args: unknown[]) => makeChain(),
  };

  return {
    db,
    interactionEventsTable,
    nutritionLogsTable,
    wellbeingEntriesTable,
    activityLogsTable,
    userProfileTable,
  };
});

// drizzle-orm exports many helpers via Symbol-tagged proxies — replacing
// them with no-op factories is enough because our chained `db` mock
// ignores the WHERE arguments entirely.
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ kind: "and", args }),
  eq: (...args: unknown[]) => ({ kind: "eq", args }),
  gte: (...args: unknown[]) => ({ kind: "gte", args }),
  lt: (...args: unknown[]) => ({ kind: "lt", args }),
  sql: Object.assign(
    (..._args: unknown[]) => ({ kind: "sql" }),
    { raw: (..._args: unknown[]) => ({ kind: "sql.raw" }) },
  ),
}));

import {
  __resetEngagementCaches,
  aggregateActivity,
  aggregateNutrition,
  aggregateWellbeing,
  buildEngagementProfile,
  classifyTrend,
  computeLongestStreak,
  DEFAULT_CALCIUM_TARGET_MG,
  EMPTY_BEHAVIOURAL_STATS,
  getCachedTone,
  pickCalciumTarget,
  renderBehaviouralContext,
  selectTone,
  toneClause,
  type BehaviouralStats,
  type EngagementProfile,
} from "../engagementProfile";

interface TableRowConfig {
  interaction_events?: never; // routed through groupBySpy, not tableRowsSpy
  nutrition_logs?: unknown[];
  wellbeing_entries?: unknown[];
  activity_logs?: unknown[];
  user_profile?: unknown[];
}

/** Configure tableRowsSpy to dispatch rows by table sentinel. */
function configureTableRows(cfg: TableRowConfig = {}): void {
  tableRowsSpy.mockImplementation((tbl: { __t?: string } | null | undefined) => {
    const key = tbl?.__t as keyof TableRowConfig | undefined;
    if (!key) return [];
    const rows = cfg[key];
    return Array.isArray(rows) ? rows : [];
  });
}

beforeEach(() => {
  __resetEngagementCaches();
  groupBySpy.mockReset();
  tableRowsSpy.mockReset();
  // Default: every per-table query returns [] — keeps tests that only care
  // about the rec_* half from having to opt into a behavioural fixture.
  configureTableRows();
});

// ---- classifyTrend (10pp swing threshold) --------------------------------

describe("classifyTrend", () => {
  it("returns 'steady' when either window has fewer than 5 shown events", () => {
    expect(classifyTrend(0.9, 4, 0.1, 100)).toBe("steady");
    expect(classifyTrend(0.9, 100, 0.1, 4)).toBe("steady");
    expect(classifyTrend(0.9, 4, 0.1, 4)).toBe("steady");
  });

  it("classifies as 'improving' just above the +10pp threshold", () => {
    expect(classifyTrend(0.61, 10, 0.5, 10)).toBe("improving");
  });

  it("classifies as 'dropping' just below the -10pp threshold", () => {
    expect(classifyTrend(0.39, 10, 0.5, 10)).toBe("dropping");
  });

  it("classifies a sub-10pp swing in either direction as 'steady'", () => {
    expect(classifyTrend(0.59, 10, 0.5, 10)).toBe("steady");
    expect(classifyTrend(0.41, 10, 0.5, 10)).toBe("steady");
  });

  it("classifies a clear improvement / drop above the threshold", () => {
    expect(classifyTrend(0.8, 20, 0.5, 20)).toBe("improving");
    expect(classifyTrend(0.2, 20, 0.5, 20)).toBe("dropping");
  });
});

// ---- selectTone ----------------------------------------------------------

function profile(overrides: {
  byKind?: EngagementProfile["sevenDay"]["byKind"];
  totalShown?: number;
  totalCompleted?: number;
  totalDismissed?: number;
  rate?: number;
  thirtyDayTrend?: EngagementProfile["thirtyDayTrend"];
  behavioural?: Partial<BehaviouralStats>;
} = {}): EngagementProfile {
  const totalShown = overrides.totalShown ?? 0;
  const totalCompleted = overrides.totalCompleted ?? 0;
  const behavioural: BehaviouralStats = {
    nutrition: {
      ...EMPTY_BEHAVIOURAL_STATS.nutrition,
      ...overrides.behavioural?.nutrition,
    },
    wellbeing: {
      ...EMPTY_BEHAVIOURAL_STATS.wellbeing,
      ...overrides.behavioural?.wellbeing,
    },
    activity: {
      ...EMPTY_BEHAVIOURAL_STATS.activity,
      ...overrides.behavioural?.activity,
    },
    gamification: {
      ...EMPTY_BEHAVIOURAL_STATS.gamification,
      ...overrides.behavioural?.gamification,
    },
  };
  return {
    sevenDay: {
      byKind: overrides.byKind ?? {},
      totalShown,
      totalCompleted,
      totalDismissed: overrides.totalDismissed ?? 0,
      rate:
        overrides.rate ??
        (totalShown > 0 ? totalCompleted / totalShown : 0),
    },
    thirtyDayTrend: overrides.thirtyDayTrend ?? "steady",
    behavioural,
    generatedAtMs: 1_700_000_000_000,
  };
}

describe("selectTone", () => {
  it("falls through to 'encouraging' for the warm default", () => {
    expect(selectTone(profile({ totalShown: 6, totalCompleted: 2, rate: 2 / 6 }))).toBe(
      "encouraging",
    );
  });

  it("returns 'gentle' when the 30d trend is dropping", () => {
    expect(selectTone(profile({ thirtyDayTrend: "dropping" }))).toBe("gentle");
  });

  it("returns 'gentle' when dismiss rate >= 40% with at least 5 shown", () => {
    expect(
      selectTone(
        profile({
          totalShown: 10,
          totalCompleted: 3,
          totalDismissed: 4,
        }),
      ),
    ).toBe("gentle");
  });

  it("returns 'gentle' when behavioural mean mood valence is at/under 0.35", () => {
    expect(
      selectTone(
        profile({
          totalShown: 12,
          totalCompleted: 9, // would otherwise lean energising
          behavioural: {
            wellbeing: {
              ...EMPTY_BEHAVIOURAL_STATS.wellbeing,
              moodValence7d: 0.3,
            },
          },
        }),
      ),
    ).toBe("gentle");
  });

  it("does not flip to 'gentle' on the low-mood rule when there is no mood data yet", () => {
    expect(
      selectTone(
        profile({
          totalShown: 6,
          totalCompleted: 2,
          behavioural: {
            wellbeing: {
              ...EMPTY_BEHAVIOURAL_STATS.wellbeing,
              moodValence7d: null, // brand-new account, never logged a mood
            },
          },
        }),
      ),
    ).toBe("encouraging");
  });

  it("does not flip to 'gentle' on the low-mood rule just above the 0.35 ceiling", () => {
    expect(
      selectTone(
        profile({
          totalShown: 6,
          totalCompleted: 2,
          behavioural: {
            wellbeing: {
              ...EMPTY_BEHAVIOURAL_STATS.wellbeing,
              moodValence7d: 0.36,
            },
          },
        }),
      ),
    ).toBe("encouraging");
  });

  it("returns 'gentle' when the user clearly slipped (prior >=3, drop >=3)", () => {
    expect(
      selectTone(
        profile({
          totalShown: 6,
          totalCompleted: 2,
          behavioural: {
            wellbeing: {
              ...EMPTY_BEHAVIOURAL_STATS.wellbeing,
              sessions7d: 0,
              sessionsPrev7d: 4, // drop = 4, prior = 4 — both clear the floor
            },
          },
        }),
      ),
    ).toBe("gentle");
  });

  it("does not flip to 'gentle' on the slipping rule when prior week was below the 3-session floor", () => {
    expect(
      selectTone(
        profile({
          totalShown: 6,
          totalCompleted: 2,
          behavioural: {
            wellbeing: {
              ...EMPTY_BEHAVIOURAL_STATS.wellbeing,
              sessions7d: 0,
              sessionsPrev7d: 2, // prior week below the 3-session floor
            },
          },
        }),
      ),
    ).toBe("encouraging");
  });

  it("does not flip to 'gentle' on the slipping rule when the week-on-week drop is below 3", () => {
    expect(
      selectTone(
        profile({
          totalShown: 6,
          totalCompleted: 2,
          behavioural: {
            wellbeing: {
              ...EMPTY_BEHAVIOURAL_STATS.wellbeing,
              sessions7d: 2,
              sessionsPrev7d: 4, // drop = 2, below the 3-session drop floor
            },
          },
        }),
      ),
    ).toBe("encouraging");
  });

  it("returns 'energising' when the trend is improving", () => {
    expect(selectTone(profile({ thirtyDayTrend: "improving" }))).toBe("energising");
  });

  it("returns 'energising' for high completion (>=10 shown, rate >= 0.6)", () => {
    expect(
      selectTone(profile({ totalShown: 10, totalCompleted: 6 })),
    ).toBe("energising");
  });

  it("returns 'energising' when mood trend is improving and the wellbeing streak is 3+", () => {
    expect(
      selectTone(
        profile({
          totalShown: 4, // not enough for the rec-only energising rule
          totalCompleted: 1,
          behavioural: {
            wellbeing: {
              ...EMPTY_BEHAVIOURAL_STATS.wellbeing,
              moodTrend: "improving",
              currentStreak: 3,
            },
          },
        }),
      ),
    ).toBe("energising");
  });

  it("does not flip to 'energising' on improving mood when the streak is short", () => {
    expect(
      selectTone(
        profile({
          totalShown: 4,
          totalCompleted: 1,
          behavioural: {
            wellbeing: {
              ...EMPTY_BEHAVIOURAL_STATS.wellbeing,
              moodTrend: "improving",
              currentStreak: 2,
            },
          },
        }),
      ),
    ).toBe("encouraging");
  });

  it("does not flip to 'energising' below the 10-shown floor", () => {
    expect(
      selectTone(profile({ totalShown: 9, totalCompleted: 9 })),
    ).toBe("encouraging");
  });

  it("'gentle' overrides 'energising' signals (low mood valence beats high rec rate)", () => {
    expect(
      selectTone(
        profile({
          totalShown: 20,
          totalCompleted: 18,
          behavioural: {
            wellbeing: {
              ...EMPTY_BEHAVIOURAL_STATS.wellbeing,
              moodValence7d: 0.2,
            },
          },
        }),
      ),
    ).toBe("gentle");
  });
});

// ---- toneClause ----------------------------------------------------------

describe("toneClause", () => {
  it("emits a clearly-labelled clause per tone", () => {
    expect(toneClause("gentle")).toContain("gentle");
    expect(toneClause("energising")).toContain("energising");
    expect(toneClause("encouraging")).toContain("encouraging");
  });
});

// ---- pickCalciumTarget ---------------------------------------------------

describe("pickCalciumTarget", () => {
  it("falls back to the default when prefs is missing or malformed", () => {
    expect(pickCalciumTarget(null)).toBe(DEFAULT_CALCIUM_TARGET_MG);
    expect(pickCalciumTarget(undefined)).toBe(DEFAULT_CALCIUM_TARGET_MG);
    expect(pickCalciumTarget({})).toBe(DEFAULT_CALCIUM_TARGET_MG);
    expect(pickCalciumTarget({ nutritionTargets: {} })).toBe(DEFAULT_CALCIUM_TARGET_MG);
    expect(pickCalciumTarget({ nutritionTargets: { calcium: "1500" } })).toBe(
      DEFAULT_CALCIUM_TARGET_MG,
    );
    expect(pickCalciumTarget({ nutritionTargets: { calcium: 0 } })).toBe(
      DEFAULT_CALCIUM_TARGET_MG,
    );
    expect(pickCalciumTarget({ nutritionTargets: { calcium: -100 } })).toBe(
      DEFAULT_CALCIUM_TARGET_MG,
    );
    expect(pickCalciumTarget({ nutritionTargets: { calcium: Number.POSITIVE_INFINITY } })).toBe(
      DEFAULT_CALCIUM_TARGET_MG,
    );
  });

  it("reads a positive finite calcium target out of the prefs blob", () => {
    expect(pickCalciumTarget({ nutritionTargets: { calcium: 1500 } })).toBe(1500);
    expect(pickCalciumTarget({ nutritionTargets: { calcium: 800 } })).toBe(800);
  });
});

// ---- aggregateNutrition --------------------------------------------------

describe("aggregateNutrition", () => {
  it("returns zeroed stats when there are no rows", () => {
    const out = aggregateNutrition([], 1200);
    expect(out).toMatchObject({
      loggedDays7d: 0,
      avgCalciumMg7d: 0,
      avgVitaminDUg7d: 0,
      avgProteinG7d: 0,
      calciumDaysOnTarget7d: 0,
      calciumTargetMg: 1200,
      lastLoggedDay: null,
    });
  });

  it("averages per logged day and counts days that hit the calcium target", () => {
    const out = aggregateNutrition(
      [
        { day: "2026-04-26", log: { calcium: 1300, vitaminD: 8, protein: 80 } },
        { day: "2026-04-27", log: { calcium: 600, vitaminD: 4, protein: 60 } },
        { day: "2026-04-28", log: { calcium: 1500, vitaminD: 10, protein: 90 } },
      ],
      1200,
    );
    expect(out.loggedDays7d).toBe(3);
    // (1300 + 600 + 1500) / 3
    expect(out.avgCalciumMg7d).toBeCloseTo(1133.333, 2);
    expect(out.avgVitaminDUg7d).toBeCloseTo((8 + 4 + 10) / 3, 5);
    expect(out.avgProteinG7d).toBeCloseTo((80 + 60 + 90) / 3, 5);
    // 1300 ≥ 1200 and 1500 ≥ 1200; 600 misses.
    expect(out.calciumDaysOnTarget7d).toBe(2);
    expect(out.lastLoggedDay).toBe("2026-04-28");
  });

  it("sums multiple rows for the same day before counting on-target", () => {
    const out = aggregateNutrition(
      [
        { day: "2026-04-28", log: { calcium: 700 } },
        { day: "2026-04-28", log: { calcium: 600 } },
      ],
      1200,
    );
    expect(out.loggedDays7d).toBe(1);
    expect(out.avgCalciumMg7d).toBe(1300);
    expect(out.calciumDaysOnTarget7d).toBe(1);
  });

  it("treats missing / non-numeric jsonb fields as 0", () => {
    const out = aggregateNutrition(
      [
        { day: "2026-04-26", log: null as unknown as Record<string, unknown> },
        { day: "2026-04-27", log: { calcium: "lots" } as unknown as Record<string, unknown> },
        { day: "2026-04-28", log: { calcium: 1300 } },
      ],
      1200,
    );
    expect(out.loggedDays7d).toBe(3);
    // Only day 28 contributes calcium → mean across 3 days = 1300 / 3.
    expect(out.avgCalciumMg7d).toBeCloseTo(1300 / 3, 2);
    expect(out.calciumDaysOnTarget7d).toBe(1);
  });

  it("never marks days on target when the target itself is 0 or negative", () => {
    const out = aggregateNutrition(
      [{ day: "2026-04-28", log: { calcium: 5000 } }],
      0,
    );
    expect(out.calciumDaysOnTarget7d).toBe(0);
  });
});

// ---- computeLongestStreak ------------------------------------------------

describe("computeLongestStreak", () => {
  it("returns 0 for an empty array", () => {
    expect(computeLongestStreak([])).toBe(0);
  });

  it("returns 1 for a single day bucket", () => {
    expect(computeLongestStreak([100])).toBe(1);
  });

  it("counts a single uninterrupted run", () => {
    // 5 consecutive days.
    expect(computeLongestStreak([10, 11, 12, 13, 14])).toBe(5);
  });

  it("picks the longest run when there are multiple gaps", () => {
    // run-of-3, gap, run-of-2, gap, run-of-4.
    expect(computeLongestStreak([1, 2, 3, 10, 11, 20, 21, 22, 23])).toBe(4);
  });

  it("deduplicates same-day buckets before counting", () => {
    // Two sessions on day 5 should only count as one day in the streak.
    expect(computeLongestStreak([5, 5, 6, 7])).toBe(3);
  });

  it("handles an unsorted input array", () => {
    expect(computeLongestStreak([14, 12, 11, 13])).toBe(4);
  });

  it("returns 1 when all days are isolated (no consecutive pairs)", () => {
    expect(computeLongestStreak([1, 3, 5, 7])).toBe(1);
  });
});

// ---- aggregateWellbeing --------------------------------------------------

describe("aggregateWellbeing", () => {
  // 2026-05-02 12:00 UTC anchor used for all wellbeing windows here.
  const NOW_MS = Date.UTC(2026, 4, 2, 12, 0, 0);
  const DAY = 86_400_000;

  it("returns zeroed stats when there are no rows", () => {
    const out = aggregateWellbeing([], NOW_MS);
    expect(out).toMatchObject({
      sessions7d: 0,
      sessionsPrev7d: 0,
      lastSessionAtMs: null,
      moodValence7d: null,
      moodValencePrev7d: null,
      moodTrend: "steady",
      currentStreak: 0,
      longestStreak: 0,
    });
  });

  it("returns longestStreak from allTimeCompletedAtMs when supplied with empty recent rows", () => {
    const out = aggregateWellbeing([], NOW_MS, [
      NOW_MS - 40 * DAY,
      NOW_MS - 39 * DAY,
      NOW_MS - 38 * DAY,
      NOW_MS - 38 * DAY, // duplicate — same day
    ]);
    expect(out.longestStreak).toBe(3);
    expect(out.currentStreak).toBe(0);
  });

  it("splits sessions into the 7d / prior-7d windows and averages mood valence per window", () => {
    const out = aggregateWellbeing(
      [
        // This week (≤ 7 days back) — mostly calm/energised → high valence.
        { entry: { mood: "calm" }, completedAtMs: NOW_MS - 1 * DAY },
        { entry: { mood: "calm" }, completedAtMs: NOW_MS - 3 * DAY },
        { entry: { mood: "energised" }, completedAtMs: NOW_MS - 5 * DAY },
        // Prior week (8–14 days back) — heavier moods → low valence.
        { entry: { mood: "still_tense" }, completedAtMs: NOW_MS - 9 * DAY },
        { entry: { mood: "still_tense" }, completedAtMs: NOW_MS - 11 * DAY },
        // Outside the window — must be ignored.
        { entry: { mood: "calm" }, completedAtMs: NOW_MS - 30 * DAY },
      ],
      NOW_MS,
    );
    expect(out.sessions7d).toBe(3);
    expect(out.sessionsPrev7d).toBe(2);
    // (1.0 + 1.0 + 0.85) / 3
    expect(out.moodValence7d).toBeCloseTo((1.0 + 1.0 + 0.85) / 3, 5);
    // (0.2 + 0.2) / 2
    expect(out.moodValencePrev7d).toBeCloseTo(0.2, 5);
    expect(out.moodTrend).toBe("improving");
    expect(out.lastSessionAtMs).toBe(NOW_MS - 1 * DAY);
  });

  it("classifies a clear mood drop as 'dropping'", () => {
    const out = aggregateWellbeing(
      [
        // Heavier this week.
        { entry: { mood: "still_tense" }, completedAtMs: NOW_MS - 1 * DAY },
        { entry: { mood: "still_tense" }, completedAtMs: NOW_MS - 4 * DAY },
        // Calm prior week.
        { entry: { mood: "calm" }, completedAtMs: NOW_MS - 9 * DAY },
        { entry: { mood: "calm" }, completedAtMs: NOW_MS - 11 * DAY },
      ],
      NOW_MS,
    );
    expect(out.moodTrend).toBe("dropping");
  });

  it("returns 'steady' when either window has fewer than 2 sessions", () => {
    const out = aggregateWellbeing(
      [
        { entry: { mood: "calm" }, completedAtMs: NOW_MS - 2 * DAY },
        { entry: { mood: "still_tense" }, completedAtMs: NOW_MS - 9 * DAY },
      ],
      NOW_MS,
    );
    expect(out.sessions7d).toBe(1);
    expect(out.sessionsPrev7d).toBe(1);
    expect(out.moodTrend).toBe("steady");
  });

  it("computes a current streak from consecutive day buckets ending today", () => {
    const out = aggregateWellbeing(
      [
        { entry: { mood: "calm" }, completedAtMs: NOW_MS - 0 * DAY },
        { entry: { mood: "calm" }, completedAtMs: NOW_MS - 1 * DAY },
        { entry: { mood: "calm" }, completedAtMs: NOW_MS - 2 * DAY },
        // Gap on day-3 → streak stops at 3.
        { entry: { mood: "calm" }, completedAtMs: NOW_MS - 4 * DAY },
      ],
      NOW_MS,
    );
    expect(out.currentStreak).toBe(3);
    // Without allTimeCompletedAtMs, longestStreak falls back to currentStreak.
    expect(out.longestStreak).toBe(3);
  });

  it("uses allTimeCompletedAtMs to find a longer historical streak than the recent window", () => {
    // Recent window has a 3-day streak, but all-time has a 7-day run.
    const allTime = [
      // Ancient 7-day run.
      NOW_MS - 60 * DAY,
      NOW_MS - 59 * DAY,
      NOW_MS - 58 * DAY,
      NOW_MS - 57 * DAY,
      NOW_MS - 56 * DAY,
      NOW_MS - 55 * DAY,
      NOW_MS - 54 * DAY,
      // Recent 3-day run (mirrors rows).
      NOW_MS - 0 * DAY,
      NOW_MS - 1 * DAY,
      NOW_MS - 2 * DAY,
    ];
    const out = aggregateWellbeing(
      [
        { entry: { mood: "calm" }, completedAtMs: NOW_MS - 0 * DAY },
        { entry: { mood: "calm" }, completedAtMs: NOW_MS - 1 * DAY },
        { entry: { mood: "calm" }, completedAtMs: NOW_MS - 2 * DAY },
      ],
      NOW_MS,
      allTime,
    );
    expect(out.currentStreak).toBe(3);
    expect(out.longestStreak).toBe(7);
  });

  it("applies the one-day grace when today has no session but yesterday does", () => {
    const out = aggregateWellbeing(
      [
        { entry: { mood: "calm" }, completedAtMs: NOW_MS - 1 * DAY },
        { entry: { mood: "calm" }, completedAtMs: NOW_MS - 2 * DAY },
      ],
      NOW_MS,
    );
    expect(out.currentStreak).toBe(2);
  });

  it("returns a zero streak when the most recent session is older than yesterday", () => {
    const out = aggregateWellbeing(
      [{ entry: { mood: "calm" }, completedAtMs: NOW_MS - 3 * DAY }],
      NOW_MS,
    );
    expect(out.currentStreak).toBe(0);
  });

  it("treats unknown moods as the neutral 0.5 valence", () => {
    const out = aggregateWellbeing(
      [
        { entry: { mood: "rage_quit" }, completedAtMs: NOW_MS - 1 * DAY },
        { entry: { mood: "rage_quit" }, completedAtMs: NOW_MS - 3 * DAY },
      ],
      NOW_MS,
    );
    expect(out.moodValence7d).toBe(0.5);
  });
});

// ---- aggregateActivity ---------------------------------------------------

describe("aggregateActivity", () => {
  it("sums activeMinutes and counts only days at or above the 10-min floor", () => {
    const out = aggregateActivity([
      { day: "2026-04-26", log: { activeMinutes: 25 } },
      { day: "2026-04-27", log: { activeMinutes: 5 } }, // below floor
      { day: "2026-04-28", log: { activeMinutes: 10 } }, // exactly floor
      { day: "2026-04-29", log: { activeMinutes: 0 } },
    ]);
    expect(out.activeMinutes7d).toBe(40);
    expect(out.activeDays7d).toBe(2);
  });

  it("sums same-day rows before checking the floor", () => {
    const out = aggregateActivity([
      { day: "2026-04-28", log: { activeMinutes: 6 } },
      { day: "2026-04-28", log: { activeMinutes: 7 } },
    ]);
    expect(out.activeMinutes7d).toBe(13);
    expect(out.activeDays7d).toBe(1);
  });
});

// ---- renderBehaviouralContext --------------------------------------------

describe("renderBehaviouralContext", () => {
  it("returns empty string when nothing meaningful to say", () => {
    expect(renderBehaviouralContext(EMPTY_BEHAVIOURAL_STATS)).toBe("");
  });

  it("renders nutrition / wellbeing / activity / progress lines when present", () => {
    const out = renderBehaviouralContext({
      nutrition: {
        loggedDays7d: 5,
        avgCalciumMg7d: 1140,
        avgVitaminDUg7d: 8,
        avgProteinG7d: 70,
        calciumDaysOnTarget7d: 3,
        calciumTargetMg: 1200,
        lastLoggedDay: "2026-04-30",
      },
      wellbeing: {
        sessions7d: 4,
        sessionsPrev7d: 2,
        lastSessionAtMs: 1_700_000_000_000,
        moodValence7d: 0.9,
        moodValencePrev7d: 0.5,
        moodTrend: "improving",
        currentStreak: 4,
        longestStreak: 4,
      },
      activity: { activeMinutes7d: 95, activeDays7d: 4 },
      gamification: { level: 3, xp: 200, streakDays: 7, totalPoints: 850 },
    });
    expect(out).toContain("RECENT BEHAVIOUR");
    expect(out).toContain("logged nutrition on 5 days");
    expect(out).toContain("1140 mg calcium/day");
    expect(out).toContain("target 1200 mg");
    expect(out).toContain("Hit the calcium target on 3");
    expect(out).toContain("4 wellbeing sessions this past week");
    expect(out).toContain("4-day current streak");
    expect(out).toContain("mood is trending up");
    expect(out).toContain("95 active minutes");
    expect(out).toContain("4 days");
    expect(out).toContain("level 3");
    expect(out).toContain("7-day overall streak");
    expect(out).toContain("850 XP total");
  });

  it("singularises day labels when counts are 1", () => {
    const out = renderBehaviouralContext({
      ...EMPTY_BEHAVIOURAL_STATS,
      nutrition: {
        ...EMPTY_BEHAVIOURAL_STATS.nutrition,
        loggedDays7d: 1,
        avgCalciumMg7d: 1300,
        calciumDaysOnTarget7d: 1,
      },
      wellbeing: {
        ...EMPTY_BEHAVIOURAL_STATS.wellbeing,
        sessions7d: 1,
      },
      activity: { activeMinutes7d: 12, activeDays7d: 1 },
    });
    expect(out).toContain("logged nutrition on 1 day,");
    expect(out).toContain("Hit the calcium target on 1 of those day.");
    expect(out).toContain("1 wellbeing session this past week");
    expect(out).toContain("1 day this past week");
  });

  it("flags a heavier mood week when trend is dropping", () => {
    const out = renderBehaviouralContext({
      ...EMPTY_BEHAVIOURAL_STATS,
      wellbeing: {
        ...EMPTY_BEHAVIOURAL_STATS.wellbeing,
        sessions7d: 3,
        sessionsPrev7d: 4,
        moodTrend: "dropping",
      },
    });
    expect(out).toContain("mood has been heavier than the previous week");
  });
});

// ---- getCachedTone (24h cache stability) ---------------------------------

interface FakeRow {
  kind: string;
  recKind: string | null;
  count: number;
}

/**
 * Configure the `db.groupBy` mock to return one set of rows for the next
 * call(s). buildEngagementProfile makes two grouped queries (7-day, then
 * prior 23 days) — `rowsByCall` is consumed in order.
 */
function nextGroupByReturns(rowsByCall: FakeRow[][]): void {
  let i = 0;
  groupBySpy.mockImplementation(async () => {
    const rows = rowsByCall[i] ?? [];
    i += 1;
    return rows;
  });
}

describe("getCachedTone — 24h cache stability", () => {
  it("returns the same tone on a follow-up call even if the underlying data changes", async () => {
    // First build → improving trend → tone should be 'energising'.
    nextGroupByReturns([
      [
        { kind: "rec_shown", recKind: "nutrition", count: 20 },
        { kind: "rec_completed", recKind: "nutrition", count: 16 },
      ],
      [
        { kind: "rec_shown", recKind: "nutrition", count: 20 },
        { kind: "rec_completed", recKind: "nutrition", count: 4 },
      ],
    ]);
    const first = await getCachedTone("user-1");
    expect(first).toBe("energising");

    // Now flip the would-be data so the next compute would yield 'gentle'.
    // The cached tone must still come back as 'energising'.
    nextGroupByReturns([
      [
        { kind: "rec_shown", recKind: "nutrition", count: 20 },
        { kind: "rec_completed", recKind: "nutrition", count: 4 },
        { kind: "rec_dismissed", recKind: "nutrition", count: 12 },
      ],
      [
        { kind: "rec_shown", recKind: "nutrition", count: 20 },
        { kind: "rec_completed", recKind: "nutrition", count: 16 },
      ],
    ]);
    const second = await getCachedTone("user-1");
    expect(second).toBe("energising");

    // Resetting the caches releases the user from the 24h hold and the
    // newly-mocked data should now flow through.
    __resetEngagementCaches();
    nextGroupByReturns([
      [
        { kind: "rec_shown", recKind: "nutrition", count: 20 },
        { kind: "rec_completed", recKind: "nutrition", count: 4 },
        { kind: "rec_dismissed", recKind: "nutrition", count: 12 },
      ],
      [
        { kind: "rec_shown", recKind: "nutrition", count: 20 },
        { kind: "rec_completed", recKind: "nutrition", count: 16 },
      ],
    ]);
    const third = await getCachedTone("user-1");
    expect(third).toBe("gentle");
  });
});

// ---- buildEngagementProfile (7d / 30d windowing + trend) -----------------

describe("buildEngagementProfile windowing", () => {
  it("aggregates 7d byKind totals and classifies a clear improvement", async () => {
    nextGroupByReturns([
      // Last 7 days: nutrition 5/10, wellbeing 4/4, plus one un-bucketed row.
      [
        { kind: "rec_shown", recKind: "nutrition", count: 10 },
        { kind: "rec_completed", recKind: "nutrition", count: 5 },
        { kind: "rec_shown", recKind: "wellbeing", count: 4 },
        { kind: "rec_completed", recKind: "wellbeing", count: 4 },
        { kind: "rec_dismissed", recKind: "nutrition", count: 1 },
        { kind: "rec_shown", recKind: null, count: 2 },
      ],
      // Prior 23 days: 4/16 — 25% completion. 7-day sits at 9/14 ≈ 64%.
      // That's a +39pp swing, well above the 10pp threshold → improving.
      [
        { kind: "rec_shown", recKind: "wellbeing", count: 16 },
        { kind: "rec_completed", recKind: "wellbeing", count: 4 },
      ],
    ]);

    const result = await buildEngagementProfile("user-windowing");

    expect(result.sevenDay.totalShown).toBe(16);
    expect(result.sevenDay.totalCompleted).toBe(9);
    expect(result.sevenDay.totalDismissed).toBe(1);
    expect(result.sevenDay.byKind.nutrition).toMatchObject({
      shown: 10,
      completed: 5,
      dismissed: 1,
    });
    expect(result.sevenDay.byKind.nutrition.rate).toBeCloseTo(0.5, 5);
    expect(result.sevenDay.byKind.wellbeing).toMatchObject({
      shown: 4,
      completed: 4,
      dismissed: 0,
    });
    // un-bucketed rows feed totals but never byKind
    expect(Object.keys(result.sevenDay.byKind).sort()).toEqual([
      "nutrition",
      "wellbeing",
    ]);
    expect(result.thirtyDayTrend).toBe("improving");
    // No behavioural rows configured for this test → empty defaults.
    expect(result.behavioural).toEqual(EMPTY_BEHAVIOURAL_STATS);
  });

  it("returns 'steady' when the prior window has fewer than 5 shown events", async () => {
    nextGroupByReturns([
      [
        { kind: "rec_shown", recKind: "nutrition", count: 10 },
        { kind: "rec_completed", recKind: "nutrition", count: 9 },
      ],
      // Only 3 shown in the prior window → not enough signal → 'steady'.
      [
        { kind: "rec_shown", recKind: "nutrition", count: 3 },
        { kind: "rec_completed", recKind: "nutrition", count: 0 },
      ],
    ]);

    const result = await buildEngagementProfile("user-thin-prior");
    expect(result.thirtyDayTrend).toBe("steady");
  });

  it("merges per-table behavioural rows into the profile snapshot", async () => {
    const NOW_MS = Date.now();
    const DAY = 86_400_000;
    nextGroupByReturns([[], []]); // no rec_* events

    configureTableRows({
      user_profile: [
        {
          level: 4,
          xp: 320,
          streakDays: 6,
          totalPoints: 1500,
          preferences: { nutritionTargets: { calcium: 1500 } },
        },
      ],
      nutrition_logs: [
        { day: "2026-04-30", log: { calcium: 1600, vitaminD: 9, protein: 75 } },
        { day: "2026-04-29", log: { calcium: 800, vitaminD: 5, protein: 60 } },
      ],
      wellbeing_entries: [
        { entry: { mood: "calm" }, completedAtMs: NOW_MS - 1 * DAY },
        { entry: { mood: "energised" }, completedAtMs: NOW_MS - 3 * DAY },
      ],
      activity_logs: [
        { day: "2026-04-30", log: { activeMinutes: 30 } },
        { day: "2026-04-28", log: { activeMinutes: 12 } },
      ],
    });

    const result = await buildEngagementProfile("user-with-data");

    expect(result.behavioural.gamification).toEqual({
      level: 4,
      xp: 320,
      streakDays: 6,
      totalPoints: 1500,
    });
    expect(result.behavioural.nutrition.calciumTargetMg).toBe(1500);
    expect(result.behavioural.nutrition.loggedDays7d).toBe(2);
    expect(result.behavioural.nutrition.calciumDaysOnTarget7d).toBe(1);
    expect(result.behavioural.wellbeing.sessions7d).toBe(2);
    expect(result.behavioural.activity.activeMinutes7d).toBe(42);
    expect(result.behavioural.activity.activeDays7d).toBe(2);
  });
});

// ---- shape contract with mobile lib --------------------------------------
//
// Lightweight cross-package contract: the exact key set of
// EMPTY_BEHAVIOURAL_STATS must mirror artifacts/mobile/lib/behaviouralStats.ts.
// If you add or remove a field on either side without updating the other,
// the matching test on the opposite side will fail in lockstep, surfacing
// the drift before it reaches a user-facing surface (Bone Buddy prompt,
// Today's Focus bias, Smart Food re-rank, Weekly SNAP overrides).

describe("BehaviouralStats shape contract (server ↔ mobile)", () => {
  it("EMPTY_BEHAVIOURAL_STATS has the canonical four-domain key set", () => {
    expect(Object.keys(EMPTY_BEHAVIOURAL_STATS).sort()).toEqual([
      "activity",
      "gamification",
      "nutrition",
      "wellbeing",
    ]);
  });

  it("nutrition has the canonical fields", () => {
    expect(Object.keys(EMPTY_BEHAVIOURAL_STATS.nutrition).sort()).toEqual([
      "avgCalciumMg7d",
      "avgProteinG7d",
      "avgVitaminDUg7d",
      "calciumDaysOnTarget7d",
      "calciumTargetMg",
      "lastLoggedDay",
      "loggedDays7d",
    ]);
  });

  it("wellbeing has the canonical fields", () => {
    expect(Object.keys(EMPTY_BEHAVIOURAL_STATS.wellbeing).sort()).toEqual([
      "currentStreak",
      "lastSessionAtMs",
      "longestStreak",
      "moodTrend",
      "moodValence7d",
      "moodValencePrev7d",
      "sessions7d",
      "sessionsPrev7d",
    ]);
  });

  it("activity has the canonical fields", () => {
    expect(Object.keys(EMPTY_BEHAVIOURAL_STATS.activity).sort()).toEqual([
      "activeDays7d",
      "activeMinutes7d",
    ]);
  });

  it("gamification has the canonical fields", () => {
    expect(Object.keys(EMPTY_BEHAVIOURAL_STATS.gamification).sort()).toEqual([
      "level",
      "streakDays",
      "totalPoints",
      "xp",
    ]);
  });
});
