/**
 * Rate-limit middleware tests.
 *
 * Verifies:
 *   - All limiters are no-ops when NODE_ENV === "test" (the production
 *     vitest environment), so unrelated tests don't trigger 429s.
 *   - When the no-op gate is bypassed (NODE_ENV temporarily set to
 *     "production" and the module re-imported under `vi.resetModules()`),
 *     the limiters enforce the documented thresholds: 5/min for auth,
 *     60/min for events, 20/min for chat.
 *   - User-keyed limiters (events, chat) partition by bearer token, so
 *     two distinct users each get their own quota.
 *
 * Uses the same `app.listen(0) + fetch` harness as the route-level tests
 * to avoid a `supertest` dependency.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express, { type Express, type Request, type Response } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = process.env.NODE_ENV;

async function buildApp(envOverride: string | undefined): Promise<Express> {
  process.env.NODE_ENV = envOverride;
  vi.resetModules();
  const mod = await import("../rateLimit");
  const app = express();
  app.set("trust proxy", true);
  const ok = (_req: Request, res: Response) => {
    res.json({ ok: true });
  };
  app.post("/api/auth/ping", mod.authLimiter, ok);
  app.post("/api/events", mod.eventsLimiter, ok);
  app.post("/api/chat/bone-buddy", mod.chatLimiter, ok);
  return app;
}

async function startServer(app: Express): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

async function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

afterAll(() => {
  process.env.NODE_ENV = ORIGINAL_ENV;
});

describe("rate-limit middleware (test env: no-op)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = await buildApp("test");
    const started = await startServer(app);
    server = started.server;
    baseUrl = started.url;
  });

  afterAll(async () => {
    await stopServer(server);
  });

  it("authLimiter is a no-op (50 reqs all 200)", async () => {
    for (let i = 0; i < 50; i++) {
      const r = await fetch(`${baseUrl}/api/auth/ping`, { method: "POST" });
      expect(r.status).toBe(200);
    }
  });

  it("eventsLimiter is a no-op (200 reqs all 200)", async () => {
    for (let i = 0; i < 200; i++) {
      const r = await fetch(`${baseUrl}/api/events`, {
        method: "POST",
        headers: { Authorization: "Bearer t-noop" },
      });
      expect(r.status).toBe(200);
    }
  });
});

describe("rate-limit middleware (production env: enforced)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = await buildApp("production");
    const started = await startServer(app);
    server = started.server;
    baseUrl = started.url;
  });

  afterAll(async () => {
    await stopServer(server);
  });

  it("authLimiter allows 5/min then 429s the 6th request from the same IP", async () => {
    const headers = { "X-Forwarded-For": "10.10.10.1" };
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`${baseUrl}/api/auth/ping`, { method: "POST", headers });
      expect(r.status).toBe(200);
    }
    const sixth = await fetch(`${baseUrl}/api/auth/ping`, { method: "POST", headers });
    expect(sixth.status).toBe(429);
    const body = (await sixth.json()) as { error?: string };
    expect(body.error).toBe("rate_limited");
  });

  it("authLimiter quota is per-IP (a different IP still gets through)", async () => {
    const r = await fetch(`${baseUrl}/api/auth/ping`, {
      method: "POST",
      headers: { "X-Forwarded-For": "10.10.10.2" },
    });
    expect(r.status).toBe(200);
  });

  it("chatLimiter allows 20/min then 429s the 21st request from the same IP (no verified principal)", async () => {
    // No `req.auth.userId` is set in this harness (we don't mount Clerk
    // middleware), so the limiter falls back to the IP key. Sending a
    // bearer header here is intentional: it must NOT serve as a key,
    // otherwise an attacker could rotate fake bearers to dodge the
    // quota and rack up OpenAI cost.
    const headers = {
      Authorization: "Bearer chat-user-A",
      "X-Forwarded-For": "10.20.30.40",
    };
    for (let i = 0; i < 20; i++) {
      const r = await fetch(`${baseUrl}/api/chat/bone-buddy`, { method: "POST", headers });
      expect(r.status).toBe(200);
    }
    const twentyFirst = await fetch(`${baseUrl}/api/chat/bone-buddy`, {
      method: "POST",
      headers,
    });
    expect(twentyFirst.status).toBe(429);
  });

  it("chatLimiter ignores bearer rotation from the same IP (security: no synthetic-bearer bypass)", async () => {
    // Same source IP that just exhausted the quota above, but a
    // brand-new bearer string. With the bearer-key fallback removed
    // this MUST still 429.
    const r = await fetch(`${baseUrl}/api/chat/bone-buddy`, {
      method: "POST",
      headers: {
        Authorization: "Bearer chat-user-DIFFERENT",
        "X-Forwarded-For": "10.20.30.40",
      },
    });
    expect(r.status).toBe(429);
  });

  it("chatLimiter quota is per-IP (a different IP gets its own quota)", async () => {
    const r = await fetch(`${baseUrl}/api/chat/bone-buddy`, {
      method: "POST",
      headers: {
        Authorization: "Bearer chat-user-B",
        "X-Forwarded-For": "10.20.30.99",
      },
    });
    expect(r.status).toBe(200);
  });

  it("eventsLimiter allows 60/min then 429s the 61st request from the same IP", async () => {
    const headers = {
      Authorization: "Bearer events-user-A",
      "X-Forwarded-For": "10.30.30.30",
    };
    for (let i = 0; i < 60; i++) {
      const r = await fetch(`${baseUrl}/api/events`, { method: "POST", headers });
      expect(r.status).toBe(200);
    }
    const sixtyFirst = await fetch(`${baseUrl}/api/events`, { method: "POST", headers });
    expect(sixtyFirst.status).toBe(429);
  });
});

describe("rate-limit middleware (production env: verified principal keying)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "production";
    vi.resetModules();
    const mod = await import("../rateLimit");
    const app = express();
    app.set("trust proxy", true);
    // Inject a fake Clerk auth so the limiter takes the
    // `clerk:<userId>` branch. The Clerk userId on the request is what
    // a real `clerkMiddleware` would set after validating the session.
    const fakeClerkAuth = (userIdHeader: string) =>
      ((req: Request, _res: Response, next: () => void) => {
        const u = req.header(userIdHeader);
        if (u) (req as unknown as { auth: { userId: string } }).auth = { userId: u };
        next();
      });
    app.use(fakeClerkAuth("X-Test-Clerk-User"));
    app.post("/api/chat/bone-buddy", mod.chatLimiter, (_req, res) => {
      res.json({ ok: true });
    });
    const started = await startServer(app);
    server = started.server;
    baseUrl = started.url;
  });

  afterAll(async () => {
    await stopServer(server);
  });

  it("is keyed per verified Clerk user (two users from same IP don't share quota)", async () => {
    // Verified Clerk user A exhausts the quota.
    for (let i = 0; i < 20; i++) {
      const r = await fetch(`${baseUrl}/api/chat/bone-buddy`, {
        method: "POST",
        headers: {
          "X-Test-Clerk-User": "user_AAA",
          "X-Forwarded-For": "10.40.40.40",
        },
      });
      expect(r.status).toBe(200);
    }
    const twentyFirstA = await fetch(`${baseUrl}/api/chat/bone-buddy`, {
      method: "POST",
      headers: {
        "X-Test-Clerk-User": "user_AAA",
        "X-Forwarded-For": "10.40.40.40",
      },
    });
    expect(twentyFirstA.status).toBe(429);

    // Verified Clerk user B from the *same* IP gets their own quota.
    const firstB = await fetch(`${baseUrl}/api/chat/bone-buddy`, {
      method: "POST",
      headers: {
        "X-Test-Clerk-User": "user_BBB",
        "X-Forwarded-For": "10.40.40.40",
      },
    });
    expect(firstB.status).toBe(200);
  });
});
