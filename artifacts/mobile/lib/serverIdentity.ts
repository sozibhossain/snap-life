import { Platform } from "react-native";

export interface AppIdentity {
  appUserId: string;
  isAdmin: boolean;
  isTester: boolean;
}

export interface AuthLinkResult {
  ok: boolean;
  status: number;
  appUserId?: string;
  error?: string;
}

export function resolveApiBase(): string | null {
  const override = process.env.EXPO_PUBLIC_API_URL;
  if (override) return override.replace(/\/$/, "");
  if (Platform.OS === "web") return "";
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) return null;
  return domain.startsWith("http") ? domain : `https://${domain}`;
}

/**
 * API base for building `${getApiBaseUrl()}/api/...` URLs. Same resolution as
 * resolveApiBase() but returns "" instead of null when nothing is configured,
 * so callers can always string-concat. Single source of truth used across the
 * lib/* helpers (events, feedback, push, webPush, revenuecat, userToken,
 * engagementProfile).
 */
export function getApiBaseUrl(): string {
  const override = process.env.EXPO_PUBLIC_API_URL;
  if (override) return override.replace(/\/$/, "");
  if (Platform.OS === "web") return "";
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) return "";
  return domain.startsWith("http") ? domain : `https://${domain}`;
}

export async function fetchAppIdentity(
  clerkSessionToken: string | null,
): Promise<AppIdentity | null> {
  if (!clerkSessionToken) return null;
  const base = resolveApiBase();
  if (base === null) return null;
  try {
    const r = await fetch(`${base}/api/auth/me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${clerkSessionToken}` },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as Partial<AppIdentity>;
    if (typeof j.appUserId !== "string" || j.appUserId.length === 0) return null;
    return {
      appUserId: j.appUserId,
      isAdmin: Boolean(j.isAdmin),
      isTester: Boolean(j.isTester),
    };
  } catch (err) {
    console.warn("[auth] /api/auth/me request failed", err);
    return null;
  }
}

export async function postAuthLink(
  legacyToken: string,
  clerkSessionToken: string,
): Promise<AuthLinkResult> {
  const base = resolveApiBase();
  if (base === null) {
    return { ok: false, status: 0, error: "no_api_base_url" };
  }
  try {
    const r = await fetch(`${base}/api/auth/link`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clerkSessionToken}`,
      },
      body: JSON.stringify({ legacyToken }),
    });
    let body: Partial<AuthLinkResult> = {};
    try {
      body = (await r.json()) as Partial<AuthLinkResult>;
    } catch (err) {
      console.warn("[auth] /api/auth/link non-JSON body", err);
    }
    return {
      ok: r.ok,
      status: r.status,
      appUserId:
        typeof body.appUserId === "string" ? body.appUserId : undefined,
      error: typeof body.error === "string" ? body.error : undefined,
    };
  } catch (err) {
    console.warn("[auth] /api/auth/link request failed", err);
    return { ok: false, status: 0, error: "network_error" };
  }
}
