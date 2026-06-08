/**
 * Tests for GET /api/subscription/me — the merged server-trial / RC-mirror
 * read endpoint that the mobile app uses for trial day-of, badge labels,
 * and the TrialPromptCard cascade.
 *
 * Cascade rules under test:
 *   - server trial active → tier=trial, trialSource=server, day-of computed.
 *   - server trial expired → tier=free, isOnTrial=false (lazy expiry).
 *   - store-side trial mirrored from RC → tier=trial, trialSource=store.
 *   - paid Premium row (trialSource cleared) → tier=premium, isOnTrial=false.
 *   - missing row → tier=free, no trial info.
 */

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

interface SubscribersRow {
  appUserId: string;
  entitlementId: string;
  isActive: boolean;
  isInTrial: boolean;
  willRenew: boolean;
  productId: string | null;
  periodType: string | null;
  store: string | null;
  expiresAt: Date | null;
  trialSource: "server" | "store" | null;
  trialEndsAt: Date | null;
  cancelledAt?: Date | null;
  billingIssueAt?: Date | null;
  gracePeriodEndsAt?: Date | null;
}

const state: { row: SubscribersRow | null } = { row: null };

vi.mock("../../lib/auth", () => ({
  // The route only needs requireUser; return a stable fake user.
  requireUser: async () => ({
    appUserId: "u-test",
    isAdmin: false,
    isTester: false,
    source: "clerk",
  }),
  SERVER_TRIAL_LENGTH_DAYS: 30,
}));

vi.mock("@workspace/db", () => {
  // Object sentinel for table identity in the chained query builder.
  const subscribersTable = {
    __t: "subscribers",
    appUserId: { __c: "appUserId" },
  } as const;

  const db = {
    select: () => ({
      from: (_tbl: unknown) => ({
        where: (_cond: unknown) => ({
          limit: async (_n: number) => (state.row ? [state.row] : []),
        }),
      }),
    }),
  };

  return { db, subscribersTable };
});

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ kind: "eq", args }),
}));

const subscriptionRouter = (await import("../subscription")).default;

let app: Express;
let server: Server;
let baseUrl = "";

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use("/api", subscriptionRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.row = null;
});

describe("GET /subscription/me", () => {
  it("returns free with null trial fields when no subscriber row exists", async () => {
    const r = await fetch(`${baseUrl}/subscription/me`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as any;
    expect(body).toEqual({
      tier: "free",
      isOnTrial: false,
      trialSource: null,
      trialDayOf: null,
      trialDaysRemaining: null,
      trialLengthDays: 30,
      trialEndsAt: null,
      trialEndedAt: null,
      // No subscriber row → no payment in flight → no billing-issue
      // grace window. The field is always present (never undefined) so
      // the mobile client's optional-chaining stays type-safe.
      billingIssue: null,
    });
  });

  it("reports an active server trial with computed Day X of 30", async () => {
    // Trial ending in 16 days → day-of ≈ 30 - 16 + 1 = 15 (mid-trial).
    const trialEndsAt = new Date(Date.now() + 16 * 24 * 3600 * 1000);
    state.row = {
      appUserId: "u-test",
      entitlementId: "snap_premium",
      isActive: true,
      isInTrial: true,
      willRenew: false,
      productId: null,
      periodType: "TRIAL",
      store: null,
      expiresAt: trialEndsAt,
      trialSource: "server",
      trialEndsAt,
    };
    const r = await fetch(`${baseUrl}/subscription/me`);
    const body = (await r.json()) as any;
    expect(body.tier).toBe("trial");
    expect(body.isOnTrial).toBe(true);
    expect(body.trialSource).toBe("server");
    expect(body.trialLengthDays).toBe(30);
    // Day-of within ±1 of expected (allows for sub-day rounding).
    expect(body.trialDayOf).toBeGreaterThanOrEqual(14);
    expect(body.trialDayOf).toBeLessThanOrEqual(16);
    expect(body.trialDaysRemaining).toBeGreaterThanOrEqual(15);
    expect(body.trialDaysRemaining).toBeLessThanOrEqual(17);
    expect(body.trialEndsAt).toBe(trialEndsAt.toISOString());
  });

  it("degrades an expired server trial to tier=free without a job", async () => {
    const trialEndsAt = new Date(Date.now() - 1 * 24 * 3600 * 1000);
    state.row = {
      appUserId: "u-test",
      entitlementId: "snap_premium",
      isActive: true, // not flipped — lazy expiry.
      isInTrial: true,
      willRenew: false,
      productId: null,
      periodType: "TRIAL",
      store: null,
      expiresAt: trialEndsAt,
      trialSource: "server",
      trialEndsAt,
    };
    const r = await fetch(`${baseUrl}/subscription/me`);
    const body = (await r.json()) as any;
    expect(body.tier).toBe("free");
    expect(body.isOnTrial).toBe(false);
    expect(body.trialSource).toBeNull();
    expect(body.trialEndsAt).toBeNull();
    // Recently expired (< 7 days) → drives the post-trial banner.
    expect(body.trialEndedAt).toBe(trialEndsAt.toISOString());
  });

  it("does not surface trialEndedAt for trials that ended >7 days ago", async () => {
    const trialEndsAt = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    state.row = {
      appUserId: "u-test",
      entitlementId: "snap_premium",
      isActive: true,
      isInTrial: true,
      willRenew: false,
      productId: null,
      periodType: "TRIAL",
      store: null,
      expiresAt: trialEndsAt,
      trialSource: "server",
      trialEndsAt,
    };
    const r = await fetch(`${baseUrl}/subscription/me`);
    const body = (await r.json()) as any;
    expect(body.tier).toBe("free");
    expect(body.trialEndedAt).toBeNull();
  });

  it("flags a store-mirrored trial with trialSource=store", async () => {
    const expiresAt = new Date(Date.now() + 5 * 24 * 3600 * 1000);
    state.row = {
      appUserId: "u-test",
      entitlementId: "snap_premium",
      isActive: true,
      isInTrial: true,
      willRenew: true,
      productId: "snaplife_premium_monthly",
      periodType: "TRIAL",
      store: "app_store",
      expiresAt,
      // RC webhook overwrote the server marker with "store" (or null).
      trialSource: "store",
      trialEndsAt: null,
    };
    const r = await fetch(`${baseUrl}/subscription/me`);
    const body = (await r.json()) as any;
    expect(body.tier).toBe("trial");
    expect(body.isOnTrial).toBe(true);
    expect(body.trialSource).toBe("store");
    // Store trials don't get day-of from the server — client falls back to RC.
    expect(body.trialDayOf).toBeNull();
    // But days-remaining is still derivable from expiresAt.
    expect(body.trialDaysRemaining).toBeGreaterThanOrEqual(4);
    expect(body.trialDaysRemaining).toBeLessThanOrEqual(5);
  });

  it("reports tier=premium for a paid Premium subscriber (no trial)", async () => {
    state.row = {
      appUserId: "u-test",
      entitlementId: "snap_premium",
      isActive: true,
      isInTrial: false,
      willRenew: true,
      productId: "snaplife_premium_monthly",
      periodType: "normal",
      store: "app_store",
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      trialSource: null,
      trialEndsAt: null,
    };
    const r = await fetch(`${baseUrl}/subscription/me`);
    const body = (await r.json()) as any;
    expect(body.tier).toBe("premium");
    expect(body.isOnTrial).toBe(false);
    expect(body.trialSource).toBeNull();
  });

  it("keeps tier=premium with billingIssue set during an open grace window", async () => {
    // Simulate the BILLING_ISSUE webhook landing one day ago with a
    // 3-day grace window. The subscriber row is still flagged active
    // (the route preserves access until grace expires).
    const billingIssueAt = new Date(Date.now() - 1 * 24 * 3600 * 1000);
    const gracePeriodEndsAt = new Date(Date.now() + 2 * 24 * 3600 * 1000);
    state.row = {
      appUserId: "u-test",
      entitlementId: "snap_premium",
      isActive: true,
      isInTrial: false,
      willRenew: true,
      productId: "snaplife_premium_monthly",
      periodType: "normal",
      store: "app_store",
      expiresAt: new Date(Date.now() + 20 * 24 * 3600 * 1000),
      trialSource: null,
      trialEndsAt: null,
      billingIssueAt,
      gracePeriodEndsAt,
    };
    const r = await fetch(`${baseUrl}/subscription/me`);
    const body = (await r.json()) as any;
    // Access stays granted (tier=premium) so PremiumGate keeps unlocked
    // children rendering during the grace window.
    expect(body.tier).toBe("premium");
    expect(body.isOnTrial).toBe(false);
    // billingIssue payload exposes the dates the mobile banner needs.
    expect(body.billingIssue).not.toBeNull();
    expect(body.billingIssue.since).toBe(billingIssueAt.toISOString());
    expect(body.billingIssue.gracePeriodEndsAt).toBe(
      gracePeriodEndsAt.toISOString(),
    );
  });

  it("flips to free with billingIssue=null once the grace window has expired", async () => {
    // Grace window elapsed 1d ago. Lazy expiry: the `subscribers.row`
    // is still `isActive=true` but the route should return free.
    const billingIssueAt = new Date(Date.now() - 5 * 24 * 3600 * 1000);
    const gracePeriodEndsAt = new Date(Date.now() - 1 * 24 * 3600 * 1000);
    state.row = {
      appUserId: "u-test",
      entitlementId: "snap_premium",
      isActive: true,
      isInTrial: false,
      willRenew: true,
      productId: "snaplife_premium_monthly",
      periodType: "normal",
      store: "app_store",
      // expiresAt is still in the future — the only reason we degrade
      // is the elapsed grace window.
      expiresAt: new Date(Date.now() + 10 * 24 * 3600 * 1000),
      trialSource: null,
      trialEndsAt: null,
      billingIssueAt,
      gracePeriodEndsAt,
    };
    const r = await fetch(`${baseUrl}/subscription/me`);
    const body = (await r.json()) as any;
    expect(body.tier).toBe("free");
    expect(body.isOnTrial).toBe(false);
    // Banner should disappear after grace expiry — billingIssue is null.
    expect(body.billingIssue).toBeNull();
  });

  it("reports tier=plus for a paid Plus subscriber", async () => {
    state.row = {
      appUserId: "u-test",
      entitlementId: "snap_plus",
      isActive: true,
      isInTrial: false,
      willRenew: true,
      productId: "snaplife_plus_monthly",
      periodType: "normal",
      store: "play_store",
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      trialSource: null,
      trialEndsAt: null,
    };
    const r = await fetch(`${baseUrl}/subscription/me`);
    const body = (await r.json()) as any;
    expect(body.tier).toBe("plus");
    expect(body.isOnTrial).toBe(false);
  });
});
