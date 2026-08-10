import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express, { type Express } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const userTokensState: { tokens: Map<string, string> } = {
  tokens: new Map<string, string>(),
};

interface InsertCall {
  table: string;
  values: unknown;
  conflict?: { kind: "update" | "nothing"; set?: unknown; target?: unknown };
}

const inserts: InsertCall[] = [];
const selectsByTable: Map<string, unknown[]> = new Map();

vi.mock("@workspace/db", () => {
  function makeTable(name: string) {
    return {
      __table: name,
      appUserId: { __col: `${name}.appUserId` },
      day: { __col: `${name}.day` },
      entryId: { __col: `${name}.entryId` },
      resultId: { __col: `${name}.resultId` },
      achievementId: { __col: `${name}.achievementId` },
      token: { __col: `${name}.token` },
      lastUsedAt: { __col: `${name}.lastUsedAt` },
      isAdmin: { __col: `${name}.isAdmin` },
    } as const;
  }

  type Cond = { kind?: string; args?: unknown[] } | undefined;

  // Build the chained insert builder used by the route. After the final
  // .onConflict... we resolve, recording the call shape into `inserts`.
  function makeInsertBuilder(tableName: string) {
    return {
      values(values: unknown) {
        const call: InsertCall = { table: tableName, values };
        return {
          onConflictDoUpdate: async (opts: {
            target: unknown;
            set: unknown;
          }) => {
            call.conflict = { kind: "update", target: opts.target, set: opts.set };
            inserts.push(call);
          },
          onConflictDoNothing: async (opts: { target: unknown }) => {
            call.conflict = { kind: "nothing", target: opts.target };
            inserts.push(call);
          },
          // Plain await on `values()` for a non-conflict insert.
          then(onFulfilled: () => void) {
            inserts.push(call);
            onFulfilled();
          },
        };
      },
    };
  }

  const userTokensTable = makeTable("user_tokens");
  const usersTable = makeTable("users");

  // Map a probe table back to its registered name by reference identity.
  function nameOf(tbl: unknown): string {
    if (typeof tbl === "object" && tbl !== null && "__table" in tbl) {
      return (tbl as { __table: string }).__table;
    }
    return "unknown";
  }

  // Real @workspace/db export names — both auth.ts and sync.ts import
  // these, so the mock must surface them under the same identifiers.
  const tableRegistry = {
    userTokensTable,
    usersTable,
    userProfileTable: makeTable("user_profile"),
    nutritionLogsTable: makeTable("nutrition_logs"),
    activityLogsTable: makeTable("activity_logs"),
    mealPlanDaysTable: makeTable("meal_plan_days"),
    wellbeingEntriesTable: makeTable("wellbeing_entries"),
    gamificationStateTable: makeTable("gamification_state"),
    assessmentResultsTable: makeTable("assessment_results"),
    supplementStateTable: makeTable("supplement_state"),
    interactionEventsTable: makeTable("interaction_events"),
    outcomeEntriesTable: makeTable("outcome_entries"),
  } as const;

  const db = {
    select: (_cols?: unknown) => ({
      from: (tbl: unknown) => {
        const tableName = nameOf(tbl);
        const builder = {
          where: (cond: Cond) => {
            // For the auth bearer-token lookup we resolve the token via
            // the configured map.
            if (tableName === "user_tokens") {
              const args = cond?.args ?? [];
              const tokenArg = args.find((a) => typeof a === "string") as
                | string
                | undefined;
              const userId = tokenArg
                ? userTokensState.tokens.get(tokenArg)
                : undefined;
              const rows = userId ? [{ appUserId: userId }] : [];
              return {
                limit: async (_n: number) => rows,
              };
            }
            if (tableName === "users") {
              return {
                limit: async (_n: number) => [{ isAdmin: false }],
              };
            }
            // Per-user snapshot reads — return whatever the test
            // pre-loaded for this table.
            const rows = selectsByTable.get(tableName) ?? [];
            const final = rows;
            return {
              limit: async (_n: number) => final,
              // Some snapshot reads have no .limit().
              then(onFulfilled: (v: unknown[]) => void) {
                onFulfilled(final);
              },
            };
          },
        };
        return builder;
      },
    }),

    update: (_tbl: unknown) => ({
      set: (_set: unknown) => ({
        where: (_cond: unknown) => ({
          catch: (_fn: (e: unknown) => void) => Promise.resolve(),
        }),
      }),
    }),

    insert: (tbl: unknown) => makeInsertBuilder(nameOf(tbl)),
  };

  return { db, ...tableRegistry };
});

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ kind: "eq", args }),
}));

const { default: syncRouter } = await import("../sync");

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use(syncRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  userTokensState.tokens.clear();
  userTokensState.tokens.set("valid-token", "user-1");
  userTokensState.tokens.set("user-2-token", "user-2");
  inserts.length = 0;
  selectsByTable.clear();
});

async function call(
  method: string,
  path: string,
  opts: { token?: string | null; body?: unknown } = {},
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = opts.token === undefined ? "valid-token" : opts.token;
  if (token != null) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

// ---- auth gates ----------------------------------------------------------

describe("/sync/* — auth gates", () => {
  const cases: Array<[string, string, unknown]> = [
    ["PUT", "/sync/profile", { profile: {} }],
    ["PUT", "/sync/nutrition/2026-05-02", { data: {} }],
    ["PUT", "/sync/activity/2026-05-02", { data: {} }],
    ["PUT", "/sync/meal-plan/2026-05-02", { data: {} }],
    ["PUT", "/sync/supplements", { state: {} }],
    ["PUT", "/sync/gamification", { state: {} }],
    ["POST", "/sync/wellbeing", { entryId: "x", entry: {}, completedAtMs: 1 }],
    ["POST", "/sync/assessment", { resultId: "x", kind: "dexa", payload: {}, takenAtMs: 1 }],
    ["POST", "/sync/outcomes", { entryId: "x", entry: {}, recordedAtMs: 1 }],
    ["GET", "/sync/snapshot", undefined],
  ];

  for (const [method, path, body] of cases) {
    it(`${method} ${path} rejects anonymous with 401 and never inserts`, async () => {
      const res = await call(method, path, { token: null, body });
      expect(res.status).toBe(401);
      expect(inserts).toHaveLength(0);
    });

    it(`${method} ${path} rejects an unknown bearer token with 401`, async () => {
      const res = await call(method, path, { token: "nope", body });
      expect(res.status).toBe(401);
      expect(inserts).toHaveLength(0);
    });
  }
});

// ---- validation ----------------------------------------------------------

describe("/sync/* — body validation", () => {
  it("PUT /sync/profile rejects a missing `profile` with 400", async () => {
    const res = await call("PUT", "/sync/profile", { body: {} });
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it("PUT /sync/nutrition rejects an invalid date param with 400", async () => {
    const res = await call("PUT", "/sync/nutrition/not-a-date", {
      body: { data: {} },
    });
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it("POST /sync/wellbeing rejects when entryId is missing with 400", async () => {
    const res = await call("POST", "/sync/wellbeing", {
      body: { entry: {}, completedAtMs: 1 },
    });
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it("POST /sync/assessment rejects when kind is missing with 400", async () => {
    const res = await call("POST", "/sync/assessment", {
      body: { resultId: "r1", payload: {}, takenAtMs: 1 },
    });
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it("POST /sync/outcomes rejects when entryId is missing with 400", async () => {
    const res = await call("POST", "/sync/outcomes", {
      body: { entry: { confidence: 4 }, recordedAtMs: 1 },
    });
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });
});

// ---- happy paths + idempotent semantics ----------------------------------

describe("/sync/* — happy paths source identity from the bearer token", () => {
  it("PUT /sync/profile uses the authed user, never any body field", async () => {
    const res = await call("PUT", "/sync/profile", {
      // Even if a malicious client smuggles an `appUserId` in the body,
      // the route must NOT forward it to the insert call.
      body: {
        profile: { name: "Pat", age: 60, appUserId: "EVIL" },
        updatedAtMs: 999,
      },
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(inserts).toHaveLength(1);
    const v = inserts[0].values as { appUserId: string };
    expect(v.appUserId).toBe("user-1");
    expect(inserts[0].conflict?.kind).toBe("update");
  });

  it("a different bearer token resolves to a different user", async () => {
    await call("PUT", "/sync/profile", {
      token: "user-2-token",
      body: { profile: { name: "X" } },
    });
    expect((inserts[0].values as { appUserId: string }).appUserId).toBe("user-2");
  });

  it("PUT /sync/nutrition/{date} stores the body and uses ON CONFLICT UPDATE (idempotent)", async () => {
    const body = { data: { calcium: 800, protein: 60 }, updatedAtMs: 100 };
    const r1 = await call("PUT", "/sync/nutrition/2026-05-02", { body });
    const r2 = await call("PUT", "/sync/nutrition/2026-05-02", { body });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(inserts).toHaveLength(2);
    for (const ins of inserts) {
      expect(ins.table).toBe("nutrition_logs");
      expect(ins.conflict?.kind).toBe("update");
      const vals = ins.values as { appUserId: string; day: string };
      expect(vals.appUserId).toBe("user-1");
      expect(vals.day).toBe("2026-05-02");
    }
  });

  it("PUT /sync/supplements upserts a singleton-per-user state row", async () => {
    const r = await call("PUT", "/sync/supplements", {
      body: { state: { supplements: [{ id: "s1" }] } },
    });
    expect(r.status).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("supplement_state");
    expect(inserts[0].conflict?.kind).toBe("update");
  });

  it("POST /sync/wellbeing uses ON CONFLICT DO NOTHING (idempotent on entryId)", async () => {
    const r = await call("POST", "/sync/wellbeing", {
      body: { entryId: "w-1", entry: { mood: "calm" }, completedAtMs: 1234 },
    });
    expect(r.status).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("wellbeing_entries");
    expect(inserts[0].conflict?.kind).toBe("nothing");
    const vals = inserts[0].values as { appUserId: string; entryId: string };
    expect(vals.appUserId).toBe("user-1");
    expect(vals.entryId).toBe("w-1");
  });

  it("POST /sync/assessment uses ON CONFLICT DO NOTHING (idempotent on resultId)", async () => {
    const r = await call("POST", "/sync/assessment", {
      body: {
        resultId: "d-1",
        kind: "dexa",
        payload: { tScore: -1.4 },
        takenAtMs: 1234,
      },
    });
    expect(r.status).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("assessment_results");
    expect(inserts[0].conflict?.kind).toBe("nothing");
  });

  it("POST /sync/outcomes appends an idempotent structured check-in", async () => {
    const r = await call("POST", "/sync/outcomes", {
      body: {
        entryId: "outcome-1",
        entry: { confidence: 4, mobility: 3, fallsLast90Days: 0 },
        recordedAtMs: 1234,
      },
    });
    expect(r.status).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("outcome_entries");
    expect(inserts[0].conflict?.kind).toBe("nothing");
    expect(inserts[0].values).toMatchObject({
      appUserId: "user-1",
      entryId: "outcome-1",
    });
  });
});

// ---- snapshot ------------------------------------------------------------

describe("GET /sync/snapshot", () => {
  it("returns an empty snapshot when the user has no rows", async () => {
    const r = await call("GET", "/sync/snapshot");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      appUserId: "user-1",
      profile: null,
      nutrition: [],
      activity: [],
      mealPlan: [],
      wellbeing: [],
      gamification: null,
      supplements: null,
      assessments: [],
    });
  });

  it("aggregates rows from each per-domain table for the authed user", async () => {
    selectsByTable.set("user_profile", [
      { appUserId: "user-1", preferences: { name: "Pat" }, updatedAtMs: 100 },
    ]);
    selectsByTable.set("nutrition_logs", [
      { appUserId: "user-1", day: "2026-05-02", log: { calcium: 800 }, updatedAtMs: 200 },
    ]);
    selectsByTable.set("wellbeing_entries", [
      { appUserId: "user-1", entryId: "w-1", entry: { mood: "calm" }, completedAtMs: 1234 },
    ]);
    const r = await call("GET", "/sync/snapshot");
    expect(r.status).toBe(200);
    const j = r.json as {
      profile: { profile: { name: string } };
      nutrition: Array<{ day: string; data: { calcium: number } }>;
      wellbeing: Array<{ entryId: string }>;
    };
    expect(j.profile.profile).toEqual({ name: "Pat" });
    expect(j.nutrition).toEqual([{ day: "2026-05-02", data: { calcium: 800 }, updatedAtMs: 200 }]);
    expect(j.wellbeing[0].entryId).toBe("w-1");
    // `badges` is intentionally NOT round-tripped — achievement state
    // already syncs through gamification.state.achievements, and a
    // snapshot field with no paired client write path would just
    // leak stale empty data on every device.
    expect((j as Record<string, unknown>).badges).toBeUndefined();
  });
});
