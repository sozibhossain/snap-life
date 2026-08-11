import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express, { type Express } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface InsertedEvent {
  appUserId: string;
  clientEventId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  occurredAtMs: number | null;
}

interface SeedEvent {
  appUserId: string;
  kind: string;
  /** Server-side timestamp; the weekly window's fallback path filters on this. */
  receivedAt: Date;
  occurredAtMs?: number | null;
}

const userTokensState: { tokens: Map<string, string> } = {
  tokens: new Map<string, string>(),
};
const insertedEvents: InsertedEvent[] = [];
const insertControl: { fail: boolean } = { fail: false };
const weeklyEventsState: { events: SeedEvent[] } = { events: [] };
const weeklySelectControl: { fail: boolean } = { fail: false };

vi.mock("@workspace/db", () => {
  // Use object sentinels (not strings) so the auth bearer-token lookup
  // can be told apart from column references inside the WHERE args, and
  // so the weekly-aggregate mock can recognise which column each clause
  // refers to.
  const interactionEventsTable = {
    __table: "interaction_events",
    appUserId: { __col: "appUserId" },
    kind: { __col: "kind" },
    occurredAtMs: { __col: "occurredAtMs" },
    clientEventId: { __col: "clientEventId" },
    receivedAt: { __col: "receivedAt" },
  } as const;
  const userTokensTable = {
    __table: "user_tokens",
    appUserId: { __col: "appUserId" },
    token: { __col: "token" },
    lastUsedAt: { __col: "lastUsedAt" },
  } as const;

  type Cond = { kind?: string; args?: unknown[] } | undefined;

  // Returns true when the given seeded row satisfies the predicate built
  // by the weekly-aggregate handler. The handler shape is:
  //   and(
  //     eq(appUserId, X),
  //     or(
  //       and(isNotNull(occurredAtMs), gte(occurredAtMs, windowStartMs)),
  //       and(isNull(occurredAtMs),    gte(receivedAt,   windowStart)),
  //     ),
  //   )
  // We walk that tree mirror-image style so the test really asserts the
  // handler's predicate, not just its response shape.
  function matchEvent(cond: Cond, row: SeedEvent): boolean {
    if (!cond) return true;
    if (cond.kind === "and") {
      return (cond.args ?? []).every((c) => matchEvent(c as Cond, row));
    }
    if (cond.kind === "or") {
      return (cond.args ?? []).some((c) => matchEvent(c as Cond, row));
    }
    if (cond.kind === "eq") {
      const args = cond.args ?? [];
      const col = args[0] as { __col?: string } | undefined;
      const val = args[1];
      if (col?.__col === "appUserId") return row.appUserId === val;
      return false;
    }
    if (cond.kind === "gte") {
      const args = cond.args ?? [];
      const col = args[0] as { __col?: string } | undefined;
      const val = args[1];
      if (col?.__col === "occurredAtMs") {
        return row.occurredAtMs != null && row.occurredAtMs >= (val as number);
      }
      if (col?.__col === "receivedAt") {
        return row.receivedAt >= (val as Date);
      }
      return false;
    }
    if (cond.kind === "isNotNull") {
      const args = cond.args ?? [];
      const col = args[0] as { __col?: string } | undefined;
      if (col?.__col === "occurredAtMs") return row.occurredAtMs != null;
      return false;
    }
    if (cond.kind === "isNull") {
      const args = cond.args ?? [];
      const col = args[0] as { __col?: string } | undefined;
      if (col?.__col === "occurredAtMs") return row.occurredAtMs == null;
      return false;
    }
    return true;
  }

  function selectChain() {
    return {
      from: (_tbl: unknown) => ({
        where: (cond: Cond) => ({
          limit: async (_n: number) => {
            // The auth lookup is `eq(userTokensTable.token, <token>)`.
            // Our `eq` mock packs args as { kind: "eq", args: [col, value] };
            // pull the string operand out and resolve it against the
            // configured token map.
            const args = cond?.args ?? [];
            const tokenArg = args.find((a) => typeof a === "string") as
              | string
              | undefined;
            if (!tokenArg) return [] as Array<{ appUserId: string }>;
            const userId = userTokensState.tokens.get(tokenArg);
            return userId ? [{ appUserId: userId }] : [];
          },
          // The weekly aggregate handler ends in `.groupBy(kind)`. We apply
          // the full predicate tree (see matchEvent above) so the test
          // really exercises the handler's WHERE — including the new
          // occurredAtMs-vs-receivedAt branch and timezone window start.
          groupBy: async (_col: unknown) => {
            if (weeklySelectControl.fail) {
              throw new Error("simulated weekly select failure");
            }
            const matched = weeklyEventsState.events.filter((e) =>
              matchEvent(cond, e),
            );
            const counts = new Map<string, number>();
            for (const e of matched) {
              counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
            }
            return Array.from(counts.entries()).map(([kind, count]) => ({
              kind,
              count,
            }));
          },
        }),
      }),
    };
  }

  const db = {
    select: (_cols?: unknown) => selectChain(),
    insert: (_tbl: unknown) => ({
      values: (row: InsertedEvent) => ({
        onConflictDoNothing: async () => {
          if (insertControl.fail) {
            throw new Error("simulated db failure");
          }
          if (
            row.clientEventId &&
            insertedEvents.some(
              (event) =>
                event.appUserId === row.appUserId &&
                event.clientEventId === row.clientEventId,
            )
          ) {
            return;
          }
          insertedEvents.push(row);
        },
      }),
    }),
    // Auth's best-effort `lastUsedAt` refresh is fire-and-forget; return a
    // thenable chain that swallows the trailing `.catch(() => {})`.
    update: (_tbl: unknown) => ({
      set: (_set: unknown) => ({
        where: (_cond: unknown) => ({
          catch: (_fn: (e: unknown) => void) => Promise.resolve(),
        }),
      }),
    }),
  };

  const usersTable = {
    __table: "users",
    appUserId: { __col: "users.appUserId" },
    isAdmin: { __col: "users.isAdmin" },
  } as const;
  return { db, interactionEventsTable, userTokensTable, usersTable };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ kind: "and", args }),
  or: (...args: unknown[]) => ({ kind: "or", args }),
  eq: (...args: unknown[]) => ({ kind: "eq", args }),
  gte: (...args: unknown[]) => ({ kind: "gte", args }),
  isNull: (...args: unknown[]) => ({ kind: "isNull", args }),
  isNotNull: (...args: unknown[]) => ({ kind: "isNotNull", args }),
  sql: Object.assign(
    (..._args: unknown[]) => ({ kind: "sql" }),
    { raw: (..._args: unknown[]) => ({ kind: "sql.raw" }) },
  ),
}));

// Import after the mocks are wired up.
const { default: eventsRouter } = await import("../events");

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use(eventsRouter);
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
  insertedEvents.length = 0;
  insertControl.fail = false;
  weeklyEventsState.events.length = 0;
  weeklySelectControl.fail = false;
});

async function postEvent(
  body: unknown,
  opts: { token?: string | null } = {},
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = opts.token === undefined ? "valid-token" : opts.token;
  if (token != null) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}/events`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function getWeekly(
  opts: { token?: string | null; tz?: string } = {},
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {};
  const token = opts.token === undefined ? "valid-token" : opts.token;
  if (token != null) headers.authorization = `Bearer ${token}`;
  const url = opts.tz
    ? `${baseUrl}/events/weekly?tz=${encodeURIComponent(opts.tz)}`
    : `${baseUrl}/events/weekly`;
  const res = await fetch(url, { method: "GET", headers });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const DAY_MS = 86_400_000;
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY_MS);
}
function msAgo(ms: number): number {
  return Date.now() - ms;
}

// ---- auth gate -----------------------------------------------------------

describe("POST /events — auth gate", () => {
  it("rejects an anonymous request with 401 (no Authorization header)", async () => {
    const res = await postEvent(
      { kind: "rec_shown", payload: { recKind: "nutrition" } },
      { token: null },
    );
    expect(res.status).toBe(401);
    expect(insertedEvents).toHaveLength(0);
  });

  it("rejects an unknown bearer token with 401", async () => {
    const res = await postEvent(
      { kind: "rec_shown", payload: { recKind: "nutrition" } },
      { token: "definitely-not-a-real-token" },
    );
    expect(res.status).toBe(401);
    expect(insertedEvents).toHaveLength(0);
  });
});

describe("POST /events — idempotent client retries", () => {
  it("stores a valid clientEventId", async () => {
    const res = await postEvent({
      clientEventId: "evt-20260811-abc123",
      kind: "lesson_completed",
      payload: { lessonId: "lesson-1" },
    });
    expect(res.status).toBe(200);
    expect(insertedEvents[0]?.clientEventId).toBe("evt-20260811-abc123");
  });

  it("deduplicates a repeated clientEventId", async () => {
    const body = {
      clientEventId: "evt-20260811-duplicate",
      kind: "lesson_completed",
      payload: { lessonId: "lesson-1" },
    };
    expect((await postEvent(body)).status).toBe(200);
    expect((await postEvent(body)).status).toBe(200);
    expect(insertedEvents).toHaveLength(1);
  });

  it("rejects malformed clientEventId values", async () => {
    const res = await postEvent({
      clientEventId: "bad id!",
      kind: "lesson_completed",
    });
    expect(res.status).toBe(400);
    expect(insertedEvents).toHaveLength(0);
  });
});

// ---- rec_* whitelist + recKind persistence -------------------------------

describe("POST /events — rec_* whitelist", () => {
  it.each(["rec_shown", "rec_completed", "rec_dismissed"] as const)(
    "accepts %s and persists the recKind payload field",
    async (kind) => {
      const res = await postEvent({
        kind,
        payload: { surface: "todays_focus", recId: "tf-7", recKind: "nutrition" },
        occurredAtMs: 1_700_000_000_000,
      });
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ ok: true });
      expect(insertedEvents).toHaveLength(1);
      const inserted = insertedEvents[0]!;
      expect(inserted).toMatchObject({
        appUserId: "user-1",
        kind,
        occurredAtMs: 1_700_000_000_000,
      });
      // The whole payload survives, and `recKind` (the field that powers
      // per-kind ranking and the engagement profile) is persisted verbatim.
      expect(inserted.payload).toEqual({
        surface: "todays_focus",
        recId: "tf-7",
        recKind: "nutrition",
      });
      expect(inserted.payload.recKind).toBe("nutrition");
    },
  );

  it("accepts wearables_interest from the Coming-Soon screen", async () => {
    const res = await postEvent({
      kind: "wearables_interest",
      payload: { surface: "settings_wearable" },
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(insertedEvents).toHaveLength(1);
    expect(insertedEvents[0]).toMatchObject({
      appUserId: "user-1",
      kind: "wearables_interest",
    });
    expect(insertedEvents[0]!.payload).toEqual({ surface: "settings_wearable" });
  });

  it("rejects a non-whitelisted kind with 400 and writes nothing", async () => {
    const res = await postEvent({
      kind: "rec_clicked",
      payload: { recKind: "nutrition" },
    });
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: "kind not allowed" });
    expect(insertedEvents).toHaveLength(0);
  });

  it("rejects an arbitrary string kind with 400", async () => {
    const res = await postEvent({
      kind: "definitely_not_in_the_whitelist",
      payload: {},
    });
    expect(res.status).toBe(400);
    expect(insertedEvents).toHaveLength(0);
  });

  it("rejects when kind is missing entirely", async () => {
    const res = await postEvent({ payload: { recKind: "nutrition" } });
    expect(res.status).toBe(400);
    expect(insertedEvents).toHaveLength(0);
  });
});

// ---- payload + appUserId guards (regression-protect surrounding behaviour) -

describe("POST /events — payload and appUserId guards", () => {
  it("defaults payload to {} when omitted", async () => {
    const res = await postEvent({ kind: "rec_shown" });
    expect(res.status).toBe(200);
    expect(insertedEvents).toHaveLength(1);
    expect(insertedEvents[0]!.payload).toEqual({});
  });

  it("rejects a non-object payload with 400", async () => {
    const res = await postEvent({ kind: "rec_shown", payload: [1, 2, 3] });
    expect(res.status).toBe(400);
    expect(insertedEvents).toHaveLength(0);
  });

  it("returns 403 when the body's appUserId does not match the authed user", async () => {
    const res = await postEvent({
      kind: "rec_completed",
      payload: { recKind: "wellbeing" },
      appUserId: "someone-else",
    });
    expect(res.status).toBe(403);
    expect(insertedEvents).toHaveLength(0);
  });

  it("accepts a body appUserId that matches the authed user", async () => {
    const res = await postEvent({
      kind: "rec_completed",
      payload: { recKind: "wellbeing" },
      appUserId: "user-1",
    });
    expect(res.status).toBe(200);
    expect(insertedEvents).toHaveLength(1);
    expect(insertedEvents[0]!.appUserId).toBe("user-1");
  });
});

// ---- occurredAtMs sizing — regression for the int4 overflow bug ----------

describe("POST /events — large occurredAtMs (Date.now-shaped) round-trips", () => {
  // The `occurred_at_ms` column was originally declared as Postgres int4
  // (max ~2.147e9). The mobile client sends `Date.now()` (~1.7e12+), which
  // overflowed the column and silently dropped the value on every insert,
  // forcing `GET /events/weekly` to fall back to `receivedAt` for every row
  // (the bug Task #26 fixes). Pin both an actual `Date.now()` and a value
  // well past the int4 ceiling so a future schema regression is caught here
  // rather than in production.
  it.each([
    ["actual Date.now()", Date.now()] as const,
    ["explicit > int4 max", 2_147_483_648 + 1] as const,
    ["mid-2026-shaped ms", 1_777_000_000_000] as const,
  ])("accepts %s and persists the exact ms value", async (_label, ms) => {
    const res = await postEvent({
      kind: "snap_shot_read",
      payload: { tipId: "t1" },
      occurredAtMs: ms,
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(insertedEvents).toHaveLength(1);
    expect(insertedEvents[0]!.occurredAtMs).toBe(ms);
  });
});

// ---- DB failure surfaces as 500 (and never silently swallows) ------------

describe("POST /events — db failure", () => {
  it("returns 500 when the underlying insert throws", async () => {
    insertControl.fail = true;
    const res = await postEvent({
      kind: "rec_shown",
      payload: { recKind: "nutrition" },
    });
    expect(res.status).toBe(500);
    expect(res.json).toMatchObject({ error: "internal" });
    expect(insertedEvents).toHaveLength(0);
  });
});

// ---- GET /events/weekly — auth gate -------------------------------------

describe("GET /events/weekly — auth gate", () => {
  it("rejects an anonymous request with 401 (no Authorization header)", async () => {
    // Seed events for user-1 so a regression that ignored auth would
    // wrongly hand them back instead of 401-ing.
    weeklyEventsState.events.push(
      { appUserId: "user-1", kind: "snap_shot_read", receivedAt: daysAgo(1) },
    );
    const res = await getWeekly({ token: null });
    expect(res.status).toBe(401);
    expect(res.json).not.toMatchObject({ counts: expect.anything() });
  });

  it("rejects an unknown bearer token with 401", async () => {
    weeklyEventsState.events.push(
      { appUserId: "user-1", kind: "snap_shot_read", receivedAt: daysAgo(1) },
    );
    const res = await getWeekly({ token: "definitely-not-a-real-token" });
    expect(res.status).toBe(401);
    expect(res.json).not.toMatchObject({ counts: expect.anything() });
  });
});

// ---- GET /events/weekly — response shape & filtering --------------------

describe("GET /events/weekly — response", () => {
  it("returns the documented shape { appUserId, windowDays: 7, tz, windowStartMs, counts }", async () => {
    const res = await getWeekly();
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      appUserId: "user-1",
      windowDays: 7,
      tz: "UTC",
      counts: {},
    });
    const json = res.json as { windowStartMs: number };
    expect(typeof json.windowStartMs).toBe("number");
  });

  it("aggregates the authed user's last-7-days events grouped by kind", async () => {
    // Mix of legacy (occurredAtMs null → falls back to receivedAt) rows so
    // the aggregate has to traverse both branches of the new predicate.
    weeklyEventsState.events.push(
      { appUserId: "user-1", kind: "snap_shot_read", receivedAt: daysAgo(1) },
      { appUserId: "user-1", kind: "snap_shot_read", receivedAt: daysAgo(3) },
      { appUserId: "user-1", kind: "today_focus_completed", receivedAt: daysAgo(2) },
    );
    const res = await getWeekly();
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      appUserId: "user-1",
      windowDays: 7,
      counts: { snap_shot_read: 2, today_focus_completed: 1 },
    });
  });

  it("returns counts only for the authed user (never another user's rows)", async () => {
    weeklyEventsState.events.push(
      // authed user — should be counted
      { appUserId: "user-1", kind: "snap_shot_read", receivedAt: daysAgo(1) },
      { appUserId: "user-1", kind: "today_focus_completed", receivedAt: daysAgo(2) },
      // a different user — must NOT leak into the response
      { appUserId: "user-2", kind: "snap_shot_read", receivedAt: daysAgo(1) },
      { appUserId: "user-2", kind: "snap_shot_read", receivedAt: daysAgo(2) },
      { appUserId: "user-2", kind: "calcium_logged", receivedAt: daysAgo(3) },
    );
    const res = await getWeekly();
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      appUserId: "user-1",
      windowDays: 7,
      counts: { snap_shot_read: 1, today_focus_completed: 1 },
    });
    // Belt-and-braces: nothing from user-2's "calcium_logged" should appear.
    const json = res.json as { counts: Record<string, number> };
    expect(json.counts).not.toHaveProperty("calcium_logged");
  });

  it("includes only the trailing 7 days (events older than the window are excluded)", async () => {
    weeklyEventsState.events.push(
      // in window
      { appUserId: "user-1", kind: "snap_shot_read", receivedAt: daysAgo(1) },
      { appUserId: "user-1", kind: "snap_shot_read", receivedAt: daysAgo(5) },
      // out of window — comfortably older than 7 local days back
      { appUserId: "user-1", kind: "snap_shot_read", receivedAt: daysAgo(15) },
      { appUserId: "user-1", kind: "calcium_logged", receivedAt: daysAgo(30) },
    );
    const res = await getWeekly();
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      appUserId: "user-1",
      windowDays: 7,
      counts: { snap_shot_read: 2 },
    });
    const json = res.json as { counts: Record<string, number> };
    // The 30-days-ago calcium_logged row must not appear at all.
    expect(json.counts).not.toHaveProperty("calcium_logged");
  });

  it("uses the bearer-token identity, not any URL/body input", async () => {
    // Mint a second user and confirm the response carries *that* id, not
    // the default "user-1", proving identity is sourced from the token.
    userTokensState.tokens.set("user-2-token", "user-2");
    weeklyEventsState.events.push(
      { appUserId: "user-1", kind: "snap_shot_read", receivedAt: daysAgo(1) },
      { appUserId: "user-2", kind: "today_focus_completed", receivedAt: daysAgo(1) },
    );
    const res = await getWeekly({ token: "user-2-token" });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      appUserId: "user-2",
      windowDays: 7,
      counts: { today_focus_completed: 1 },
    });
  });

  it("returns 500 when the aggregate query throws", async () => {
    weeklySelectControl.fail = true;
    const res = await getWeekly();
    expect(res.status).toBe(500);
    expect(res.json).toMatchObject({ error: "internal" });
  });
});

// ---- GET /events/weekly — occurredAtMs vs receivedAt ---------------------

describe("GET /events/weekly — occurredAtMs preferred, receivedAt fallback", () => {
  it("filters using occurredAtMs when present (a stale receivedAt does not pull a row in)", async () => {
    // Imagine a queued client event: it actually occurred 30 days ago in
    // the user's life, but the client backfilled it today and `receivedAt`
    // is "now". The new behaviour MUST drop it from the weekly window —
    // anchoring on the user's local moment, not the server clock.
    weeklyEventsState.events.push({
      appUserId: "user-1",
      kind: "session_completed",
      receivedAt: new Date(),
      occurredAtMs: msAgo(30 * DAY_MS),
    });
    const res = await getWeekly();
    expect(res.status).toBe(200);
    const json = res.json as { counts: Record<string, number> };
    expect(json.counts).not.toHaveProperty("session_completed");
  });

  it("filters using occurredAtMs when present (a stale receivedAt does not exclude a recent row)", async () => {
    // The mirror image: receivedAt is ancient (e.g. row was inserted
    // weeks late) but the user's `occurredAtMs` is from yesterday. The
    // row should appear in the weekly count.
    weeklyEventsState.events.push({
      appUserId: "user-1",
      kind: "calcium_logged",
      receivedAt: daysAgo(40),
      occurredAtMs: msAgo(1 * DAY_MS),
    });
    const res = await getWeekly();
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      counts: { calcium_logged: 1 },
    });
  });

  it("falls back to receivedAt when occurredAtMs is null (legacy rows still count)", async () => {
    weeklyEventsState.events.push(
      { appUserId: "user-1", kind: "snap_shot_read", receivedAt: daysAgo(2), occurredAtMs: null },
      { appUserId: "user-1", kind: "snap_shot_read", receivedAt: daysAgo(20), occurredAtMs: null },
    );
    const res = await getWeekly();
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      counts: { snap_shot_read: 1 },
    });
  });
});

// ---- GET /events/weekly — timezone-aware window -------------------------

describe("GET /events/weekly — timezone window", () => {
  it("returns the requested IANA timezone in the response when valid", async () => {
    const res = await getWeekly({ tz: "Asia/Tokyo" });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ tz: "Asia/Tokyo" });
  });

  it("falls back to UTC when the tz query is unrecognised", async () => {
    const res = await getWeekly({ tz: "Not/AReal_Zone" });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ tz: "UTC" });
  });

  it("anchors the 7-day window on local midnight, not UTC midnight", async () => {
    // Pick a fixed IANA zone so the assertion is independent of where
    // the test happens to run. The window start the handler computes
    // must align with the most recent local midnight in that zone, then
    // back up six prior local days.
    const tz = "Asia/Tokyo";
    const res = await getWeekly({ tz });
    expect(res.status).toBe(200);
    const json = res.json as { windowStartMs: number; tz: string };
    expect(json.tz).toBe(tz);

    // Re-derive the expected start using the same Intl primitives the
    // handler uses, then assert the response matches.
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const now = new Date();
    const m: Record<string, string> = {};
    for (const p of fmt.formatToParts(now)) m[p.type] = p.value;
    const hour = m.hour === "24" ? "00" : m.hour;
    const targetLocalAsUtc = Date.UTC(
      +m.year,
      +m.month - 1,
      +m.day,
      0,
      0,
      0,
    );
    const sinceLocalMidnight =
      +hour * 3_600_000 + +m.minute * 60_000 + +m.second * 1_000;
    let guess = now.getTime() - sinceLocalMidnight;
    for (let i = 0; i < 3; i++) {
      const g: Record<string, string> = {};
      for (const p of fmt.formatToParts(new Date(guess))) g[p.type] = p.value;
      const gh = g.hour === "24" ? "00" : g.hour;
      const guessLocalAsUtc = Date.UTC(
        +g.year,
        +g.month - 1,
        +g.day,
        +gh,
        +g.minute,
        +g.second,
      );
      const delta = targetLocalAsUtc - guessLocalAsUtc;
      if (delta === 0) break;
      guess += delta;
    }
    const expectedWindowStartMs = guess - 6 * DAY_MS;
    // Allow a tiny clock-drift fudge for the two `new Date()` calls
    // straddling the request — they almost always coincide, but one
    // extra millisecond shouldn't break the test.
    expect(Math.abs(json.windowStartMs - expectedWindowStartMs)).toBeLessThan(
      2_000,
    );
  });

  it("UTC and far-east tz disagree for events near the user's local day boundary", async () => {
    // Construct an event with an `occurredAtMs` that lies just before
    // UTC's "7 days ago" line but comfortably inside Asia/Tokyo's
    // 7-local-day window. The UTC caller should miss it; the Tokyo
    // caller should pick it up. This is the core scenario the task
    // exists to fix — far-east users losing the most recent local day.
    const utcRes = await getWeekly();
    const utcJson = utcRes.json as { windowStartMs: number };
    const utcStart = utcJson.windowStartMs;

    const tokyoRes = await getWeekly({ tz: "Asia/Tokyo" });
    const tokyoJson = tokyoRes.json as { windowStartMs: number };
    const tokyoStart = tokyoJson.windowStartMs;

    // Place the event 30 minutes before UTC's window start, which
    // sits well inside Tokyo's window (Tokyo midnight is 9 hours
    // earlier in UTC than UTC midnight, so its window start is up to
    // ~9 hours earlier in absolute time).
    const occurredAtMs = utcStart - 30 * 60_000;
    expect(occurredAtMs).toBeGreaterThanOrEqual(tokyoStart);

    weeklyEventsState.events.push({
      appUserId: "user-1",
      kind: "today_focus_completed",
      // Intentionally make receivedAt also stale so we can tell the
      // window logic is using occurredAtMs / windowStartMs, not the
      // legacy receivedAt path.
      receivedAt: new Date(occurredAtMs),
      occurredAtMs,
    });

    const utcAfter = await getWeekly();
    const tokyoAfter = await getWeekly({ tz: "Asia/Tokyo" });
    const utcCounts = (utcAfter.json as { counts: Record<string, number> })
      .counts;
    const tokyoCounts = (tokyoAfter.json as { counts: Record<string, number> })
      .counts;
    expect(utcCounts.today_focus_completed).toBeUndefined();
    expect(tokyoCounts.today_focus_completed).toBe(1);
  });
});
