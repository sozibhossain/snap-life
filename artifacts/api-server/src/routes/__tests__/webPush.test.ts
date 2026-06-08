/**
 * Targeted tests for the web push routes and endpoint validation.
 *
 * Covers:
 *  1. validateWebPushEndpoint — allowlist logic and SSRF rejection
 *  2. POST /push/web/register — auth gate, bad endpoints, happy path
 *  3. POST /push/web/unregister — auth gate, targeted vs. bulk opt-out
 *  4. GET /push/web/vapid-public-key — missing / present env var
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express, { type Express } from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// DB mock
// ---------------------------------------------------------------------------

interface InsertedWebSub {
  appUserId: string;
  endpoint: string;
  p256dhKey: string;
  authKey: string;
  optedIn: boolean;
}

interface WebUpdateCall {
  set: Record<string, unknown>;
  whereAppUserId: string | null;
  whereEndpoint: string | null;
}

const userTokensState: { tokens: Map<string, string> } = {
  tokens: new Map(),
};
const insertedSubs: InsertedWebSub[] = [];
const webUpdateCalls: WebUpdateCall[] = [];
const insertControl: { fail: boolean } = { fail: false };

vi.mock("@workspace/db", () => {
  const userTokensTable = {
    __table: "user_tokens",
    appUserId: { __col: "appUserId" },
    token: { __col: "token" },
    lastUsedAt: { __col: "lastUsedAt" },
  } as const;

  const webPushSubscriptionsTable = {
    __table: "web_push_subscriptions",
    appUserId: { __col: "webSub.appUserId" },
    endpoint: { __col: "webSub.endpoint" },
    p256dhKey: { __col: "webSub.p256dhKey" },
    authKey: { __col: "webSub.authKey" },
    optedIn: { __col: "webSub.optedIn" },
    createdAt: { __col: "webSub.createdAt" },
    updatedAt: { __col: "webSub.updatedAt" },
  } as const;

  // Unused tables must still be exported so the route module's imports resolve.
  const pushTokensTable = { __table: "push_tokens" } as const;
  const pushUserStateTable = { __table: "push_user_state" } as const;
  // auth.ts accesses usersTable columns; must be defined to avoid TypeErrors.
  const usersTable = {
    __table: "users",
    appUserId: { __col: "users.appUserId" },
    isAdmin: { __col: "users.isAdmin" },
    isTester: { __col: "users.isTester" },
    deletedAt: { __col: "users.deletedAt" },
  } as const;
  // Listed in auth.ts imports; unused in requireUserAuth but must be exported.
  const pendingEmailsTable = { __table: "pending_emails" } as const;
  const subscribersTable = { __table: "subscribers" } as const;

  type Cond = { kind?: string; args?: unknown[] } | undefined;

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
            const args = cond?.args ?? [];
            const tokenArg = args.find((a) => typeof a === "string") as string | undefined;
            if (!tokenArg) return [];
            const userId = userTokensState.tokens.get(tokenArg);
            return userId ? [{ appUserId: userId }] : [];
          },
        }),
      }),
    }),
    insert: (_tbl: unknown) => ({
      values: (row: InsertedWebSub) => ({
        onConflictDoUpdate: async (_cfg: unknown) => {
          if (insertControl.fail) throw new Error("simulated db failure");
          insertedSubs.push({
            appUserId: row.appUserId,
            endpoint: row.endpoint,
            p256dhKey: row.p256dhKey,
            authKey: row.authKey,
            optedIn: row.optedIn ?? true,
          });
        },
      }),
    }),
    update: (tbl: unknown) => ({
      set: (setObj: Record<string, unknown>) => ({
        where: (cond: Cond) => {
          if ((tbl as { __table?: string }).__table === "user_tokens") {
            return { catch: (_fn: (e: unknown) => void) => Promise.resolve() };
          }
          webUpdateCalls.push({
            set: setObj,
            whereAppUserId:
              (extractColValue(cond, "webSub.appUserId") as string | null) ?? null,
            whereEndpoint:
              (extractColValue(cond, "webSub.endpoint") as string | null) ?? null,
          });
          return Promise.resolve();
        },
      }),
    }),
  };

  return {
    db,
    userTokensTable,
    webPushSubscriptionsTable,
    pushTokensTable,
    pushUserStateTable,
    usersTable,
    pendingEmailsTable,
    subscribersTable,
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ kind: "and", args }),
  eq: (...args: unknown[]) => ({ kind: "eq", args }),
}));

vi.mock("../../lib/pushSender", () => ({
  sendBoneBuddyPush: async (_appUserId: string, _push: unknown) => ({
    status: "sent" as const,
    sentCount: 1,
  }),
}));

vi.mock("../../lib/buddyCopy", () => ({
  composeDailyNudgeLine: async (_facts: unknown) => "Hi — small kind line.",
}));

// Import after mocks.
const { default: pushRouter, validateWebPushEndpoint } = await import("../push");

// ---------------------------------------------------------------------------
// Test server setup
// ---------------------------------------------------------------------------

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
  insertedSubs.length = 0;
  webUpdateCalls.length = 0;
  insertControl.fail = false;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getJson(
  path: string,
  opts: { token?: string | null } = {},
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {};
  const token = opts.token === undefined ? "valid-token" : opts.token;
  if (token != null) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, { headers });
  return { status: res.status, json: await res.json().catch(() => null) };
}

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

const VALID_WEB_SUB = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  p256dhKey: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlTiHTy-fEKLWIaqKk",
  authKey: "tBHItJI5svbpez7KI4CCXg",
};

// ---------------------------------------------------------------------------
// 1. validateWebPushEndpoint — unit tests
// ---------------------------------------------------------------------------

describe("validateWebPushEndpoint — allowlist", () => {
  it("accepts known Chrome FCM endpoint", () => {
    expect(
      validateWebPushEndpoint("https://fcm.googleapis.com/fcm/send/abc"),
    ).toBe(true);
  });

  it("accepts a Mozilla push endpoint", () => {
    expect(
      validateWebPushEndpoint(
        "https://updates.push.services.mozilla.com/push/v1/abc",
      ),
    ).toBe(true);
  });

  it("accepts an Apple push endpoint", () => {
    expect(
      validateWebPushEndpoint("https://web.push.apple.com/push/abc"),
    ).toBe(true);
  });

  it("accepts a Windows/Edge notify endpoint", () => {
    expect(
      validateWebPushEndpoint("https://db5.notify.windows.com/foo"),
    ).toBe(true);
  });

  it("rejects http (non-HTTPS) endpoint", () => {
    expect(
      validateWebPushEndpoint("http://fcm.googleapis.com/fcm/send/abc"),
    ).toBe(false);
  });

  it("rejects a localhost endpoint", () => {
    expect(validateWebPushEndpoint("https://localhost/push/abc")).toBe(false);
  });

  it("rejects a private IPv4 address", () => {
    expect(validateWebPushEndpoint("https://192.168.1.1/push/abc")).toBe(false);
  });

  it("rejects an arbitrary public HTTPS URL not on the allowlist", () => {
    expect(validateWebPushEndpoint("https://evil.example.com/push/abc")).toBe(
      false,
    );
  });

  it("rejects a URL that merely contains an allowed suffix as a substring", () => {
    expect(
      validateWebPushEndpoint("https://evil.googleapis.com.attacker.com/push/abc"),
    ).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(validateWebPushEndpoint("")).toBe(false);
  });

  it("rejects a non-URL string", () => {
    expect(validateWebPushEndpoint("not-a-url")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. POST /push/web/register
// ---------------------------------------------------------------------------

describe("POST /push/web/register — auth gate", () => {
  it("rejects anonymous requests with 401 and writes nothing", async () => {
    const res = await postJson("/push/web/register", VALID_WEB_SUB, { token: null });
    expect(res.status).toBe(401);
    expect(insertedSubs).toHaveLength(0);
  });

  it("rejects unknown bearer token with 401", async () => {
    const res = await postJson(
      "/push/web/register",
      VALID_WEB_SUB,
      { token: "bad-token" },
    );
    expect(res.status).toBe(401);
    expect(insertedSubs).toHaveLength(0);
  });
});

describe("POST /push/web/register — SSRF rejection", () => {
  const ssrfEndpoints = [
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://localhost/push/abc",
    "https://127.0.0.1/push/abc",
    "https://192.168.1.1/push/abc",
    "https://10.0.0.1/push/abc",
    "https://attacker.example.com/push/abc",
    "https://googleapis.com.evil.com/push/abc",
  ];

  for (const endpoint of ssrfEndpoints) {
    it(`rejects endpoint: ${endpoint}`, async () => {
      const res = await postJson("/push/web/register", {
        ...VALID_WEB_SUB,
        endpoint,
      });
      expect(res.status).toBe(400);
      expect(insertedSubs).toHaveLength(0);
    });
  }
});

describe("POST /push/web/register — happy path", () => {
  it("stores the subscription scoped to the authed user", async () => {
    const res = await postJson("/push/web/register", VALID_WEB_SUB);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(insertedSubs).toHaveLength(1);
    expect(insertedSubs[0]).toMatchObject({
      appUserId: "user-1",
      endpoint: VALID_WEB_SUB.endpoint,
      p256dhKey: VALID_WEB_SUB.p256dhKey,
      authKey: VALID_WEB_SUB.authKey,
      optedIn: true,
    });
  });

  it("returns 400 when p256dhKey is missing", async () => {
    const res = await postJson("/push/web/register", {
      endpoint: VALID_WEB_SUB.endpoint,
      authKey: VALID_WEB_SUB.authKey,
    });
    expect(res.status).toBe(400);
    expect(insertedSubs).toHaveLength(0);
  });

  it("returns 500 on a DB failure and writes nothing to insertedSubs", async () => {
    insertControl.fail = true;
    const res = await postJson("/push/web/register", VALID_WEB_SUB);
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// 3. POST /push/web/unregister
// ---------------------------------------------------------------------------

describe("POST /push/web/unregister — auth gate", () => {
  it("rejects anonymous requests with 401 and writes nothing", async () => {
    const res = await postJson(
      "/push/web/unregister",
      { endpoint: VALID_WEB_SUB.endpoint },
      { token: null },
    );
    expect(res.status).toBe(401);
    expect(webUpdateCalls).toHaveLength(0);
  });
});

describe("POST /push/web/unregister — happy path", () => {
  it("scopes the targeted opt-out to the authed user + endpoint", async () => {
    const res = await postJson("/push/web/unregister", {
      endpoint: VALID_WEB_SUB.endpoint,
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(webUpdateCalls).toHaveLength(1);
    expect(webUpdateCalls[0]!.whereAppUserId).toBe("user-1");
    expect(webUpdateCalls[0]!.whereEndpoint).toBe(VALID_WEB_SUB.endpoint);
    expect(webUpdateCalls[0]!.set).toMatchObject({ optedIn: false });
  });

  it("scopes a bulk opt-out (no endpoint) to the authed user only", async () => {
    const res = await postJson("/push/web/unregister", {});
    expect(res.status).toBe(200);
    expect(webUpdateCalls).toHaveLength(1);
    expect(webUpdateCalls[0]!.whereAppUserId).toBe("user-1");
    expect(webUpdateCalls[0]!.whereEndpoint).toBeNull();
    expect(webUpdateCalls[0]!.set).toMatchObject({ optedIn: false });
  });
});

// ---------------------------------------------------------------------------
// 4. GET /push/web/vapid-public-key
// ---------------------------------------------------------------------------

describe("GET /push/web/vapid-public-key", () => {
  afterEach(() => {
    delete process.env.VAPID_PUBLIC_KEY;
  });

  it("returns 503 when VAPID_PUBLIC_KEY is not set", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    const res = await getJson("/push/web/vapid-public-key", { token: null });
    expect(res.status).toBe(503);
  });

  it("returns the public key when VAPID_PUBLIC_KEY is set", async () => {
    process.env.VAPID_PUBLIC_KEY = "BTestPublicKey12345";
    const res = await getJson("/push/web/vapid-public-key", { token: null });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ vapidPublicKey: "BTestPublicKey12345" });
  });
});
