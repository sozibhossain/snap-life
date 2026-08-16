import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  pendingEmailsTable: {},
}));

vi.mock("../../lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const previousResendKey = process.env.RESEND_API_KEY;
delete process.env.RESEND_API_KEY;

const { default: coachingRouter } = await import("../coaching");
const { default: expertRouter, escapeHtml } = await import("../expertSupport");

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(coachingRouter);
  app.use(expertRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (previousResendKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = previousResendKey;
});

async function post(path: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() as Record<string, unknown> };
}

function expertConsent(dataShared: string[]) {
  return {
    acknowledged: true,
    version: "expert-support-v1",
    timestamp: new Date().toISOString(),
    dataShared,
    appDataShared: [],
  };
}

describe("service request delivery guards", () => {
  it("does not claim a coaching request was sent when email is unavailable", async () => {
    const result = await post("/coaching/booking", {
      name: "Test User",
      email: "test@example.com",
      sessionId: "consultation",
    });
    expect(result.status).toBe(503);
    expect(result.json.error).toBe("email_service_unavailable");
  });

  it("does not claim an expert request was sent when email is unavailable", async () => {
    const result = await post("/expert-support/request", {
      name: "Test User",
      email: "test@example.com",
      consultantId: "maria",
      consent: expertConsent(["name", "email"]),
    });
    expect(result.status).toBe(503);
    expect(result.json.error).toBe("email_service_unavailable");
  });

  it("escapes user-provided HTML used in expert emails", () => {
    expect(escapeHtml(`<img src=x onerror='alert(1)'>`)).toBe(
      "&lt;img src=x onerror=&#39;alert(1)&#39;&gt;",
    );
  });
});
