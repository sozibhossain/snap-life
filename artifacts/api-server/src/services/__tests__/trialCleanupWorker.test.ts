/**
 * Unit tests for the trial-cleanup worker.
 *
 * The worker issues a single bulk `UPDATE subscribers SET is_active=false
 * WHERE trial_source='server' AND is_active=true AND trial_ends_at < now()`.
 * We mock `@workspace/db` so we can assert both the WHERE shape and the
 * SET payload without touching a real database, and `drizzle-orm` so the
 * predicate helpers return tagged objects we can inspect.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface UpdateCapture {
  table: string | undefined;
  setVals: Record<string, unknown> | undefined;
  where: unknown;
  returning: unknown;
}

const lastUpdate: UpdateCapture = {
  table: undefined,
  setVals: undefined,
  where: undefined,
  returning: undefined,
};

const updateResult: { rows: Array<{ appUserId: string }> } = { rows: [] };

vi.mock("@workspace/db", () => {
  const subscribersTable = {
    __table: "subscribers",
    appUserId: { __col: "subscribers.appUserId" },
    isActive: { __col: "subscribers.isActive" },
    trialSource: { __col: "subscribers.trialSource" },
    trialEndsAt: { __col: "subscribers.trialEndsAt" },
    updatedAt: { __col: "subscribers.updatedAt" },
  } as const;

  const db = {
    update: (tbl: { __table: string }) => ({
      set: (setVals: Record<string, unknown>) => ({
        where: (cond: unknown) => ({
          returning: (cols: unknown) => {
            lastUpdate.table = tbl.__table;
            lastUpdate.setVals = setVals;
            lastUpdate.where = cond;
            lastUpdate.returning = cols;
            return Promise.resolve(updateResult.rows);
          },
        }),
      }),
    }),
  };

  return { db, subscribersTable };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ kind: "and", args }),
  eq: (...args: unknown[]) => ({ kind: "eq", args }),
  lt: (...args: unknown[]) => ({ kind: "lt", args }),
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const { runTrialCleanupPass } = await import("../trialCleanupWorker");

beforeEach(() => {
  lastUpdate.table = undefined;
  lastUpdate.setVals = undefined;
  lastUpdate.where = undefined;
  lastUpdate.returning = undefined;
  updateResult.rows = [];
});

describe("runTrialCleanupPass", () => {
  it("issues an UPDATE on subscribers with the lazy-expiry WHERE clause", async () => {
    updateResult.rows = [
      { appUserId: "user-a" },
      { appUserId: "user-b" },
    ];
    const now = new Date("2026-05-02T12:00:00.000Z");

    const result = await runTrialCleanupPass(now);

    expect(result.deactivated).toBe(2);
    expect(lastUpdate.table).toBe("subscribers");

    // SET payload: flips isActive=false and bumps updatedAt.
    expect(lastUpdate.setVals).toEqual({ isActive: false, updatedAt: now });

    // WHERE: and(eq(trialSource, "server"), eq(isActive, true),
    //            lt(trialEndsAt, now)).
    const where = lastUpdate.where as { kind: string; args: unknown[] };
    expect(where.kind).toBe("and");
    const clauses = where.args as Array<{ kind: string; args: unknown[] }>;
    expect(clauses).toHaveLength(3);

    const trialSourceClause = clauses.find(
      (c) =>
        c.kind === "eq" &&
        (c.args[0] as { __col: string }).__col === "subscribers.trialSource",
    );
    expect(trialSourceClause?.args[1]).toBe("server");

    const isActiveClause = clauses.find(
      (c) =>
        c.kind === "eq" &&
        (c.args[0] as { __col: string }).__col === "subscribers.isActive",
    );
    expect(isActiveClause?.args[1]).toBe(true);

    const trialEndsAtClause = clauses.find(
      (c) =>
        c.kind === "lt" &&
        (c.args[0] as { __col: string }).__col === "subscribers.trialEndsAt",
    );
    expect(trialEndsAtClause?.args[1]).toBe(now);
  });

  it("returns deactivated=0 when no rows are due", async () => {
    updateResult.rows = [];
    const result = await runTrialCleanupPass(new Date());
    expect(result.deactivated).toBe(0);
    expect(lastUpdate.table).toBe("subscribers");
  });

  it("is idempotent: a second pass with no due rows reports zero", async () => {
    updateResult.rows = [{ appUserId: "user-a" }];
    const first = await runTrialCleanupPass(new Date());
    expect(first.deactivated).toBe(1);

    updateResult.rows = [];
    const second = await runTrialCleanupPass(new Date());
    expect(second.deactivated).toBe(0);
  });
});
