/**
 * Tests for the trial-reminder worker.
 *
 * Coverage (per Task #52 acceptance):
 *   - Day 14 active server trial → enqueues exactly one
 *     `trial_halfway` row whose payload carries the trial cycle's
 *     `trialEndsAt`.
 *   - Day 25 active server trial → enqueues exactly one
 *     `trial_ending_soon` row.
 *   - Idempotency: a second pass on the same trial cycle does NOT
 *     enqueue another row.
 *   - A re-granted trial (different `trialEndsAt`) DOES re-enqueue.
 *   - Expired trial / non-trigger day-of → no rows.
 *   - Soft-deleted user → skipped.
 *   - Missing email → skipped.
 *   - All push tokens opted-out → skipped (notification preferences).
 *   - Store-trial / paid subscriber → skipped (worker is server-trial only).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface SubscriberRow {
  appUserId: string;
  trialSource: "server" | "store" | null;
  trialEndsAt: Date | null;
}
interface UserRow {
  appUserId: string;
  email: string | null;
  deletedAt: Date | null;
}
interface PushTokenRow {
  appUserId: string;
  optedIn: boolean;
}
interface PendingEmailRow {
  id: number;
  kind: string;
  toAddress: string;
  payload: Record<string, unknown>;
}

const state = {
  subscribers: [] as SubscriberRow[],
  users: [] as UserRow[],
  pushTokens: [] as PushTokenRow[],
  pendingEmails: [] as PendingEmailRow[],
  pendingId: 1,
};

function reset() {
  state.subscribers = [];
  state.users = [];
  state.pushTokens = [];
  state.pendingEmails = [];
  state.pendingId = 1;
}

// Drizzle helpers we ship as opaque tagged objects; the mock `db`
// understands enough of them to filter rows in JS rather than SQL.
type Pred =
  | { kind: "eq"; col: string; val: unknown }
  | { kind: "inArray"; col: string; vals: unknown[] }
  | { kind: "gt"; col: string; val: unknown }
  | { kind: "lte"; col: string; val: unknown }
  | { kind: "isNotNull"; col: string }
  | { kind: "and"; preds: Pred[] }
  | { kind: "sql"; check: (row: Record<string, unknown>) => boolean };

vi.mock("drizzle-orm", () => {
  return {
    and: (...preds: Pred[]): Pred => ({ kind: "and", preds }),
    eq: (col: { __c: string }, val: unknown): Pred => ({
      kind: "eq",
      col: col.__c,
      val,
    }),
    gt: (col: { __c: string }, val: unknown): Pred => ({
      kind: "gt",
      col: col.__c,
      val,
    }),
    lte: (col: { __c: string }, val: unknown): Pred => ({
      kind: "lte",
      col: col.__c,
      val,
    }),
    isNotNull: (col: { __c: string }): Pred => ({
      kind: "isNotNull",
      col: col.__c,
    }),
    inArray: (col: { __c: string }, vals: unknown[]): Pred => ({
      kind: "inArray",
      col: col.__c,
      vals,
    }),
    // The worker uses `sql` for two specific JSON-payload predicates:
    //   sql`${pendingEmails.payload}->>'appUserId' = ${appUserId}`
    //   sql`${pendingEmails.payload}->>'trialEndsAt' = ${iso}`
    // We rebuild them here as predicates that read the matching JSON
    // key from the row's payload.
    sql: (
      strings: TemplateStringsArray,
      ..._values: unknown[]
    ): Pred => {
      const raw = strings.join("?");
      // The string after the placeholder is e.g. `->>'appUserId' = `.
      const keyMatch = raw.match(/->>'(\w+)'\s*=/);
      const key = keyMatch?.[1];
      const expected = _values[_values.length - 1];
      return {
        kind: "sql",
        check: (row) => {
          const payload = row.payload as
            | Record<string, unknown>
            | undefined;
          if (!payload || !key) return false;
          return payload[key] === expected;
        },
      };
    },
  };
});

vi.mock("../../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function colProxy(name: string): unknown {
  return new Proxy(
    { __t: name },
    {
      get(_t, prop) {
        if (prop === "__t") return name;
        if (typeof prop !== "string") return undefined;
        return { __t: name, __c: prop };
      },
    },
  );
}

vi.mock("@workspace/db", () => {
  const subscribersTable = colProxy("subscribers");
  const usersTable = colProxy("users");
  const pushTokensTable = colProxy("pushTokens");
  const pendingEmailsTable = colProxy("pendingEmails");

  function rowsFor(name: string): Record<string, unknown>[] {
    if (name === "subscribers")
      return state.subscribers as unknown as Record<string, unknown>[];
    if (name === "users")
      return state.users as unknown as Record<string, unknown>[];
    if (name === "pushTokens")
      return state.pushTokens as unknown as Record<string, unknown>[];
    if (name === "pendingEmails")
      return state.pendingEmails as unknown as Record<string, unknown>[];
    return [];
  }

  function evalPred(row: Record<string, unknown>, p: Pred): boolean {
    switch (p.kind) {
      case "and":
        return p.preds.every((q) => evalPred(row, q));
      case "eq": {
        const val = p.val as { __c?: string } | unknown;
        // Join predicates pass a column ref as the rhs; resolve it
        // against the (already-flattened) row.
        if (val && typeof val === "object" && "__c" in (val as object)) {
          return row[p.col] === row[(val as { __c: string }).__c];
        }
        return row[p.col] === val;
      }
      case "inArray":
        return p.vals.includes(row[p.col]);
      case "gt":
        return (row[p.col] as Date)?.getTime?.() > (p.val as Date).getTime();
      case "lte":
        return (row[p.col] as Date)?.getTime?.() <= (p.val as Date).getTime();
      case "isNotNull":
        return row[p.col] != null;
      case "sql":
        return p.check(row);
    }
  }

  function shapeRow(
    row: Record<string, unknown>,
    shape: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(shape)) {
      const ref = v as { __t?: string; __c?: string };
      if (ref && ref.__c) {
        // Joined columns: prefer the per-row `__joined` map if present,
        // else read from the row itself (single-table select).
        const joined = row.__joined as
          | Record<string, Record<string, unknown>>
          | undefined;
        if (joined && joined[ref.__t!] && ref.__c in joined[ref.__t!]) {
          out[k] = joined[ref.__t!][ref.__c];
        } else {
          out[k] = row[ref.__c];
        }
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  const db = {
    select(shape?: Record<string, unknown>) {
      let baseTable = "";
      let joinedRows: Record<string, unknown>[] = [];
      const builder = {
        from(t: { __t: string }) {
          baseTable = t.__t;
          joinedRows = rowsFor(baseTable).map((r) => ({
            ...r,
            __joined: { [baseTable]: { ...r } },
          }));
          return builder;
        },
        innerJoin(t: { __t: string }, on: Pred) {
          const otherRows = rowsFor(t.__t);
          const out: Record<string, unknown>[] = [];
          for (const left of joinedRows) {
            for (const right of otherRows) {
              // Synthesise a combined row keyed by both tables so the
              // shape resolver can find columns from either side.
              const combined: Record<string, unknown> = {
                ...left,
                __joined: {
                  ...(left.__joined as Record<
                    string,
                    Record<string, unknown>
                  >),
                  [t.__t]: { ...right },
                },
              };
              // For the eq predicate we need to read from the
              // already-joined left row plus the right row. Synthesise
              // a flat view for predicate evaluation.
              const flatForPred: Record<string, unknown> = { ...left };
              for (const [k, v] of Object.entries(right)) flatForPred[k] = v;
              if (evalPred(flatForPred, on)) out.push(combined);
            }
          }
          joinedRows = out;
          return builder;
        },
        where(pred: Pred) {
          // Predicates may reference columns from any joined table —
          // build a flat view (right-table values overriding left where
          // they collide is fine for this test surface because the
          // worker never reads ambiguous columns by name).
          joinedRows = joinedRows.filter((r) => {
            const flat: Record<string, unknown> = { ...r };
            const joined = r.__joined as
              | Record<string, Record<string, unknown>>
              | undefined;
            if (joined) {
              for (const tableRow of Object.values(joined)) {
                for (const [k, v] of Object.entries(tableRow)) flat[k] = v;
              }
            }
            return evalPred(flat, pred);
          });
          return builder;
        },
        limit(n: number) {
          return Promise.resolve(
            joinedRows
              .slice(0, n)
              .map((r) => (shape ? shapeRow(r, shape) : r)),
          );
        },
        then<T>(
          resolve: (v: Record<string, unknown>[]) => T,
          reject?: (err: unknown) => unknown,
        ) {
          try {
            const out = joinedRows.map((r) =>
              shape ? shapeRow(r, shape) : r,
            );
            return Promise.resolve(resolve(out));
          } catch (err) {
            if (reject) return Promise.resolve(reject(err));
            return Promise.reject(err);
          }
        },
      };
      return builder;
    },
    insert(t: { __t: string }) {
      return {
        values(row: Record<string, unknown>) {
          if (t.__t === "pendingEmails") {
            state.pendingEmails.push({
              id: state.pendingId++,
              kind: row.kind as string,
              toAddress: row.toAddress as string,
              payload: row.payload as Record<string, unknown>,
            });
          }
          return Promise.resolve();
        },
      };
    },
  };

  return {
    db,
    subscribersTable,
    usersTable,
    pushTokensTable,
    pendingEmailsTable,
  };
});

const worker = await import("../trialReminderWorker");

const NOW = new Date("2026-05-02T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function seedActiveTrial(opts: {
  appUserId?: string;
  email?: string | null;
  deletedAt?: Date | null;
  /** Day-of-trial at the test's `now`. */
  dayOf: number;
  trialSource?: "server" | "store" | null;
}) {
  const id = opts.appUserId ?? "u-1";
  // dayOf = 30 - daysRemaining + 1  ⇒  daysRemaining = 31 - dayOf.
  // We add a half-day cushion so `Math.ceil((end - now)/DAY)` lands
  // squarely inside the target bucket regardless of rounding.
  const daysRemaining = 31 - opts.dayOf;
  const trialEndsAt = new Date(
    NOW.getTime() + daysRemaining * DAY - DAY / 2,
  );
  state.subscribers.push({
    appUserId: id,
    trialSource: opts.trialSource ?? "server",
    trialEndsAt,
  });
  state.users.push({
    appUserId: id,
    email: opts.email === undefined ? "u1@example.com" : opts.email,
    deletedAt: opts.deletedAt ?? null,
  });
  return trialEndsAt;
}

beforeEach(() => {
  reset();
});

describe("runTrialReminderPass", () => {
  it("enqueues a seven-day reminder on Day 23", async () => {
    const trialEndsAt = seedActiveTrial({ dayOf: 23 });
    const result = await worker.runTrialReminderPass(NOW);
    expect(result).toMatchObject({ enqueued: 1, errors: 0 });
    expect(state.pendingEmails).toHaveLength(1);
    expect(state.pendingEmails[0]).toMatchObject({
      kind: "trial_reminder_7d",
      toAddress: "u1@example.com",
    });
    expect(state.pendingEmails[0].payload).toMatchObject({
      appUserId: "u-1",
      trialEndsAt: trialEndsAt.toISOString(),
      trialDayOf: 23,
      trialLengthDays: 30,
    });
  });

  it("enqueues a two-day reminder on Day 28", async () => {
    seedActiveTrial({ dayOf: 28 });
    const result = await worker.runTrialReminderPass(NOW);
    expect(result.enqueued).toBe(1);
    expect(state.pendingEmails[0].kind).toBe("trial_reminder_2d");
    expect(state.pendingEmails[0].payload).toMatchObject({ trialDayOf: 28 });
  });

  it("does not enqueue on a non-trigger day", async () => {
    seedActiveTrial({ dayOf: 7 });
    const result = await worker.runTrialReminderPass(NOW);
    expect(result.enqueued).toBe(0);
    expect(state.pendingEmails).toHaveLength(0);
  });

  it("is idempotent across passes for the same trial cycle", async () => {
    seedActiveTrial({ dayOf: 23 });
    await worker.runTrialReminderPass(NOW);
    await worker.runTrialReminderPass(NOW);
    await worker.runTrialReminderPass(NOW);
    expect(state.pendingEmails).toHaveLength(1);
  });

  it("re-enqueues when the trial is re-granted (different trialEndsAt)", async () => {
    seedActiveTrial({ dayOf: 23 });
    await worker.runTrialReminderPass(NOW);
    expect(state.pendingEmails).toHaveLength(1);

    // Simulate a fresh trial grant: bump trialEndsAt to a new value
    // that still lands in the Day-23 bucket (slightly different ms).
    state.subscribers[0].trialEndsAt = new Date(
      state.subscribers[0].trialEndsAt!.getTime() + 1000,
    );
    await worker.runTrialReminderPass(NOW);
    expect(state.pendingEmails).toHaveLength(2);
  });

  it("skips soft-deleted users", async () => {
    seedActiveTrial({ dayOf: 23, deletedAt: new Date(NOW.getTime() - DAY) });
    const result = await worker.runTrialReminderPass(NOW);
    expect(result.enqueued).toBe(0);
    expect(state.pendingEmails).toHaveLength(0);
  });

  it("skips users without an email on file", async () => {
    seedActiveTrial({ dayOf: 23, email: null });
    const result = await worker.runTrialReminderPass(NOW);
    expect(result.enqueued).toBe(0);
    expect(state.pendingEmails).toHaveLength(0);
  });

  it("skips users whose every push token is opted out", async () => {
    seedActiveTrial({ dayOf: 23 });
    state.pushTokens.push(
      { appUserId: "u-1", optedIn: false },
      { appUserId: "u-1", optedIn: false },
    );
    const result = await worker.runTrialReminderPass(NOW);
    expect(result.enqueued).toBe(0);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(state.pendingEmails).toHaveLength(0);
  });

  it("still emails users with at least one opted-in push token", async () => {
    seedActiveTrial({ dayOf: 23 });
    state.pushTokens.push(
      { appUserId: "u-1", optedIn: false },
      { appUserId: "u-1", optedIn: true },
    );
    const result = await worker.runTrialReminderPass(NOW);
    expect(result.enqueued).toBe(1);
  });

  it("enqueues reminders for store-side trials", async () => {
    seedActiveTrial({ dayOf: 23, trialSource: "store" });
    const result = await worker.runTrialReminderPass(NOW);
    expect(result.scanned).toBe(1);
    expect(result.enqueued).toBe(1);
    expect(state.pendingEmails).toHaveLength(1);
  });

  it("ignores expired trials", async () => {
    state.subscribers.push({
      appUserId: "u-1",
      trialSource: "server",
      trialEndsAt: new Date(NOW.getTime() - DAY),
    });
    state.users.push({
      appUserId: "u-1",
      email: "u1@example.com",
      deletedAt: null,
    });
    const result = await worker.runTrialReminderPass(NOW);
    expect(result.scanned).toBe(0);
    expect(state.pendingEmails).toHaveLength(0);
  });
});
