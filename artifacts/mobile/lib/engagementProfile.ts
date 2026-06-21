/**
 * Mobile-side fetcher for the per-user engagement profile (Premium-only
 * adaptive surfaces). The shape mirrors the server type in
 * api-server/src/lib/engagementProfile.ts — kept in sync by hand because
 * we don't want to pull the api-server package into the Expo bundle.
 *
 * Cached in module scope per user for 5 minutes. The server's own cache
 * is 1h; we deliberately re-fetch more often than that so a tile order
 * can react to a session ending without waiting for an hour cache to
 * expire. The server still does the heavy aggregate at most once an
 * hour, so we're not paying for the freshness on the database.
 */

import { authHeader } from "./userToken";
import { getApiBaseUrl } from "./serverIdentity";
import type { BehaviouralStats } from "./behaviouralStats";

export interface EngagementByKind {
  shown: number;
  completed: number;
  dismissed: number;
  /** completed / shown, clamped to [0,1]. 0 when shown is 0. */
  rate: number;
}

// `BehaviouralStats` and `EMPTY_BEHAVIOURAL_STATS` live in their own
// RN-free module (`./behaviouralStats`) so vitest suites for pure-logic
// helpers can import them without pulling in the Expo runtime. Re-exported
// here so existing call sites that import from `./engagementProfile`
// keep working.
export type { BehaviouralStats } from "./behaviouralStats";
export { EMPTY_BEHAVIOURAL_STATS } from "./behaviouralStats";

export interface EngagementProfile {
  sevenDay: {
    byKind: Record<string, EngagementByKind>;
    totalShown: number;
    totalCompleted: number;
    totalDismissed: number;
    rate: number;
  };
  thirtyDayTrend: "improving" | "steady" | "dropping";
  /**
   * Behavioural snapshot. Older server builds may omit this — callers
   * that need it should fall back to `EMPTY_BEHAVIOURAL_STATS`.
   */
  behavioural?: BehaviouralStats;
  generatedAtMs: number;
}

const CACHE_TTL_MS = 5 * 60 * 1_000;

interface CacheEntry {
  profile: EngagementProfile | null;
  expiresAtMs: number;
}

const cache = new Map<string, CacheEntry>();
let inFlight = new Map<string, Promise<EngagementProfile | null>>();

/**
 * Fetch the engagement profile for a user. Returns `null` when there's
 * no auth or the request fails — callers must handle that as "no
 * adaptation available, fall back to the deterministic experience".
 *
 * Coalesces concurrent calls per user so a Dashboard tab + an Insights
 * card mounting in the same frame doesn't fire two HTTP requests.
 */
export async function fetchEngagementProfile(
  appUserId: string | null | undefined,
): Promise<EngagementProfile | null> {
  if (!appUserId) return null;
  const userId = appUserId;

  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.expiresAtMs > now) return hit.profile;

  const existing = inFlight.get(userId);
  if (existing) return existing;

  const p = (async () => {
    const base = getApiBaseUrl();
    if (!base) return null;
    try {
      const auth = await authHeader(userId);
      if (!auth.Authorization) return null;
      const r = await fetch(`${base}/api/engagement/profile`, { headers: auth });
      if (!r.ok) {
        cache.set(userId, { profile: null, expiresAtMs: now + CACHE_TTL_MS });
        return null;
      }
      const json = (await r.json()) as EngagementProfile;
      cache.set(userId, { profile: json, expiresAtMs: now + CACHE_TTL_MS });
      return json;
    } catch {
      cache.set(userId, { profile: null, expiresAtMs: now + CACHE_TTL_MS });
      return null;
    } finally {
      inFlight.delete(userId);
    }
  })();
  inFlight.set(userId, p);
  return p;
}

/** Test / diagnostic — clears the in-memory cache. */
export function __resetEngagementProfileCache(): void {
  cache.clear();
  inFlight = new Map();
}
