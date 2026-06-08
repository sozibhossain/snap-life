import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tokenState: { tokens: Map<string, string> } = {
  tokens: new Map<string, string>(),
};
const usersState: {
  byClerkId: Map<string, { appUserId: string; isAdmin: boolean }>;
  byAppUserId: Map<string, { clerkUserId: string | null; isAdmin: boolean }>;
  inserts: Array<Record<string, unknown>>;
  updates: Array<{ where: unknown; set: Record<string, unknown> }>;
} = {
  byClerkId: new Map(),
  byAppUserId: new Map(),
  inserts: [],
  updates: [],
};
const selectControl: { fail: boolean } = { fail: false };
const updateCalls: { count: number } = { count: 0 };

vi.mock("@workspace/db", () => {
  const userTokensTable = {
    __table: "user_tokens",
    appUserId: { __col: "userTokens.appUserId" },
    token: { __col: "userTokens.token" },
    lastUsedAt: { __col: "userTokens.lastUsedAt" },
  } as const;
  const usersTable = {
    __table: "users",
    appUserId: { __col: "users.appUserId" },
    clerkUserId: { __col: "users.clerkUserId" },
    email: { __col: "users.email" },
    displayName: { __col: "users.displayName" },
    isAdmin: { __col: "users.isAdmin" },
  } as const;

  type Cond = { kind?: string; args?: unknown[] } | undefined;

  function describeWhere(cond: Cond): { col: string; value: unknown } | null {
    const args = cond?.args ?? [];
    const col = args.find(
      (a): a is { __col: string } =>
        typeof a === "object" && a !== null && "__col" in (a as object),
    );
    const value = args.find((a) => typeof a !== "object" || a === null);
    if (!col) return null;
    return { col: col.__col, value };
  }

  const db = {
    select: (cols?: Record<string, { __col: string }>) => ({
      from: (tbl: { __table: string }) => ({
        where: (cond: Cond) => ({
          limit: async (_n: number) => {
            if (selectControl.fail) {
              throw new Error("simulated select failure");
            }
            const w = describeWhere(cond);
            if (!w) return [];
            if (tbl.__table === "user_tokens") {
              if (typeof w.value !== "string") return [];
              const userId = tokenState.tokens.get(w.value);
              return userId ? [{ appUserId: userId }] : [];
            }
            if (tbl.__table === "users") {
              if (w.col === "users.clerkUserId") {
                const u = usersState.byClerkId.get(w.value as string);
                if (!u) return [];
                return [
                  {
                    appUserId: u.appUserId,
                    isAdmin: u.isAdmin,
                    clerkUserId: w.value,
                    email: null,
                    displayName: null,
                  },
                ];
              }
              if (w.col === "users.appUserId") {
                const u = usersState.byAppUserId.get(w.value as string);
                if (!u) return [];
                return [
                  {
                    appUserId: w.value,
                    isAdmin: u.isAdmin,
                    clerkUserId: u.clerkUserId,
                    email: null,
                    displayName: null,
                  },
                ];
              }
            }
            return [];
          },
        }),
      }),
    }),
    update: (tbl: { __table: string }) => ({
      set: (setVals: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          if (tbl.__table === "user_tokens") {
            updateCalls.count += 1;
            return {
              catch: (_fn: (e: unknown) => void) => Promise.resolve(),
            };
          }
          usersState.updates.push({ where: cond, set: setVals });
          return Promise.resolve();
        },
      }),
    }),
    insert: (tbl: { __table: string }) => ({
      values: (v: Record<string, unknown>) => {
        const apply = () => {
          if (tbl.__table !== "users") return;
          const clerkUserId = (v["clerkUserId"] as string) ?? null;
          if (clerkUserId && usersState.byClerkId.has(clerkUserId)) return;
          usersState.inserts.push(v);
          const appUserId = v["appUserId"] as string;
          const isAdmin = (v["isAdmin"] as boolean) ?? false;
          usersState.byAppUserId.set(appUserId, { clerkUserId, isAdmin });
          if (clerkUserId)
            usersState.byClerkId.set(clerkUserId, { appUserId, isAdmin });
        };
        const thenable = Promise.resolve().then(apply);
        return Object.assign(thenable, {
          onConflictDoNothing: async (_opts: unknown) => {
            apply();
          },
        });
      },
    }),
  };

  return { db, userTokensTable, usersTable };
});

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ kind: "eq", args }),
}));

const { requireUserAuth, requireUser, requireAdminUser, assertSelf } =
  await import("../auth");

interface FakeResponse {
  res: Response;
  statusCode: number | null;
  body: unknown;
}

function makeRes(): FakeResponse {
  const state: FakeResponse = {
    res: undefined as unknown as Response,
    statusCode: null,
    body: undefined,
  };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  } as unknown as Response;
  state.res = res;
  return state;
}

function makeReq(
  headers: Record<string, string> = {},
  clerkUserId: string | null = null,
  sessionClaims: unknown = null,
): Request {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    header(name: string): string | undefined {
      return lower[name.toLowerCase()];
    },
    auth: clerkUserId ? { userId: clerkUserId, sessionClaims } : undefined,
    log: { error: () => {}, warn: () => {} },
  } as unknown as Request;
}

beforeEach(() => {
  tokenState.tokens.clear();
  tokenState.tokens.set("valid-token", "user-1");
  usersState.byClerkId.clear();
  usersState.byAppUserId.clear();
  usersState.inserts = [];
  usersState.updates = [];
  selectControl.fail = false;
  updateCalls.count = 0;
});

describe("requireUserAuth (legacy bearer)", () => {
  it("returns null and 401 when neither Clerk session nor bearer header is present", async () => {
    const req = makeReq();
    const r = makeRes();
    const result = await requireUserAuth(req, r.res);
    expect(result).toBeNull();
    expect(r.statusCode).toBe(401);
    expect(r.body).toEqual({ error: "missing bearer token" });
    expect(updateCalls.count).toBe(0);
  });

  it("returns null and 401 when the scheme is not 'Bearer '", async () => {
    for (const header of [
      "Basic abc123",
      "Token valid-token",
      "valid-token",
      "bearer valid-token",
    ]) {
      const req = makeReq({ authorization: header });
      const r = makeRes();
      const result = await requireUserAuth(req, r.res);
      expect(result).toBeNull();
      expect(r.statusCode).toBe(401);
      expect(r.body).toEqual({ error: "missing bearer token" });
    }
    expect(updateCalls.count).toBe(0);
  });

  it("returns null and 401 when the token portion is empty or whitespace", async () => {
    for (const header of ["Bearer ", "Bearer    "]) {
      const req = makeReq({ authorization: header });
      const r = makeRes();
      const result = await requireUserAuth(req, r.res);
      expect(result).toBeNull();
      expect(r.statusCode).toBe(401);
      expect(r.body).toEqual({ error: "invalid bearer token" });
    }
    expect(updateCalls.count).toBe(0);
  });

  it("returns null and 401 when the token exceeds the 200-character cap", async () => {
    const longToken = "a".repeat(201);
    const req = makeReq({ authorization: `Bearer ${longToken}` });
    const r = makeRes();
    const result = await requireUserAuth(req, r.res);
    expect(result).toBeNull();
    expect(r.statusCode).toBe(401);
    expect(r.body).toEqual({ error: "invalid bearer token" });
    expect(updateCalls.count).toBe(0);
  });

  it("returns null and 401 when the token is unknown to the DB", async () => {
    const req = makeReq({ authorization: "Bearer not-a-real-token" });
    const r = makeRes();
    const result = await requireUserAuth(req, r.res);
    expect(result).toBeNull();
    expect(r.statusCode).toBe(401);
    expect(r.body).toEqual({ error: "unknown bearer token" });
    expect(updateCalls.count).toBe(0);
  });

  it("returns the appUserId on a happy-path lookup and refreshes lastUsedAt", async () => {
    const req = makeReq({ authorization: "Bearer valid-token" });
    const r = makeRes();
    const result = await requireUserAuth(req, r.res);
    expect(result).toBe("user-1");
    expect(r.statusCode).toBeNull();
    expect(r.body).toBeUndefined();
    expect(updateCalls.count).toBe(1);
  });

  it("returns null and 500 when the DB lookup throws", async () => {
    selectControl.fail = true;
    const req = makeReq({ authorization: "Bearer valid-token" });
    const r = makeRes();
    const result = await requireUserAuth(req, r.res);
    expect(result).toBeNull();
    expect(r.statusCode).toBe(500);
    expect(r.body).toEqual({ error: "internal" });
  });
});

describe("requireUser (Clerk session)", () => {
  it("creates a `users` row on first contact and returns the new appUserId", async () => {
    const req = makeReq({}, "user_clerk_new");
    const r = makeRes();
    const u = await requireUser(req, r.res);
    expect(u).not.toBeNull();
    expect(u?.appUserId).toBe("user_clerk_new");
    expect(u?.isAdmin).toBe(false);
    expect(u?.source).toBe("clerk");
    expect(usersState.inserts).toHaveLength(1);
    expect(usersState.inserts[0]).toMatchObject({
      appUserId: "user_clerk_new",
      clerkUserId: "user_clerk_new",
      isAdmin: false,
    });
  });

  it("returns the existing appUserId for a previously-linked Clerk user", async () => {
    usersState.byClerkId.set("user_clerk_existing", {
      appUserId: "legacy-app-user-42",
      isAdmin: false,
    });
    usersState.byAppUserId.set("legacy-app-user-42", {
      clerkUserId: "user_clerk_existing",
      isAdmin: false,
    });
    const req = makeReq({}, "user_clerk_existing");
    const r = makeRes();
    const u = await requireUser(req, r.res);
    expect(u?.appUserId).toBe("legacy-app-user-42");
    expect(u?.source).toBe("clerk");
    expect(usersState.inserts).toHaveLength(0);
  });

  it("propagates the isAdmin flag from the users row", async () => {
    usersState.byClerkId.set("user_clerk_admin", {
      appUserId: "admin-1",
      isAdmin: true,
    });
    usersState.byAppUserId.set("admin-1", {
      clerkUserId: "user_clerk_admin",
      isAdmin: true,
    });
    const req = makeReq({}, "user_clerk_admin");
    const r = makeRes();
    const u = await requireUser(req, r.res);
    expect(u?.isAdmin).toBe(true);
  });

  it("Clerk session takes precedence over a legacy bearer header", async () => {
    const req = makeReq(
      { authorization: "Bearer valid-token" },
      "user_clerk_priority",
    );
    const r = makeRes();
    const u = await requireUser(req, r.res);
    expect(u?.appUserId).toBe("user_clerk_priority");
    expect(u?.source).toBe("clerk");
  });
});

describe("requireUser (legacy bearer)", () => {
  it("returns appUserId with isAdmin=false when no users row exists", async () => {
    const req = makeReq({ authorization: "Bearer valid-token" });
    const r = makeRes();
    const u = await requireUser(req, r.res);
    expect(u?.appUserId).toBe("user-1");
    expect(u?.isAdmin).toBe(false);
    expect(u?.source).toBe("legacy");
  });

  it("returns canonical isAdmin from the users row on the legacy path", async () => {
    usersState.byAppUserId.set("user-1", {
      clerkUserId: null,
      isAdmin: true,
    });
    const req = makeReq({ authorization: "Bearer valid-token" });
    const r = makeRes();
    const u = await requireUser(req, r.res);
    expect(u?.appUserId).toBe("user-1");
    expect(u?.isAdmin).toBe(true);
    expect(u?.source).toBe("legacy");
  });
});

describe("requireUser (Clerk session claims persistence)", () => {
  it("persists email and displayName from session claims on first contact", async () => {
    const req = makeReq({}, "user_clerk_with_claims", {
      email: "alice@example.com",
      name: "Alice Example",
    });
    const r = makeRes();
    const u = await requireUser(req, r.res);
    expect(u?.appUserId).toBe("user_clerk_with_claims");
    expect(usersState.inserts).toHaveLength(1);
    expect(usersState.inserts[0]).toMatchObject({
      appUserId: "user_clerk_with_claims",
      clerkUserId: "user_clerk_with_claims",
      email: "alice@example.com",
      displayName: "Alice Example",
    });
  });

  it("falls back to given_name when name and full_name are absent", async () => {
    const req = makeReq({}, "user_clerk_given_only", {
      email: "bob@example.com",
      given_name: "Bob",
    });
    const r = makeRes();
    await requireUser(req, r.res);
    expect(usersState.inserts[0]).toMatchObject({
      email: "bob@example.com",
      displayName: "Bob",
    });
  });
});

describe("assertSelf", () => {
  it("returns false and writes nothing when claimed === authed", async () => {
    const r = makeRes();
    const mismatch = assertSelf(r.res, "user-1", "user-1");
    expect(mismatch).toBe(false);
    expect(r.statusCode).toBeNull();
    expect(r.body).toBeUndefined();
  });

  it("returns true and writes 403 when claimed !== authed", async () => {
    const r = makeRes();
    const mismatch = assertSelf(r.res, "user-1", "someone-else");
    expect(mismatch).toBe(true);
    expect(r.statusCode).toBe(403);
    expect(r.body).toEqual({ error: "user mismatch" });
  });

  it("returns false and writes nothing when claimed is null or undefined", async () => {
    for (const claimed of [null, undefined] as const) {
      const r = makeRes();
      const mismatch = assertSelf(r.res, "user-1", claimed);
      expect(mismatch).toBe(false);
      expect(r.statusCode).toBeNull();
      expect(r.body).toBeUndefined();
    }
  });
});

describe("requireAdminUser", () => {
  it("returns the AuthedUser when the caller is an admin", async () => {
    usersState.byClerkId.set("user_clerk_admin", {
      appUserId: "admin-1",
      isAdmin: true,
    });
    usersState.byAppUserId.set("admin-1", {
      clerkUserId: "user_clerk_admin",
      isAdmin: true,
    });
    const req = makeReq({}, "user_clerk_admin");
    const r = makeRes();
    const u = await requireAdminUser(req, r.res);
    expect(u).not.toBeNull();
    expect(u?.appUserId).toBe("admin-1");
    expect(u?.isAdmin).toBe(true);
    expect(r.statusCode).toBeNull();
  });

  it("writes 403 and returns null when signed in but not an admin", async () => {
    usersState.byClerkId.set("user_clerk_member", {
      appUserId: "member-1",
      isAdmin: false,
    });
    usersState.byAppUserId.set("member-1", {
      clerkUserId: "user_clerk_member",
      isAdmin: false,
    });
    const req = makeReq({}, "user_clerk_member");
    const r = makeRes();
    const u = await requireAdminUser(req, r.res);
    expect(u).toBeNull();
    expect(r.statusCode).toBe(403);
    expect(r.body).toEqual({ error: "admin required" });
  });

  it("writes 401 and returns null when there is no session at all", async () => {
    const req = makeReq({}); // no Clerk session, no bearer token
    const r = makeRes();
    const u = await requireAdminUser(req, r.res);
    expect(u).toBeNull();
    expect(r.statusCode).toBe(401);
  });

  it("writes 403 even on the legacy bearer path when isAdmin=false", async () => {
    // Legacy bearer + no users row → isAdmin defaults to false → 403.
    const req = makeReq({ authorization: "Bearer valid-token" });
    const r = makeRes();
    const u = await requireAdminUser(req, r.res);
    expect(u).toBeNull();
    expect(r.statusCode).toBe(403);
  });

  it("admits a legacy bearer caller whose users row is admin", async () => {
    usersState.byAppUserId.set("user-1", {
      clerkUserId: null,
      isAdmin: true,
    });
    const req = makeReq({ authorization: "Bearer valid-token" });
    const r = makeRes();
    const u = await requireAdminUser(req, r.res);
    expect(u).not.toBeNull();
    expect(u?.appUserId).toBe("user-1");
    expect(u?.isAdmin).toBe(true);
    expect(r.statusCode).toBeNull();
  });
});
