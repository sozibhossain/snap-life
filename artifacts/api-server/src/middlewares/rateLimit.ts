/**
 * Rate-limit middleware for the SNAP Life API.
 *
 * Named limiters cover the public abuse surfaces:
 *   - `authLimiter`  : 5 requests / minute / IP on `/api/auth/*`. Limits
 *     legacy bearer-token bootstrap + Clerk linking. Keyed by IP because
 *     these are pre-auth surfaces.
 *   - `eventsLimiter`: 60 requests / minute / user on `POST /api/events`.
 *     A well-behaved client batches events, so 60/min is generous.
 *   - `chatLimiter`  : 20 requests / minute / user on `POST /api/chat/bone-buddy`.
 *     OpenAI is expensive; the mobile client is conversational, not
 *     scripted.
 *   - `serviceRequestLimiter`: 10 requests / 10 minutes / verified user or IP
 *     for coaching and expert-support email/payment handoffs.
 *
 * Keying strategy (security-critical):
 *   The user-keyed limiters partition by *verified* principal:
 *     1. `req.auth.userId` (set by Clerk middleware after session
 *        verification) → `clerk:<userId>`.
 *     2. Legacy bearer token, only if the token actually resolves to a
 *        row in `user_tokens` → `app:<appUserId>`. The lookup is
 *        memoised in-process for 60s so the limiter doesn't add a DB
 *        round-trip per request.
 *     3. Otherwise, source IP → `ip:<addr>`.
 *
 *   Crucially, an unrecognised bearer string is never used as a key
 *   directly: an attacker rotating fake bearers from one IP would
 *   otherwise mint unlimited synthetic identities and bypass the
 *   limiter. Unknown bearers fall through to IP keying.
 *
 * Tests should not be limited — the limiter is a no-op when
 * `NODE_ENV === "test"` (vitest runs set NODE_ENV automatically).
 */

import rateLimit, {
  ipKeyGenerator,
  type RateLimitRequestHandler,
  type Options,
} from "express-rate-limit";
import type { Request, RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, userTokensTable } from "@workspace/db";

const MINUTE_MS = 60 * 1000;

// Limiters are a no-op in test (vitest) and development. In dev, all
// traffic in the Replit preview shares one IP through the proxy, so
// IP-keyed limits like authLimiter (5/min/IP) immediately exhaust the
// bucket and break normal usage. Production keeps full enforcement.
const isNonProd = (): boolean =>
  process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development";

/**
 * Bearer-token → appUserId resolver, with a small in-process LRU
 * cache. The cache is shared across all limiters; hot tokens hit the
 * cache and add zero latency.
 */
const TOKEN_CACHE_TTL_MS = 60 * 1000;
const TOKEN_CACHE_MAX = 5_000;
const tokenCache = new Map<
  string,
  { appUserId: string | null; expiresAt: number }
>();

async function resolveBearerOwner(token: string): Promise<string | null> {
  const now = Date.now();
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > now) return cached.appUserId;

  let owner: string | null = null;
  try {
    const rows = await db
      .select({ appUserId: userTokensTable.appUserId })
      .from(userTokensTable)
      .where(eq(userTokensTable.token, token))
      .limit(1);
    owner = rows[0]?.appUserId ?? null;
  } catch {
    // DB hiccup — fall back to IP keying for this request rather than
    // 500ing the user. Don't cache the failure.
    return null;
  }

  // Naive LRU eviction: drop the oldest insertion when full.
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    const firstKey = tokenCache.keys().next().value;
    if (firstKey !== undefined) tokenCache.delete(firstKey);
  }
  tokenCache.set(token, {
    appUserId: owner,
    expiresAt: now + TOKEN_CACHE_TTL_MS,
  });
  return owner;
}

/** Test/teardown hook. Resets the resolver cache. */
export function _resetRateLimitTokenCache(): void {
  tokenCache.clear();
}

async function userKey(req: Request): Promise<string> {
  // 1) Verified Clerk principal — best signal.
  const clerkAuth = (req as { auth?: { userId?: string | null } }).auth;
  if (clerkAuth?.userId) return `clerk:${clerkAuth.userId}`;

  // 2) Legacy bearer — only trust it as a key if it resolves to a
  // real `user_tokens` row. Unknown bearers fall through to IP.
  const auth = req.header("authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    if (token) {
      const owner = await resolveBearerOwner(token);
      if (owner) return `app:${owner}`;
    }
  }

  // 3) Anonymous / unverified — IP fallback (normalised via ipKeyGenerator
  //    so IPv6 /56 subnets share a bucket, matching the auth limiter).
  return `ip:${ipKeyGenerator(req.ip ?? "0.0.0.0")}`;
}

const noop: RequestHandler = (_req, _res, next) => next();

function makeLimiter(
  opts: Partial<Options>,
): RateLimitRequestHandler | RequestHandler {
  if (isNonProd()) return noop;
  return rateLimit({
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: "rate_limited" });
    },
    ...opts,
  });
}

/** 5 / min / IP. Pre-auth surfaces. */
export const authLimiter: RateLimitRequestHandler | RequestHandler = makeLimiter({
  windowMs: MINUTE_MS,
  limit: 5,
  // Pre-auth: the bearer token is being minted, so key strictly by IP.
  keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? "0.0.0.0")}`,
});

/** 60 / min / verified-user (or IP). Per `POST /api/events`. */
export const eventsLimiter: RateLimitRequestHandler | RequestHandler = makeLimiter({
  windowMs: MINUTE_MS,
  limit: 60,
  keyGenerator: userKey,
});

/** 20 / min / verified-user (or IP). Per `POST /api/chat/bone-buddy`. */
export const chatLimiter: RateLimitRequestHandler | RequestHandler = makeLimiter({
  windowMs: MINUTE_MS,
  limit: 20,
  keyGenerator: userKey,
});

/** 10 / 10 min / verified-user (or IP) for external service requests. */
export const serviceRequestLimiter: RateLimitRequestHandler | RequestHandler = makeLimiter({
  windowMs: 10 * MINUTE_MS,
  limit: 10,
  keyGenerator: userKey,
});
