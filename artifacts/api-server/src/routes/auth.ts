import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { db, userTokensTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { claimsToProfile, clerkAuthOf, upsertClerkUser } from "../lib/auth";
import { createPasswordOnlySignInTicket } from "../lib/passwordOnlySignIn";

const router: IRouter = Router();

const MAX_USER_ID_LEN = 200;
const MAX_TOKEN_LEN = 200;
const MAX_EMAIL_LEN = 320;
const MAX_PASSWORD_LEN = 512;

router.post("/auth/password-only-sign-in", async (req, res) => {
  const body = req.body as { email?: unknown; password?: unknown } | undefined;
  const email = body?.email;
  const password = body?.password;
  if (
    typeof email !== "string" ||
    email.length === 0 ||
    email.length > MAX_EMAIL_LEN ||
    typeof password !== "string" ||
    password.length === 0 ||
    password.length > MAX_PASSWORD_LEN
  ) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    req.log?.error("password-only sign-in unavailable: CLERK_SECRET_KEY not set");
    res.status(503).json({ error: "sign_in_unavailable" });
    return;
  }

  try {
    const result = await createPasswordOnlySignInTicket(
      email,
      password,
      secretKey,
    );
    res.setHeader("Cache-Control", "no-store");
    if (!result.ok) {
      if (result.reason === "rate_limited") {
        res.status(429).json({ error: "rate_limited" });
      } else if (result.reason === "invalid_credentials") {
        res.status(401).json({ error: "invalid_credentials" });
      } else {
        req.log?.error("password-only sign-in: Clerk API failed");
        res.status(502).json({ error: "sign_in_unavailable" });
      }
      return;
    }
    res.json({ ticket: result.ticket });
  } catch (err) {
    req.log?.error({ err }, "password-only sign-in failed");
    res.status(502).json({ error: "sign_in_unavailable" });
  }
});

router.post("/auth/bootstrap", async (req, res) => {
  const body = req.body as { appUserId?: unknown } | undefined;
  const appUserId = body?.appUserId;
  if (
    typeof appUserId !== "string" ||
    appUserId.length === 0 ||
    appUserId.length > MAX_USER_ID_LEN
  ) {
    res.status(400).json({ error: "appUserId required" });
    return;
  }
  try {
    const existing = await db
      .select({ appUserId: userTokensTable.appUserId })
      .from(userTokensTable)
      .where(eq(userTokensTable.appUserId, appUserId))
      .limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "already_claimed" });
      return;
    }
    const token = randomBytes(32).toString("hex");
    await db.insert(userTokensTable).values({ appUserId, token });
    res.json({ token });
  } catch (err) {
    req.log?.error({ err }, "auth bootstrap failed");
    res.status(500).json({ error: "internal" });
  }
});

router.post("/auth/link", async (req, res) => {
  const { userId: clerkUserId } = clerkAuthOf(req);
  if (!clerkUserId) {
    res.status(401).json({ error: "clerk session required" });
    return;
  }
  const body = req.body as { legacyToken?: unknown } | undefined;
  const legacyToken = body?.legacyToken;
  if (
    typeof legacyToken !== "string" ||
    legacyToken.length === 0 ||
    legacyToken.length > MAX_TOKEN_LEN
  ) {
    res.status(400).json({ error: "legacyToken required" });
    return;
  }
  try {
    const [tokenRow] = await db
      .select({ appUserId: userTokensTable.appUserId })
      .from(userTokensTable)
      .where(eq(userTokensTable.token, legacyToken))
      .limit(1);
    if (!tokenRow) {
      res.status(401).json({ error: "unknown legacy token" });
      return;
    }
    const legacyAppUserId = tokenRow.appUserId;

    const [existingForClerk] = await db
      .select({
        appUserId: usersTable.appUserId,
        clerkUserId: usersTable.clerkUserId,
      })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .limit(1);

    if (existingForClerk) {
      if (existingForClerk.appUserId === legacyAppUserId) {
        res.json({ appUserId: legacyAppUserId, status: "already_linked" });
        return;
      }
      res.status(409).json({
        error: "clerk_user_already_linked",
        appUserId: existingForClerk.appUserId,
      });
      return;
    }

    const [existingForLegacy] = await db
      .select({
        appUserId: usersTable.appUserId,
        clerkUserId: usersTable.clerkUserId,
      })
      .from(usersTable)
      .where(eq(usersTable.appUserId, legacyAppUserId))
      .limit(1);

    if (existingForLegacy) {
      if (
        existingForLegacy.clerkUserId &&
        existingForLegacy.clerkUserId !== clerkUserId
      ) {
        res.status(409).json({
          error: "legacy_user_already_linked",
          appUserId: legacyAppUserId,
        });
        return;
      }
      await db
        .update(usersTable)
        .set({ clerkUserId, updatedAt: new Date() })
        .where(eq(usersTable.appUserId, legacyAppUserId));
    } else {
      await db.insert(usersTable).values({
        appUserId: legacyAppUserId,
        clerkUserId,
      });
    }
    res.json({ appUserId: legacyAppUserId, status: "linked" });
  } catch (err) {
    req.log?.error({ err }, "auth link failed");
    res.status(500).json({ error: "internal" });
  }
});

router.get("/auth/me", async (req, res) => {
  const { userId: clerkUserId, sessionClaims } = clerkAuthOf(req);
  if (!clerkUserId) {
    res.status(401).json({ error: "clerk session required" });
    return;
  }
  try {
    const row = await upsertClerkUser(clerkUserId, claimsToProfile(sessionClaims));
    // Honour the soft-delete contract. `requireUser` returns 410 for
    // every other authed surface; `/auth/me` is the gateway to all of
    // them and would otherwise tell the mobile client "you're signed
    // in" only for every subsequent request to fail with 410. Keeping
    // both behaviours aligned avoids confusing post-delete UX.
    if (row.deletedAt) {
      res.status(410).json({ error: "account_deleted" });
      return;
    }
    res.json({
      appUserId: row.appUserId,
      isAdmin: row.isAdmin,
      isTester: row.isTester,
      clerkUserId,
    });
  } catch (err) {
    req.log?.error({ err }, "auth me failed");
    res.status(500).json({ error: "internal" });
  }
});

export default router;
