import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express, { type Express } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const userTokensState: { tokens: Map<string, string> } = {
  tokens: new Map<string, string>(),
};

const profileBuilds: { calls: string[]; fail: boolean } = {
  calls: [],
  fail: false,
};

vi.mock("@workspace/db", () => {
  // Object sentinels (not strings) so the auth bearer-token lookup can be
  // told apart from column references inside the WHERE args.
  const userTokensTable = {
    __table: "user_tokens",
    appUserId: { __col: "appUserId" },
    token: { __col: "token" },
    lastUsedAt: { __col: "lastUsedAt" },
  } as const;

  type Cond = { kind?: string; args?: unknown[] } | undefined;

  const db = {
    select: (_cols?: unknown) => ({
      from: (_tbl: unknown) => ({
        where: (cond: Cond) => ({
          limit: async (_n: number) => {
            // The auth lookup is `eq(userTokensTable.token, <token>)`. Our
            // `eq` mock packs args as { kind: "eq", args: [col, value] };
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
        }),
      }),
    }),
    // Auth's best-effort `lastUsedAt` refresh is fire-and-forget; return
    // a thenable chain that swallows the trailing `.catch(() => {})`.
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
  return { db, userTokensTable, usersTable };
});

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ kind: "eq", args }),
}));

// Spy on the engagement-profile builder so we can assert which user id
// the route handed it — that is the auth-gate guarantee we care about
// (identity is sourced from the bearer token, never from any URL/body).
vi.mock("../../lib/engagementProfile", () => ({
  buildEngagementProfile: async (appUserId: string) => {
    profileBuilds.calls.push(appUserId);
    if (profileBuilds.fail) throw new Error("simulated profile build failure");
    return {
      sevenDay: {
        byKind: {},
        totalShown: 0,
        totalCompleted: 0,
        totalDismissed: 0,
        rate: 0,
      },
      thirtyDayTrend: "steady" as const,
      generatedAtMs: 0,
    };
  },
}));

// Import after the mocks are wired up.
const { default: profileRouter } = await import("../profile");

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use(profileRouter);
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
  profileBuilds.calls.length = 0;
  profileBuilds.fail = false;
});

async function getProfile(
  opts: { token?: string | null } = {},
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {};
  const token = opts.token === undefined ? "valid-token" : opts.token;
  if (token != null) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}/engagement/profile`, {
    method: "GET",
    headers,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ---- auth gate -----------------------------------------------------------

describe("GET /engagement/profile — auth gate", () => {
  it("rejects an anonymous request with 401 and never builds a profile", async () => {
    const res = await getProfile({ token: null });
    expect(res.status).toBe(401);
    // Critical: a regression that forgot `requireUserAuth` would happily
    // call the builder anyway. Pin that down.
    expect(profileBuilds.calls).toHaveLength(0);
  });

  it("rejects an unknown bearer token with 401 and never builds a profile", async () => {
    const res = await getProfile({ token: "definitely-not-a-real-token" });
    expect(res.status).toBe(401);
    expect(profileBuilds.calls).toHaveLength(0);
  });
});

// ---- happy path ----------------------------------------------------------

describe("GET /engagement/profile — happy path", () => {
  it("returns the profile shape and sources identity from the bearer token", async () => {
    const res = await getProfile();
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      sevenDay: expect.any(Object),
      thirtyDayTrend: "steady",
    });
    // Built strictly for the authed user — there is no URL/body input
    // that could be substituted for it.
    expect(profileBuilds.calls).toEqual(["user-1"]);
  });

  it("uses the bearer-token identity (a different token resolves to a different user)", async () => {
    const res = await getProfile({ token: "user-2-token" });
    expect(res.status).toBe(200);
    expect(profileBuilds.calls).toEqual(["user-2"]);
  });

  it("returns 500 when the underlying profile build throws", async () => {
    profileBuilds.fail = true;
    const res = await getProfile();
    expect(res.status).toBe(500);
    expect(res.json).toMatchObject({ error: "internal" });
  });
});
