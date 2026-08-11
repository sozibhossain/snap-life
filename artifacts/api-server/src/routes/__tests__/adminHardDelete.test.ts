/**
 * Integration tests for POST /admin/users/:id/hard-delete
 *
 * Guard tests (production env, auth) short-circuit before any DB access and
 * work with a mocked auth module only.
 *
 * Success-path tests seed real rows into the live test database, call the
 * endpoint over HTTP, and assert the resulting database state.  No part of the
 * hard-delete cascade is mocked so regressions in hardDeleteUserCascade will
 * surface here.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express, { type Express } from "express";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { db, usersTable, auditLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/* -------------------------------------------------------------------------- *
 * Auth mode state — controls what requireAdminUser returns per-test.
 * -------------------------------------------------------------------------- */

type AuthMode = "unauth" | "nonAdmin" | "admin";
let authMode: AuthMode = "admin";

/* -------------------------------------------------------------------------- *
 * Mocks — auth only; DB, drizzle-orm, and hardDeleteWorker are real.
 * -------------------------------------------------------------------------- */

vi.mock("../../lib/auth", () => ({
  requireAdminUser: async (
    _req: unknown,
    res: { status: (n: number) => { json: (b: unknown) => void } },
  ) => {
    if (authMode === "unauth") {
      res.status(401).json({ error: "missing bearer token" });
      return null;
    }
    if (authMode === "nonAdmin") {
      res.status(403).json({ error: "admin required" });
      return null;
    }
    return {
      appUserId: "admin-1",
      email: "admin@snap.life",
      isAdmin: true,
      source: "clerk",
    };
  },
  requireUser: async () => ({
    appUserId: "admin-1",
    isAdmin: true,
    source: "clerk",
  }),
  requireUserAuth: async () => "admin-1",
  assertSelf: () => false,
  clerkAuthOf: () => ({ userId: null, sessionClaims: null }),
}));

/* -------------------------------------------------------------------------- *
 * Test server — one Express instance for the whole suite.
 * -------------------------------------------------------------------------- */

let app: Express;
let server: Server;
let baseUrl = "";

const originalSnapLifeEnv = process.env.SNAP_LIFE_ENV;

beforeAll(async () => {
  const { default: adminRouter } = await import("../admin");
  app = express();
  app.use(express.json());
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
  if (originalSnapLifeEnv === undefined) {
    delete process.env.SNAP_LIFE_ENV;
  } else {
    process.env.SNAP_LIFE_ENV = originalSnapLifeEnv;
  }
});

beforeEach(() => {
  authMode = "admin";
  process.env.SNAP_LIFE_ENV = "staging";
});

/* -------------------------------------------------------------------------- *
 * Helpers
 * -------------------------------------------------------------------------- */

const hardDeleteUrl = (id: string) =>
  `${baseUrl}/admin/users/${id}/hard-delete`;

/** Returns a unique test-scoped user ID that won't collide with production data. */
function makeTestUserId(): string {
  return `test-hd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/* -------------------------------------------------------------------------- *
 * Tests
 * -------------------------------------------------------------------------- */

describe("POST /admin/users/:id/hard-delete", () => {
  /* ---------------------------------------------------------------------- *
   * Production guard — short-circuits before DB access; no seeding needed.
   * ---------------------------------------------------------------------- */
  describe("production guard — endpoint must be invisible outside staging", () => {
    afterEach(() => {
      process.env.SNAP_LIFE_ENV = "staging";
    });

    it("returns 404 when SNAP_LIFE_ENV is unset", async () => {
      delete process.env.SNAP_LIFE_ENV;
      const r = await fetch(hardDeleteUrl("any-user"), { method: "POST" });
      expect(r.status).toBe(404);
      const body = (await r.json()) as { error: string };
      expect(body.error).toBe("not_found");
    });

    it("returns 404 when SNAP_LIFE_ENV is 'production'", async () => {
      process.env.SNAP_LIFE_ENV = "production";
      const r = await fetch(hardDeleteUrl("any-user"), { method: "POST" });
      expect(r.status).toBe(404);
      const body = (await r.json()) as { error: string };
      expect(body.error).toBe("not_found");
    });
  });

  /* ---------------------------------------------------------------------- *
   * Auth guard — requireAdminUser is mocked; no DB access.
   * ---------------------------------------------------------------------- */
  describe("auth guard — only admins may call this endpoint", () => {
    it("returns 401 for unauthenticated callers", async () => {
      authMode = "unauth";
      const r = await fetch(hardDeleteUrl("target-user"), { method: "POST" });
      expect(r.status).toBe(401);
    });

    it("returns 403 for authenticated non-admin callers", async () => {
      authMode = "nonAdmin";
      const r = await fetch(hardDeleteUrl("target-user"), { method: "POST" });
      expect(r.status).toBe(403);
      const body = (await r.json()) as { error: string };
      expect(body.error).toMatch(/admin/i);
    });
  });

  /* ---------------------------------------------------------------------- *
   * Self-delete guard — no DB access because the check is before the query.
   * ---------------------------------------------------------------------- */
  describe("self-delete guard", () => {
    it("returns 400 when admin attempts to delete their own account", async () => {
      const r = await fetch(hardDeleteUrl("admin-1"), { method: "POST" });
      expect(r.status).toBe(400);
      const body = (await r.json()) as { error: string };
      expect(body.error).toBe("cannot_delete_self");
    });
  });

  /* ---------------------------------------------------------------------- *
   * Success path — DB-backed: real forceHardDeleteUser, real cascade.
   * ---------------------------------------------------------------------- */
  describe("success path — data effects (DB-backed)", { timeout: 20_000 }, () => {
    let testUserId: string;

    beforeEach(async () => {
      testUserId = makeTestUserId();
      await db.insert(usersTable).values({
        appUserId: testUserId,
        email: "hd-test@example.com",
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    afterEach(async () => {
      // Clean up any audit log rows written during (or before) the test.
      await db
        .delete(auditLogsTable)
        .where(eq(auditLogsTable.targetUserId, testUserId));
      // If the test failed before the user was hard-deleted, remove the row.
      await db
        .delete(usersTable)
        .where(eq(usersTable.appUserId, testUserId));
    });

    it("returns 200 with ok:true and the target appUserId", async () => {
      const r = await fetch(hardDeleteUrl(testUserId), { method: "POST" });
      expect(r.status).toBe(200);
      const body = (await r.json()) as { ok: boolean; appUserId: string };
      expect(body.ok).toBe(true);
      expect(body.appUserId).toBe(testUserId);
    });

    it("removes the user row from the database", async () => {
      const r = await fetch(hardDeleteUrl(testUserId), { method: "POST" });
      expect(r.status).toBe(200);

      const remaining = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.appUserId, testUserId));
      expect(remaining).toHaveLength(0);
    });

    it("leaves pre-existing audit_log rows untouched after hard-deleting the user", async () => {
      // Seed an audit log entry that represents prior admin activity for this user.
      const inserted = await db
        .insert(auditLogsTable)
        .values({
          targetUserId: testUserId,
          action: "user_login",
        })
        .returning({ id: auditLogsTable.id });
      const seededId = inserted[0]!.id;

      const r = await fetch(hardDeleteUrl(testUserId), { method: "POST" });
      expect(r.status).toBe(200);

      // User row must be gone.
      const users = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.appUserId, testUserId));
      expect(users).toHaveLength(0);

      // The pre-seeded audit log must still be present.
      const logs = await db
        .select()
        .from(auditLogsTable)
        .where(eq(auditLogsTable.targetUserId, testUserId));
      const preSeeded = logs.find((l) => l.id === seededId);
      expect(preSeeded).toBeDefined();
      expect(preSeeded?.action).toBe("user_login");
    });

    it("returns 404 when the target user does not exist in the database", async () => {
      const r = await fetch(hardDeleteUrl("nonexistent-user-xyz"), {
        method: "POST",
      });
      expect(r.status).toBe(404);
      const body = (await r.json()) as { error: string };
      expect(body.error).toBe("not_found");
    });
  });
});
