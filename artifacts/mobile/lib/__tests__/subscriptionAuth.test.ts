import { describe, expect, it, vi } from "vitest";
import { resolveSubscriptionAuthHeader } from "../subscriptionAuth";

describe("resolveSubscriptionAuthHeader", () => {
  it("prefers the Clerk session JWT without touching the legacy token", async () => {
    const legacy = vi
      .fn()
      .mockResolvedValue({ Authorization: "Bearer legacy" });

    await expect(
      resolveSubscriptionAuthHeader(async () => "clerk-jwt", legacy),
    ).resolves.toEqual({ Authorization: "Bearer clerk-jwt" });
    expect(legacy).not.toHaveBeenCalled();
  });

  it("falls back when Clerk has not issued a session token yet", async () => {
    const legacy = vi
      .fn()
      .mockResolvedValue({ Authorization: "Bearer legacy" });

    await expect(
      resolveSubscriptionAuthHeader(async () => null, legacy),
    ).resolves.toEqual({ Authorization: "Bearer legacy" });
  });

  it("falls back when Clerk token resolution throws", async () => {
    const legacy = vi
      .fn()
      .mockResolvedValue({ Authorization: "Bearer legacy" });

    await expect(
      resolveSubscriptionAuthHeader(async () => {
        throw new Error("session unavailable");
      }, legacy),
    ).resolves.toEqual({ Authorization: "Bearer legacy" });
  });

  it("returns an empty header when neither auth source is available", async () => {
    await expect(
      resolveSubscriptionAuthHeader(null, async () => ({})),
    ).resolves.toEqual({});
  });
});
