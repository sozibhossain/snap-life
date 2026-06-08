/**
 * /api/subscription/me — resolved subscription/trial state for the caller.
 *
 * The mobile client previously inferred trial day-of and "Day X of N"
 * directly from the RevenueCat entitlement attached to the user. Switching
 * to a server-managed 30-day Premium trial granted at registration breaks
 * that contract: there's no entitlement to read on the client. This route
 * is the single seam the client now consults to render the trial badge,
 * the TrialPromptCard cascade, and the dashboard premium gates.
 *
 * The endpoint deliberately merges both sources (server trial + RC mirror
 * in `subscribers`) so the client can stop juggling them. The server-side
 * webhook + sync paths already collapse into the same `subscribers` row,
 * so a "real store purchase wins" outcome is enforced by the upsert
 * clearing `trialSource`, not by a special case here.
 */

import { Router, type IRouter } from "express";
import { db, subscribersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireUser, SERVER_TRIAL_LENGTH_DAYS } from "../lib/auth";
import { tierFromProductId } from "../lib/subscriptionPricing";

const router: IRouter = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Compute "Day X of trialLengthDays" from a fixed `trialEndsAt`. We never
 * persist `trialDayOf` itself — derive it from the wall-clock end so the
 * value advances naturally as time passes without scheduled writes.
 *
 * Clamps to `[1, length]` so a small clock skew on either side can't yield
 * a `Day 0` or `Day 31` badge.
 */
function dayOfFromEnd(
  trialEndsAt: Date,
  now: number,
  length: number,
): number {
  const remaining = trialEndsAt.getTime() - now;
  // remaining > length*DAY_MS would mean the trial start is in the future
  // (shouldn't happen, but clamp defensively).
  const remainingDays = Math.ceil(remaining / DAY_MS);
  const day = length - Math.max(0, Math.min(length, remainingDays)) + 1;
  return Math.max(1, Math.min(length, day));
}

router.get("/subscription/me", async (req, res): Promise<void> => {
  const u = await requireUser(req, res);
  if (!u) return;

  try {
    const [row] = await db
      .select()
      .from(subscribersTable)
      .where(eq(subscribersTable.appUserId, u.appUserId))
      .limit(1);

    const now = Date.now();
    const trialLengthDays = SERVER_TRIAL_LENGTH_DAYS;

    // No row at all → free tier, no trial. This shouldn't normally happen
    // (the trial grant in `upsertClerkUser` is best-effort but very
    // reliable), but the endpoint must still answer cleanly.
    if (!row) {
      res.json({
        tier: "free",
        isOnTrial: false,
        billingIssue: null,
        trialSource: null,
        trialDayOf: null,
        trialDaysRemaining: null,
        trialLengthDays,
        trialEndsAt: null,
        trialEndedAt: null,
      });
      return;
    }

    // Lazy expiry: the row's `isActive` may still be `true` but the trial
    // window has elapsed. Re-derive from `expiresAt` so the gates flip
    // off without us having to schedule a job. Mirrors the pattern used
    // by the existing entitlement read endpoint.
    const expiresAt = row.expiresAt;
    const stillWithinExpiry = !expiresAt || expiresAt.getTime() > now;
    // Billing-issue grace: a BILLING_ISSUE webhook keeps `isActive=true`
    // and stamps `billingIssueAt`/`gracePeriodEndsAt`. We keep the user
    // active until the grace window elapses, then lazily flip access off
    // here (mirrors the trial-expiry pattern).
    const billingIssueOpen =
      !!row.billingIssueAt &&
      !!row.gracePeriodEndsAt &&
      row.gracePeriodEndsAt.getTime() > now;
    const billingIssueExpired =
      !!row.billingIssueAt &&
      !!row.gracePeriodEndsAt &&
      row.gracePeriodEndsAt.getTime() <= now;
    const isActive = row.isActive && stillWithinExpiry && !billingIssueExpired;
    const billingIssue = billingIssueOpen
      ? {
          since: row.billingIssueAt!.toISOString(),
          gracePeriodEndsAt: row.gracePeriodEndsAt!.toISOString(),
        }
      : null;

    // Server trial state: the trial is active if it was granted by us
    // (`trialSource = "server"`) AND `trialEndsAt > now`. We DON'T look at
    // `isActive` here because that flag is also set for paid subscribers.
    const isServerTrialActive =
      row.trialSource === "server" &&
      !!row.trialEndsAt &&
      row.trialEndsAt.getTime() > now;

    // Store-side trial: a RevenueCat-mirrored TRIAL period. This wins over
    // the server trial because the upsert path clears `trialSource =
    // "server"` whenever a webhook arrives, so seeing "store" here means
    // a real store-side trial is in flight.
    const isStoreTrialActive =
      isActive && row.isInTrial && row.trialSource !== "server";

    if (isStoreTrialActive) {
      res.json({
        tier: "trial",
        isOnTrial: true,
        billingIssue,
        trialSource: "store",
        // Day-of/days-remaining for store trials come from RC on the client
        // (the SDK has the authoritative purchase date). We could compute
        // days-remaining from `expiresAt` here, but the client already has
        // a richer source — keep the server response truthful about what
        // *we* know.
        trialDayOf: null,
        trialDaysRemaining: expiresAt
          ? Math.max(0, Math.ceil((expiresAt.getTime() - now) / DAY_MS))
          : null,
        trialLengthDays,
        trialEndsAt: expiresAt ? expiresAt.toISOString() : null,
        trialEndedAt: null,
      });
      return;
    }

    if (isServerTrialActive) {
      const trialEndsAt = row.trialEndsAt!;
      const dayOf = dayOfFromEnd(trialEndsAt, now, trialLengthDays);
      const daysRemaining = Math.max(
        0,
        Math.ceil((trialEndsAt.getTime() - now) / DAY_MS),
      );
      res.json({
        tier: "trial",
        isOnTrial: true,
        billingIssue,
        trialSource: "server",
        trialDayOf: dayOf,
        trialDaysRemaining: daysRemaining,
        trialLengthDays,
        trialEndsAt: trialEndsAt.toISOString(),
        trialEndedAt: null,
      });
      return;
    }

    // Not on a trial. Resolve the paying tier from product id (with the
    // same heuristic the admin metrics use, so the two views agree).
    const productTier = tierFromProductId(row.productId);
    let tier: "free" | "plus" | "premium" = "free";
    if (isActive && !row.isInTrial && productTier !== "none") {
      tier = productTier;
    } else if (isActive && row.entitlementId === "snap_premium" && !row.isInTrial) {
      // Defensive: an active row with the premium entitlement but no
      // recognised product id (e.g. promotional grant) — treat as premium.
      tier = "premium";
    } else if (isActive && row.entitlementId === "snap_plus" && !row.isInTrial) {
      tier = "plus";
    }

    // Recently-ended server trial: the user's 30-day grant elapsed within
    // the last 7 days AND they are not on a paid entitlement. The dashboard
    // uses this to render a one-time post-trial banner. We deliberately
    // suppress this whenever `tier !== "free"` so converted users don't
    // see "your trial has ended" alongside their fresh paid plan.
    const SEVEN_DAYS_MS = 7 * DAY_MS;
    const recentlyEndedServerTrial =
      tier === "free" &&
      row.trialSource === "server" &&
      !!row.trialEndsAt &&
      row.trialEndsAt.getTime() <= now &&
      now - row.trialEndsAt.getTime() <= SEVEN_DAYS_MS;

    res.json({
      tier,
      isOnTrial: false,
      billingIssue,
      trialSource: null,
      trialDayOf: null,
      trialDaysRemaining: null,
      trialLengthDays,
      trialEndsAt: null,
      trialEndedAt: recentlyEndedServerTrial
        ? row.trialEndsAt!.toISOString()
        : null,
    });
  } catch (err) {
    req.log?.error({ err }, "GET /subscription/me failed");
    res.status(500).json({ error: "internal" });
  }
});

export default router;
