import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express, { type Express } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface InsertedPushToken {
  appUserId: string;
  expoToken: string;
  platform: string | null;
  optedIn: boolean;
}

interface UpdateCall {
  set: Record<string, unknown>;
  whereAppUserId: string | null;
  whereExpoToken: string | null;
}

const userTokensState: { tokens: Map<string, string> } = {
  tokens: new Map<string, string>(),
};
const insertedPushTokens: InsertedPushToken[] = [];
const updateCalls: UpdateCall[] = [];
const insertControl: { fail: boolean } = { fail: false };
const updateControl: { fail: boolean } = { fail: false };

const sendBoneBuddyPush = vi.fn(async (_appUserId: string, _push: unknown) => ({
  status: "sent" as const,
  sentCount: 1,
}));

vi.mock("@workspace/db", () => {
  // Object sentinels (not strings) so the bearer-token lookup operand
  // can be told apart from column references inside the WHERE args, and
  // so the route's update WHERE can be inspected per column.
  const userTokensTable = {
    __table: "user_tokens",
    appUserId: { __col: "appUserId" },
    token: { __col: "token" },
    lastUsedAt: { __col: "lastUsedAt" },
  } as const;
  const pushTokensTable = {
    __table: "push_tokens",
    appUserId: { __col: "appUserId" },
    expoToken: { __col: "expoToken" },
    platform: { __col: "platform" },
    optedIn: { __col: "optedIn" },
    createdAt: { __col: "createdAt" },
    updatedAt: { __col: "updatedAt" },
  } as const;

  type Cond = { kind?: string; args?: unknown[] } | undefined;

  // Walk an `and(eq(col, val), eq(col, val))` (or a bare `eq`) tree and
  // pull out the first equality clause for the named column. Returns
  // null when the column wasn't filtered on — which the test uses to
  // confirm a missing expoToken filter on the "opt-out everything"
  // unregister code path.
  function extractColValue(cond: Cond, colName: string): unknown {
    if (!cond) return null;
    if (cond.kind === "and") {
      for (const c of cond.args ?? []) {
        const v = extractColValue(c as Cond, colName);
        if (v != null) return v;
      }
      return null;
    }
    if (cond.kind === "eq") {
      const args = cond.args ?? [];
      const col = args[0] as { __col?: string } | undefined;
      if (col?.__col === colName) return args[1];
    }
    return null;
  }

  const db = {
    select: (_cols?: unknown) => ({
      from: (_tbl: unknown) => ({
        where: (cond: Cond) => ({
          limit: async (_n: number) => {
            // Auth lookup against `user_tokens`.
            const args = cond?.args ?? [];
            const tokenArg = args.find((a) => typeof a === "string") as
              | string
              | undefined;
            if (!tokenArg) return [] as Array<{ appUserId: string }>;
            const userId = userTokensState.tokens.get(tokenArg);
            return userId ? [{ appUserId: userId }] : [];
          },
        }),
      }),
    }),
    insert: (tbl: unknown) => ({
      values: (row: InsertedPushToken) => ({
        onConflictDoUpdate: async (_cfg: unknown) => {
          if (insertControl.fail) {
            throw new Error("simulated db failure");
          }
          if (tbl === pushTokensTable) {
            insertedPushTokens.push({
              appUserId: row.appUserId,
              expoToken: row.expoToken,
              platform: row.platform ?? null,
              optedIn: row.optedIn ?? true,
            });
          }
        },
      }),
    }),
    update: (tbl: unknown) => ({
      set: (setObj: Record<string, unknown>) => ({
        where: (cond: Cond) => {
          // Auth's best-effort `lastUsedAt` refresh fires
          // `db.update(userTokensTable)…where(...).catch(() => {})`.
          // It must be ignored here so it doesn't show up in
          // `updateCalls` and pollute the assertions.
          if (tbl === userTokensTable) {
            return { catch: (_fn: (e: unknown) => void) => Promise.resolve() };
          }
          if (updateControl.fail) {
            return Promise.reject(new Error("simulated db failure"));
          }
          updateCalls.push({
            set: setObj,
            whereAppUserId:
              (extractColValue(cond, "appUserId") as string | null) ?? null,
            whereExpoToken:
              (extractColValue(cond, "expoToken") as string | null) ?? null,
          });
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
  return { db, userTokensTable, pushTokensTable, usersTable };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ kind: "and", args }),
  eq: (...args: unknown[]) => ({ kind: "eq", args }),
}));

vi.mock("../../lib/pushSender", () => ({
  sendBoneBuddyPush: (appUserId: string, push: unknown) =>
    sendBoneBuddyPush(appUserId, push),
}));

vi.mock("../../lib/buddyCopy", () => ({
  composeDailyNudgeLine: async (_facts: unknown) => "Hi — small kind line.",
}));

// Import after the mocks are wired up.
const { default: pushRouter } = await import("../push");

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use(pushRouter);
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
  insertedPushTokens.length = 0;
  updateCalls.length = 0;
  insertControl.fail = false;
  updateControl.fail = false;
  sendBoneBuddyPush.mockClear();
});

const VALID_TOKEN = "ExponentPushToken[abc-123-xyz]";

async function postJson(
  path: string,
  body: unknown,
  opts: { token?: string | null } = {},
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = opts.token === undefined ? "valid-token" : opts.token;
  if (token != null) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ---- POST /push/register -------------------------------------------------

describe("POST /push/register — auth gate", () => {
  it("rejects an anonymous request with 401 and writes nothing", async () => {
    const res = await postJson(
      "/push/register",
      { expoToken: VALID_TOKEN, platform: "ios" },
      { token: null },
    );
    expect(res.status).toBe(401);
    expect(insertedPushTokens).toHaveLength(0);
  });

  it("rejects an unknown bearer token with 401 and writes nothing", async () => {
    const res = await postJson(
      "/push/register",
      { expoToken: VALID_TOKEN, platform: "ios" },
      { token: "definitely-not-a-real-token" },
    );
    expect(res.status).toBe(401);
    expect(insertedPushTokens).toHaveLength(0);
  });

  it("returns 403 when body appUserId does not match the authed user", async () => {
    const res = await postJson("/push/register", {
      expoToken: VALID_TOKEN,
      platform: "ios",
      appUserId: "someone-else",
    });
    expect(res.status).toBe(403);
    expect(insertedPushTokens).toHaveLength(0);
  });
});

describe("POST /push/register — happy path", () => {
  it("upserts the token scoped to the authed user", async () => {
    const res = await postJson("/push/register", {
      expoToken: VALID_TOKEN,
      platform: "ios",
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(insertedPushTokens).toHaveLength(1);
    expect(insertedPushTokens[0]).toMatchObject({
      appUserId: "user-1",
      expoToken: VALID_TOKEN,
      platform: "ios",
      optedIn: true,
    });
  });

  it("writes against the bearer-token user even when the body claims a matching id", async () => {
    const res = await postJson(
      "/push/register",
      { expoToken: VALID_TOKEN, platform: "android", appUserId: "user-2" },
      { token: "user-2-token" },
    );
    expect(res.status).toBe(200);
    expect(insertedPushTokens).toHaveLength(1);
    expect(insertedPushTokens[0]!.appUserId).toBe("user-2");
  });
});

// ---- POST /push/unregister ----------------------------------------------

describe("POST /push/unregister — auth gate", () => {
  it("rejects an anonymous request with 401 and writes nothing", async () => {
    const res = await postJson(
      "/push/unregister",
      { expoToken: VALID_TOKEN },
      { token: null },
    );
    expect(res.status).toBe(401);
    expect(updateCalls).toHaveLength(0);
  });

  it("rejects an unknown bearer token with 401 and writes nothing", async () => {
    const res = await postJson(
      "/push/unregister",
      { expoToken: VALID_TOKEN },
      { token: "definitely-not-a-real-token" },
    );
    expect(res.status).toBe(401);
    expect(updateCalls).toHaveLength(0);
  });

  it("returns 403 when body appUserId does not match the authed user", async () => {
    const res = await postJson("/push/unregister", {
      expoToken: VALID_TOKEN,
      appUserId: "someone-else",
    });
    expect(res.status).toBe(403);
    expect(updateCalls).toHaveLength(0);
  });
});

describe("POST /push/unregister — happy path", () => {
  it("scopes the opt-out update to the authed user (and the optional token)", async () => {
    const res = await postJson("/push/unregister", { expoToken: VALID_TOKEN });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(updateCalls).toHaveLength(1);
    const call = updateCalls[0]!;
    expect(call.whereAppUserId).toBe("user-1");
    expect(call.whereExpoToken).toBe(VALID_TOKEN);
    expect(call.set).toMatchObject({ optedIn: false });
  });

  it("scopes the bulk opt-out (no expoToken) to the authed user only", async () => {
    const res = await postJson("/push/unregister", {});
    expect(res.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.whereAppUserId).toBe("user-1");
    // Without a token in the body the WHERE only filters by appUserId,
    // so a regression that broadened the WHERE to "all rows" would show
    // up here as a non-null `whereExpoToken` or, worse, no filter at all.
    expect(updateCalls[0]!.whereExpoToken).toBeNull();
  });
});

// ---- POST /push/daily-nudge ---------------------------------------------

describe("POST /push/daily-nudge — auth gate", () => {
  it("rejects an anonymous request with 401 and never calls the sender", async () => {
    const res = await postJson(
      "/push/daily-nudge",
      { firstName: "Sam" },
      { token: null },
    );
    expect(res.status).toBe(401);
    expect(sendBoneBuddyPush).not.toHaveBeenCalled();
  });

  it("rejects an unknown bearer token with 401 and never calls the sender", async () => {
    const res = await postJson(
      "/push/daily-nudge",
      { firstName: "Sam" },
      { token: "definitely-not-a-real-token" },
    );
    expect(res.status).toBe(401);
    expect(sendBoneBuddyPush).not.toHaveBeenCalled();
  });
});

describe("POST /push/daily-nudge — happy path", () => {
  it("sends the push to the bearer-token user (never any URL/body input)", async () => {
    const res = await postJson(
      "/push/daily-nudge",
      { firstName: "Sam", wellbeingStreak: 3 },
      { token: "user-2-token" },
    );
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ status: "sent" });
    expect(sendBoneBuddyPush).toHaveBeenCalledTimes(1);
    expect(sendBoneBuddyPush).toHaveBeenCalledWith(
      "user-2",
      expect.objectContaining({
        body: "Hi — small kind line.",
        title: "Bone Buddy",
      }),
    );
  });
});
