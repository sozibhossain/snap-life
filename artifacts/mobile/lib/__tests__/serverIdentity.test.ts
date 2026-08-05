import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { platformMock } = vi.hoisted(() => ({
  platformMock: { OS: "ios" } as { OS: string },
}));

vi.mock("react-native", () => ({
  Platform: platformMock,
}));

import {
  resolveApiBase,
  fetchAppIdentity,
  postAuthLink,
  requestPasswordOnlySignInTicket,
} from "../serverIdentity";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.EXPO_PUBLIC_API_URL;
  delete process.env.EXPO_PUBLIC_DOMAIN;
  platformMock.OS = "ios";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("resolveApiBase", () => {
  it("returns the override when EXPO_PUBLIC_API_URL is set, stripping a trailing slash", () => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.example.com/";
    expect(resolveApiBase()).toBe("https://api.example.com");
  });

  it("returns empty string on web (same-origin fetch) when no override is configured", () => {
    platformMock.OS = "web";
    expect(resolveApiBase()).toBe("");
  });

  it("returns null on native when neither override nor EXPO_PUBLIC_DOMAIN is configured", () => {
    platformMock.OS = "ios";
    expect(resolveApiBase()).toBeNull();
  });

  it("returns the https-prefixed domain on native when EXPO_PUBLIC_DOMAIN is bare", () => {
    platformMock.OS = "android";
    process.env.EXPO_PUBLIC_DOMAIN = "snap.example.com";
    expect(resolveApiBase()).toBe("https://snap.example.com");
  });

  it("returns the URL as-is on native when EXPO_PUBLIC_DOMAIN already has scheme", () => {
    platformMock.OS = "android";
    process.env.EXPO_PUBLIC_DOMAIN = "https://staging.snap.example.com";
    expect(resolveApiBase()).toBe("https://staging.snap.example.com");
  });
});

describe("fetchAppIdentity", () => {
  it("returns null without making a request when there is no Clerk token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchAppIdentity(null)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("issues a relative same-origin request on web", async () => {
    platformMock.OS = "web";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ appUserId: "app-1", isAdmin: false }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchAppIdentity("clerk-jwt");
    expect(out).toEqual({
      appUserId: "app-1",
      isAdmin: false,
      isTester: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer clerk-jwt" },
      }),
    );
  });

  it("returns null on native when no API base URL is configured", async () => {
    platformMock.OS = "ios";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchAppIdentity("clerk-jwt")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when the response is not ok", async () => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.example.com";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchAppIdentity("clerk-jwt")).toBeNull();
  });
});

describe("postAuthLink", () => {
  it("returns no_api_base_url on native with no configured base", async () => {
    platformMock.OS = "ios";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await postAuthLink("legacy-token", "clerk-jwt");
    expect(r).toEqual({ ok: false, status: 0, error: "no_api_base_url" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to a relative URL on web", async () => {
    platformMock.OS = "web";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ appUserId: "app-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await postAuthLink("legacy-token", "clerk-jwt");
    expect(r).toEqual({ ok: true, status: 200, appUserId: "app-1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/link",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer clerk-jwt",
        }),
        body: JSON.stringify({ legacyToken: "legacy-token" }),
      }),
    );
  });

  it("propagates 409 from the server with body fields", async () => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.example.com";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "already_linked" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await postAuthLink("legacy-token", "clerk-jwt");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(409);
    expect(r.error).toBe("already_linked");
  });
});

describe("requestPasswordOnlySignInTicket", () => {
  it("posts the credentials to the account-scoped API and returns its ticket", async () => {
    platformMock.OS = "web";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ticket: "one-use-ticket" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestPasswordOnlySignInTicket(
      "rabby.raziul@gmail.com",
      "password",
    );

    expect(result).toEqual({
      ok: true,
      status: 200,
      ticket: "one-use-ticket",
      error: undefined,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/password-only-sign-in",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "rabby.raziul@gmail.com",
          password: "password",
        }),
      }),
    );
  });

  it("returns the generic API error when the password is rejected", async () => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.example.com";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: "invalid_credentials" }),
      }),
    );

    const result = await requestPasswordOnlySignInTicket(
      "rabby.raziul@gmail.com",
      "wrong",
    );
    expect(result).toEqual({
      ok: false,
      status: 401,
      ticket: undefined,
      error: "invalid_credentials",
    });
  });
});
