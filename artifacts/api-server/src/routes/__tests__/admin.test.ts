import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express, { type Express } from "express";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/* -------------------------------------------------------------------------- *
 * Test state — manipulate from `beforeEach` and assertions; the @workspace/db
 * and ../../lib/auth mocks read from these.
 * -------------------------------------------------------------------------- */

interface UserRow {
  appUserId: string;
  clerkUserId: string | null;
  email: string | null;
  displayName: string | null;
  isAdmin: boolean;
  createdAt: Date;
}

interface SubscriberRow {
  appUserId: string;
  entitlementId: string;
  isActive: boolean;
  isInTrial: boolean;
  willRenew: boolean;
  productId: string | null;
  periodType: string | null;
  store: string | null;
  expiresAt: Date | null;
  cancelledAt: Date | null;
  /** subscribers.createdAt — proxies "trial start" in admin metrics. */
  createdAt?: Date;
  /**
   * "server" → granted by upsertClerkUser at registration; "store" →
   * mirrored from RevenueCat. Drives the new server-trial metrics.
   */
  trialSource?: "server" | "store" | null;
  /** Wall-clock end of the server-managed trial. */
  trialEndsAt?: Date | null;
  /** Start of the BILLING_ISSUE grace window, or null when payment is healthy. */
  billingIssueAt?: Date | null;
  /** End of the BILLING_ISSUE grace window. */
  gracePeriodEndsAt?: Date | null;
}

interface MealPlanDayRow {
  appUserId: string;
  day: string;
  updatedAt: Date;
}

interface PushUserStateRow {
  appUserId: string;
  lastSentAt: Date | null;
}

interface FeedbackRow {
  id: number;
  appUserId: string | null;
  tier: string;
  feedbackType: string;
  message: string;
  tags: string[];
  allowTestimonialUse: boolean;
  platform: string | null;
  appVersion: string | null;
  createdAt: Date;
}

interface InteractionRow {
  appUserId: string;
  kind: string;
  receivedAt: Date;
}

interface WellbeingRow {
  appUserId: string;
  entry: {
    kind?: string;
    sessionName?: string;
    durationSec?: number;
    mood?: string;
    completedAt?: number;
  };
  completedAtMs: number;
}

interface AuditEventRow {
  id: number;
  actorAppUserId: string;
  targetAppUserId: string | null;
  action: string;
  payload: Record<string, unknown> | null;
  createdAt: Date;
}

interface BoneBuddyChatMessageRow {
  id: number;
  requestId: string;
  appUserId: string;
  role: "user" | "assistant";
  content: string;
  promptKey: string;
  promptVersion: number | null;
  createdAt: Date;
}

type AuthMode = "unauth" | "nonAdmin" | "admin";

const state = {
  authMode: "admin" as AuthMode,
  users: [] as UserRow[],
  subscribers: [] as SubscriberRow[],
  feedback: [] as FeedbackRow[],
  interactions: [] as InteractionRow[],
  wellbeing: [] as WellbeingRow[],
  mealPlanDays: [] as MealPlanDayRow[],
  pushUserState: [] as PushUserStateRow[],
  userProfile: [] as Array<Record<string, unknown>>,
  auditEvents: [] as AuditEventRow[],
  boneBuddyChatMessages: [] as BoneBuddyChatMessageRow[],
  analyticsConsent: [] as Array<Record<string, unknown>>,
};

function reset() {
  state.authMode = "admin";
  state.users.length = 0;
  state.subscribers.length = 0;
  state.feedback.length = 0;
  state.interactions.length = 0;
  state.wellbeing.length = 0;
  state.mealPlanDays.length = 0;
  state.pushUserState.length = 0;
  state.userProfile.length = 0;
  state.auditEvents.length = 0;
  state.boneBuddyChatMessages.length = 0;
  state.analyticsConsent.length = 0;
}

/* -------------------------------------------------------------------------- *
 * Mock the auth module so the route's call to `requireAdminUser` simply
 * reads `state.authMode`. The real auth flow (Clerk + upsert + isAdmin
 * check) is exercised in `lib/__tests__/auth.test.ts`.
 * -------------------------------------------------------------------------- */

vi.mock("../../lib/auth", () => ({
  requireAdminUser: async (
    _req: unknown,
    res: {
      status: (n: number) => { json: (b: unknown) => void };
    },
  ) => {
    if (state.authMode === "unauth") {
      res.status(401).json({ error: "missing bearer token" });
      return null;
    }
    if (state.authMode === "nonAdmin") {
      res.status(403).json({ error: "admin required" });
      return null;
    }
    return { appUserId: "admin-1", isAdmin: true, source: "clerk" };
  },
  // Keep the rest of the surface alive in case anything else imports from
  // this module via the same mock.
  requireUser: async () => ({
    appUserId: "admin-1",
    isAdmin: true,
    source: "clerk",
  }),
  requireUserAuth: async () => "admin-1",
  assertSelf: () => false,
  clerkAuthOf: () => ({ userId: null, sessionClaims: null }),
}));

/* -------------------------------------------------------------------------- *
 * Mock @workspace/db with a tiny query interpreter. Each table is a Proxy
 * that maps property access (`usersTable.email`) to a tagged column ref so
 * the interpreter can evaluate predicates and aggregations.
 * -------------------------------------------------------------------------- */

interface ColRef {
  __c: string;
  __t: string;
}

interface SqlMarker {
  __sql: string;
}

interface AggMarker {
  __agg: "count";
}

const TABLE_KEYS = {
  users: "users",
  subscribers: "subscribers",
  feedback: "feedback",
  interactionEvents: "interactionEvents",
  wellbeingEntries: "wellbeingEntries",
  userTokens: "userTokens",
  mealPlanDays: "mealPlanDays",
  pushUserState: "pushUserState",
  userProfile: "userProfile",
  auditEvents: "auditEvents",
  boneBuddyChatMessages: "boneBuddyChatMessages",
  analyticsConsent: "analyticsConsent",
} as const;

function makeTableProxy(tableName: string): unknown {
  const tableMarker = { __t: tableName };
  return new Proxy(tableMarker, {
    get(target, prop) {
      if (prop === "__t") return target.__t;
      if (typeof prop !== "string") return undefined;
      return { __c: prop, __t: tableName } as ColRef;
    },
  });
}

const usersTable = makeTableProxy(TABLE_KEYS.users);
const subscribersTable = makeTableProxy(TABLE_KEYS.subscribers);
const feedbackTable = makeTableProxy(TABLE_KEYS.feedback);
const interactionEventsTable = makeTableProxy(TABLE_KEYS.interactionEvents);
const wellbeingEntriesTable = makeTableProxy(TABLE_KEYS.wellbeingEntries);
const userTokensTable = makeTableProxy(TABLE_KEYS.userTokens);
const mealPlanDaysTable = makeTableProxy(TABLE_KEYS.mealPlanDays);
const pushUserStateTable = makeTableProxy(TABLE_KEYS.pushUserState);
const userProfileTable = makeTableProxy(TABLE_KEYS.userProfile);
const auditEventsTable = makeTableProxy(TABLE_KEYS.auditEvents);
const boneBuddyChatMessagesTable = makeTableProxy(TABLE_KEYS.boneBuddyChatMessages);
const analyticsConsentTable = makeTableProxy(TABLE_KEYS.analyticsConsent);

interface Cond {
  kind: string;
  args?: unknown[];
}

function rowsFor(t: string): Array<Record<string, unknown>> {
  switch (t) {
    case TABLE_KEYS.users:
      return state.users as unknown as Array<Record<string, unknown>>;
    case TABLE_KEYS.subscribers:
      return state.subscribers as unknown as Array<Record<string, unknown>>;
    case TABLE_KEYS.feedback:
      return state.feedback as unknown as Array<Record<string, unknown>>;
    case TABLE_KEYS.interactionEvents:
      return state.interactions as unknown as Array<Record<string, unknown>>;
    case TABLE_KEYS.wellbeingEntries:
      return state.wellbeing as unknown as Array<Record<string, unknown>>;
    case TABLE_KEYS.mealPlanDays:
      return state.mealPlanDays as unknown as Array<Record<string, unknown>>;
    case TABLE_KEYS.pushUserState:
      return state.pushUserState as unknown as Array<Record<string, unknown>>;
    case TABLE_KEYS.userProfile:
      return state.userProfile;
    case TABLE_KEYS.auditEvents:
      return state.auditEvents as unknown as Array<Record<string, unknown>>;
    case TABLE_KEYS.boneBuddyChatMessages:
      return state.boneBuddyChatMessages as unknown as Array<Record<string, unknown>>;
    case TABLE_KEYS.analyticsConsent:
      return state.analyticsConsent;
    default:
      return [];
  }
}

function isCol(x: unknown): x is ColRef {
  return typeof x === "object" && x !== null && "__c" in (x as object);
}

function getCell(row: Record<string, unknown>, ref: ColRef): unknown {
  return row[ref.__c];
}

function evalCond(row: Record<string, unknown>, cond: Cond): boolean {
  if (cond.kind === "and") {
    return (cond.args ?? []).every((c) => evalCond(row, c as Cond));
  }
  if (cond.kind === "or") {
    return (cond.args ?? []).some((c) => evalCond(row, c as Cond));
  }
  if (cond.kind === "ilike") {
    const [colRef, val] = cond.args ?? [];
    if (!isCol(colRef)) return false;
    const cell = getCell(row, colRef);
    if (typeof cell !== "string" || typeof val !== "string") return false;
    // Mirror PostgreSQL `ILIKE` semantics so the wildcard-escape regression
    // test exercises real wildcard behavior. `%` matches any run of
    // characters; `_` matches a single character; `\` escapes the next
    // metacharacter (matching the production handler's escaping).
    let regex = "^";
    let i = 0;
    while (i < val.length) {
      const ch = val[i]!;
      if (ch === "\\" && i + 1 < val.length) {
        const next = val[i + 1]!;
        regex += next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        i += 2;
        continue;
      }
      if (ch === "%") {
        regex += ".*";
      } else if (ch === "_") {
        regex += ".";
      } else {
        regex += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      i += 1;
    }
    regex += "$";
    return new RegExp(regex, "i").test(cell);
  }
  if (cond.kind === "eq") {
    const [colRef, val] = cond.args ?? [];
    if (!isCol(colRef)) return false;
    return getCell(row, colRef) === val;
  }
  if (cond.kind === "gte") {
    const [colRef, val] = cond.args ?? [];
    if (!isCol(colRef)) return false;
    const cell = getCell(row, colRef);
    if (cell instanceof Date && val instanceof Date) {
      return cell.getTime() >= val.getTime();
    }
    if (typeof cell === "number" && typeof val === "number") return cell >= val;
    return false;
  }
  if (cond.kind === "lt") {
    const [colRef, val] = cond.args ?? [];
    if (!isCol(colRef)) return false;
    const cell = getCell(row, colRef);
    if (cell instanceof Date && val instanceof Date) {
      return cell.getTime() < val.getTime();
    }
    if (typeof cell === "number" && typeof val === "number") return cell < val;
    return false;
  }
  if (cond.kind === "lte") {
    const [colRef, val] = cond.args ?? [];
    if (!isCol(colRef)) return false;
    const cell = getCell(row, colRef);
    if (cell instanceof Date && val instanceof Date) {
      return cell.getTime() <= val.getTime();
    }
    if (typeof cell === "number" && typeof val === "number") return cell <= val;
    return false;
  }
  return true;
}

function applyWhere(
  rows: Array<Record<string, unknown>>,
  cond: Cond | undefined,
): Array<Record<string, unknown>> {
  if (!cond) return rows;
  return rows.filter((r) => evalCond(r, cond));
}

function applyOrderBy(
  rows: Array<Record<string, unknown>>,
  spec: { kind: "desc"; col: ColRef } | undefined,
): Array<Record<string, unknown>> {
  if (!spec) return rows;
  const sorted = [...rows].sort((a, b) => {
    const av = getCell(a, spec.col);
    const bv = getCell(b, spec.col);
    if (av instanceof Date && bv instanceof Date) {
      return bv.getTime() - av.getTime();
    }
    if (typeof av === "number" && typeof bv === "number") return bv - av;
    return 0;
  });
  return sorted;
}

vi.mock("@workspace/db", () => {
  const select = (selectShape?: Record<string, unknown>) => {
    return {
      from: (tbl: { __t: string }) => {
        const baseRows = () => rowsFor(tbl.__t);

        function exec(
          rowsIn: Array<Record<string, unknown>>,
        ): Array<Record<string, unknown>> {
          if (!selectShape) {
            // bare select() returns the underlying rows verbatim.
            return rowsIn;
          }
          const keys = Object.keys(selectShape);

          // sql<number>`count(distinct ${appUserId})` shape.
          const distinctMarker = keys.find(
            (k) =>
              (selectShape[k] as SqlMarker)?.__sql === "count_distinct_app_user",
          );
          if (distinctMarker && keys.length === 1) {
            const distinct = new Set(rowsIn.map((r) => r["appUserId"]));
            return [{ [distinctMarker]: distinct.size }];
          }

          const aggKey = keys.find(
            (k) => (selectShape[k] as AggMarker)?.__agg === "count",
          );
          const groupKeys = keys.filter((k) => k !== aggKey);

          if (aggKey && groupKeys.length === 0) {
            return [{ [aggKey]: rowsIn.length }];
          }

          if (aggKey && groupKeys.length > 0) {
            const groups = new Map<string, Record<string, unknown>>();
            for (const row of rowsIn) {
              const groupVals: Record<string, unknown> = {};
              for (const gk of groupKeys) {
                const ref = selectShape[gk];
                if (isCol(ref)) {
                  groupVals[gk] = getCell(row, ref);
                } else if (
                  ref &&
                  (ref as SqlMarker).__sql === "wellbeing_entry_kind"
                ) {
                  const entry = (row["entry"] as { kind?: string }) ?? {};
                  groupVals[gk] = entry.kind ?? "other";
                }
              }
              const key = JSON.stringify(groupVals);
              const existing = groups.get(key);
              if (existing) {
                existing[aggKey] = (existing[aggKey] as number) + 1;
              } else {
                groups.set(key, { ...groupVals, [aggKey]: 1 });
              }
            }
            return [...groups.values()];
          }

          // Pure column selection (no agg) — project columns out of each row.
          return rowsIn.map((row) => {
            const out: Record<string, unknown> = {};
            for (const k of keys) {
              const ref = selectShape[k];
              if (isCol(ref)) out[k] = getCell(row, ref);
            }
            return out;
          });
        }

        const chainable = (
          rowsIn: Array<Record<string, unknown>>,
          orderSpec?: { kind: "desc"; col: ColRef },
        ) => {
          let current = rowsIn;
          let order = orderSpec;

          const api = {
            where(cond: Cond | undefined) {
              current = applyWhere(current, cond);
              return chainable(current, order);
            },
            orderBy(spec: unknown) {
              if (
                spec &&
                typeof spec === "object" &&
                (spec as { kind?: string }).kind === "desc"
              ) {
                order = spec as { kind: "desc"; col: ColRef };
              }
              return chainable(current, order);
            },
            groupBy(..._args: unknown[]) {
              return chainable(current, order);
            },
            limit(n: number) {
              return {
                offset(skip: number) {
                  const sorted = applyOrderBy(current, order);
                  return Promise.resolve(exec(sorted).slice(skip, skip + n));
                },
                then<T>(
                  resolve: (v: Array<Record<string, unknown>>) => T,
                  reject?: (err: unknown) => unknown,
                ) {
                  try {
                    const sorted = applyOrderBy(current, order);
                    return Promise.resolve(resolve(exec(sorted).slice(0, n)));
                  } catch (err) {
                    if (reject) return Promise.resolve(reject(err));
                    return Promise.reject(err);
                  }
                },
              };
            },
            then<T>(
              resolve: (v: Array<Record<string, unknown>>) => T,
              reject?: (err: unknown) => unknown,
            ) {
              try {
                const sorted = applyOrderBy(current, order);
                return Promise.resolve(resolve(exec(sorted)));
              } catch (err) {
                if (reject) return Promise.resolve(reject(err));
                return Promise.reject(err);
              }
            },
          };
          return api;
        };

        return chainable(baseRows());
      },
    };
  };

  return {
    db: { select },
    usersTable,
    subscribersTable,
    feedbackTable,
    interactionEventsTable,
    wellbeingEntriesTable,
    userTokensTable,
    mealPlanDaysTable,
    pushUserStateTable,
    userProfileTable,
    auditEventsTable,
    boneBuddyChatMessagesTable,
    analyticsConsentTable,
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ kind: "and", args }),
  or: (...args: unknown[]) => ({ kind: "or", args }),
  count: (): AggMarker => ({ __agg: "count" }),
  desc: (col: unknown) => ({ kind: "desc", col }),
  eq: (a: unknown, b: unknown) => ({ kind: "eq", args: [a, b] }),
  gte: (a: unknown, b: unknown) => ({ kind: "gte", args: [a, b] }),
  ilike: (a: unknown, b: unknown) => ({ kind: "ilike", args: [a, b] }),
  lt: (a: unknown, b: unknown) => ({ kind: "lt", args: [a, b] }),
  lte: (a: unknown, b: unknown) => ({ kind: "lte", args: [a, b] }),
  inArray: (a: unknown, b: unknown) => ({ kind: "inArray", args: [a, b] }),
  sql: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): SqlMarker => {
    const joined = strings.join("?");
    if (joined.includes("count(distinct")) {
      return { __sql: "count_distinct_app_user" };
    }
    // The route uses `coalesce(${entry}->>'kind', 'other')` with the
    // `entry` column interpolated. The interpolation strips the literal
    // `entry` token from the joined string, so detect by inspecting the
    // template values for a ColRef pointing at the `entry` column.
    const refsEntryCol = values.some(
      (v) =>
        typeof v === "object" &&
        v !== null &&
        (v as ColRef).__c === "entry",
    );
    if (joined.includes("'kind'") && refsEntryCol) {
      return { __sql: "wellbeing_entry_kind" };
    }
    return { __sql: joined };
  },
}));

/* -------------------------------------------------------------------------- *
 * Build an Express app with just the admin router. We hit it over real HTTP
 * so middleware ordering and JSON serialization are exercised.
 * -------------------------------------------------------------------------- */

let app: Express;
let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const { default: adminRouter } = await import("../admin");
  app = express();
  app.use(express.json());
  app.use("/api", adminRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  reset();
});

/* -------------------------------------------------------------------------- *
 * Cross-cutting: admin gate
 * -------------------------------------------------------------------------- */

describe("admin gate", () => {
  const ADMIN_PATHS = [
    "/admin/me",
    "/admin/metrics/users",
    "/admin/metrics/engagement",
    "/admin/metrics/community-insights",
    "/admin/metrics/subscriptions",
    "/admin/feedback",
    "/admin/users/lookup?email=admin@snap.life",
  ];

  it("returns { isAdmin: true } on /admin/me when caller is admin", async () => {
    state.authMode = "admin";
    const r = await fetch(`${baseUrl}/admin/me`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { isAdmin: boolean };
    expect(body).toEqual({ isAdmin: true });
  });

  for (const path of ADMIN_PATHS) {
    it(`401 when no session for ${path}`, async () => {
      state.authMode = "unauth";
      const r = await fetch(`${baseUrl}${path}`);
      expect(r.status).toBe(401);
    });

    it(`403 when signed-in but not admin for ${path}`, async () => {
      state.authMode = "nonAdmin";
      const r = await fetch(`${baseUrl}${path}`);
      expect(r.status).toBe(403);
      const body = (await r.json()) as { error: string };
      expect(body).toMatchObject({ error: expect.any(String) });
    });
  }
});

/* -------------------------------------------------------------------------- *
 * Per-endpoint aggregation logic
 * -------------------------------------------------------------------------- */

describe("GET /admin/metrics/community-insights", () => {
  it("returns a blank report below the minimum consented cohort", async () => {
    state.analyticsConsent.push(
      { appUserId: "user-1", communityAnalytics: true },
      { appUserId: "user-2", communityAnalytics: true },
    );
    const response = await fetch(`${baseUrl}/admin/metrics/community-insights`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body.privacy).toMatchObject({
      minCohortSize: 10,
      consentedParticipants: null,
      suppressed: true,
    });
    expect(body.overview).toBeNull();
    expect(body.impact).toBeNull();
  });
});

describe("GET /admin/metrics/users", () => {
  it("counts users, admins, recent signups, and tier breakdown", async () => {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 3600 * 1000);
    const longAgo = new Date(now.getTime() - 90 * 24 * 3600 * 1000);

    state.users.push(
      {
        appUserId: "admin-1",
        clerkUserId: null,
        email: null,
        displayName: null,
        isAdmin: true,
        createdAt: longAgo,
      },
      {
        appUserId: "u1",
        clerkUserId: null,
        email: null,
        displayName: null,
        isAdmin: false,
        createdAt: dayAgo,
      },
      {
        appUserId: "u2",
        clerkUserId: null,
        email: null,
        displayName: null,
        isAdmin: false,
        createdAt: tenDaysAgo,
      },
      {
        appUserId: "u3",
        clerkUserId: null,
        email: null,
        displayName: null,
        isAdmin: false,
        createdAt: longAgo,
      },
    );

    state.subscribers.push(
      {
        appUserId: "u1",
        entitlementId: "plus",
        isActive: true,
        isInTrial: false,
        willRenew: true,
        productId: "snaplife_plus_monthly",
        periodType: "normal",
        store: "app_store",
        expiresAt: null,
        cancelledAt: null,
      },
      {
        appUserId: "u2",
        entitlementId: "premium",
        isActive: true,
        isInTrial: true,
        willRenew: true,
        productId: "snaplife_premium_monthly",
        periodType: "trial",
        store: "play_store",
        expiresAt: null,
        cancelledAt: null,
      },
      {
        appUserId: "u3",
        entitlementId: "plus",
        isActive: false,
        isInTrial: false,
        willRenew: false,
        productId: "snaplife_plus_monthly",
        periodType: "normal",
        store: "app_store",
        expiresAt: null,
        cancelledAt: new Date(),
      },
    );

    const r = await fetch(`${baseUrl}/admin/metrics/users`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      totalUsers: number;
      adminCount: number;
      byTier: Record<string, number>;
      newUsersLast7d: number;
      activeLast7d: number;
      activeLast30d: number;
    };
    expect(body.totalUsers).toBe(4);
    expect(body.adminCount).toBe(1);
    // u1 active plus → plus; u2 isInTrial → trial;
    // u3 inactive + !inTrial → lapsed; admin (no subscribers row) → free.
    expect(body.byTier).toEqual({
      free: 1,
      trial: 1,
      plus: 1,
      premium: 0,
      lapsed: 1,
    });
    // Exactly one signup in the last 7d (u1 was created `dayAgo`); u2 at
    // ~10d ago is outside the window, u3/admin at ~90d ago likewise.
    expect(body.newUsersLast7d).toBe(1);
    // No interaction events seeded → no recently-active users.
    expect(body.activeLast7d).toBe(0);
    expect(body.activeLast30d).toBe(0);
  });

  it("counts active users from interaction_events alongside tier breakdown", async () => {
    const now = new Date();
    state.users.push({
      appUserId: "u1",
      clerkUserId: null,
      email: null,
      displayName: null,
      isAdmin: false,
      createdAt: new Date(now.getTime() - 10 * 24 * 3600 * 1000),
    });
    state.interactions.push(
      { appUserId: "u1", kind: "tap", receivedAt: now },
      // Same user, two events in the window — distinct counts to 1.
      { appUserId: "u1", kind: "tap", receivedAt: now },
    );
    const r = await fetch(`${baseUrl}/admin/metrics/users`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      activeLast7d: number;
      activeLast30d: number;
    };
    expect(body.activeLast7d).toBe(1);
    expect(body.activeLast30d).toBe(1);
  });
});

describe("GET /admin/metrics/engagement", () => {
  it("counts distinct active users for DAU/WAU/MAU and ignores duplicate events", async () => {
    const now = Date.now();
    const within24h = new Date(now - 2 * 3600 * 1000);
    const within7d = new Date(now - 3 * 24 * 3600 * 1000);
    const within30d = new Date(now - 20 * 24 * 3600 * 1000);
    const tooOld = new Date(now - 60 * 24 * 3600 * 1000);

    state.interactions.push(
      // u1: two events today → still 1 distinct DAU.
      { appUserId: "u1", kind: "tap", receivedAt: within24h },
      { appUserId: "u1", kind: "scroll", receivedAt: within24h },
      // u2: active this week but not today.
      { appUserId: "u2", kind: "tap", receivedAt: within7d },
      // u3: active this month but not this week.
      { appUserId: "u3", kind: "tap", receivedAt: within30d },
      // u4: outside the 30d window — must NOT count toward MAU.
      { appUserId: "u4", kind: "tap", receivedAt: tooOld },
    );

    state.wellbeing.push(
      {
        appUserId: "u1",
        entry: { kind: "breathing" },
        completedAtMs: now - 1 * 3600 * 1000,
      },
      {
        appUserId: "u1",
        entry: { kind: "breathing" },
        completedAtMs: now - 2 * 3600 * 1000,
      },
      {
        appUserId: "u2",
        entry: { kind: "meditation" },
        completedAtMs: now - 24 * 3600 * 1000,
      },
    );

    const r = await fetch(`${baseUrl}/admin/metrics/engagement`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      dau: number;
      wau: number;
      mau: number;
      wellbeingSessionsLast7d: {
        breathing: number;
        meditation: number;
        other: number;
      };
    };
    expect(body.dau).toBe(1); // u1 only
    expect(body.wau).toBe(2); // u1 + u2
    expect(body.mau).toBe(3); // u1 + u2 + u3 (u4 excluded)
    expect(body.wellbeingSessionsLast7d).toMatchObject({
      breathing: 2,
      meditation: 1,
    });
  });

  it("includes meal-plan, push-delivery, Bone Buddy, and weekly sparkline", async () => {
    const now = Date.now();
    const within7d = new Date(now - 3 * 24 * 3600 * 1000);
    const within7dB = new Date(now - 5 * 24 * 3600 * 1000);
    const tooOld = new Date(now - 30 * 24 * 3600 * 1000);

    // Meal plan rows — only those updated within the last 7d count.
    state.mealPlanDays.push(
      { appUserId: "u1", day: "2026-04-30", updatedAt: within7d },
      { appUserId: "u1", day: "2026-04-29", updatedAt: within7dB },
      { appUserId: "u2", day: "2026-04-30", updatedAt: within7d },
      // Stale — outside the window.
      { appUserId: "u3", day: "2026-03-01", updatedAt: tooOld },
    );

    // Push recipients — only those with lastSentAt in window.
    state.pushUserState.push(
      { appUserId: "u1", lastSentAt: within7d },
      { appUserId: "u2", lastSentAt: within7dB },
      // Stale push, must be excluded.
      { appUserId: "u3", lastSentAt: tooOld },
      // Never received a push.
      { appUserId: "u4", lastSentAt: null },
    );

    // Push opens — distinct openers + total opens drive open rate /
    // Bone Buddy interactions respectively.
    state.interactions.push(
      { appUserId: "u1", kind: "push_opened", receivedAt: within7d },
      { appUserId: "u1", kind: "push_opened", receivedAt: within7dB },
      { appUserId: "u2", kind: "push_opened", receivedAt: within7d },
      // Non-push event — must NOT inflate Bone Buddy / opens.
      { appUserId: "u1", kind: "tap", receivedAt: within7d },
    );

    const r = await fetch(`${baseUrl}/admin/metrics/engagement`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      mealPlansLast7d: number;
      pushRecipientsLast7d: number;
      pushOpenedLast7d: number;
      pushOpenRate: number | null;
      boneBuddyInteractionsLast7d: number;
      weeklyActivity: Array<{ date: string; activeUsers: number }>;
    };

    // 3 in-window meal plan day rows (one stale row excluded).
    expect(body.mealPlansLast7d).toBe(3);
    // u1 + u2 received pushes in the window; u3 stale, u4 never sent.
    expect(body.pushRecipientsLast7d).toBe(2);
    // Distinct openers u1 + u2 = 2.
    expect(body.pushOpenedLast7d).toBe(2);
    // 2 / 2 = 1.0.
    expect(body.pushOpenRate).toBeCloseTo(1.0, 5);
    // Total push_opened events in window = 3 (u1×2 + u2×1).
    expect(body.boneBuddyInteractionsLast7d).toBe(3);
    // Sparkline always returns 7 buckets, oldest first, even if empty.
    expect(body.weeklyActivity).toHaveLength(7);
    expect(body.weeklyActivity[0]?.date < body.weeklyActivity[6]!.date).toBe(
      true,
    );
  });

  it("returns null pushOpenRate when nobody received a push", async () => {
    state.interactions.push({
      appUserId: "u1",
      kind: "push_opened",
      receivedAt: new Date(),
    });
    const r = await fetch(`${baseUrl}/admin/metrics/engagement`);
    const body = (await r.json()) as {
      pushRecipientsLast7d: number;
      pushOpenRate: number | null;
    };
    expect(body.pushRecipientsLast7d).toBe(0);
    expect(body.pushOpenRate).toBeNull();
  });
});

describe("GET /admin/metrics/subscriptions", () => {
  it("computes activeCount, MRR, churn ratio (cancellations + expirations), and tier breakdown", async () => {
    const cancelled30d = new Date(Date.now() - 5 * 24 * 3600 * 1000);
    const expired20d = new Date(Date.now() - 20 * 24 * 3600 * 1000);
    state.subscribers.push(
      {
        appUserId: "u1",
        entitlementId: "plus",
        isActive: true,
        isInTrial: false,
        willRenew: true,
        productId: "snaplife_plus_monthly",
        periodType: "normal",
        store: "app_store",
        expiresAt: null,
        cancelledAt: null,
      },
      {
        appUserId: "u2",
        entitlementId: "premium",
        isActive: true,
        isInTrial: false,
        willRenew: false,
        productId: "snaplife_premium_monthly",
        periodType: "normal",
        store: "play_store",
        expiresAt: null,
        cancelledAt: null,
      },
      {
        appUserId: "u3",
        entitlementId: "plus",
        isActive: true,
        isInTrial: true,
        willRenew: true,
        productId: "snaplife_plus_monthly",
        periodType: "trial",
        store: "app_store",
        expiresAt: null,
        cancelledAt: null,
      },
      {
        appUserId: "u4",
        entitlementId: "plus",
        isActive: false,
        isInTrial: false,
        willRenew: false,
        productId: "snaplife_plus_monthly",
        periodType: "normal",
        store: "app_store",
        expiresAt: null,
        cancelledAt: cancelled30d,
      },
      // u5: quietly lapsed inside the 30d window — cancelledAt is null
      // but expiresAt fell inside the window. Must count toward churn
      // per the OpenAPI contract ("cancellations + expirations").
      {
        appUserId: "u5",
        entitlementId: "plus",
        isActive: false,
        isInTrial: false,
        willRenew: false,
        productId: "snaplife_plus_monthly",
        periodType: "normal",
        store: "app_store",
        expiresAt: expired20d,
        cancelledAt: null,
      },
    );

    const r = await fetch(`${baseUrl}/admin/metrics/subscriptions`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      activeCount: number;
      inTrialCount: number;
      willRenewCount: number;
      cancelledLast30d: number;
      byTier: Record<string, number>;
      approxMrrCents: number;
      churnRate30d: number | null;
    };

    // 3 active rows.
    expect(body.activeCount).toBe(3);
    expect(body.inTrialCount).toBe(1);
    expect(body.willRenewCount).toBe(2);
    // 1 explicit cancel (u4) + 1 quiet expiration (u5) = 2 churn events.
    expect(body.cancelledLast30d).toBe(2);
    expect(body.byTier).toEqual({ trial: 1, plus: 1, premium: 1 });

    // MRR: u1 plus monthly (999) + u2 premium yearly (19999/12) +
    // u3 trial (excluded).
    expect(body.approxMrrCents).toBe(699 + 1499);

    // baseline = active(3) + churn(2) = 5 → churn = 2/5 = 0.4
    expect(body.churnRate30d).toBeCloseTo(0.4, 5);
  });

  it("returns null churnRate30d when there is no historical activity", async () => {
    const r = await fetch(`${baseUrl}/admin/metrics/subscriptions`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      activeCount: number;
      churnRate30d: number | null;
      approxMrrCents: number;
      approxArrCents: number;
      trialsStartedLast30d: number;
      paidConvertedLast30d: number;
      trialToPaidRate: number | null;
      revenueByProduct: unknown[];
    };
    expect(body.activeCount).toBe(0);
    expect(body.churnRate30d).toBeNull();
    expect(body.approxMrrCents).toBe(0);
    expect(body.approxArrCents).toBe(0);
    expect(body.trialsStartedLast30d).toBe(0);
    expect(body.paidConvertedLast30d).toBe(0);
    expect(body.trialToPaidRate).toBeNull();
    expect(body.revenueByProduct).toEqual([]);
  });

  it("returns ARR, trial→paid conversion, and per-product revenue split", async () => {
    const within30d = new Date(Date.now() - 5 * 24 * 3600 * 1000);
    const longAgo = new Date(Date.now() - 200 * 24 * 3600 * 1000);
    state.subscribers.push(
      // Two paid plus monthly subscribers, both started recently → both
      // started AS trials, both now paid.
      {
        appUserId: "u1",
        entitlementId: "plus",
        isActive: true,
        isInTrial: false,
        willRenew: true,
        productId: "snaplife_plus_monthly",
        periodType: "normal",
        store: "app_store",
        expiresAt: null,
        cancelledAt: null,
        createdAt: within30d,
      },
      {
        appUserId: "u2",
        entitlementId: "plus",
        isActive: true,
        isInTrial: false,
        willRenew: true,
        productId: "snaplife_plus_monthly",
        periodType: "normal",
        store: "app_store",
        expiresAt: null,
        cancelledAt: null,
        createdAt: within30d,
      },
      // One started in window but is still in trial — counts as a trial
      // start but not as a paid conversion.
      {
        appUserId: "u3",
        entitlementId: "plus",
        isActive: true,
        isInTrial: true,
        willRenew: true,
        productId: "snaplife_plus_monthly",
        periodType: "trial",
        store: "app_store",
        expiresAt: null,
        cancelledAt: null,
        createdAt: within30d,
      },
      // Old paying premium yearly user — outside the conversion window
      // but contributes to MRR / per-product revenue.
      {
        appUserId: "u4",
        entitlementId: "premium",
        isActive: true,
        isInTrial: false,
        willRenew: true,
        productId: "snaplife_founder_premium_monthly",
        periodType: "normal",
        store: "play_store",
        expiresAt: null,
        cancelledAt: null,
        createdAt: longAgo,
      },
    );

    const r = await fetch(`${baseUrl}/admin/metrics/subscriptions`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      approxMrrCents: number;
      approxArrCents: number;
      trialsStartedLast30d: number;
      trialsActiveCount: number;
      trialsConvertedToPaidLast30d: number;
      trialsConvertedToPlusLast30d: number;
      trialsConvertedToPremiumLast30d: number;
      trialsExpiredWithoutConversionLast30d: number;
      paidConvertedLast30d: number;
      trialToPaidRate: number | null;
      revenueByProduct: Array<{
        productId: string | null;
        tier: string;
        activeCount: number;
        monthlyCents: number;
      }>;
    };

    // u1 + u2 plus monthly = 2 × 999; u4 premium yearly = 19999/12 ≈ 1666.
    const expectedMrr = 699 + 699 + 999;
    expect(body.approxMrrCents).toBe(expectedMrr);
    expect(body.approxArrCents).toBe(expectedMrr * 12);

    // u1 + u2 + u3 started in the last 30d.
    expect(body.trialsStartedLast30d).toBe(3);
    // u1 + u2 converted to a paying product (Plus). u3 still in trial.
    expect(body.trialsConvertedToPaidLast30d).toBe(2);
    expect(body.trialsConvertedToPlusLast30d).toBe(2);
    expect(body.trialsConvertedToPremiumLast30d).toBe(0);
    // Deprecated alias still tracks the new field.
    expect(body.paidConvertedLast30d).toBe(2);
    expect(body.trialToPaidRate).toBeCloseTo(2 / 3, 5);

    // 2 paying products: plus monthly (2 × 999), premium yearly (1 × 1666).
    const byProduct = Object.fromEntries(
      body.revenueByProduct.map((p) => [p.productId, p]),
    );
    expect(byProduct["snaplife_plus_monthly"]).toMatchObject({
      tier: "plus",
      activeCount: 2,
      monthlyCents: 699 * 2,
    });
    expect(byProduct["snaplife_founder_premium_monthly"]).toMatchObject({
      tier: "premium",
      activeCount: 1,
      monthlyCents: 999,
    });
    // Trial seat must NOT contribute to revenueByProduct.
    expect(byProduct["snaplife_plus_monthly"]?.activeCount).toBe(2);
  });

  it("counts active server-managed trials and trial-to-free leakage", async () => {
    const now = Date.now();
    const within30d = new Date(now - 5 * 24 * 3600 * 1000);
    const trialFutureEnd = new Date(now + 20 * 24 * 3600 * 1000);
    const trialPastEnd = new Date(now - 5 * 24 * 3600 * 1000);
    const trialAncientEnd = new Date(now - 200 * 24 * 3600 * 1000);

    state.subscribers.push(
      // Active server trial — counted in trialsActiveCount + byTier.trial.
      {
        appUserId: "s1",
        entitlementId: "snap_premium",
        isActive: true,
        isInTrial: true,
        willRenew: false,
        productId: null,
        periodType: "TRIAL",
        store: null,
        expiresAt: trialFutureEnd,
        cancelledAt: null,
        createdAt: within30d,
        trialSource: "server",
        trialEndsAt: trialFutureEnd,
      },
      // Expired server trial within window — counts as expired-without-conversion.
      // Should NOT appear in active/inTrial/byTier — lazy expiry kicks in.
      {
        appUserId: "s2",
        entitlementId: "snap_premium",
        isActive: true,
        isInTrial: true,
        willRenew: false,
        productId: null,
        periodType: "TRIAL",
        store: null,
        expiresAt: trialPastEnd,
        cancelledAt: null,
        createdAt: new Date(now - 35 * 24 * 3600 * 1000),
        trialSource: "server",
        trialEndsAt: trialPastEnd,
      },
      // Ancient expired server trial — outside the 30d window, so it
      // does NOT contribute to trialsExpiredWithoutConversionLast30d.
      {
        appUserId: "s3",
        entitlementId: "snap_premium",
        isActive: true,
        isInTrial: true,
        willRenew: false,
        productId: null,
        periodType: "TRIAL",
        store: null,
        expiresAt: trialAncientEnd,
        cancelledAt: null,
        createdAt: new Date(now - 230 * 24 * 3600 * 1000),
        trialSource: "server",
        trialEndsAt: trialAncientEnd,
      },
      // Trial that converted to Premium — counts toward Premium conversion.
      {
        appUserId: "s4",
        entitlementId: "snap_premium",
        isActive: true,
        isInTrial: false,
        willRenew: true,
        productId: "snaplife_premium_monthly",
        periodType: "normal",
        store: "app_store",
        expiresAt: null,
        cancelledAt: null,
        createdAt: within30d,
        // Real purchase clears trialSource on the upsert.
        trialSource: null,
        trialEndsAt: null,
      },
    );

    const r = await fetch(`${baseUrl}/admin/metrics/subscriptions`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      activeCount: number;
      inTrialCount: number;
      trialsActiveCount: number;
      trialsExpiredWithoutConversionLast30d: number;
      trialsConvertedToPremiumLast30d: number;
      trialsConvertedToPlusLast30d: number;
      byTier: { trial: number; plus: number; premium: number };
    };

    // Only s1 (active server trial) + s4 (paid premium) are effectively active.
    expect(body.activeCount).toBe(2);
    expect(body.trialsActiveCount).toBe(1);
    expect(body.inTrialCount).toBe(1);
    // s2 expired in the window; s3 expired ages ago.
    expect(body.trialsExpiredWithoutConversionLast30d).toBe(1);
    expect(body.trialsConvertedToPremiumLast30d).toBe(1);
    expect(body.trialsConvertedToPlusLast30d).toBe(0);
    // byTier reflects only the effectively-active rows.
    expect(body.byTier.trial).toBe(1);
    expect(body.byTier.premium).toBe(1);
    expect(body.byTier.plus).toBe(0);
  });

  it("counts subscribers in an open BILLING_ISSUE grace window via billingIssueCount, and lazy-expires elapsed grace windows", async () => {
    // Three rows exercise every leg of the billing-issue grace logic in
    // the metrics aggregator:
    //   u1 — payment healthy, isActive=true → contributes to activeCount
    //          but NOT to billingIssueCount.
    //   u2 — BILLING_ISSUE opened 1 day ago, gracePeriodEndsAt 2 days
    //          out → grace window is OPEN, isActive stays effective →
    //          counts toward both activeCount AND billingIssueCount.
    //   u3 — BILLING_ISSUE opened 5 days ago, gracePeriodEndsAt 2 days
    //          IN THE PAST → lazy-expiry must drop this row out of
    //          activeCount entirely (and out of billingIssueCount too).
    //          The stored isActive=true represents the moment-of-write
    //          state; the metric mirrors /subscription/me's lazy decay.
    const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const twoDaysOut = new Date(Date.now() + 2 * 24 * 3600 * 1000);
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 3600 * 1000);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    state.subscribers.push(
      {
        appUserId: "u1",
        entitlementId: "premium",
        isActive: true,
        isInTrial: false,
        willRenew: true,
        productId: "snaplife_premium_yearly",
        periodType: "normal",
        store: "play_store",
        expiresAt: null,
        cancelledAt: null,
      },
      {
        appUserId: "u2",
        entitlementId: "premium",
        isActive: true,
        isInTrial: false,
        willRenew: true,
        productId: "snaplife_premium_yearly",
        periodType: "normal",
        store: "play_store",
        expiresAt: null,
        cancelledAt: null,
        billingIssueAt: oneDayAgo,
        gracePeriodEndsAt: twoDaysOut,
      },
      {
        appUserId: "u3",
        entitlementId: "premium",
        isActive: true,
        isInTrial: false,
        willRenew: true,
        productId: "snaplife_premium_yearly",
        periodType: "normal",
        store: "play_store",
        expiresAt: null,
        cancelledAt: null,
        billingIssueAt: fiveDaysAgo,
        gracePeriodEndsAt: twoDaysAgo,
      },
    );

    const r = await fetch(`${baseUrl}/admin/metrics/subscriptions`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      activeCount: number;
      billingIssueCount: number;
    };

    // u1 (healthy) + u2 (in-grace, still effective) = 2 effectively
    // active. u3 is lazy-expired — its grace window has already
    // closed, so it must NOT count.
    expect(body.activeCount).toBe(2);
    // Only u2 sits inside an *open* grace window.
    expect(body.billingIssueCount).toBe(1);
  });
});

describe("GET /admin/feedback", () => {
  it("returns the most recent items first and supports type filter", async () => {
    state.feedback.push(
      {
        id: 1,
        appUserId: "u1",
        tier: "plus",
        feedbackType: "general",
        message: "older general",
        tags: [],
        allowTestimonialUse: false,
        platform: "ios",
        appVersion: "1.0.0",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
      {
        id: 2,
        appUserId: "u2",
        tier: "premium",
        feedbackType: "testimonial",
        message: "love it",
        tags: ["happy"],
        allowTestimonialUse: true,
        platform: "android",
        appVersion: "1.1.0",
        createdAt: new Date("2025-02-01T00:00:00Z"),
      },
      {
        id: 3,
        appUserId: null,
        tier: "trial",
        feedbackType: "general",
        message: "newer general",
        tags: [],
        allowTestimonialUse: false,
        platform: null,
        appVersion: null,
        createdAt: new Date("2025-03-01T00:00:00Z"),
      },
    );

    const all = (await (
      await fetch(`${baseUrl}/admin/feedback`)
    ).json()) as { total: number; items: Array<{ id: number }> };
    expect(all.total).toBe(3);
    // Newest first.
    expect(all.items.map((it) => it.id)).toEqual([3, 2, 1]);

    const filtered = (await (
      await fetch(`${baseUrl}/admin/feedback?feedbackType=testimonial`)
    ).json()) as {
      total: number;
      items: Array<{
        id: number;
        feedbackType: string;
        allowTestimonialUse: boolean;
      }>;
    };
    expect(filtered.total).toBe(1);
    expect(filtered.items[0]).toMatchObject({
      id: 2,
      feedbackType: "testimonial",
      allowTestimonialUse: true,
    });
  });
});

describe("GET /admin/chats", () => {
  it("is not exposed because individual Bone Buddy conversations are private", async () => {
    const r = await fetch(`${baseUrl}/admin/chats`);
    expect(r.status).toBe(404);
  });
});

describe("GET /admin/users/lookup", () => {
  it("returns user, subscription, and counts for a known email", async () => {
    state.users.push({
      appUserId: "alice",
      clerkUserId: "user_clerk_alice",
      email: "ALICE@example.com",
      displayName: "Alice",
      isAdmin: false,
      createdAt: new Date("2025-01-01T00:00:00Z"),
    });
    state.subscribers.push({
      appUserId: "alice",
      entitlementId: "plus",
      isActive: true,
      isInTrial: false,
      willRenew: true,
      productId: "snaplife_plus_monthly",
      periodType: "normal",
      store: "app_store",
      expiresAt: new Date("2026-01-01T00:00:00Z"),
      cancelledAt: null,
    });
    state.feedback.push({
      id: 1,
      appUserId: "alice",
      tier: "plus",
      feedbackType: "general",
      message: "hi",
      tags: [],
      allowTestimonialUse: false,
      platform: null,
      appVersion: null,
      createdAt: new Date(),
    });
    state.interactions.push(
      { appUserId: "alice", kind: "tap", receivedAt: new Date() },
      { appUserId: "alice", kind: "tap", receivedAt: new Date() },
    );

    // Case-insensitive email match.
    const r = await fetch(
      `${baseUrl}/admin/users/lookup?email=alice@example.com`,
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      user: { appUserId: string };
      subscription: { entitlementId: string };
      counts: {
        wellbeingEntries: number;
        interactionEvents: number;
        feedbackSubmissions: number;
      };
    };
    expect(body.user.appUserId).toBe("alice");
    expect(body.subscription.entitlementId).toBe("plus");
    expect(body.counts).toEqual({
      wellbeingEntries: 0,
      interactionEvents: 2,
      feedbackSubmissions: 1,
    });
  });

  it("returns lastActiveAt + recentSessions + recentFeedback", async () => {
    const now = Date.now();
    const fiveMinAgo = new Date(now - 5 * 60 * 1000);
    const oneHourAgo = new Date(now - 60 * 60 * 1000);
    const twoDaysAgo = new Date(now - 2 * 24 * 3600 * 1000);
    state.users.push({
      appUserId: "alice",
      clerkUserId: null,
      email: "alice@example.com",
      displayName: "Alice",
      isAdmin: false,
      createdAt: new Date("2025-01-01T00:00:00Z"),
    });
    state.interactions.push(
      { appUserId: "alice", kind: "tap", receivedAt: oneHourAgo },
      // Most recent — should drive lastActiveAt.
      { appUserId: "alice", kind: "tap", receivedAt: fiveMinAgo },
      { appUserId: "alice", kind: "tap", receivedAt: twoDaysAgo },
    );
    state.wellbeing.push(
      {
        appUserId: "alice",
        entry: {
          kind: "breathing",
          sessionName: "Box Breathing",
          durationSec: 240,
          mood: "calm",
          completedAt: now - 60 * 60 * 1000,
        },
        completedAtMs: now - 60 * 60 * 1000,
      },
      {
        appUserId: "alice",
        entry: {
          kind: "meditation",
          sessionName: "Mindful Pause",
          durationSec: 600,
          completedAt: now - 30 * 60 * 1000,
        },
        completedAtMs: now - 30 * 60 * 1000,
      },
    );
    state.feedback.push(
      {
        id: 1,
        appUserId: "alice",
        tier: "plus",
        feedbackType: "general",
        message: "older feedback",
        tags: [],
        allowTestimonialUse: false,
        platform: null,
        appVersion: null,
        createdAt: new Date(now - 7 * 24 * 3600 * 1000),
      },
      {
        id: 2,
        appUserId: "alice",
        tier: "plus",
        feedbackType: "testimonial",
        message: "loving this",
        tags: [],
        allowTestimonialUse: true,
        platform: null,
        appVersion: null,
        createdAt: new Date(now - 60 * 1000),
      },
    );

    const r = await fetch(
      `${baseUrl}/admin/users/lookup?email=alice@example.com`,
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      user: { lastActiveAt: string | null };
      recentSessions: Array<{ kind: string; sessionName: string | null }>;
      recentFeedback: Array<{ id: number; allowTestimonialUse: boolean }>;
    };

    // Most recent receivedAt was `fiveMinAgo`.
    expect(body.user.lastActiveAt).toBe(fiveMinAgo.toISOString());
    // Newest session first.
    expect(body.recentSessions).toHaveLength(2);
    expect(body.recentSessions[0]?.sessionName).toBe("Mindful Pause");
    expect(body.recentSessions[1]?.sessionName).toBe("Box Breathing");
    // Newest feedback first.
    expect(body.recentFeedback[0]?.id).toBe(2);
    expect(body.recentFeedback[0]?.allowTestimonialUse).toBe(true);
  });

  it("returns null lastActiveAt when the user has no events", async () => {
    state.users.push({
      appUserId: "lonely",
      clerkUserId: null,
      email: "lonely@example.com",
      displayName: null,
      isAdmin: false,
      createdAt: new Date(),
    });
    const r = await fetch(
      `${baseUrl}/admin/users/lookup?email=lonely@example.com`,
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      user: { lastActiveAt: string | null };
      recentSessions: unknown[];
      recentFeedback: unknown[];
    };
    expect(body.user.lastActiveAt).toBeNull();
    expect(body.recentSessions).toEqual([]);
    expect(body.recentFeedback).toEqual([]);
  });

  it("returns avatar/country/timezone from user_profile when present", async () => {
    state.users.push({
      appUserId: "alice",
      clerkUserId: null,
      email: "alice@example.com",
      displayName: "Alice",
      isAdmin: false,
      createdAt: new Date(),
    });
    state.userProfile.push({
      appUserId: "alice",
      avatar: "data:image/jpeg;base64,AAAA",
      country: "GB",
      timezone: "Europe/London",
    });
    const r = await fetch(
      `${baseUrl}/admin/users/lookup?email=alice@example.com`,
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      user: {
        avatar: string | null;
        country: string | null;
        timezone: string | null;
      };
    };
    expect(body.user.avatar).toBe("data:image/jpeg;base64,AAAA");
    expect(body.user.country).toBe("GB");
    expect(body.user.timezone).toBe("Europe/London");
  });

  it("returns null avatar/country/timezone when no user_profile row", async () => {
    state.users.push({
      appUserId: "lonely",
      clerkUserId: null,
      email: "lonely@example.com",
      displayName: null,
      isAdmin: false,
      createdAt: new Date(),
    });
    const r = await fetch(
      `${baseUrl}/admin/users/lookup?email=lonely@example.com`,
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      user: {
        avatar: string | null;
        country: string | null;
        timezone: string | null;
      };
    };
    expect(body.user.avatar).toBeNull();
    expect(body.user.country).toBeNull();
    expect(body.user.timezone).toBeNull();
  });

  it("404s when the email is unknown", async () => {
    const r = await fetch(`${baseUrl}/admin/users/lookup?email=nobody@x.com`);
    expect(r.status).toBe(404);
  });

  it("400s when email is missing or too short", async () => {
    const r = await fetch(`${baseUrl}/admin/users/lookup?email=ab`);
    expect(r.status).toBe(400);
  });

  it("does NOT treat `%` or `_` in the input as wildcards (escaped before ilike)", async () => {
    // Two users at the same domain so a regression that passed `%@x.com`
    // straight into `ilike` would happily match both — the data leak the
    // escape is preventing.
    state.users.push(
      {
        appUserId: "alice",
        clerkUserId: null,
        email: "alice@example.com",
        displayName: "Alice",
        isAdmin: false,
        createdAt: new Date(),
      },
      {
        appUserId: "bob",
        clerkUserId: null,
        email: "bob@example.com",
        displayName: "Bob",
        isAdmin: false,
        createdAt: new Date(),
      },
    );

    const wildcard = await fetch(
      `${baseUrl}/admin/users/lookup?email=${encodeURIComponent("%@example.com")}`,
    );
    expect(wildcard.status).toBe(404);

    const underscore = await fetch(
      `${baseUrl}/admin/users/lookup?email=${encodeURIComponent("_lice@example.com")}`,
    );
    expect(underscore.status).toBe(404);

    // Sanity check: literal exact match still resolves.
    const literal = await fetch(
      `${baseUrl}/admin/users/lookup?email=alice@example.com`,
    );
    expect(literal.status).toBe(200);
  });
});

/* -------------------------------------------------------------------------- *
 * GET /admin/audit — date range filtering
 * -------------------------------------------------------------------------- */

describe("GET /admin/audit", () => {
  const T0 = new Date("2024-01-10T00:00:00.000Z");
  const T1 = new Date("2024-01-15T12:00:00.000Z");
  const T2 = new Date("2024-01-20T00:00:00.000Z");
  const T3 = new Date("2024-01-25T00:00:00.000Z");

  function seedEvents() {
    state.auditEvents.push(
      {
        id: 1,
        actorAppUserId: "admin-1",
        targetAppUserId: "user-a",
        action: "account_deleted",
        payload: null,
        createdAt: T0,
      },
      {
        id: 2,
        actorAppUserId: "admin-1",
        targetAppUserId: "user-b",
        action: "test_account_provisioned",
        payload: null,
        createdAt: T1,
      },
      {
        id: 3,
        actorAppUserId: "admin-2",
        targetAppUserId: "user-a",
        action: "tester_data_reset",
        payload: null,
        createdAt: T2,
      },
      {
        id: 4,
        actorAppUserId: "admin-2",
        targetAppUserId: "user-c",
        action: "account_deleted",
        payload: null,
        createdAt: T3,
      },
    );
  }

  interface AuditResponse {
    items: Array<{
      id: number;
      actorAppUserId: string;
      targetAppUserId: string | null;
      action: string;
      createdAt: string;
    }>;
    total: number;
    limit: number;
    offset: number;
  }

  async function getAudit(query: string): Promise<{ status: number; body: AuditResponse }> {
    const r = await fetch(`${baseUrl}/admin/audit?${query}`);
    const body = (await r.json()) as AuditResponse;
    return { status: r.status, body };
  }

  it("returns all events when no filters are applied", async () => {
    seedEvents();
    const { status, body } = await getAudit("limit=200");
    expect(status).toBe(200);
    expect(body.total).toBe(4);
    expect(body.items).toHaveLength(4);
  });

  it("`from` alone excludes events before the date (inclusive lower bound)", async () => {
    seedEvents();
    const { status, body } = await getAudit(
      `from=${encodeURIComponent("2024-01-15T12:00:00.000Z")}&limit=200`,
    );
    expect(status).toBe(200);
    const ids = body.items.map((e) => e.id).sort();
    expect(ids).toEqual([2, 3, 4]);
    expect(body.total).toBe(3);
  });

  it("`to` alone excludes events after the date (inclusive upper bound)", async () => {
    seedEvents();
    const { status, body } = await getAudit(
      `to=${encodeURIComponent("2024-01-20T00:00:00.000Z")}&limit=200`,
    );
    expect(status).toBe(200);
    const ids = body.items.map((e) => e.id).sort();
    expect(ids).toEqual([1, 2, 3]);
    expect(body.total).toBe(3);
  });

  it("combined `from` + `to` window returns only events within the range", async () => {
    seedEvents();
    const { status, body } = await getAudit(
      `from=${encodeURIComponent("2024-01-15T12:00:00.000Z")}&to=${encodeURIComponent("2024-01-20T00:00:00.000Z")}&limit=200`,
    );
    expect(status).toBe(200);
    const ids = body.items.map((e) => e.id).sort();
    expect(ids).toEqual([2, 3]);
    expect(body.total).toBe(2);
  });

  it("window with no matching events returns empty items and total=0", async () => {
    seedEvents();
    const { status, body } = await getAudit(
      `from=${encodeURIComponent("2025-01-01T00:00:00.000Z")}&to=${encodeURIComponent("2025-01-02T00:00:00.000Z")}&limit=200`,
    );
    expect(status).toBe(200);
    expect(body.items).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it("combines `from`/`to` with `action` filter — window excludes one matching action event", async () => {
    seedEvents();
    // account_deleted events are at T0 (id=1) and T3 (id=4).
    // Narrowing to T0–T2 should include only id=1, proving the date filter
    // is applied on top of the action filter (not silently ignored).
    const { status, body } = await getAudit(
      `from=${encodeURIComponent("2024-01-10T00:00:00.000Z")}&to=${encodeURIComponent("2024-01-20T00:00:00.000Z")}&action=account_deleted&limit=200`,
    );
    expect(status).toBe(200);
    const ids = body.items.map((e) => e.id).sort();
    expect(ids).toEqual([1]);
    expect(body.total).toBe(1);
  });

  it("combines `from`/`to` with `targetAppUserId` filter — window excludes one matching target event", async () => {
    seedEvents();
    // user-a events are at T0 (id=1) and T2 (id=3).
    // Starting from T1 (after T0) should return only id=3, proving the date
    // filter is applied on top of the targetAppUserId filter.
    const { status, body } = await getAudit(
      `from=${encodeURIComponent("2024-01-11T00:00:00.000Z")}&to=${encodeURIComponent("2024-01-25T00:00:00.000Z")}&targetAppUserId=user-a&limit=200`,
    );
    expect(status).toBe(200);
    const ids = body.items.map((e) => e.id).sort();
    expect(ids).toEqual([3]);
    expect(body.total).toBe(1);
  });

  it("known `actorAppUserId` returns only events performed by that actor", async () => {
    seedEvents();
    // admin-1 performed events id=1 and id=2; admin-2 performed id=3 and id=4.
    const { status, body } = await getAudit("actorAppUserId=admin-1&limit=200");
    expect(status).toBe(200);
    const ids = body.items.map((e) => e.id).sort();
    expect(ids).toEqual([1, 2]);
    expect(body.total).toBe(2);
    expect(body.items.every((e) => e.actorAppUserId === "admin-1")).toBe(true);
  });

  it("unknown `actorAppUserId` returns empty items and total=0", async () => {
    seedEvents();
    const { status, body } = await getAudit("actorAppUserId=nobody&limit=200");
    expect(status).toBe(200);
    expect(body.items).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it("combined `actorAppUserId` + date range returns correctly filtered results", async () => {
    seedEvents();
    // admin-2 events are at T2 (id=3) and T3 (id=4).
    // Narrowing the window to T2–T2 (inclusive) should return only id=3,
    // proving the date filter compounds with the actorAppUserId filter.
    const { status, body } = await getAudit(
      `actorAppUserId=admin-2&from=${encodeURIComponent("2024-01-20T00:00:00.000Z")}&to=${encodeURIComponent("2024-01-20T00:00:00.000Z")}&limit=200`,
    );
    expect(status).toBe(200);
    const ids = body.items.map((e) => e.id).sort();
    expect(ids).toEqual([3]);
    expect(body.total).toBe(1);
  });

  it("returns 400 when `from` is not a valid ISO date", async () => {
    const { status } = await getAudit("from=not-a-date");
    expect(status).toBe(400);
  });

  it("returns 400 when `to` is not a valid ISO date", async () => {
    const { status } = await getAudit("to=banana");
    expect(status).toBe(400);
  });

  it("results are ordered newest-first", async () => {
    seedEvents();
    const { status, body } = await getAudit("limit=200");
    expect(status).toBe(200);
    const timestamps = body.items.map((e) => new Date(e.createdAt).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i - 1]!).toBeGreaterThanOrEqual(timestamps[i]!);
    }
  });

  it("limit=2 returns only 2 items but total reflects the full seeded count", async () => {
    seedEvents();
    const { status, body } = await getAudit("limit=2");
    expect(status).toBe(200);
    // Only the first page of items is returned…
    expect(body.items).toHaveLength(2);
    // …but total always reflects the unsliced count.
    expect(body.total).toBe(4);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(0);
  });

  it("offset skips the expected rows and returns the correct page-2 items", async () => {
    seedEvents();
    // Newest-first order: id=4 (T3), id=3 (T2), id=2 (T1), id=1 (T0).
    // Page 1 (offset=0, limit=2): ids 4, 3.
    // Page 2 (offset=2, limit=2): ids 2, 1.
    const { status, body } = await getAudit("limit=2&offset=2");
    expect(status).toBe(200);
    expect(body.items).toHaveLength(2);
    const ids = body.items.map((e) => e.id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2]);
    // total is still the full count, not just the page size.
    expect(body.total).toBe(4);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(2);
  });

  it("returns 400 when limit is 0 (below minimum)", async () => {
    const { status } = await getAudit("limit=0");
    expect(status).toBe(400);
  });

  it("returns 400 when limit exceeds the maximum (201)", async () => {
    const { status } = await getAudit("limit=201");
    expect(status).toBe(400);
  });
});
