/**
 * /api/referral — referral code management and conversion.
 *
 *   GET  /api/referral        → get (or lazy-create) the caller's referral code
 *   POST /api/referral/use    → record a referee signing up with a code,
 *                               award XP to the referrer, queue emails
 *
 * Referral codes are 8-character uppercase strings prefixed with "SNAP"
 * (e.g. SNAP1A2B). Generated lazily on first GET and stored in the
 * `referrals` table keyed by `referrerAppUserId`.
 *
 * XP is awarded by incrementing `user_profile.xp` and `.totalPoints`
 * for the referrer. The mobile client picks up the change on next sync.
 *
 * Idempotency: a referee can only use one code (unique partial index on
 * `referee_app_user_id`). Concurrent calls are safe via onConflictDoNothing.
 */

import { Router, type IRouter } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  referralsTable,
  usersTable,
  userProfileTable,
  pendingEmailsTable,
} from "@workspace/db";
import { requireUserAuth } from "../lib/auth";
import { sendBoneBuddyPush } from "../lib/pushSender";

const router: IRouter = Router();

const REFERRAL_XP = 250;

/** Generate a unique 8-char referral code: "SNAP" + 4 random alphanumeric chars. */
function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `SNAP${suffix}`;
}

/**
 * GET /api/referral
 * Returns the caller's referral code, creating one if it doesn't exist yet.
 */
router.get("/referral", async (req, res) => {
  const appUserId = await requireUserAuth(req, res);
  if (!appUserId) return;

  // Check for existing unredeemed code for this referrer
  const existing = await db
    .select({ code: referralsTable.code })
    .from(referralsTable)
    .where(
      and(
        eq(referralsTable.referrerAppUserId, appUserId),
        isNull(referralsTable.refereeAppUserId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    res.json({ code: existing[0].code });
    return;
  }

  // Lazy-create: generate a code, retry up to 5 times on collision
  let code = generateCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await db.insert(referralsTable).values({
        code,
        referrerAppUserId: appUserId,
      });
      break;
    } catch {
      code = generateCode();
    }
  }

  res.json({ code });
});

/**
 * POST /api/referral/use
 * Body: { code: string }
 *
 * Called during onboarding when a new user enters a referral code.
 * Records the conversion, awards XP to the referrer, and queues a
 * `referral_converted` email to the referrer.
 *
 * Returns 200 even if the code is invalid or already used (silent no-op)
 * to avoid leaking information about valid codes.
 */
router.post("/referral/use", async (req, res) => {
  const refereeAppUserId = await requireUserAuth(req, res);
  if (!refereeAppUserId) return;

  const code = (req.body?.code as string | undefined)?.trim().toUpperCase();

  if (!code) {
    res.status(400).json({ error: "code required" });
    return;
  }

  // Look up the referral row (must be unredeemed)
  const [referral] = await db
    .select()
    .from(referralsTable)
    .where(
      and(
        eq(referralsTable.code, code),
        isNull(referralsTable.refereeAppUserId),
      ),
    )
    .limit(1);

  if (!referral) {
    // Invalid or already used — silent success
    res.json({ ok: true, used: false });
    return;
  }

  // Prevent self-referral
  if (referral.referrerAppUserId === refereeAppUserId) {
    res.json({ ok: true, used: false });
    return;
  }

  const now = new Date();

  // Mark referral as converted
  await db
    .update(referralsTable)
    .set({
      refereeAppUserId,
      convertedAt: now,
      xpAwarded: true,
      updatedAt: now,
    })
    .where(eq(referralsTable.id, referral.id));

  // Award XP to referrer via safe SQL increment
  await db
    .update(userProfileTable)
    .set({
      xp: sql`${userProfileTable.xp} + ${REFERRAL_XP}`,
      totalPoints: sql`${userProfileTable.totalPoints} + ${REFERRAL_XP}`,
      updatedAt: now,
    })
    .where(eq(userProfileTable.appUserId, referral.referrerAppUserId));

  // Look up referrer email and referee name for the notification email
  const [referrer] = await db
    .select({ email: usersTable.email, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.appUserId, referral.referrerAppUserId))
    .limit(1);

  const [referee] = await db
    .select({ displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.appUserId, refereeAppUserId))
    .limit(1);

  // Queue a "referral converted" email to the referrer
  if (referrer?.email) {
    await db
      .insert(pendingEmailsTable)
      .values({
        kind: "referral_converted",
        toAddress: referrer.email,
        externalId: `referral_converted:${referral.id}`,
        payload: {
          referrerAppUserId: referral.referrerAppUserId,
          refereeName: referee?.displayName ?? "Your friend",
          xpAwarded: REFERRAL_XP,
        },
      })
      .onConflictDoNothing();
  }

  // Also fire a push notification to the referrer — a delight moment
  const refereeName = referee?.displayName ?? "A friend";
  void sendBoneBuddyPush(referral.referrerAppUserId, {
    title: "You just earned 250 XP!",
    body: `${refereeName} joined SNAP Life using your referral code. Keep building that community!`,
    copyId: `referral_converted:${referral.id}`,
    data: { kind: "referral_converted", xpAwarded: REFERRAL_XP },
  }).catch(() => undefined);

  req.log?.info(
    {
      referralId: referral.id,
      referrerAppUserId: referral.referrerAppUserId,
      refereeAppUserId,
    },
    "referral converted",
  );

  res.json({ ok: true, used: true, xpAwarded: REFERRAL_XP });
});

export default router;
