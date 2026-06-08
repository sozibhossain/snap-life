import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express, { type Express } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface InsertedFeedback {
  appUserId: string | null;
  tier: string;
  feedbackType: string;
  message: string;
  tags: string[];
  allowTestimonialUse: boolean;
  platform: string | null;
  appVersion: string | null;
  metadata: Record<string, unknown> | null;
}

const insertedFeedback: InsertedFeedback[] = [];
const insertControl: { fail: boolean; nextId: number } = {
  fail: false,
  nextId: 1,
};
const userTokensState: { tokens: Map<string, string> } = {
  tokens: new Map<string, string>(),
};
const listState: {
  rows: Array<Record<string, unknown>>;
  fail: boolean;
  selectCount: number;
} = {
  rows: [],
  fail: false,
  selectCount: 0,
};

vi.mock("@workspace/db", () => {
  const feedbackTable = {
    __table: "feedback",
    id: { __col: "id" },
    appUserId: { __col: "appUserId" },
    createdAt: { __col: "createdAt" },
  } as const;
  // Sentinel for the bearer-token table that `requireUserAuth` reads
  // from. Object identity (not string) is used so the mock can tell a
  // user-tokens lookup apart from the feedback admin listing.
  const userTokensTable = {
    __table: "user_tokens",
    appUserId: { __col: "appUserId" },
    token: { __col: "token" },
    lastUsedAt: { __col: "lastUsedAt" },
  } as const;

  type Cond = { kind?: string; args?: unknown[] } | undefined;

  const db = {
    select: (_cols?: unknown) => ({
      from: (tbl: unknown) => ({
        // Admin listing (`GET /feedback`) chains
        // `.from(feedback).orderBy(...).limit(...)`.
        orderBy: (_o: unknown) => ({
          limit: async (_n: number) => {
            listState.selectCount += 1;
            if (listState.fail) {
              throw new Error("simulated db failure");
            }
            return listState.rows;
          },
        }),
        // `requireUserAuth` chains `.from(user_tokens).where(eq(token, t)).limit(1)`.
        where: (cond: Cond) => ({
          limit: async (_n: number) => {
            if (tbl !== userTokensTable) {
              return [] as Array<{ appUserId: string }>;
            }
            const args = cond?.args ?? [];
            const tokenArg = args.find((a) => typeof a === "string") as
              | string
              | undefined;
            if (!tokenArg) return [];
            const userId = userTokensState.tokens.get(tokenArg);
            return userId ? [{ appUserId: userId }] : [];
          },
        }),
      }),
    }),
    insert: (_tbl: unknown) => ({
      values: (row: InsertedFeedback) => ({
        returning: async () => {
          if (insertControl.fail) {
            throw new Error("simulated db failure");
          }
          insertedFeedback.push(row);
          return [{ id: insertControl.nextId++ }];
        },
      }),
    }),
    // Auth's best-effort `lastUsedAt` refresh fires
    // `db.update(userTokensTable)…where(...).catch(() => {})` and we
    // don't want to fail the request on it. Returning a chain with a
    // `.catch()` matches the production no-op behaviour.
    update: (_tbl: unknown) => ({
      set: (_setObj: Record<string, unknown>) => ({
        where: (_cond: Cond) => ({
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
  return { db, feedbackTable, userTokensTable, usersTable };
});

vi.mock("drizzle-orm", () => ({
  desc: (col: unknown) => ({ kind: "desc", col }),
  eq: (...args: unknown[]) => ({ kind: "eq", args }),
}));

const ADMIN_SECRET = "test-admin-secret";
const previousSecret = process.env.REVENUECAT_WEBHOOK_SECRET;

// Import after the mocks are wired up.
const { default: feedbackRouter } = await import("../feedback");

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.REVENUECAT_WEBHOOK_SECRET = ADMIN_SECRET;
  const app: Express = express();
  app.use(express.json());
  app.use(feedbackRouter);
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
  // Restore the env exactly as we found it so this test file doesn't
  // bleed config into anything that runs after it in the same vitest
  // process.
  if (previousSecret === undefined) {
    delete process.env.REVENUECAT_WEBHOOK_SECRET;
  } else {
    process.env.REVENUECAT_WEBHOOK_SECRET = previousSecret;
  }
});

beforeEach(() => {
  insertedFeedback.length = 0;
  insertControl.fail = false;
  insertControl.nextId = 1;
  listState.rows = [];
  listState.fail = false;
  listState.selectCount = 0;
  userTokensState.tokens.clear();
  userTokensState.tokens.set("valid-token", "user-1");
  userTokensState.tokens.set("user-2-token", "user-2");
});

const VALID_BODY = {
  feedbackType: "general",
  tier: "premium",
  message: "Loving the app — small idea: a darker theme would be lovely.",
  tags: ["Helpful"],
  allowTestimonialUse: false,
};

async function postFeedback(
  body: unknown,
  opts: { token?: string | null; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(opts.headers ?? {}),
  };
  // Default to the "user-1" valid token so the existing validation /
  // happy-path tests don't have to thread auth through every call.
  // Pass `token: null` explicitly to send an unauthenticated request.
  const token = opts.token === undefined ? "valid-token" : opts.token;
  if (token != null) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}/feedback`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function listFeedback(
  headers: Record<string, string> = {},
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}/feedback`, { method: "GET", headers });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ---- POST /feedback — validation ----------------------------------------

describe("POST /feedback — validation", () => {
  it("rejects an empty body with 400 and writes nothing", async () => {
    const res = await postFeedback({});
    expect(res.status).toBe(400);
    expect(insertedFeedback).toHaveLength(0);
  });

  it("rejects an invalid feedbackType with 400 and writes nothing", async () => {
    const res = await postFeedback({ ...VALID_BODY, feedbackType: "rant" });
    expect(res.status).toBe(400);
    expect(insertedFeedback).toHaveLength(0);
  });

  it("rejects a tag outside the allow-list with 400 and writes nothing", async () => {
    const res = await postFeedback({ ...VALID_BODY, tags: ["Nope"] });
    expect(res.status).toBe(400);
    expect(insertedFeedback).toHaveLength(0);
  });
});

// ---- POST /feedback — auth gate -----------------------------------------

describe("POST /feedback — auth gate", () => {
  it("rejects an anonymous request with 401 and writes nothing", async () => {
    const res = await postFeedback(
      { ...VALID_BODY, appUserId: "user-1" },
      { token: null },
    );
    expect(res.status).toBe(401);
    expect(insertedFeedback).toHaveLength(0);
  });

  it("rejects an unknown bearer token with 401 and writes nothing", async () => {
    const res = await postFeedback(
      { ...VALID_BODY, appUserId: "user-1" },
      { token: "definitely-not-a-real-token" },
    );
    expect(res.status).toBe(401);
    expect(insertedFeedback).toHaveLength(0);
  });

  it("returns 403 when body appUserId does not match the authed user", async () => {
    const res = await postFeedback({
      ...VALID_BODY,
      appUserId: "someone-else",
    });
    expect(res.status).toBe(403);
    expect(insertedFeedback).toHaveLength(0);
  });
});

// ---- POST /feedback — happy path ----------------------------------------

describe("POST /feedback — happy path", () => {
  it("inserts the row scoped to the bearer-token user and returns the new id", async () => {
    const res = await postFeedback({ ...VALID_BODY, appUserId: "user-1" });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, id: 1 });
    expect(insertedFeedback).toHaveLength(1);
    expect(insertedFeedback[0]).toMatchObject({
      appUserId: "user-1",
      tier: "premium",
      feedbackType: "general",
      message: VALID_BODY.message,
      tags: ["Helpful"],
      allowTestimonialUse: false,
    });
  });

  it("persists the bearer-token user even if the body omits appUserId entirely", async () => {
    // The body field is optional — the server must still pin the
    // persisted id to the bearer-token user, never `null`.
    const res = await postFeedback(VALID_BODY, { token: "user-2-token" });
    expect(res.status).toBe(200);
    expect(insertedFeedback).toHaveLength(1);
    expect(insertedFeedback[0]!.appUserId).toBe("user-2");
  });

  it("captures the user-agent server-side in metadata (a body `metadata` claim cannot be forged in)", async () => {
    const res = await postFeedback(
      { ...VALID_BODY, appUserId: "user-1", metadata: { spoofed: true } },
      { headers: { "user-agent": "TestAgent/1.0" } },
    );
    expect(res.status).toBe(200);
    expect(insertedFeedback).toHaveLength(1);
    const meta = insertedFeedback[0]!.metadata as Record<string, unknown>;
    expect(meta).toMatchObject({ userAgent: "TestAgent/1.0" });
    // The body's `metadata` field must NOT be persisted as-is — the
    // server builds metadata itself so the value can't be spoofed.
    expect(meta).not.toHaveProperty("spoofed");
    expect(typeof meta.receivedAt).toBe("string");
  });

  it("returns 500 when the underlying insert throws", async () => {
    insertControl.fail = true;
    const res = await postFeedback({ ...VALID_BODY, appUserId: "user-1" });
    expect(res.status).toBe(500);
    expect(res.json).toMatchObject({ error: "internal" });
    expect(insertedFeedback).toHaveLength(0);
  });
});

// The legacy `GET /feedback` admin listing was removed when the admin
// dashboard launched (Task #32) — the equivalent route is now
// `GET /admin/feedback`, which is gated by `requireAdminUser` and tested
// in `admin.test.ts`. Reference `listFeedback` and `ADMIN_SECRET` here so
// the unused-import lint stays clean while the legacy helpers remain
// available for any future regression checks.
void listFeedback;
void ADMIN_SECRET;
