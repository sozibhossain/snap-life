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

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

interface SubscribersRow {
  appUserId: string;
  entitlementId: string;
  isActive: boolean;
  productId: string | null;
  periodType: string | null;
  store: string | null;
  willRenew: boolean;
  isInTrial: boolean;
  originalPurchaseAt: Date | null;
  latestPurchaseAt: Date | null;
  expiresAt: Date | null;
  unsubscribeDetectedAt: Date | null;
  cancelledAt: Date | null;
  rawCustomerInfo: unknown;
  /** "server" → granted at registration, "store" → RC-mirrored trial. */
  trialSource?: "server" | "store" | null;
  /** End of the server-managed trial. Cleared on real RC writes. */
  trialEndsAt?: Date | null;
  /** When a BILLING_ISSUE webhook opened a payment-failed grace window. */
  billingIssueAt?: Date | null;
  /** End of the BILLING_ISSUE grace window. */
  gracePeriodEndsAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface PendingEmailRow {
  kind: string;
  toAddress: string;
  externalId?: string | null;
  payload: unknown;
}
const pendingEmailsState: {
  inserts: PendingEmailRow[];
  /** externalIds already persisted — mirrors the DB unique partial index. */
  seen: Set<string>;
} = { inserts: [], seen: new Set() };

interface UpsertCall {
  action: "inserted" | "updated";
  values: SubscribersRow;
}

const userTokensState: { tokens: Map<string, string> } = {
  tokens: new Map<string, string>(),
};
const subscribersState: { rows: Map<string, SubscribersRow> } = {
  rows: new Map(),
};
const upsertCalls: UpsertCall[] = [];
const billingIssueUpdates: Array<{
  appUserId: string;
  set: Partial<SubscribersRow>;
}> = [];

interface SubscriptionEventRow {
  eventId: string;
  eventType: string;
  appUserId: string;
  productId: string | null;
  environment: string | null;
  payload: unknown;
}
// Webhook event-log dedup is enforced by `onConflictDoNothing(eventId)`.
// We track every insertion attempt (to assert dedup behaviour) and the
// final stored set keyed by eventId (to assert the row is only persisted
// once across re-deliveries).
const subscriptionEventsState: {
  attempts: SubscriptionEventRow[];
  stored: Map<string, SubscriptionEventRow>;
} = { attempts: [], stored: new Map() };

vi.mock("@workspace/db", () => {
  // Object sentinels distinguish each table inside chained query builders.
  const subscribersTable = {
    __table: "subscribers",
    appUserId: { __col: "appUserId" },
    latestPurchaseAt: { __col: "latestPurchaseAt" },
    entitlementId: { __col: "entitlementId" },
  } as const;
  const subscriptionEventsTable = { __table: "subscription_events" } as const;
  const pendingEmailsTable = {
    __table: "pending_emails",
    kind: { __col: "kind" },
    toAddress: { __col: "toAddress" },
  } as const;
  const userTokensTable = {
    __table: "user_tokens",
    appUserId: { __col: "appUserId" },
    token: { __col: "token" },
    lastUsedAt: { __col: "lastUsedAt" },
  } as const;

  function pickStringArg(cond: { args?: unknown[] } | undefined): string | undefined {
    const args = cond?.args ?? [];
    return args.find((a): a is string => typeof a === "string");
  }

  function selectChain(_cols?: unknown) {
    return {
      from: (tbl: unknown) => ({
        where: (cond: { args?: unknown[] } | undefined) => ({
          limit: async (_n: number) => {
            if (tbl === userTokensTable) {
              const token = pickStringArg(cond);
              if (!token) return [];
              const userId = userTokensState.tokens.get(token);
              return userId ? [{ appUserId: userId }] : [];
            }
            if (tbl === subscribersTable) {
              const userId = pickStringArg(cond);
              if (!userId) return [];
              const row = subscribersState.rows.get(userId);
              return row ? [row] : [];
            }
            return [];
          },
        }),
      }),
    };
  }

  // BILLING_ISSUE branch reads the subscribers row via .from().where().limit()
  // (no `.select(cols)` cols object is passed in the path we care about,
  // but the chain shape is identical to the auth path above).

  const db = {
    select: (cols?: unknown) => selectChain(cols),
    insert: (tbl: unknown) => ({
      values: (row: SubscribersRow | SubscriptionEventRow | PendingEmailRow) => {
        // pending_emails inserts use .onConflictDoNothing() keyed by
        // externalId, mirroring the DB-level unique partial index. Track
        // every attempt AND whether the dedup constraint fires.
        if (tbl === pendingEmailsTable) {
          const emailRow = row as PendingEmailRow;
          return {
            onConflictDoNothing: async () => {
              const key = emailRow.externalId ?? null;
              if (key !== null && pendingEmailsState.seen.has(key)) {
                // Simulate conflict — row silently skipped.
                return;
              }
              pendingEmailsState.inserts.push(emailRow);
              if (key !== null) pendingEmailsState.seen.add(key);
            },
          };
        }
        return {
          onConflictDoUpdate: async (_opts: unknown) => {
            if (tbl !== subscribersTable) return;
            const subRow = row as SubscribersRow;
            const existing = subscribersState.rows.get(subRow.appUserId);
            subscribersState.rows.set(subRow.appUserId, {
              ...subRow,
              createdAt: existing?.createdAt ?? new Date(),
            });
            upsertCalls.push({
              action: existing ? "updated" : "inserted",
              values: subRow,
            });
          },
          // Webhook handler dedupes event-log inserts by eventId. Track every
          // attempt (so we can assert the route still tried to log a duplicate)
          // but persist only the first.
          onConflictDoNothing: async (_opts: unknown) => {
            if (tbl !== subscriptionEventsTable) return;
            const evRow = row as SubscriptionEventRow;
            subscriptionEventsState.attempts.push(evRow);
            if (!subscriptionEventsState.stored.has(evRow.eventId)) {
              subscriptionEventsState.stored.set(evRow.eventId, evRow);
            }
          },
        };
      },
    }),
    // Two callers exercise db.update:
    //   - auth's best-effort `lastUsedAt` refresh — fire-and-forget,
    //     uses a trailing `.catch(() => {})` (no await, expects a
    //     synchronous object with a `.catch` method).
    //   - BILLING_ISSUE webhook branch — `await`-ed directly on the
    //     `.where()` return value, which must be a thenable.
    // Branch by table so both shapes keep compiling without one mock
    // shape leaking into the other path.
    update: (tbl: unknown) => ({
      set: (setVals: unknown) => ({
        where: (cond: { args?: unknown[] } | undefined) => {
          if (tbl !== subscribersTable) {
            // Auth's lastUsedAt refresh — return a fire-and-forget
            // chain object whose .catch resolves immediately.
            return {
              catch: (_fn: (e: unknown) => void) => Promise.resolve(),
            };
          }
          // BILLING_ISSUE branch — apply the patch synchronously and
          // return a resolved Promise so `await` completes immediately.
          const args = cond?.args ?? [];
          const userId = args.find(
            (a): a is string => typeof a === "string",
          );
          if (userId) {
            const existing = subscribersState.rows.get(userId);
            if (existing) {
              const patch = setVals as Partial<SubscribersRow>;
              subscribersState.rows.set(userId, { ...existing, ...patch });
              billingIssueUpdates.push({ appUserId: userId, set: patch });
            }
          }
          return Promise.resolve();
        },
      }),
    }),
  };

  const usersTable = {
    __table: "users",
    appUserId: { __col: "users.appUserId" },
    isAdmin: { __col: "users.isAdmin" },
  } as const;
  return {
    db,
    subscribersTable,
    subscriptionEventsTable,
    pendingEmailsTable,
    userTokensTable,
    usersTable,
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ kind: "and", args }),
  eq: (...args: unknown[]) => ({ kind: "eq", args }),
  gte: (...args: unknown[]) => ({ kind: "gte", args }),
  sql: Object.assign(
    (..._args: unknown[]) => ({ kind: "sql" }),
    { raw: (..._args: unknown[]) => ({ kind: "sql.raw" }) },
  ),
}));

// Control state for the RevenueCat REST client mock.
interface RcMockState {
  activeEntitlementsImpl: (appUserId: string) => Promise<
    Array<{ entitlement_id: string; expires_at: number | null }>
  >;
  subscriptionsImpl: (appUserId: string) => Promise<unknown[]>;
}
const rcState: RcMockState = {
  activeEntitlementsImpl: async () => [],
  subscriptionsImpl: async () => [],
};
const rcCalls: { active: string[]; subs: string[] } = { active: [], subs: [] };

vi.mock("../../lib/revenuecatRest", () => ({
  listCustomerActiveEntitlements: async (appUserId: string) => {
    rcCalls.active.push(appUserId);
    return rcState.activeEntitlementsImpl(appUserId);
  },
  listCustomerSubscriptions: async (appUserId: string) => {
    rcCalls.subs.push(appUserId);
    return rcState.subscriptionsImpl(appUserId);
  },
}));

// Import after mocks are wired up.
const { default: revenuecatRouter, isUpsertStale } = await import("../revenuecat");

// ---------------------------------------------------------------------------
// Pure helper — monotonicity decision
// ---------------------------------------------------------------------------

describe("isUpsertStale (monotonicity guard)", () => {
  const T1 = new Date("2026-04-01T00:00:00.000Z");
  const T2 = new Date("2026-04-15T00:00:00.000Z");
  const T3 = new Date("2026-04-28T00:00:00.000Z");

  it("is not stale on first write (no existing row)", () => {
    expect(isUpsertStale(null, T1)).toBe(false);
    expect(isUpsertStale(null, null)).toBe(false);
  });

  it("is not stale when incoming is strictly newer than existing", () => {
    expect(isUpsertStale(T1, T2)).toBe(false);
    expect(isUpsertStale(T1, T3)).toBe(false);
  });

  it("is stale when incoming is strictly older than existing", () => {
    expect(isUpsertStale(T2, T1)).toBe(true);
    expect(isUpsertStale(T3, T1)).toBe(true);
  });

  it("is not stale when incoming and existing are equal (idempotent re-write)", () => {
    expect(isUpsertStale(T2, new Date(T2.getTime()))).toBe(false);
  });

  it("is stale when incoming has no timestamp but existing does", () => {
    // Defends against a partial sync (e.g. RevenueCat subscriptions endpoint
    // failed) clobbering a complete webhook row with nulls.
    expect(isUpsertStale(T2, null)).toBe(true);
    expect(isUpsertStale(T1, null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HTTP integration — POST /revenuecat/sync
// ---------------------------------------------------------------------------

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use(revenuecatRouter);
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
  subscribersState.rows.clear();
  upsertCalls.length = 0;
  billingIssueUpdates.length = 0;
  pendingEmailsState.inserts.length = 0;
  pendingEmailsState.seen.clear();
  subscriptionEventsState.attempts.length = 0;
  subscriptionEventsState.stored.clear();
  rcCalls.active.length = 0;
  rcCalls.subs.length = 0;
  rcState.activeEntitlementsImpl = async () => [];
  rcState.subscriptionsImpl = async () => [];
});

async function postSync(opts: { token?: string | null } = {}): Promise<{
  status: number;
  json: Record<string, unknown> | null;
}> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = opts.token === undefined ? "valid-token" : opts.token;
  if (token != null) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}/revenuecat/sync`, {
    method: "POST",
    headers,
    body: "{}",
  });
  return {
    status: res.status,
    json: (await res.json().catch(() => null)) as Record<string, unknown> | null,
  };
}

describe("POST /revenuecat/sync — stale-sync skip (monotonicity guard)", () => {
  it("does not regress a fresher webhook-written row when the sync purchase is older", async () => {
    // Fresher state already on disk (e.g. written by the webhook).
    const fresherPurchaseAt = new Date("2026-04-28T00:00:00.000Z");
    subscribersState.rows.set("user-1", {
      appUserId: "user-1",
      entitlementId: "snap_premium",
      isActive: true,
      productId: "premium_monthly",
      periodType: "NORMAL",
      store: "APP_STORE",
      willRenew: true,
      isInTrial: false,
      originalPurchaseAt: fresherPurchaseAt,
      latestPurchaseAt: fresherPurchaseAt,
      expiresAt: new Date("2026-05-28T00:00:00.000Z"),
      unsubscribeDetectedAt: null,
      cancelledAt: null,
      rawCustomerInfo: { source: "webhook" },
    });

    // RevenueCat reports an older purchase (e.g. the sync call raced behind
    // the webhook). The route should detect the regression and skip the write.
    rcState.activeEntitlementsImpl = async () => [
      { entitlement_id: "snap_premium", expires_at: 1_777_000_000_000 },
    ];
    rcState.subscriptionsImpl = async () => [
      {
        id: "sub-old",
        product_id: "premium_monthly",
        starts_at: new Date("2026-04-01T00:00:00.000Z").getTime(),
        current_period_starts_at: new Date("2026-04-01T00:00:00.000Z").getTime(),
        current_period_ends_at: new Date("2026-05-01T00:00:00.000Z").getTime(),
        gives_access: true,
        auto_renewal_status: "will_renew",
        status: "active",
        store: "app_store",
        entitlements: { items: [{ id: "snap_premium" }] },
      },
    ];

    const res = await postSync();

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, action: "skipped-stale" });
    // The route still reports the entitlement to the caller so the client
    // unlocks Premium, but no DB write happened — the existing row is
    // preserved exactly as the webhook wrote it.
    expect(upsertCalls).toHaveLength(0);
    expect(subscribersState.rows.get("user-1")?.rawCustomerInfo).toEqual({
      source: "webhook",
    });
  });
});

describe("POST /revenuecat/sync — fresh-sync upsert", () => {
  it("inserts a new subscriber row from the active entitlement + subscription", async () => {
    const startedAt = new Date("2026-04-20T00:00:00.000Z").getTime();
    const periodEndsAt = new Date("2026-05-20T00:00:00.000Z").getTime();
    rcState.activeEntitlementsImpl = async () => [
      { entitlement_id: "snap_premium", expires_at: periodEndsAt },
    ];
    rcState.subscriptionsImpl = async () => [
      {
        id: "sub-new",
        product_id: "premium_monthly",
        starts_at: startedAt,
        current_period_starts_at: startedAt,
        current_period_ends_at: periodEndsAt,
        gives_access: true,
        auto_renewal_status: "will_renew",
        status: "active",
        store: "app_store",
        entitlements: { items: [{ id: "snap_premium" }] },
      },
    ];

    const res = await postSync();

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      ok: true,
      action: "inserted",
      entitlement: {
        id: "snap_premium",
        isActive: true,
        isInTrial: false,
        willRenew: true,
        productId: "premium_monthly",
        store: "APP_STORE",
        expiresAt: new Date(periodEndsAt).toISOString(),
      },
    });
    expect(upsertCalls).toHaveLength(1);
    const written = upsertCalls[0]!.values;
    expect(written).toMatchObject({
      appUserId: "user-1",
      entitlementId: "snap_premium",
      isActive: true,
      productId: "premium_monthly",
      periodType: "NORMAL",
      store: "APP_STORE",
      willRenew: true,
      isInTrial: false,
    });
    expect(written.latestPurchaseAt?.getTime()).toBe(startedAt);
    expect(written.originalPurchaseAt?.getTime()).toBe(startedAt);
    expect(written.expiresAt?.getTime()).toBe(periodEndsAt);
  });

  it("prefers snap_premium over snap_plus when both are active", async () => {
    rcState.activeEntitlementsImpl = async () => [
      { entitlement_id: "snap_plus", expires_at: 1_900_000_000_000 },
      { entitlement_id: "snap_premium", expires_at: 1_900_000_000_000 },
    ];
    rcState.subscriptionsImpl = async () => [
      {
        id: "sub-prem",
        product_id: "premium_monthly",
        starts_at: 1_800_000_000_000,
        current_period_starts_at: 1_800_000_000_000,
        current_period_ends_at: 1_900_000_000_000,
        gives_access: true,
        auto_renewal_status: "will_renew",
        status: "active",
        store: "play_store",
        entitlements: { items: [{ id: "snap_premium" }] },
      },
    ];

    const res = await postSync();
    expect(res.status).toBe(200);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]!.values.entitlementId).toBe("snap_premium");
    const entitlement = (res.json?.entitlement as { id: string }).id;
    expect(entitlement).toBe("snap_premium");
  });
});

describe("POST /revenuecat/sync — RevenueCat 404 (unknown customer)", () => {
  it("returns 200 with entitlement: null and writes nothing", async () => {
    rcState.activeEntitlementsImpl = async () => {
      const err = new Error("RevenueCat 404 for /…/customers/foo/active_entitlements: Not found") as Error & { status?: number };
      err.status = 404;
      throw err;
    };

    const res = await postSync();

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, entitlement: null });
    // Subscriptions endpoint should never be reached when the customer
    // lookup itself 404s.
    expect(rcCalls.subs).toEqual([]);
    expect(upsertCalls).toHaveLength(0);
  });

  it("returns 502 (not 200) when the upstream fails for a non-404 reason", async () => {
    // Sanity-check the fallback is scoped strictly to 404 — a 500 from
    // RevenueCat must not be silently swallowed as 'no entitlement'.
    rcState.activeEntitlementsImpl = async () => {
      const err = new Error("RevenueCat 500 for /…: server error") as Error & { status?: number };
      err.status = 500;
      throw err;
    };

    const res = await postSync();

    expect(res.status).toBe(502);
    expect(res.json).toMatchObject({ error: "revenuecat upstream error" });
    expect(upsertCalls).toHaveLength(0);
  });
});

describe("POST /revenuecat/sync — no active entitlement", () => {
  it("returns entitlement: null and writes nothing when active_entitlements is empty", async () => {
    rcState.activeEntitlementsImpl = async () => [];

    const res = await postSync();

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, entitlement: null });
    // Critically, we do NOT write isActive: false here — the webhook owns
    // entitlement loss with full event context. A no-op response keeps the
    // existing row intact.
    expect(upsertCalls).toHaveLength(0);
    // Subscriptions lookup is also skipped — there's nothing to enrich.
    expect(rcCalls.subs).toEqual([]);
  });

  it("ignores entitlements we don't recognise (e.g. legacy / non-premium tiers)", async () => {
    rcState.activeEntitlementsImpl = async () => [
      { entitlement_id: "snap_basic_legacy", expires_at: 1_900_000_000_000 },
    ];

    const res = await postSync();

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, entitlement: null });
    expect(upsertCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// HTTP integration — POST /revenuecat/webhook
// ---------------------------------------------------------------------------

const WEBHOOK_SECRET = "test-webhook-shared-secret";

async function postWebhook(opts: {
  body?: unknown;
  authorization?: string | null;
} = {}): Promise<{
  status: number;
  json: Record<string, unknown> | null;
}> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.authorization === undefined) {
    headers.authorization = `Bearer ${WEBHOOK_SECRET}`;
  } else if (opts.authorization !== null) {
    headers.authorization = opts.authorization;
  }
  const res = await fetch(`${baseUrl}/revenuecat/webhook`, {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
  return {
    status: res.status,
    json: (await res.json().catch(() => null)) as Record<string, unknown> | null,
  };
}

function buildEvent(overrides: Record<string, unknown> = {}): { event: Record<string, unknown> } {
  return {
    event: {
      id: "evt-1",
      type: "INITIAL_PURCHASE",
      app_user_id: "user-1",
      product_id: "premium_monthly",
      environment: "PRODUCTION",
      store: "APP_STORE",
      period_type: "NORMAL",
      entitlement_ids: ["snap_premium"],
      purchased_at_ms: new Date("2026-04-20T00:00:00.000Z").getTime(),
      expiration_at_ms: new Date("2026-05-20T00:00:00.000Z").getTime(),
      ...overrides,
    },
  };
}

describe("POST /revenuecat/webhook — shared-secret auth", () => {
  const previousSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
  beforeAll(() => {
    process.env.REVENUECAT_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });
  afterAll(() => {
    if (previousSecret === undefined) {
      delete process.env.REVENUECAT_WEBHOOK_SECRET;
    } else {
      process.env.REVENUECAT_WEBHOOK_SECRET = previousSecret;
    }
  });

  it("rejects requests without an Authorization header (401, no DB writes)", async () => {
    const res = await postWebhook({ body: buildEvent(), authorization: null });
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ error: "unauthorized" });
    // Auth runs before any DB access — neither table should be touched.
    expect(upsertCalls).toHaveLength(0);
    expect(subscriptionEventsState.attempts).toHaveLength(0);
    expect(subscribersState.rows.size).toBe(0);
  });

  it("rejects requests with the wrong Bearer token (401, no DB writes)", async () => {
    const res = await postWebhook({
      body: buildEvent(),
      authorization: "Bearer not-the-real-secret",
    });
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ error: "unauthorized" });
    expect(upsertCalls).toHaveLength(0);
    expect(subscriptionEventsState.attempts).toHaveLength(0);
    expect(subscribersState.rows.size).toBe(0);
  });
});

describe("POST /revenuecat/webhook — entitlement state derivation", () => {
  const previousSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
  beforeAll(() => {
    process.env.REVENUECAT_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });
  afterAll(() => {
    if (previousSecret === undefined) {
      delete process.env.REVENUECAT_WEBHOOK_SECRET;
    } else {
      process.env.REVENUECAT_WEBHOOK_SECRET = previousSecret;
    }
  });

  it("ACTIVE event (INITIAL_PURCHASE) for snap_premium inserts an active row", async () => {
    const res = await postWebhook({ body: buildEvent({ id: "evt-active-1" }) });

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, action: "inserted" });
    expect(upsertCalls).toHaveLength(1);
    const written = upsertCalls[0]!.values;
    expect(written).toMatchObject({
      appUserId: "user-1",
      entitlementId: "snap_premium",
      isActive: true,
      productId: "premium_monthly",
      periodType: "NORMAL",
      store: "APP_STORE",
      // ACTIVE_TYPES are neither cancelled nor lost, so renewal stays on
      // and there's no cancellation timestamp.
      willRenew: true,
      cancelledAt: null,
    });
    // Event log row was created exactly once.
    expect(subscriptionEventsState.stored.size).toBe(1);
    expect(subscriptionEventsState.stored.get("evt-active-1")).toMatchObject({
      eventId: "evt-active-1",
      eventType: "INITIAL_PURCHASE",
      appUserId: "user-1",
    });
  });

  it("INACTIVE event (EXPIRATION) flips an existing active row to isActive: false", async () => {
    // Seed prior ACTIVE state so we can assert it gets flipped.
    const priorPurchaseAt = new Date("2026-03-01T00:00:00.000Z");
    subscribersState.rows.set("user-1", {
      appUserId: "user-1",
      entitlementId: "snap_premium",
      isActive: true,
      productId: "premium_monthly",
      periodType: "NORMAL",
      store: "APP_STORE",
      willRenew: true,
      isInTrial: false,
      originalPurchaseAt: priorPurchaseAt,
      latestPurchaseAt: priorPurchaseAt,
      expiresAt: new Date("2026-04-01T00:00:00.000Z"),
      unsubscribeDetectedAt: null,
      cancelledAt: null,
      rawCustomerInfo: { source: "webhook" },
    });

    const res = await postWebhook({
      body: buildEvent({
        id: "evt-expire",
        type: "EXPIRATION",
        // Older-than-prior expiration; purchase moves forward so the
        // monotonicity guard does NOT skip this write.
        expiration_at_ms: new Date("2026-04-15T00:00:00.000Z").getTime(),
        purchased_at_ms: new Date("2026-04-15T00:00:00.000Z").getTime(),
      }),
    });

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, action: "updated" });
    expect(upsertCalls).toHaveLength(1);
    const written = upsertCalls[0]!.values;
    expect(written.isActive).toBe(false);
    // Lost-entitlement events also stop renewal.
    expect(written.willRenew).toBe(false);
  });

  it("CANCELLATION with future expiry keeps isActive: true and writes cancelledAt", async () => {
    const futureExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // +30 days
    const purchasedMs = Date.now() - 1_000; // strictly newer than null-existing

    const res = await postWebhook({
      body: buildEvent({
        id: "evt-cancel",
        type: "CANCELLATION",
        cancel_reason: "CUSTOMER_SUPPORT",
        purchased_at_ms: purchasedMs,
        expiration_at_ms: futureExpiry,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, action: "inserted" });
    expect(upsertCalls).toHaveLength(1);
    const written = upsertCalls[0]!.values;
    // User cancelled but still has access until the future expiry.
    expect(written.isActive).toBe(true);
    // Cancellation always disables renewal.
    expect(written.willRenew).toBe(false);
    // Both signals must be present so support can distinguish "lost access"
    // from "cancelled but still entitled".
    expect(written.cancelledAt).toBeInstanceOf(Date);
    expect(written.unsubscribeDetectedAt).toBeInstanceOf(Date);
    expect(written.expiresAt?.getTime()).toBe(futureExpiry);
  });
});

describe("POST /revenuecat/webhook — entitlement-scope filtering", () => {
  const previousSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
  beforeAll(() => {
    process.env.REVENUECAT_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });
  afterAll(() => {
    if (previousSecret === undefined) {
      delete process.env.REVENUECAT_WEBHOOK_SECRET;
    } else {
      process.env.REVENUECAT_WEBHOOK_SECRET = previousSecret;
    }
  });

  it("ignores events whose entitlement_ids reference none of our entitlements", async () => {
    const res = await postWebhook({
      body: buildEvent({
        id: "evt-foreign-entitlement",
        entitlement_ids: ["some_other_app_entitlement", "legacy_basic"],
      }),
    });

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, ignored: "entitlement-scope" });
    // Critically, no DB writes happen for foreign entitlements — neither
    // the subscriber row NOR the event log (we don't pollute the audit
    // table with events that aren't ours).
    expect(upsertCalls).toHaveLength(0);
    expect(subscriptionEventsState.attempts).toHaveLength(0);
    expect(subscribersState.rows.size).toBe(0);
  });
});

describe("POST /revenuecat/webhook — re-delivery dedup", () => {
  const previousSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
  beforeAll(() => {
    process.env.REVENUECAT_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });
  afterAll(() => {
    if (previousSecret === undefined) {
      delete process.env.REVENUECAT_WEBHOOK_SECRET;
    } else {
      process.env.REVENUECAT_WEBHOOK_SECRET = previousSecret;
    }
  });

  it("does not double-insert the event-log row on re-delivery of the same event.id", async () => {
    const body = buildEvent({ id: "evt-dup" });

    // First delivery: row should land in the event log.
    const first = await postWebhook({ body });
    expect(first.status).toBe(200);
    expect(subscriptionEventsState.stored.size).toBe(1);

    // Second delivery (same event.id): the route still calls insert, but
    // `onConflictDoNothing(eventId)` keeps the stored set at exactly one.
    const second = await postWebhook({ body });
    expect(second.status).toBe(200);
    expect(subscriptionEventsState.attempts).toHaveLength(2);
    expect(subscriptionEventsState.stored.size).toBe(1);
    // The originally stored row is preserved unchanged.
    expect(subscriptionEventsState.stored.get("evt-dup")?.eventId).toBe("evt-dup");
  });
});

describe("POST /revenuecat/webhook — out-of-order delivery (monotonicity guard)", () => {
  const previousSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
  beforeAll(() => {
    process.env.REVENUECAT_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });
  afterAll(() => {
    if (previousSecret === undefined) {
      delete process.env.REVENUECAT_WEBHOOK_SECRET;
    } else {
      process.env.REVENUECAT_WEBHOOK_SECRET = previousSecret;
    }
  });

  it("skips a webhook whose purchased_at_ms is older than the stored latestPurchaseAt", async () => {
    const fresherPurchaseAt = new Date("2026-04-28T00:00:00.000Z");
    subscribersState.rows.set("user-1", {
      appUserId: "user-1",
      entitlementId: "snap_premium",
      isActive: true,
      productId: "premium_monthly",
      periodType: "NORMAL",
      store: "APP_STORE",
      willRenew: true,
      isInTrial: false,
      originalPurchaseAt: fresherPurchaseAt,
      latestPurchaseAt: fresherPurchaseAt,
      expiresAt: new Date("2026-05-28T00:00:00.000Z"),
      unsubscribeDetectedAt: null,
      cancelledAt: null,
      rawCustomerInfo: { source: "webhook" },
    });

    const res = await postWebhook({
      body: buildEvent({
        id: "evt-late",
        type: "RENEWAL",
        // Strictly older than what's already stored — must be skipped.
        purchased_at_ms: new Date("2026-04-01T00:00:00.000Z").getTime(),
        expiration_at_ms: new Date("2026-05-01T00:00:00.000Z").getTime(),
      }),
    });

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, action: "skipped-stale" });
    // Event log still records the late delivery (audit trail), but the
    // subscriber row is untouched.
    expect(subscriptionEventsState.stored.size).toBe(1);
    expect(upsertCalls).toHaveLength(0);
    const stored = subscribersState.rows.get("user-1");
    expect(stored?.latestPurchaseAt?.getTime()).toBe(fresherPurchaseAt.getTime());
    expect(stored?.rawCustomerInfo).toEqual({ source: "webhook" });
  });
});

describe("POST /revenuecat/webhook — customer-scoped events (no entitlement_ids)", () => {
  const previousSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
  beforeAll(() => {
    process.env.REVENUECAT_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });
  afterAll(() => {
    if (previousSecret === undefined) {
      delete process.env.REVENUECAT_WEBHOOK_SECRET;
    } else {
      process.env.REVENUECAT_WEBHOOK_SECRET = previousSecret;
    }
  });

  it("retains the stored entitlementId when an existing row receives a customer-scoped event", async () => {
    // Seed an existing snap_plus row written by a prior purchase webhook.
    // The customer-scoped event below carries no entitlement_ids, so the
    // handler must fall back to whatever entitlement the row already has
    // rather than inventing one (or worse, downgrading to snap_premium by
    // mistake). We deliberately seed snap_plus — not snap_premium — so the
    // assertion would catch a regression that hard-coded the higher tier.
    const priorPurchaseAt = new Date("2026-03-01T00:00:00.000Z");
    subscribersState.rows.set("user-1", {
      appUserId: "user-1",
      entitlementId: "snap_plus",
      isActive: true,
      productId: "plus_monthly",
      periodType: "NORMAL",
      store: "APP_STORE",
      willRenew: true,
      isInTrial: false,
      originalPurchaseAt: priorPurchaseAt,
      latestPurchaseAt: priorPurchaseAt,
      expiresAt: new Date("2026-04-01T00:00:00.000Z"),
      unsubscribeDetectedAt: null,
      cancelledAt: null,
      rawCustomerInfo: { source: "webhook" },
    });

    // SUBSCRIBER_ALIAS is the canonical "no entitlement context" event:
    // RevenueCat is just telling us two app_user_ids point at the same
    // customer record. It still updates the customer row but carries no
    // entitlement_ids — exercising the fallback branch in the handler.
    const purchasedMs = new Date("2026-04-15T00:00:00.000Z").getTime();
    const res = await postWebhook({
      body: buildEvent({
        id: "evt-alias",
        type: "SUBSCRIBER_ALIAS",
        // Spread sets the key to undefined → JSON.stringify drops it →
        // server sees no `entitlement_ids` at all.
        entitlement_ids: undefined,
        purchased_at_ms: purchasedMs,
        expiration_at_ms: new Date("2026-05-15T00:00:00.000Z").getTime(),
      }),
    });

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, action: "updated" });
    expect(upsertCalls).toHaveLength(1);
    const written = upsertCalls[0]!.values;
    // The fallback must preserve snap_plus exactly — never downgrade,
    // upgrade, or null out the user's existing tier.
    expect(written.entitlementId).toBe("snap_plus");
    expect(written.appUserId).toBe("user-1");
    // SUBSCRIBER_ALIAS is in INACTIVE_TYPES, so isActive flips off and
    // willRenew is cleared (consistent with how the handler treats every
    // entitlement-loss event).
    expect(written.isActive).toBe(false);
    expect(written.willRenew).toBe(false);
    // The event-log row was still written for the audit trail.
    expect(subscriptionEventsState.stored.size).toBe(1);
    expect(subscriptionEventsState.stored.get("evt-alias")).toMatchObject({
      eventId: "evt-alias",
      eventType: "SUBSCRIBER_ALIAS",
      appUserId: "user-1",
    });
  });

  it("skips the subscriber upsert (but still logs the event) when no existing row exists", async () => {
    // No prior subscribers row for user-1 — the handler has no entitlement
    // on the event and nothing to fall back to. Writing a brand-new row
    // would require fabricating an entitlementId (the column is NOT NULL),
    // so the route must skip cleanly with `skipped-no-entitlement` rather
    // than guess.
    expect(subscribersState.rows.has("user-1")).toBe(false);

    const res = await postWebhook({
      body: buildEvent({
        id: "evt-alias-new",
        type: "SUBSCRIBER_ALIAS",
        entitlement_ids: undefined,
        purchased_at_ms: new Date("2026-04-15T00:00:00.000Z").getTime(),
        expiration_at_ms: new Date("2026-05-15T00:00:00.000Z").getTime(),
      }),
    });

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, action: "skipped-no-entitlement" });
    // Subscriber table is untouched — no fabricated row, no upsert call.
    expect(upsertCalls).toHaveLength(0);
    expect(subscribersState.rows.size).toBe(0);
    // The event log still captures the delivery so we retain an audit
    // trail of the customer-scoped event even though it didn't mutate
    // subscriber state.
    expect(subscriptionEventsState.stored.size).toBe(1);
    expect(subscriptionEventsState.stored.get("evt-alias-new")).toMatchObject({
      eventId: "evt-alias-new",
      eventType: "SUBSCRIBER_ALIAS",
      appUserId: "user-1",
    });
  });
});

describe("POST /revenuecat/webhook — BILLING_ISSUE grace window", () => {
  const previousSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
  const previousGrace = process.env.BILLING_GRACE_DAYS;
  beforeAll(() => {
    process.env.REVENUECAT_WEBHOOK_SECRET = WEBHOOK_SECRET;
    // Pin the grace window so timing assertions are deterministic.
    process.env.BILLING_GRACE_DAYS = "3";
  });
  afterAll(() => {
    if (previousSecret === undefined) {
      delete process.env.REVENUECAT_WEBHOOK_SECRET;
    } else {
      process.env.REVENUECAT_WEBHOOK_SECRET = previousSecret;
    }
    if (previousGrace === undefined) {
      delete process.env.BILLING_GRACE_DAYS;
    } else {
      process.env.BILLING_GRACE_DAYS = previousGrace;
    }
  });

  // Three days in milliseconds — must match BILLING_GRACE_DAYS above.
  const GRACE_MS = 3 * 24 * 60 * 60 * 1000;

  function seedActiveSubscriber(overrides: Partial<SubscribersRow> = {}) {
    const purchaseAt = new Date("2026-04-15T00:00:00.000Z");
    subscribersState.rows.set("user-1", {
      appUserId: "user-1",
      entitlementId: "snap_premium",
      isActive: true,
      productId: "premium_monthly",
      periodType: "NORMAL",
      store: "APP_STORE",
      willRenew: true,
      isInTrial: false,
      originalPurchaseAt: purchaseAt,
      latestPurchaseAt: purchaseAt,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      unsubscribeDetectedAt: null,
      cancelledAt: null,
      rawCustomerInfo: { source: "webhook" },
      billingIssueAt: null,
      gracePeriodEndsAt: null,
      ...overrides,
    });
  }

  it("opens a grace window: keeps isActive=true, sets billingIssueAt + gracePeriodEndsAt, enqueues email", async () => {
    seedActiveSubscriber();

    const res = await postWebhook({
      body: buildEvent({
        id: "evt-billing-1",
        type: "BILLING_ISSUE",
        // BILLING_ISSUE branch ignores expiration_at_ms / purchased_at_ms;
        // it stamps `now` directly. Provide them anyway to mirror the
        // real payload shape.
        purchased_at_ms: Date.now(),
        expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      ok: true,
      action: "billing-issue-grace-opened",
    });
    // Critically, the subscriber upsert path was NOT used — the branch
    // takes a dedicated db.update so it doesn't clobber trialSource /
    // trialEndsAt / latestPurchaseAt.
    expect(upsertCalls).toHaveLength(0);
    expect(billingIssueUpdates).toHaveLength(1);

    const stored = subscribersState.rows.get("user-1");
    // Access is preserved through the grace window.
    expect(stored?.isActive).toBe(true);
    expect(stored?.billingIssueAt).toBeInstanceOf(Date);
    expect(stored?.gracePeriodEndsAt).toBeInstanceOf(Date);
    // Grace window length matches BILLING_GRACE_DAYS (within a small
    // execution-time tolerance).
    const span =
      stored!.gracePeriodEndsAt!.getTime() - stored!.billingIssueAt!.getTime();
    expect(Math.abs(span - GRACE_MS)).toBeLessThan(1_000);

    // One billing_issue email enqueued, keyed by appUserId in toAddress.
    expect(pendingEmailsState.inserts).toHaveLength(1);
    expect(pendingEmailsState.inserts[0]).toMatchObject({
      kind: "billing_issue",
      toAddress: "user-1",
    });
    const payload = pendingEmailsState.inserts[0]!.payload as {
      appUserId: string;
      entitlementId: string;
      billingIssueAt: string;
      gracePeriodEndsAt: string;
    };
    expect(payload.appUserId).toBe("user-1");
    expect(payload.entitlementId).toBe("snap_premium");
    expect(typeof payload.billingIssueAt).toBe("string");
    expect(typeof payload.gracePeriodEndsAt).toBe("string");
  });

  it("dedupes redelivered BILLING_ISSUE within the grace window: no second update, no second email", async () => {
    // Seed a subscriber whose grace window is already open and well
    // inside the 3-day envelope (opened 1 day ago).
    const billingIssueAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const gracePeriodEndsAt = new Date(billingIssueAt.getTime() + GRACE_MS);
    seedActiveSubscriber({
      billingIssueAt,
      gracePeriodEndsAt,
    });

    const res = await postWebhook({
      body: buildEvent({
        id: "evt-billing-redeliver",
        type: "BILLING_ISSUE",
      }),
    });

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      ok: true,
      action: "billing-issue-already-open",
    });
    // No subscriber state change, no email enqueue — the dedup branch
    // skips both side effects so we don't extend the user's grace
    // window unfairly or spam them on RC retries.
    expect(billingIssueUpdates).toHaveLength(0);
    expect(pendingEmailsState.inserts).toHaveLength(0);
    // Original grace window is preserved exactly.
    const stored = subscribersState.rows.get("user-1");
    expect(stored?.billingIssueAt?.getTime()).toBe(billingIssueAt.getTime());
    expect(stored?.gracePeriodEndsAt?.getTime()).toBe(
      gracePeriodEndsAt.getTime(),
    );
  });

  it("opens a fresh grace window when the previous billingIssueAt is older than the grace window", async () => {
    // Previous incident, fully outside the current grace envelope (5
    // days ago vs. a 3-day window). This represents a *new* payment
    // failure, not a redelivery — so the branch must restart the grace
    // window AND re-enqueue the email.
    const oldIssueAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    seedActiveSubscriber({
      billingIssueAt: oldIssueAt,
      gracePeriodEndsAt: new Date(oldIssueAt.getTime() + GRACE_MS),
    });

    const res = await postWebhook({
      body: buildEvent({
        id: "evt-billing-new-incident",
        type: "BILLING_ISSUE",
      }),
    });

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      ok: true,
      action: "billing-issue-grace-opened",
    });
    expect(billingIssueUpdates).toHaveLength(1);
    expect(pendingEmailsState.inserts).toHaveLength(1);
    const stored = subscribersState.rows.get("user-1");
    // billingIssueAt was bumped forward (strictly newer than the
    // 5-day-old prior incident).
    expect(stored?.billingIssueAt?.getTime()).toBeGreaterThan(
      oldIssueAt.getTime(),
    );
  });

  it("does not reactivate an already-inactive subscriber (out-of-order EXPIRATION → BILLING_ISSUE)", async () => {
    // Realistic out-of-order delivery from RC: an EXPIRATION already
    // landed and flipped the subscriber inactive. A delayed
    // BILLING_ISSUE for the same subscription must NOT re-grant access
    // by reopening a 3-day grace window — that would directly violate
    // the "EXPIRATION/CANCELLATION behaviour unchanged" requirement.
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    seedActiveSubscriber({
      isActive: false,
      expiresAt: expiredAt,
      cancelledAt: null,
    });

    const res = await postWebhook({
      body: buildEvent({
        id: "evt-billing-late",
        type: "BILLING_ISSUE",
        purchased_at_ms: Date.now() - 7 * 24 * 60 * 60 * 1000,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      ok: true,
      action: "skipped-stale-or-inactive",
    });
    // No state change, no email — subscriber stays inactive.
    expect(billingIssueUpdates).toHaveLength(0);
    expect(pendingEmailsState.inserts).toHaveLength(0);
    const stored = subscribersState.rows.get("user-1");
    expect(stored?.isActive).toBe(false);
    expect(stored?.billingIssueAt ?? null).toBeNull();
    expect(stored?.gracePeriodEndsAt ?? null).toBeNull();
  });

  it("logs only when the BILLING_ISSUE webhook references an unknown subscriber", async () => {
    // No seeded subscriber row for user-1. We have no entitlement
    // context to fabricate one (entitlementId is NOT NULL), so the
    // branch must skip cleanly with `skipped-no-subscriber`.
    expect(subscribersState.rows.has("user-1")).toBe(false);

    const res = await postWebhook({
      body: buildEvent({
        id: "evt-billing-unknown",
        type: "BILLING_ISSUE",
      }),
    });

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, action: "skipped-no-subscriber" });
    expect(billingIssueUpdates).toHaveLength(0);
    expect(pendingEmailsState.inserts).toHaveLength(0);
    // Audit log row is still written so we retain a trail of the
    // unknown-user delivery.
    expect(subscriptionEventsState.stored.size).toBe(1);
    expect(subscriptionEventsState.stored.get("evt-billing-unknown")).toMatchObject({
      eventId: "evt-billing-unknown",
      eventType: "BILLING_ISSUE",
    });
  });

  it("DB-level dedup: two concurrent deliveries of the same event produce exactly one email row", async () => {
    // Simulate two webhook deliveries arriving so close together that
    // both pass the application-level `priorGraceOpen` check (neither
    // has written billingIssueAt yet when the other reads). The unique
    // partial index on `pending_emails.external_id` is the last line of
    // defence — it must silence the second insert via onConflictDoNothing
    // without throwing.
    seedActiveSubscriber();

    const event = buildEvent({
      id: "evt-billing-concurrent",
      type: "BILLING_ISSUE",
      purchased_at_ms: Date.now(),
    });

    // Fire both webhook calls without awaiting the first — this is as
    // close to "concurrent" as a synchronous test runner allows. Because
    // our mock resolves Promises synchronously, both calls will race
    // through the priorGraceOpen check before either writes.
    const [res1, res2] = await Promise.all([
      postWebhook({ body: event }),
      postWebhook({ body: event }),
    ]);

    // Both responses must be 200 OK (no 500 from a constraint violation).
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // Exactly one email row must be persisted — the second insert was
    // silenced by onConflictDoNothing + the externalId unique index.
    expect(pendingEmailsState.inserts).toHaveLength(1);
    expect(pendingEmailsState.inserts[0]).toMatchObject({
      kind: "billing_issue",
      toAddress: "user-1",
    });
    // externalId is set and follows the canonical format.
    const extId = pendingEmailsState.inserts[0]?.externalId ?? "";
    expect(extId).toMatch(/^billing_issue:user-1:/);
  });
});
