/**
 * Per-user bearer token used to authorise our small set of "per-user"
 * server endpoints (`/api/events`, `/api/push/*`).
 *
 * Trust-on-first-use pairing:
 *   1. The first time we need a token for `appUserId`, we POST to
 *      `/api/auth/bootstrap` and receive a freshly-minted opaque token.
 *   2. We persist `{ appUserId → token }` in AsyncStorage.
 *   3. Subsequent calls return the cached token without a network hop.
 *
 * If the server returns 409 (token already claimed by another device),
 * we cannot recover for this user — there is no UI escalation in v1, so
 * we simply return null and the caller skips the per-user request. The
 * device that claimed the userId first keeps using its locally-cached
 * token.
 *
 * Web is unsupported (the per-user API path is mobile-only) and we
 * return null without making a network call.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const TOKEN_KEY_PREFIX = "@snaplife/userToken/v1:";

const memCache = new Map<string, string | null>();

function keyFor(appUserId: string): string {
  return `${TOKEN_KEY_PREFIX}${appUserId}`;
}

function getApiBaseUrl(): string {
  const override = process.env.EXPO_PUBLIC_API_URL;
  if (override) return override.replace(/\/$/, "");
  if (Platform.OS === "web") return "";
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) return "";
  return domain.startsWith("http") ? domain : `https://${domain}`;
}

/**
 * Return the cached token without touching the network. `null` if we have
 * never bootstrapped for this user on this device.
 */
export async function getUserToken(
  appUserId: string | null | undefined,
): Promise<string | null> {
  if (!appUserId) return null;
  if (memCache.has(appUserId)) return memCache.get(appUserId) ?? null;
  try {
    const v = await AsyncStorage.getItem(keyFor(appUserId));
    memCache.set(appUserId, v ?? null);
    return v ?? null;
  } catch {
    return null;
  }
}

/**
 * Return the token, fetching from the server (and caching) if needed.
 * Idempotent and safe to call from many places — the in-flight promise is
 * shared so two simultaneous bootstraps for the same user only hit the
 * network once.
 */
const inflight = new Map<string, Promise<string | null>>();

export async function bootstrapUserToken(
  appUserId: string | null | undefined,
): Promise<string | null> {
  if (!appUserId) return null;
  if (Platform.OS === "web") return null;

  const cached = await getUserToken(appUserId);
  if (cached) return cached;

  const existing = inflight.get(appUserId);
  if (existing) return existing;

  const p = (async () => {
    const base = getApiBaseUrl();
    if (!base) return null;
    try {
      const r = await fetch(`${base}/api/auth/bootstrap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appUserId }),
      });
      if (r.status === 409) {
        // Another device already claimed this userId. Without a recovery
        // flow in v1 we record the failure (null) so we don't retry on
        // every interaction.
        memCache.set(appUserId, null);
        return null;
      }
      if (!r.ok) return null;
      const j = (await r.json()) as { token?: unknown };
      const token = typeof j.token === "string" && j.token.length > 0 ? j.token : null;
      if (token) {
        try {
          await AsyncStorage.setItem(keyFor(appUserId), token);
        } catch {
          // non-fatal
        }
        memCache.set(appUserId, token);
      }
      return token;
    } catch {
      return null;
    }
  })();
  inflight.set(appUserId, p);
  try {
    return await p;
  } finally {
    inflight.delete(appUserId);
  }
}

/**
 * Build the standard Authorization header for per-user requests. Returns
 * an empty object if no token is available — the caller can decide whether
 * to short-circuit or send the request unauthenticated (the server will
 * reject the latter with 401).
 */
export async function authHeader(
  appUserId: string | null | undefined,
): Promise<Record<string, string>> {
  const token = await bootstrapUserToken(appUserId);
  return token ? { Authorization: `Bearer ${token}` } : {};
}
