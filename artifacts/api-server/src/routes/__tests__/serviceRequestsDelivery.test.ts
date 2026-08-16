import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  queued: [] as Array<Record<string, unknown>>,
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));

vi.mock("@workspace/db", () => ({
  pendingEmailsTable: {},
  db: {
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        onConflictDoNothing: async () => {
          mocks.queued.push(row);
        },
      }),
    }),
  },
}));

vi.mock("../../lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const previousKey = process.env.RESEND_API_KEY;
const previousFrom = process.env.RESEND_FROM_ADDRESS;
const previousFocusCheckout = process.env.COACHING_CHECKOUT_FOCUS_URL;
process.env.RESEND_API_KEY = "re_test_delivery";
process.env.RESEND_FROM_ADDRESS = "SNAP Test <verified@example.com>";
process.env.COACHING_CHECKOUT_FOCUS_URL = "https://payments.example/focus";

const { default: coachingRouter } = await import("../coaching");
const { default: expertRouter } = await import("../expertSupport");

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
  if (previousKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = previousKey;
  if (previousFrom === undefined) delete process.env.RESEND_FROM_ADDRESS;
  else process.env.RESEND_FROM_ADDRESS = previousFrom;
  if (previousFocusCheckout === undefined) delete process.env.COACHING_CHECKOUT_FOCUS_URL;
  else process.env.COACHING_CHECKOUT_FOCUS_URL = previousFocusCheckout;
});

beforeEach(() => {
  mocks.send.mockReset().mockResolvedValue({ data: { id: "email-1" }, error: null });
  mocks.queued.length = 0;
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

describe("service request email delivery", () => {
  it("delivers a coaching request and queues its confirmation", async () => {
    const result = await post("/coaching/booking", {
      name: "Alex <Test>",
      email: "alex@example.com",
      sessionId: "consultation",
      message: "Help <please>",
    });
    expect(result).toMatchObject({
      status: 200,
      json: { ok: true, emailDelivered: true, confirmationQueued: true },
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0]?.[0]).toMatchObject({
      to: "teamsnap@snaplife.co.uk",
      replyTo: "alex@example.com",
    });
    expect(String(mocks.send.mock.calls[0]?.[0]?.html)).toContain("Alex &lt;Test&gt;");
    expect(mocks.queued[0]).toMatchObject({ kind: "coaching_confirmation" });
  });

  it("returns a configured secure checkout for a paid coaching request", async () => {
    const result = await post("/coaching/booking", {
      name: "Alex",
      email: "alex@example.com",
      sessionId: "focus",
    });
    expect(result).toMatchObject({
      status: 200,
      json: {
        ok: true,
        nextAction: "payment",
        paymentUrl: "https://payments.example/focus",
      },
    });
    expect(mocks.queued[0]).toMatchObject({
      kind: "coaching_confirmation",
      payload: {
        paymentRequired: true,
        checkoutUrl: "https://payments.example/focus",
      },
    });
  });

  it("delivers an expert request to Maria and the SNAP team", async () => {
    const result = await post("/expert-support/request", {
      name: "Alex <Test>",
      email: "alex@example.com",
      consultantId: "maria",
      reason: "Need <support>",
      consent: expertConsent(["name", "email", "user_entered_reason"]),
    });
    expect(result).toMatchObject({
      status: 200,
      json: { ok: true, emailDelivered: true, confirmationQueued: true },
    });
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send.mock.calls[0]?.[0]).toMatchObject({
      to: "mrigopoulou@hotmail.co.uk",
    });
    expect(mocks.send.mock.calls[1]?.[0]).toMatchObject({
      to: "teamsnap@snaplife.co.uk",
    });
    expect(String(mocks.send.mock.calls[0]?.[0]?.html)).toContain("Need &lt;support&gt;");
    expect(mocks.queued[0]).toMatchObject({ kind: "expert_support_confirmation" });
  });

  it("returns a delivery error when Resend rejects the primary email", async () => {
    mocks.send.mockResolvedValueOnce({ data: null, error: { message: "rejected" } });
    const result = await post("/coaching/booking", {
      name: "Alex",
      email: "alex@example.com",
      sessionId: "consultation",
    });
    expect(result.status).toBe(502);
    expect(result.json.error).toBe("email_delivery_failed");
    expect(mocks.queued).toHaveLength(0);
  });
});
