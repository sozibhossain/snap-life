/**
 * Unit tests for the billing-issue lapse worker.
 *
 * The worker bulk-clears `billingIssueAt` / `gracePeriodEndsAt` on every
 * subscriber row whose `gracePeriodEndsAt` is more than one day in the
 * past, then emits one `billing_issue_lapsed` row into
 * `subscription_events` per cleared subscriber. We mock `@workspace/db`
 * to capture both the UPDATE shape and the per-row event inserts
 * without touching a real database.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface UpdateCapture {
  table: string | undefined;
  setVals: Record<string, unknown> | undefined;
  where: unknown;
  returning: unknown;
}

interface InsertCapture {
  table: string | undefined;
  values: Record<string, unknown> | undefined;
  conflictTarget: unknown;
}

const lastUpdate: UpdateCapture = {
  table: undefined,
  setVals: undefined,
  where: undefined,
  returning: undefined,
};

const updateResult: {
  rows: Array<{
    appUserId: string;
    gracePeriodEndsAt: Date | null;
    billingIssueAt: Date | null;
    entitlementId: string;
  }>;
} = { rows: [] };

const insertCalls: InsertCapture[] = [];
const insertConflictBehaviour: { duplicateEventIds: Set<string> } = {
  duplicateEventIds: new Set(),
};

vi.mock("@workspace/db", () => {
  const subscribersTable = {
    __table: "subscribers",
    appUserId: { __col: "subscribers.appUserId" },
    entitlementId: { __col: "subscribers.entitlementId" },
    billingIssueAt: { __col: "subscribers.billingIssueAt" },
    gracePeriodEndsAt: { __col: "subscribers.gracePeriodEndsAt" },
    updatedAt: { __col: "subscribers.updatedAt" },
  } as const;

  const subscriptionEventsTable = {
    __table: "subscription_events",
    eventId: { __col: "subscription_events.eventId" },
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
    insert: (tbl: { __table: string }) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: (opts: unknown) => ({
          returning: (_cols: unknown) => {
            insertCalls.push({
              table: tbl.__table,
              values,
              conflictTarget: opts,
            });
            const eventId = values["eventId"] as string;
            if (insertConflictBehaviour.duplicateEventIds.has(eventId)) {
              return Promise.resolve([]);
            }
            return Promise.resolve([{ eventId }]);
          },
        }),
      }),
    }),
  };

  return { db, subscribersTable, subscriptionEventsTable };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ kind: "and", args }),
  isNotNull: (...args: unknown[]) => ({ kind: "isNotNull", args }),
  lt: (...args: unknown[]) => ({ kind: "lt", args }),
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const { runBillingIssueLapsePass } = await import(
  "../billingIssueLapseWorker"
);

beforeEach(() => {
  lastUpdate.table = undefined;
  lastUpdate.setVals = undefined;
  lastUpdate.where = undefined;
  lastUpdate.returning = undefined;
  updateResult.rows = [];
  insertCalls.length = 0;
  insertConflictBehaviour.duplicateEventIds = new Set();
});

describe("runBillingIssueLapsePass", () => {
  it("clears billing-issue columns and emits one event per cleared row", async () => {
    const now = new Date("2026-05-03T12:00:00.000Z");
    updateResult.rows = [
      {
        appUserId: "user-a",
        gracePeriodEndsAt: null,
        billingIssueAt: null,
        entitlementId: "snap_premium",
      },
      {
        appUserId: "user-b",
        gracePeriodEndsAt: null,
        billingIssueAt: null,
        entitlementId: "snap_plus",
      },
    ];

    const result = await runBillingIssueLapsePass(now);

    expect(result).toEqual({ cleared: 2, eventsEmitted: 2 });
    expect(lastUpdate.table).toBe("subscribers");
    expect(lastUpdate.setVals).toEqual({
      billingIssueAt: null,
      gracePeriodEndsAt: null,
      updatedAt: now,
    });

    // WHERE: and(isNotNull(gracePeriodEndsAt), lt(gracePeriodEndsAt, cutoff))
    // where cutoff = now - 1 day.
    const where = lastUpdate.where as { kind: string; args: unknown[] };
    expect(where.kind).toBe("and");
    const clauses = where.args as Array<{ kind: string; args: unknown[] }>;
    expect(clauses).toHaveLength(2);

    const isNotNullClause = clauses.find((c) => c.kind === "isNotNull");
    expect(
      (isNotNullClause?.args[0] as { __col: string }).__col,
    ).toBe("subscribers.gracePeriodEndsAt");

    const ltClause = clauses.find((c) => c.kind === "lt");
    expect(
      (ltClause?.args[0] as { __col: string }).__col,
    ).toBe("subscribers.gracePeriodEndsAt");
    const cutoff = ltClause?.args[1] as Date;
    expect(cutoff.getTime()).toBe(now.getTime() - 24 * 60 * 60 * 1000);

    // Two events, one per cleared subscriber, into subscription_events.
    expect(insertCalls).toHaveLength(2);
    for (const call of insertCalls) {
      expect(call.table).toBe("subscription_events");
      expect(call.values?.["eventType"]).toBe("billing_issue_lapsed");
      const payload = call.values?.["payload"] as Record<string, unknown>;
      expect(payload["lapsedAt"]).toBe(now.toISOString());
      expect(payload["reason"]).toBe(
        "grace_window_expired_without_recovery",
      );
    }
    const eventIds = insertCalls.map((c) => c.values?.["eventId"]);
    expect(eventIds).toEqual([
      `billing_issue_lapsed:user-a:${now.toISOString()}`,
      `billing_issue_lapsed:user-b:${now.toISOString()}`,
    ]);
  });

  it("returns zeros when no rows are due", async () => {
    updateResult.rows = [];
    const result = await runBillingIssueLapsePass(new Date());
    expect(result).toEqual({ cleared: 0, eventsEmitted: 0 });
    expect(insertCalls).toHaveLength(0);
  });

  it("does not count duplicate-event inserts toward eventsEmitted", async () => {
    const now = new Date("2026-05-03T12:00:00.000Z");
    updateResult.rows = [
      {
        appUserId: "user-a",
        gracePeriodEndsAt: null,
        billingIssueAt: null,
        entitlementId: "snap_premium",
      },
    ];
    insertConflictBehaviour.duplicateEventIds = new Set([
      `billing_issue_lapsed:user-a:${now.toISOString()}`,
    ]);

    const result = await runBillingIssueLapsePass(now);
    expect(result.cleared).toBe(1);
    expect(result.eventsEmitted).toBe(0);
    expect(insertCalls).toHaveLength(1);
  });
});
