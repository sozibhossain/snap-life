/**
 * Unit tests for the hard-delete worker.
 *
 * Core invariant: `runHardDeletePass` and `forceHardDeleteUser` must NEVER
 * issue a DELETE against `audit_logs` or `audit_events`. Those tables are
 * intentionally append-only so the audit trail survives account erasure
 * (GDPR runbook §7).
 *
 * We mock `@workspace/db` so every `db.delete(table)` call is captured, then
 * assert:
 *   1. The targeted table set never contains either audit table.
 *   2. Every expected user-data table IS targeted (whitelist guard — catches
 *      tables silently dropped from the cascade).
 *   3. `insertAuditLog` is called once per erased user, confirming the
 *      post-delete audit entry is always written.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Captured state ───────────────────────────────────────────────────────────

/** Every table name passed to db.delete() during a test run. */
const deletedTables: string[] = [];

/** Controls what db.select() returns for usersTable queries. */
const selectResult: { rows: Array<{ appUserId: string }> } = { rows: [] };

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  function makeTable(name: string) {
    return { __table: name };
  }

  const usersTable = {
    ...makeTable("users"),
    appUserId: { __col: "users.appUserId" },
    hardDeleteAfter: { __col: "users.hardDeleteAfter" },
  };

  const db = {
    select: (_cols?: unknown) => ({
      from: (_tbl: unknown) => ({
        where: (_cond: unknown) => ({
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(selectResult.rows).then(resolve, reject),
          limit: (_n: number) => Promise.resolve(selectResult.rows.slice(0, 1)),
        }),
      }),
    }),

    delete: (tbl: { __table: string }) => {
      deletedTables.push(tbl.__table);
      return {
        where: (_cond: unknown) => Promise.resolve([]),
      };
    },

    insert: (_tbl: unknown) => ({
      values: (_vals: unknown) => Promise.resolve([]),
    }),
  };

  return {
    db,
    usersTable,
    userProfileTable: makeTable("user_profiles"),
    nutritionLogsTable: makeTable("nutrition_logs"),
    activityLogsTable: makeTable("activity_logs"),
    mealPlanDaysTable: makeTable("meal_plan_days"),
    wellbeingEntriesTable: makeTable("wellbeing_entries"),
    gamificationStateTable: makeTable("gamification_state"),
    badgeUnlocksTable: makeTable("badge_unlocks"),
    assessmentResultsTable: makeTable("assessment_results"),
    supplementStateTable: makeTable("supplement_state"),
    pushTokensTable: makeTable("push_tokens"),
    pushUserStateTable: makeTable("push_user_state"),
    interactionEventsTable: makeTable("interaction_events"),
    userTokensTable: makeTable("user_tokens"),
    subscriptionEventsTable: makeTable("subscription_events"),
    feedbackTable: makeTable("feedback"),
    analyticsConsentTable: makeTable("analytics_consent"),
    boneBuddyChatMessagesTable: makeTable("bone_buddy_chat_messages"),
    outcomeEntriesTable: makeTable("outcome_entries"),
    referralsTable: {
      ...makeTable("referrals"),
      referrerAppUserId: { __col: "referrals.referrerAppUserId" },
      refereeAppUserId: { __col: "referrals.refereeAppUserId" },
    },
    webPushSubscriptionsTable: {
      ...makeTable("web_push_subscriptions"),
      appUserId: { __col: "webPushSubscriptions.appUserId" },
    },
    pendingEmailsTable: {
      ...makeTable("pending_emails"),
      payload: { __col: "pendingEmails.payload" },
      toAddress: { __col: "pendingEmails.toAddress" },
      externalId: { __col: "pendingEmails.externalId" },
    },
    // Exported so tests can reference the names; the worker must never delete these.
    auditLogsTable: makeTable("audit_logs"),
    auditEventsTable: makeTable("audit_events"),
  };
});

vi.mock("drizzle-orm", () => ({
  lt: (...args: unknown[]) => ({ kind: "lt", args }),
  eq: (...args: unknown[]) => ({ kind: "eq", args }),
  and: (...args: unknown[]) => ({ kind: "and", args }),
  isNotNull: (...args: unknown[]) => ({ kind: "isNotNull", args }),
  or: (...args: unknown[]) => ({ kind: "or", args }),
  sql: Object.assign(
    (...args: unknown[]) => ({ kind: "sql", args }),
    { raw: (...args: unknown[]) => ({ kind: "sql.raw", args }) },
  ),
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const mockInsertAuditLog = vi.fn().mockResolvedValue(undefined);
vi.mock("../../lib/audit", () => ({
  insertAuditLog: mockInsertAuditLog,
}));

const { runHardDeletePass, forceHardDeleteUser } = await import(
  "../hardDeleteWorker"
);

// ─── Constants ────────────────────────────────────────────────────────────────

const AUDIT_TABLES = new Set(["audit_logs", "audit_events"]);

/**
 * Canonical list of tables the cascade MUST delete.
 * If a table is added to or removed from hardDeleteUserCascade without updating
 * this list the corresponding whitelist tests will fail, preventing silent drift.
 *
 * Intentionally excluded tables (preserved after account erasure):
 *   - `subscribers`  — RevenueCat may re-mirror this via webhook after the local
 *                      user row is gone, so it must survive the cascade.
 *   - `audit_logs`   — append-only audit trail; retention is the whole point.
 *   - `audit_events` — same policy as audit_logs.
 */
const EXPECTED_USER_DATA_TABLES = new Set([
  "users",
  "user_profiles",
  "nutrition_logs",
  "activity_logs",
  "meal_plan_days",
  "wellbeing_entries",
  "gamification_state",
  "badge_unlocks",
  "assessment_results",
  "supplement_state",
  "push_tokens",
  "push_user_state",
  "interaction_events",
  "user_tokens",
  "subscription_events",
  "feedback",
  "analytics_consent",
  "bone_buddy_chat_messages",
  "outcome_entries",
  "referrals",
  "web_push_subscriptions",
  "pending_emails",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function assertNoAuditTableDeleted() {
  const violations = deletedTables.filter((t) => AUDIT_TABLES.has(t));
  expect(violations).toHaveLength(0);
}

/**
 * Assert that every table in EXPECTED_USER_DATA_TABLES was targeted at least
 * once. Catches any table that was silently removed from the cascade.
 */
function assertAllUserDataTablesDeleted() {
  for (const table of EXPECTED_USER_DATA_TABLES) {
    expect(deletedTables, `expected cascade to delete "${table}"`).toContain(table);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  deletedTables.length = 0;
  selectResult.rows = [];
  mockInsertAuditLog.mockClear();
});

describe("runHardDeletePass — audit-table safety", () => {
  it("never deletes from audit_logs or audit_events when users are due", async () => {
    selectResult.rows = [
      { appUserId: "user-alice" },
      { appUserId: "user-bob" },
    ];

    const result = await runHardDeletePass(new Date("2026-05-01T00:00:00Z"));

    expect(result.hardDeleted).toBe(2);
    expect(result.errors).toBe(0);
    assertNoAuditTableDeleted();
  });

  it("never deletes from audit_logs or audit_events when no users are due", async () => {
    selectResult.rows = [];

    const result = await runHardDeletePass(new Date("2026-05-01T00:00:00Z"));

    expect(result.scanned).toBe(0);
    expect(result.hardDeleted).toBe(0);
    assertNoAuditTableDeleted();
  });

  it("deletes the users row itself (sanity check that cascade runs)", async () => {
    selectResult.rows = [{ appUserId: "user-carol" }];

    await runHardDeletePass(new Date("2026-05-01T00:00:00Z"));

    expect(deletedTables).toContain("users");
  });

  it("deletes every expected user-data table — whitelist guard", async () => {
    selectResult.rows = [{ appUserId: "user-whitelist" }];

    await runHardDeletePass(new Date("2026-05-01T00:00:00Z"));

    assertAllUserDataTablesDeleted();
    assertNoAuditTableDeleted();
  });

  it("calls insertAuditLog once per erased user", async () => {
    selectResult.rows = [
      { appUserId: "user-audit-1" },
      { appUserId: "user-audit-2" },
    ];

    await runHardDeletePass(new Date("2026-05-01T00:00:00Z"));

    expect(mockInsertAuditLog).toHaveBeenCalledTimes(2);
    expect(mockInsertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "system_hard_delete" }),
    );
  });
});

describe("forceHardDeleteUser — audit-table safety", () => {
  it("never deletes from audit_logs or audit_events for an existing user", async () => {
    selectResult.rows = [{ appUserId: "user-dave" }];

    const result = await forceHardDeleteUser("user-dave");

    expect(result.found).toBe(true);
    assertNoAuditTableDeleted();
  });

  it("never deletes anything when the user is not found", async () => {
    selectResult.rows = [];

    const result = await forceHardDeleteUser("user-ghost");

    expect(result.found).toBe(false);
    expect(deletedTables).toHaveLength(0);
    assertNoAuditTableDeleted();
  });

  it("deletes the users row itself when the user exists (sanity check)", async () => {
    selectResult.rows = [{ appUserId: "user-eve" }];

    await forceHardDeleteUser("user-eve");

    expect(deletedTables).toContain("users");
  });

  it("deletes every expected user-data table — whitelist guard", async () => {
    selectResult.rows = [{ appUserId: "user-force-whitelist" }];

    await forceHardDeleteUser("user-force-whitelist");

    assertAllUserDataTablesDeleted();
    assertNoAuditTableDeleted();
  });

  it("calls insertAuditLog once for the erased user", async () => {
    selectResult.rows = [{ appUserId: "user-force-audit" }];

    await forceHardDeleteUser("user-force-audit");

    expect(mockInsertAuditLog).toHaveBeenCalledTimes(1);
    expect(mockInsertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "system_hard_delete" }),
    );
  });

  it("does not call insertAuditLog when the user is not found", async () => {
    selectResult.rows = [];

    await forceHardDeleteUser("user-not-found");

    expect(mockInsertAuditLog).not.toHaveBeenCalled();
  });
});
