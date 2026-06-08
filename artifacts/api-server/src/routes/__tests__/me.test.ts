/**
 * Integration tests for the GDPR self-serve surface (`/api/me/*`) plus
 * a sanity check on the admin gate guarding `/api/admin/test-accounts`.
 *
 * Coverage (per Task #34 acceptance):
 *   - GET  /api/me/export      → archive shape contains every domain section.
 *   - DELETE /api/me           → soft-deletes user, redacts free-text PII,
 *                                hard-deletes push/legacy tokens, and calls
 *                                Clerk `users.deleteUser` for the upstream
 *                                account; queues a confirmation email log.
 *   - POST /api/me/reset       → 403 for non-tester, 200 + DELETE fan-out
 *                                for tester.
 *   - POST /api/admin/test-accounts → 403 when caller is not an admin.
 *
 * Mocks:
 *   - @workspace/db         : tiny in-memory store with chainable
 *                             select/update/delete/insert verbs.
 *   - drizzle-orm           : `eq`/`or` returns tagged predicates the
 *                             mock interpreter ignores (we read state
 *                             by table, not by predicate).
 *   - ../../lib/auth        : `requireUser` / `requireAdminUser` switched
 *                             via `state.authMode`.
 *   - @clerk/express        : `clerkClient.users.deleteUser` is a spy.
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

type AuthMode = "tester" | "regular" | "admin" | "nonAdmin" | "unauth";

const state = {
  authMode: "regular" as AuthMode,
  appUserId: "user-1",
  clerkUserId: "clerk-1" as string | null,
  // Per-table stores. The mock `select().from(t)` returns the array
  // for `t`; mutations replace / filter the array in place so the
  // tests can assert against the post-state.
  tables: new Map<string, Array<Record<string, unknown>>>(),
};

function tbl(name: string): Array<Record<string, unknown>> {
  let rows = state.tables.get(name);
  if (!rows) {
    rows = [];
    state.tables.set(name, rows);
  }
  return rows;
}

function resetState() {
  state.authMode = "regular";
  state.appUserId = "user-1";
  state.clerkUserId = "clerk-1";
  state.tables.clear();
  // Seed a baseline user row so DELETE /me has something to read.
  tbl("users").push({
    appUserId: "user-1",
    clerkUserId: "clerk-1",
    email: "user1@example.com",
    displayName: "User One",
    isAdmin: false,
    isTester: false,
    deletedAt: null,
    hardDeleteAfter: null,
  });
}

const clerkDeleteUser = vi.fn(async (id: string) => ({ id, deleted: true }));

// /me/avatar reaches into object storage to validate the uploaded blob's
// content-type and size before persisting the path. The test stub lets
// us drive every branch (200 happy path, 415 wrong mime, 413 too large,
// 404 unknown object) without standing up the GCS sidecar.
const objectStorageState = {
  meta: { contentType: "image/jpeg", size: 200_000 } as {
    contentType: string;
    size: number;
  } | null,
};

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityFile(_path: string) {
      if (!objectStorageState.meta) {
        throw new Error("not found");
      }
      const meta = objectStorageState.meta;
      return {
        getMetadata: async () => [meta],
        // setObjectAclPolicy calls .exists() and .setMetadata() on the
        // file; satisfy both so the avatar happy-path doesn't throw.
        exists: async () => [true],
        setMetadata: async (_m: unknown) => undefined,
        name: "mock-object",
      };
    }
    normalizeObjectEntityPath(p: string) {
      return p;
    }
  },
}));

vi.mock("../../lib/objectAcl", () => ({
  setObjectAclPolicy: vi.fn(async () => undefined),
}));

vi.mock("@clerk/express", () => ({
  clerkClient: {
    users: {
      deleteUser: (id: string) => clerkDeleteUser(id),
    },
  },
}));

vi.mock("../../lib/auth", () => {
  type Res = { status: (n: number) => { json: (b: unknown) => void } };
  return {
    requireUser: async (_req: unknown, res: Res) => {
      if (state.authMode === "unauth") {
        res.status(401).json({ error: "missing bearer token" });
        return null;
      }
      return {
        appUserId: state.appUserId,
        isAdmin: state.authMode === "admin",
        isTester: state.authMode === "tester",
        source: "clerk" as const,
      };
    },
    requireAdminUser: async (_req: unknown, res: Res) => {
      if (state.authMode === "unauth") {
        res.status(401).json({ error: "missing bearer token" });
        return null;
      }
      if (state.authMode !== "admin") {
        res.status(403).json({ error: "admin required" });
        return null;
      }
      return { appUserId: state.appUserId, isAdmin: true, source: "clerk" };
    },
    requireUserAuth: async () => state.appUserId,
    assertSelf: () => false,
    clerkAuthOf: () => ({ userId: null, sessionClaims: null }),
  };
});

interface ColRef {
  __t: string;
  __c: string;
}

function isColRef(x: unknown): x is ColRef {
  return typeof x === "object" && x !== null && "__t" in (x as object);
}

function tableProxy(name: string): unknown {
  return new Proxy(
    { __t: name },
    {
      get(target, prop) {
        if (prop === "__t") return target.__t;
        if (typeof prop !== "string") return undefined;
        return { __t: name, __c: prop } as ColRef;
      },
    },
  );
}

vi.mock("@workspace/db", () => {
  const tableNames = [
    "users",
    "userProfile",
    "nutritionLogs",
    "activityLogs",
    "mealPlanDays",
    "wellbeingEntries",
    "gamificationState",
    "badgeUnlocks",
    "assessmentResults",
    "supplementState",
    "pushTokens",
    "pushUserState",
    "interactionEvents",
    "userTokens",
    "subscribers",
    "subscriptionEvents",
    "feedback",
    "pendingEmails",
  ];
  const proxies: Record<string, unknown> = {};
  for (const n of tableNames) proxies[n] = tableProxy(n);

  // Resolve the table name a select/update/delete is targeting. We
  // accept either the proxy object directly or a select-shape object
  // whose first ColRef value carries the table tag.
  function tableNameOf(target: unknown): string {
    if (target && typeof target === "object" && "__t" in target) {
      return (target as { __t: string }).__t;
    }
    if (target && typeof target === "object") {
      for (const v of Object.values(target as Record<string, unknown>)) {
        if (isColRef(v)) return v.__t;
      }
    }
    return "_unknown";
  }

  function selectShape(
    rows: Array<Record<string, unknown>>,
    shape: unknown,
  ): Array<Record<string, unknown>> {
    if (!shape || typeof shape !== "object") return rows;
    const entries = Object.entries(shape as Record<string, unknown>);
    if (entries.every(([, v]) => !isColRef(v))) return rows;
    return rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of entries) {
        if (isColRef(v)) out[k] = r[v.__c];
        else out[k] = v;
      }
      return out;
    });
  }

  const db = {
    select(shape?: unknown) {
      return {
        from(t: unknown) {
          const name = tableNameOf(shape ?? t);
          let rows = tbl(name);
          const chain = {
            where(_cond: unknown) {
              // Per-user predicate is implicit — the test seeds only
              // rows for the active appUserId, so returning the table
              // unchanged is equivalent.
              return chain;
            },
            limit(n: number) {
              return Promise.resolve(selectShape(rows, shape).slice(0, n));
            },
            then<T>(
              resolve: (v: Array<Record<string, unknown>>) => T,
              reject?: (err: unknown) => unknown,
            ) {
              try {
                return Promise.resolve(resolve(selectShape(rows, shape)));
              } catch (err) {
                if (reject) return Promise.resolve(reject(err));
                return Promise.reject(err);
              }
            },
          };
          return chain;
        },
      };
    },
    update(t: unknown) {
      const name = tableNameOf(t);
      return {
        set(patch: Record<string, unknown>) {
          return {
            where(_cond: unknown) {
              const rows = tbl(name);
              for (const r of rows) Object.assign(r, patch);
              return Promise.resolve();
            },
          };
        },
      };
    },
    delete(t: unknown) {
      const name = tableNameOf(t);
      return {
        where(_cond: unknown) {
          state.tables.set(name, []);
          return Promise.resolve();
        },
      };
    },
    insert(t: unknown) {
      const name = tableNameOf(t);
      return {
        values(row: Record<string, unknown>) {
          // Plain insert returns a thenable; the upsert chain layers
          // onConflictDoUpdate on top, keyed by appUserId (the only
          // unique column we care about in these tests).
          const inserted = { ...row };
          const chain = {
            onConflictDoUpdate(opts: { set: Record<string, unknown> }) {
              const rows = tbl(name);
              const idx = rows.findIndex(
                (r) => r.appUserId === inserted.appUserId,
              );
              if (idx >= 0) {
                Object.assign(rows[idx]!, opts.set);
              } else {
                rows.push({ ...inserted });
              }
              return Promise.resolve();
            },
            then<T>(
              resolve: (v: void) => T,
              reject?: (err: unknown) => unknown,
            ) {
              try {
                tbl(name).push(inserted);
                return Promise.resolve(resolve(undefined as void));
              } catch (err) {
                if (reject) return Promise.resolve(reject(err));
                return Promise.reject(err);
              }
            },
          };
          return chain;
        },
      };
    },
  };

  return {
    db,
    usersTable: proxies.users,
    userProfileTable: proxies.userProfile,
    nutritionLogsTable: proxies.nutritionLogs,
    activityLogsTable: proxies.activityLogs,
    mealPlanDaysTable: proxies.mealPlanDays,
    wellbeingEntriesTable: proxies.wellbeingEntries,
    gamificationStateTable: proxies.gamificationState,
    badgeUnlocksTable: proxies.badgeUnlocks,
    assessmentResultsTable: proxies.assessmentResults,
    supplementStateTable: proxies.supplementState,
    pushTokensTable: proxies.pushTokens,
    pushUserStateTable: proxies.pushUserState,
    interactionEventsTable: proxies.interactionEvents,
    userTokensTable: proxies.userTokens,
    subscribersTable: proxies.subscribers,
    subscriptionEventsTable: proxies.subscriptionEvents,
    feedbackTable: proxies.feedback,
    pendingEmailsTable: proxies.pendingEmails,
  };
});

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ kind: "eq", a, b }),
  or: (...args: unknown[]) => ({ kind: "or", args }),
  and: (...args: unknown[]) => ({ kind: "and", args }),
  desc: (col: unknown) => ({ kind: "desc", col }),
  count: () => ({ __agg: "count" }),
  ilike: (a: unknown, b: unknown) => ({ kind: "ilike", a, b }),
  gte: (a: unknown, b: unknown) => ({ kind: "gte", a, b }),
  lt: (a: unknown, b: unknown) => ({ kind: "lt", a, b }),
  sql: () => ({ __sql: "noop" }),
}));

let app: Express;
let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const { default: meRouter } = await import("../me");
  const { default: adminRouter } = await import("../admin");
  app = express();
  app.use(express.json());
  app.use("/api", meRouter);
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

const ORIGINAL_SNAP_LIFE_ENV = process.env.SNAP_LIFE_ENV;

afterAll(() => {
  process.env.SNAP_LIFE_ENV = ORIGINAL_SNAP_LIFE_ENV;
});

beforeEach(() => {
  resetState();
  clerkDeleteUser.mockClear();
  // Tester reset + admin test-accounts are gated on staging — opt-in
  // here so the gate-positive cases work; the gate-negative cases
  // override the env locally.
  process.env.SNAP_LIFE_ENV = "staging";
});

describe("GET /api/me/export", () => {
  it("returns the full archive shape with every documented section", async () => {
    // Seed a couple of rows in different domains so we can verify the
    // route is actually fanning out across tables (not just returning a
    // skeleton).
    tbl("nutritionLogs").push({
      id: 1,
      appUserId: "user-1",
      kcal: 500,
    });
    tbl("activityLogs").push({
      id: 1,
      appUserId: "user-1",
      kind: "walk",
    });
    tbl("feedback").push({
      id: 1,
      appUserId: "user-1",
      message: "nice app",
      tags: [],
    });
    tbl("interactionEvents").push({
      appUserId: "user-1",
      kind: "view",
      payload: { route: "/home" },
    });

    const res = await fetch(`${baseUrl}/me/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain(
      `snap-life-export-user-1.json`,
    );
    const body = (await res.json()) as Record<string, unknown>;

    // Every section enumerated in the route must be present in the
    // response — the export contract is what GDPR Subject Access asks
    // us to honour.
    for (const key of [
      "schemaVersion",
      "exportedAt",
      "appUserId",
      "user",
      "userProfile",
      "nutritionLogs",
      "activityLogs",
      "mealPlanDays",
      "wellbeingEntries",
      "gamificationState",
      "badgeUnlocks",
      "assessmentResults",
      "supplementState",
      "pushTokens",
      "pushUserState",
      "interactionEvents",
      "subscriber",
      "subscriptionEvents",
      "feedback",
    ]) {
      expect(body).toHaveProperty(key);
    }
    expect(body.appUserId).toBe("user-1");
    expect(Array.isArray(body.nutritionLogs)).toBe(true);
    expect((body.nutritionLogs as unknown[]).length).toBe(1);
    expect((body.feedback as Array<{ message: string }>)[0]?.message).toBe(
      "nice app",
    );
  });

  it("returns 401 when the request is unauthenticated", async () => {
    state.authMode = "unauth";
    const res = await fetch(`${baseUrl}/me/export`);
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/me", () => {
  it("soft-deletes the user, cascades through related tables, and calls Clerk", async () => {
    // Seed PII-bearing rows we expect to be redacted/hard-deleted.
    tbl("pushTokens").push({ appUserId: "user-1", token: "expo-xxx" });
    tbl("pushUserState").push({ appUserId: "user-1", lastSentAt: new Date() });
    tbl("userTokens").push({
      appUserId: "user-1",
      token: "legacy-bearer",
    });
    tbl("feedback").push({
      id: 1,
      appUserId: "user-1",
      message: "secret feelings",
      tags: ["beta"],
    });
    tbl("interactionEvents").push({
      appUserId: "user-1",
      kind: "chat",
      payload: { question: "private question" },
    });
    tbl("wellbeingEntries").push({
      appUserId: "user-1",
      entry: { mood: "😢", sessionName: "evening journal" },
    });
    tbl("userProfile").push({
      appUserId: "user-1",
      name: "Real Name",
      email: "user1@example.com",
      avatar: "data:image/jpeg;base64,FACEDATA",
      gender: "female",
      condition: "osteoporosis",
      preferences: { unit: "kg" },
      country: "GB",
      timezone: "Europe/London",
    });

    const res = await fetch(`${baseUrl}/me`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      confirmationEmailQueued: true,
    });
    expect(typeof body.deletedAt).toBe("string");
    expect(typeof body.hardDeleteAfter).toBe("string");

    // users row PII redacted + soft-delete columns set.
    const userRow = tbl("users")[0]!;
    expect(userRow.email).toBeNull();
    expect(userRow.displayName).toBeNull();
    expect(userRow.deletedAt).toBeInstanceOf(Date);
    expect(userRow.hardDeleteAfter).toBeInstanceOf(Date);

    // Push + legacy bearer tokens are hard-deleted (no replay risk).
    expect(tbl("pushTokens").length).toBe(0);
    expect(tbl("pushUserState").length).toBe(0);
    expect(tbl("userTokens").length).toBe(0);

    // Free-text payloads on retained rows are scrubbed.
    expect(tbl("feedback")[0]).toMatchObject({
      message: "[redacted]",
      tags: [],
    });
    expect(tbl("interactionEvents")[0]?.payload).toEqual({});
    expect(tbl("wellbeingEntries")[0]?.entry).toEqual({ kind: "redacted" });

    // user_profile PII (incl. the new biometric-adjacent profile photo
    // AND locale fields per the GDPR cascade spec) is scrubbed in
    // place — the row itself is retained for the 30d grace window.
    const profile = tbl("userProfile")[0]!;
    expect(profile.name).toBeNull();
    expect(profile.email).toBeNull();
    expect(profile.avatar).toBeNull();
    expect(profile.gender).toBeNull();
    expect(profile.condition).toBeNull();
    expect(profile.preferences).toEqual({});
    expect(profile.country).toBeNull();
    expect(profile.timezone).toBeNull();

    // Clerk SDK called with the upstream user id captured before the
    // local row was redacted.
    expect(clerkDeleteUser).toHaveBeenCalledTimes(1);
    expect(clerkDeleteUser).toHaveBeenCalledWith("clerk-1");

    // Confirmation email row appended to the queue.
    const pending = tbl("pendingEmails");
    expect(pending.length).toBe(1);
    expect(pending[0]).toMatchObject({
      kind: "account_deletion_confirmation",
      toAddress: "user1@example.com",
    });
  });

  it("still returns 200 when Clerk delete throws (best-effort)", async () => {
    clerkDeleteUser.mockRejectedValueOnce(new Error("clerk down"));
    const res = await fetch(`${baseUrl}/me`, { method: "DELETE" });
    expect(res.status).toBe(200);
    // Local soft-delete must have happened regardless.
    expect(tbl("users")[0]?.deletedAt).toBeInstanceOf(Date);
  });

  it("does not call Clerk when the user has no clerkUserId", async () => {
    tbl("users")[0]!.clerkUserId = null;
    const res = await fetch(`${baseUrl}/me`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(clerkDeleteUser).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/me/profile", () => {
  beforeEach(resetState);

  it("returns 401 when unauthenticated", async () => {
    state.authMode = "unauth";
    const res = await fetch(`${baseUrl}/me/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country: "GB" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects an empty patch with 400", async () => {
    const res = await fetch(`${baseUrl}/me/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed country code", async () => {
    const res = await fetch(`${baseUrl}/me/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country: "british" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/ISO 3166/);
  });

  it("rejects an invalid IANA timezone", async () => {
    const res = await fetch(`${baseUrl}/me/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: "Mars/Phobos" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/IANA/);
  });

  it("rejects oversized bodies (defense in depth)", async () => {
    const big = "x".repeat(8 * 1024);
    const res = await fetch(`${baseUrl}/me/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country: "GB", filler: big }),
    });
    expect(res.status).toBe(400);
  });

  it("seeds the profile row on first patch and returns the new state", async () => {
    const res = await fetch(`${baseUrl}/me/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country: "GB", timezone: "Europe/London" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      profile: { country: string; timezone: string; avatarUrl: string | null };
    };
    expect(body.ok).toBe(true);
    expect(body.profile.country).toBe("GB");
    expect(body.profile.timezone).toBe("Europe/London");
    expect(tbl("userProfile")[0]).toMatchObject({
      appUserId: "user-1",
      country: "GB",
      timezone: "Europe/London",
    });
  });

  it("updates an existing row in place and accepts partial patches", async () => {
    tbl("userProfile").push({
      appUserId: "user-1",
      country: "GB",
      timezone: "Europe/London",
      avatar: "/objects/abc",
    });
    const res = await fetch(`${baseUrl}/me/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: "Asia/Tokyo" }),
    });
    expect(res.status).toBe(200);
    const profile = tbl("userProfile")[0]!;
    expect(profile.country).toBe("GB"); // untouched
    expect(profile.timezone).toBe("Asia/Tokyo");
    expect(profile.avatar).toBe("/objects/abc");
  });

  it("accepts explicit nulls to clear locale fields", async () => {
    tbl("userProfile").push({
      appUserId: "user-1",
      country: "GB",
      timezone: "Europe/London",
    });
    const res = await fetch(`${baseUrl}/me/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country: null, timezone: null }),
    });
    expect(res.status).toBe(200);
    const profile = tbl("userProfile")[0]!;
    expect(profile.country).toBeNull();
    expect(profile.timezone).toBeNull();
  });
});

describe("POST /api/me/avatar", () => {
  beforeEach(() => {
    resetState();
    objectStorageState.meta = { contentType: "image/jpeg", size: 200_000 };
  });

  it("returns 401 when unauthenticated", async () => {
    state.authMode = "unauth";
    const res = await fetch(`${baseUrl}/me/avatar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objectPath: "/objects/uploads/abc" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a malformed objectPath with 400", async () => {
    const res = await fetch(`${baseUrl}/me/avatar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objectPath: "https://evil.example/avatar.png" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects unsupported mime types with 415", async () => {
    objectStorageState.meta = {
      contentType: "application/x-msdownload",
      size: 4096,
    };
    const res = await fetch(`${baseUrl}/me/avatar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objectPath: "/objects/uploads/evil.exe" }),
    });
    expect(res.status).toBe(415);
  });

  it("rejects oversized objects with 413", async () => {
    objectStorageState.meta = {
      contentType: "image/png",
      size: 50 * 1024 * 1024,
    };
    const res = await fetch(`${baseUrl}/me/avatar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objectPath: "/objects/uploads/huge.png" }),
    });
    expect(res.status).toBe(413);
  });

  it("returns 404 when the object does not exist", async () => {
    objectStorageState.meta = null;
    const res = await fetch(`${baseUrl}/me/avatar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objectPath: "/objects/uploads/missing" }),
    });
    expect(res.status).toBe(404);
  });

  it("persists the path to user_profile.avatar on success", async () => {
    const res = await fetch(`${baseUrl}/me/avatar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objectPath: "/objects/uploads/abc-123" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; avatarUrl: string };
    expect(body.ok).toBe(true);
    expect(body.avatarUrl).toBe("/api/storage/objects/uploads/abc-123");
    expect(tbl("userProfile")[0]).toMatchObject({
      appUserId: "user-1",
      avatar: "/api/storage/objects/uploads/abc-123",
    });
  });
});

describe("POST /api/me/reset", () => {
  it("returns 404 in non-staging environments (defense in depth)", async () => {
    process.env.SNAP_LIFE_ENV = "production";
    state.authMode = "tester";
    const res = await fetch(`${baseUrl}/me/reset`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("rejects non-tester accounts with 403", async () => {
    state.authMode = "regular";
    const res = await fetch(`${baseUrl}/me/reset`, { method: "POST" });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("tester_only");
  });

  it("wipes per-user domain rows for tester accounts", async () => {
    state.authMode = "tester";
    tbl("nutritionLogs").push({ appUserId: "user-1", kcal: 100 });
    tbl("activityLogs").push({ appUserId: "user-1", kind: "walk" });
    tbl("wellbeingEntries").push({ appUserId: "user-1", entry: {} });
    tbl("interactionEvents").push({
      appUserId: "user-1",
      kind: "view",
      payload: {},
    });

    const res = await fetch(`${baseUrl}/me/reset`, { method: "POST" });
    expect(res.status).toBe(200);

    expect(tbl("nutritionLogs").length).toBe(0);
    expect(tbl("activityLogs").length).toBe(0);
    expect(tbl("wellbeingEntries").length).toBe(0);
    expect(tbl("interactionEvents").length).toBe(0);
    // The user row itself is intentionally retained so the tester can
    // re-run onboarding under the same identity.
    expect(tbl("users").length).toBe(1);
  });
});

describe("DELETE /api/admin/users/:id (GDPR admin override)", () => {
  beforeEach(() => {
    // Reuse the same baseline `user-1` row, but seed the cascade-target
    // rows + a separate admin row so we can assert the admin gate too.
    tbl("users").push({
      appUserId: "admin-1",
      clerkUserId: "clerk-admin",
      email: "admin@example.com",
      displayName: "Admin",
      isAdmin: true,
      isTester: false,
      deletedAt: null,
      hardDeleteAfter: null,
    });
    tbl("pushTokens").push({ appUserId: "user-1", token: "expo-xxx" });
    tbl("userTokens").push({ appUserId: "user-1", token: "legacy-bearer" });
    tbl("feedback").push({
      id: 99,
      appUserId: "user-1",
      message: "secret feelings",
      tags: ["beta"],
    });
    tbl("interactionEvents").push({
      appUserId: "user-1",
      kind: "chat",
      payload: { question: "private question" },
    });
    tbl("wellbeingEntries").push({
      appUserId: "user-1",
      entry: { mood: "😢", sessionName: "evening journal" },
    });
  });

  it("returns 401 when the caller is unauthenticated", async () => {
    state.authMode = "unauth";
    const res = await fetch(`${baseUrl}/admin/users/user-1`, {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
    // Cascade must NOT have run.
    expect(tbl("pushTokens").length).toBe(1);
    expect(tbl("users")[0]?.deletedAt).toBeNull();
  });

  it("returns 403 when the caller is not an admin", async () => {
    state.authMode = "nonAdmin";
    const res = await fetch(`${baseUrl}/admin/users/user-1`, {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
    // Cascade must NOT have run.
    expect(tbl("users")[0]?.deletedAt).toBeNull();
    expect(tbl("pushTokens").length).toBe(1);
    expect(clerkDeleteUser).not.toHaveBeenCalled();
  });

  it("admin call soft-deletes the target and runs the same cascade as DELETE /me", async () => {
    state.authMode = "admin";
    state.appUserId = "admin-1";
    const res = await fetch(`${baseUrl}/admin/users/user-1`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      appUserId: "user-1",
      confirmationEmailQueued: true,
    });
    expect(typeof body.deletedAt).toBe("string");
    expect(typeof body.hardDeleteAfter).toBe("string");

    // The mock select has no per-user predicate filtering, so this
    // exercises the cascade against all seeded rows. The post-state
    // mirrors what the user-facing DELETE /me test asserts.
    const userRow = tbl("users")[0]!;
    expect(userRow.email).toBeNull();
    expect(userRow.displayName).toBeNull();
    expect(userRow.deletedAt).toBeInstanceOf(Date);
    expect(userRow.hardDeleteAfter).toBeInstanceOf(Date);

    expect(tbl("pushTokens").length).toBe(0);
    expect(tbl("userTokens").length).toBe(0);
    expect(tbl("feedback")[0]).toMatchObject({
      message: "[redacted]",
      tags: [],
    });
    expect(tbl("interactionEvents")[0]?.payload).toEqual({});
    expect(tbl("wellbeingEntries")[0]?.entry).toEqual({ kind: "redacted" });

    // Clerk erasure best-effort fired with the captured upstream id.
    expect(clerkDeleteUser).toHaveBeenCalledWith("clerk-1");

    // Confirmation email was queued against the original address.
    const pending = tbl("pendingEmails");
    expect(pending.length).toBe(1);
    expect(pending[0]).toMatchObject({
      kind: "account_deletion_confirmation",
      toAddress: "user1@example.com",
    });

    // The soft-deleted row is still present in the DB during the 30-day
    // grace window — the admin UI shows the "Account soft-deleted" badge
    // by keying off the now-null email.
    const userRowAfter = tbl("users").find((r) => r.appUserId === "user-1");
    expect(userRowAfter?.deletedAt).toBeInstanceOf(Date);
    expect(userRowAfter?.email).toBeNull();
  });

  it("returns 404 when the target appUserId does not exist", async () => {
    state.authMode = "admin";
    state.appUserId = "admin-1";
    // Clear the users table so `softDeleteAccount` reports `found: false`.
    state.tables.set("users", []);
    const res = await fetch(`${baseUrl}/admin/users/nope`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  it("refuses to delete the caller's own account (cannot_delete_self)", async () => {
    state.authMode = "admin";
    state.appUserId = "admin-1";
    const res = await fetch(`${baseUrl}/admin/users/admin-1`, {
      method: "DELETE",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("cannot_delete_self");
    // Cascade must NOT have run on the admin's row.
    const adminRow = tbl("users").find((r) => r.appUserId === "admin-1");
    expect(adminRow?.deletedAt).toBeNull();
  });
});

describe("POST /api/admin/test-accounts admin gate", () => {
  it("returns 404 in non-staging environments even for admins", async () => {
    process.env.SNAP_LIFE_ENV = "production";
    state.authMode = "admin";
    const res = await fetch(`${baseUrl}/admin/test-accounts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "tester@example.com",
        displayName: "Tester",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 403 when the caller is not an admin", async () => {
    state.authMode = "nonAdmin";
    const res = await fetch(`${baseUrl}/admin/test-accounts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "tester@example.com",
        displayName: "Tester",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 when the caller is unauthenticated", async () => {
    state.authMode = "unauth";
    const res = await fetch(`${baseUrl}/admin/test-accounts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "tester@example.com",
        displayName: "Tester",
      }),
    });
    expect(res.status).toBe(401);
  });
});
