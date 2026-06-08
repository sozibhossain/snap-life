import type { Request, Response } from "express";
import { clerkClient, verifyToken } from "@clerk/express";
import { db, pendingEmailsTable, subscribersTable, userTokensTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Length of the server-managed Premium trial granted automatically at
 * registration. Centralised here (rather than in route code) because both
 * the grant in `upsertClerkUser` and the read endpoint
 * `GET /api/subscription/me` need to agree on the same number.
 */
export const SERVER_TRIAL_LENGTH_DAYS = 30;
const SERVER_TRIAL_LENGTH_MS = SERVER_TRIAL_LENGTH_DAYS * 24 * 60 * 60 * 1000;

const TOKEN_PREFIX = "Bearer ";
const MAX_TOKEN_LEN = 200;

export interface AuthedUser {
  appUserId: string;
  isAdmin: boolean;
  isTester: boolean;
  source: "clerk" | "legacy";
  /** Denormalised from the users row. Null for legacy-token callers where
   *  the email column is unpopulated or the account has been GDPR-redacted. */
  email: string | null;
}

/**
 * Returns true and writes a 410 response if the user row has been
 * GDPR-soft-deleted. `requireUser` calls this immediately after looking
 * up the row so a deleted account cannot continue to call the API even
 * if it still presents a valid bearer/Clerk session.
 */
function isUserDeleted(deletedAt: Date | null | undefined): boolean {
  return deletedAt != null;
}

export function clerkAuthOf(req: Request): {
  userId: string | null;
  sessionClaims: unknown;
} {
  const auth = (req as { auth?: { userId?: string; sessionClaims?: unknown } })
    .auth;
  return {
    userId: auth?.userId ?? null,
    sessionClaims: auth?.sessionClaims ?? null,
  };
}

/**
 * Attempt to verify a Clerk JWT directly using the secret key, bypassing
 * the `clerkMiddleware` cookie/dev-browser flow. This is needed in
 * development where the Clerk proxy is not active and the `__clerk_db_jwt`
 * dev-browser cookie is set on Clerk's own domain rather than ours.
 *
 * Returns the Clerk user ID on success, null on any failure.
 */
async function verifyClerkBearerJwt(
  authHeader: string,
): Promise<string | null> {
  if (!authHeader.startsWith(TOKEN_PREFIX)) return null;
  const token = authHeader.slice(TOKEN_PREFIX.length).trim();
  // Clerk JWTs are three base64url segments separated by dots.
  // Legacy app tokens are opaque short strings with no dots.
  if (!token.includes(".")) return null;
  if (token.length > 4096) return null;
  try {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) return null;
    const payload = await verifyToken(token, { secretKey });
    const sub = (payload as { sub?: string }).sub;
    logger.info({ sub }, "verifyClerkBearerJwt: direct JWT verified");
    return sub ?? null;
  } catch (err) {
    logger.warn({ err }, "verifyClerkBearerJwt: token verification failed");
    return null;
  }
}

export async function requireUser(
  req: Request,
  res: Response,
  opts: { silent?: boolean } = {},
): Promise<AuthedUser | null> {
  // `silent` lets callers (e.g. /storage/objects/* which serves
  // both public and private objects) attempt to identify the caller
  // without having a 401 written to the response when no creds are
  // present — they decide what to do with the null return.
  const silent = opts.silent === true;

  // 1. Try Clerk session from clerkMiddleware (cookie-based, works in prod
  //    and in dev when the dev-browser cookie is present on our domain).
  const { userId: clerkUserId, sessionClaims } = clerkAuthOf(req);
  if (clerkUserId) {
    try {
      const row = await upsertClerkUser(
        clerkUserId,
        claimsToProfile(sessionClaims),
      );
      if (isUserDeleted(row.deletedAt)) {
        if (!silent) res.status(410).json({ error: "account_deleted" });
        return null;
      }
      return {
        appUserId: row.appUserId,
        isAdmin: row.isAdmin,
        isTester: row.isTester,
        source: "clerk",
        email: row.email,
      };
    } catch (err) {
      req.log?.error({ err }, "requireUser clerk lookup failed");
      if (!silent) res.status(500).json({ error: "internal" });
      return null;
    }
  }

  // 2. If clerkMiddleware didn't resolve a session (e.g. dev-browser cookie
  //    missing in development), try verifying a Clerk JWT directly from the
  //    Authorization header. This path handles the admin web app in dev mode
  //    where the Clerk proxy is inactive and the dev-browser cookie lives on
  //    Clerk's domain rather than ours.
  const authHeader = req.header("authorization") ?? "";
  const directClerkUserId = await verifyClerkBearerJwt(authHeader);
  if (directClerkUserId) {
    try {
      const row = await upsertClerkUser(directClerkUserId, {});
      if (isUserDeleted(row.deletedAt)) {
        if (!silent) res.status(410).json({ error: "account_deleted" });
        return null;
      }
      return {
        appUserId: row.appUserId,
        isAdmin: row.isAdmin,
        isTester: row.isTester,
        source: "clerk",
        email: row.email,
      };
    } catch (err) {
      req.log?.error({ err }, "requireUser direct-jwt lookup failed");
      if (!silent) res.status(500).json({ error: "internal" });
      return null;
    }
  }

  const header = req.header("authorization") ?? "";
  if (!header.startsWith(TOKEN_PREFIX)) {
    if (!silent) res.status(401).json({ error: "missing bearer token" });
    return null;
  }
  const token = header.slice(TOKEN_PREFIX.length).trim();
  if (!token || token.length > MAX_TOKEN_LEN) {
    if (!silent) res.status(401).json({ error: "invalid bearer token" });
    return null;
  }
  try {
    const [tokenRow] = await db
      .select({ appUserId: userTokensTable.appUserId })
      .from(userTokensTable)
      .where(eq(userTokensTable.token, token))
      .limit(1);
    if (!tokenRow) {
      if (!silent) res.status(401).json({ error: "unknown bearer token" });
      return null;
    }
    void db
      .update(userTokensTable)
      .set({ lastUsedAt: new Date() })
      .where(eq(userTokensTable.appUserId, tokenRow.appUserId))
      .catch((err) =>
        req.log?.warn({ err }, "user_tokens.lastUsedAt refresh failed"),
      );
    const [userRow] = await db
      .select({
        isAdmin: usersTable.isAdmin,
        isTester: usersTable.isTester,
        deletedAt: usersTable.deletedAt,
        email: usersTable.email,
      })
      .from(usersTable)
      .where(eq(usersTable.appUserId, tokenRow.appUserId))
      .limit(1);
    if (userRow && isUserDeleted(userRow.deletedAt)) {
      if (!silent) res.status(410).json({ error: "account_deleted" });
      return null;
    }
    return {
      appUserId: tokenRow.appUserId,
      isAdmin: userRow?.isAdmin ?? false,
      isTester: userRow?.isTester ?? false,
      source: "legacy",
      email: userRow?.email ?? null,
    };
  } catch (err) {
    req.log?.error({ err }, "requireUserAuth lookup failed");
    if (!silent) res.status(500).json({ error: "internal" });
    return null;
  }
}

export async function requireUserAuth(
  req: Request,
  res: Response,
): Promise<string | null> {
  const u = await requireUser(req, res);
  return u?.appUserId ?? null;
}

/**
 * Authenticate AND authorize as an admin. Returns the AuthedUser when the
 * caller has a valid session and `users.isAdmin = true`. Otherwise writes
 * a 401 (no session) or 403 (session but not admin) and returns null.
 *
 * Belt-and-braces: every admin route handler should call this AND treat
 * a null return as "stop" — never trust isAdmin off a stale session.
 */
export async function requireAdminUser(
  req: Request,
  res: Response,
): Promise<AuthedUser | null> {
  const u = await requireUser(req, res);
  if (!u) return null; // requireUser already wrote a 401/500 response
  if (!u.isAdmin) {
    res.status(403).json({ error: "admin required" });
    return null;
  }
  return u;
}

export function assertSelf(
  res: Response,
  authedUserId: string,
  claimed: unknown,
): boolean {
  if (claimed != null && claimed !== authedUserId) {
    res.status(403).json({ error: "user mismatch" });
    return true;
  }
  return false;
}

/**
 * Resolve the email for a Clerk user when it was not present in the JWT
 * session claims. Falls back to the Clerk Backend API which always has
 * the authoritative email. Returns null on any error so the caller can
 * still proceed — email is stored opportunistically, not required.
 */
async function fetchClerkEmail(clerkUserId: string): Promise<string | null> {
  try {
    const user = await clerkClient.users.getUser(clerkUserId);
    const primary = user.emailAddresses.find(
      (e) => e.id === user.primaryEmailAddressId,
    );
    return primary?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
  } catch (err) {
    logger.warn({ err, clerkUserId }, "fetchClerkEmail: Clerk API call failed");
    return null;
  }
}

export async function upsertClerkUser(
  clerkUserId: string,
  fields: { email?: string | null; displayName?: string | null } = {},
): Promise<{
  appUserId: string;
  isAdmin: boolean;
  isTester: boolean;
  deletedAt: Date | null;
  email: string | null;
}> {
  // If the JWT claims didn't carry an email (Clerk doesn't include it by
  // default), look it up via the Clerk Backend API so we can store it.
  const resolvedEmail = fields.email ?? (await fetchClerkEmail(clerkUserId));

  const insertResult = await db
    .insert(usersTable)
    .values({
      appUserId: clerkUserId,
      clerkUserId,
      email: resolvedEmail ?? null,
      displayName: fields.displayName ?? null,
      isAdmin: false,
    })
    .onConflictDoNothing()
    .returning({ appUserId: usersTable.appUserId });

  // Queue a welcome email for brand-new users only (insert returned a row).
  if (insertResult.length > 0 && resolvedEmail) {
    await db
      .insert(pendingEmailsTable)
      .values({
        kind: "welcome",
        toAddress: resolvedEmail,
        externalId: `welcome:${clerkUserId}`,
        payload: { appUserId: clerkUserId, displayName: fields.displayName ?? null },
      })
      .onConflictDoNothing()
      .catch((err) => {
        logger.warn({ err, clerkUserId }, "upsertClerkUser: failed to enqueue welcome email (soft)");
      });
  }

  // Server-managed trial grant (legacy).
  //
  // DISABLED — the app now uses RevenueCat IAP introductory offers for the
  // 1-month free trial. Users enter payment details upfront in the App Store
  // / Google Play; RevenueCat manages the trial period and fires the
  // INITIAL_PURCHASE webhook when the trial starts, which the webhook handler
  // mirrors into the `subscribers` table with trialSource = 'store'.
  //
  // To re-enable the server trial (e.g. for staging smoke-tests or a
  // temporary back-compat window), set SNAP_LIFE_ENABLE_SERVER_TRIAL=true.
  //
  // Existing rows with trialSource = 'server' are unaffected — the cleanup
  // and reminder workers continue to process them normally until they expire.
  if (process.env.SNAP_LIFE_ENABLE_SERVER_TRIAL === "true") {
    try {
      const now = new Date();
      const trialEndsAt = new Date(now.getTime() + SERVER_TRIAL_LENGTH_MS);
      await db
        .insert(subscribersTable)
        .values({
          appUserId: clerkUserId,
          entitlementId: "snap_premium",
          isActive: true,
          isInTrial: true,
          willRenew: false,
          productId: null,
          periodType: "TRIAL",
          store: null,
          trialSource: "server",
          trialEndsAt,
          expiresAt: trialEndsAt,
          originalPurchaseAt: null,
          latestPurchaseAt: null,
          unsubscribeDetectedAt: null,
          cancelledAt: null,
          rawCustomerInfo: { source: "server-trial-grant" },
        })
        .onConflictDoNothing({ target: subscribersTable.appUserId });
    } catch (err) {
      logger.warn(
        { err, clerkUserId },
        "upsertClerkUser: server-trial grant insert failed (soft)",
      );
    }
  }
  const [row] = await db
    .select({
      appUserId: usersTable.appUserId,
      isAdmin: usersTable.isAdmin,
      isTester: usersTable.isTester,
      deletedAt: usersTable.deletedAt,
      email: usersTable.email,
      displayName: usersTable.displayName,
    })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  if (!row) {
    throw new Error(`upsertClerkUser: row missing after insert for ${clerkUserId}`);
  }
  // Don't refresh email/displayName on a soft-deleted account — those
  // fields were intentionally redacted by the GDPR delete.
  if (!isUserDeleted(row.deletedAt)) {
    const patch: { email?: string; displayName?: string; updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (resolvedEmail && resolvedEmail !== row.email) patch.email = resolvedEmail;
    if (fields.displayName && fields.displayName !== row.displayName) {
      patch.displayName = fields.displayName;
    }
    if (Object.keys(patch).length > 1) {
      await db
        .update(usersTable)
        .set(patch)
        .where(eq(usersTable.appUserId, row.appUserId));
    }
  }
  return {
    appUserId: row.appUserId,
    isAdmin: row.isAdmin,
    isTester: row.isTester,
    deletedAt: row.deletedAt,
    email: row.email ?? null,
  };
}

function extractClaim(claims: unknown, keys: string[]): string | undefined {
  if (!claims || typeof claims !== "object") return undefined;
  const obj = claims as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

export function claimsToProfile(claims: unknown): {
  email?: string | null;
  displayName?: string | null;
} {
  return {
    email: extractClaim(claims, ["email"]),
    displayName: extractClaim(claims, ["name", "full_name", "given_name"]),
  };
}
