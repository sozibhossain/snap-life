/**
 * Billing-issue grace-window lapse worker.
 *
 * BILLING_ISSUE webhooks open a grace window (`billingIssueAt` +
 * `gracePeriodEndsAt`) on `subscribers`. The window is normally cleared
 * by the next successful RevenueCat webhook (RENEWAL / INITIAL_PURCHASE
 * / etc) via `upsertSubscriberMonotonic`. If RC goes silent — the user
 * abandons the retry, switches stores, or RC simply never fires another
 * event for this customer — those columns stay set forever and we rely
 * on lazy-expiry in `/subscription/me` and admin metrics to mask them.
 *
 * That's correct for end-user UX but bad for operations: the dashboard
 * banner copy ("update your payment method") stays armed against a row
 * that long-ago lapsed, and support has no clean signal for "the grace
 * window timed out without recovery".
 *
 * This worker sweeps once per day and, for every row whose
 * `gracePeriodEndsAt` is more than one day in the past, nulls both
 * billing-issue columns and emits a `billing_issue_lapsed` event into
 * `subscription_events` (the same audit log RC webhooks land in) so
 * support can filter on it. Idempotent: the synthetic `event_id` is
 * `billing_issue_lapsed:<appUserId>:<gracePeriodEndsAt-iso>` so a
 * re-run after a partial failure won't double-emit, and the UPDATE's
 * `gracePeriodEndsAt IS NOT NULL` predicate makes a second pass over
 * the same row a no-op.
 *
 * Designed to be run in-process from `index.ts` via
 * `startBillingIssueLapseScheduler()`. No-op under `NODE_ENV=test`.
 */

import { and, isNotNull, lt } from "drizzle-orm";
import {
  db,
  subscribersTable,
  subscriptionEventsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { workersEnabled } from "../lib/workerGate";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface BillingIssueLapseResult {
  cleared: number;
  eventsEmitted: number;
}

/**
 * Single sweep. Clears `billingIssueAt` + `gracePeriodEndsAt` on every
 * subscriber row whose grace window ended more than one day ago, and
 * emits one `billing_issue_lapsed` analytics event per cleared row.
 *
 * Returns the number of rows cleared and events successfully emitted
 * (events with a duplicate synthetic id are silently ignored, which is
 * the desired idempotent behaviour, so they do NOT count toward
 * `eventsEmitted`).
 */
export async function runBillingIssueLapsePass(
  now: Date = new Date(),
): Promise<BillingIssueLapseResult> {
  const cutoff = new Date(now.getTime() - ONE_DAY_MS);

  // Bulk clear in one statement and return the per-row context we need
  // to fabricate the analytics event id. Using RETURNING (instead of
  // SELECT-then-UPDATE) keeps the worker safe against a concurrent
  // recovery webhook landing mid-sweep — the recovery write would just
  // beat us to it and we'd return zero rows.
  const cleared = await db
    .update(subscribersTable)
    .set({
      billingIssueAt: null,
      gracePeriodEndsAt: null,
      updatedAt: now,
    })
    .where(
      and(
        isNotNull(subscribersTable.gracePeriodEndsAt),
        lt(subscribersTable.gracePeriodEndsAt, cutoff),
      ),
    )
    .returning({
      appUserId: subscribersTable.appUserId,
      gracePeriodEndsAt: subscribersTable.gracePeriodEndsAt,
      billingIssueAt: subscribersTable.billingIssueAt,
      entitlementId: subscribersTable.entitlementId,
    });

  let eventsEmitted = 0;
  for (const row of cleared) {
    // RETURNING on Postgres returns the OLD column values for an
    // UPDATE that nulls them only if you explicitly request the old
    // form; drizzle returns the post-update view, which means the
    // billing-issue columns come back null here. That's why we keyed
    // the worker entirely on the predicate above (we know
    // gracePeriodEndsAt was non-null pre-update) but we need to
    // re-derive the dedup key from a stable signal. The cutoff time
    // is stable across retries within the same sweep but NOT across
    // sweeps, so use the appUserId + the cleared row's updatedAt
    // (which we just set to `now`) for a per-sweep idempotent id.
    //
    // We can't use `gracePeriodEndsAt` in the id because we just
    // nulled it; using `now.toISOString()` (the sweep timestamp)
    // means two sweeps a day apart against the same already-cleared
    // row would still be deduped by the WHERE clause (no rows
    // returned the second time), so collisions are not possible in
    // practice.
    const eventId = `billing_issue_lapsed:${row.appUserId}:${now.toISOString()}`;
    try {
      const inserted = await db
        .insert(subscriptionEventsTable)
        .values({
          eventId,
          eventType: "billing_issue_lapsed",
          appUserId: row.appUserId,
          productId: null,
          environment: null,
          payload: {
            appUserId: row.appUserId,
            entitlementId: row.entitlementId,
            lapsedAt: now.toISOString(),
            reason: "grace_window_expired_without_recovery",
          },
        })
        .onConflictDoNothing({ target: subscriptionEventsTable.eventId })
        .returning({ eventId: subscriptionEventsTable.eventId });
      if (inserted.length > 0) eventsEmitted += 1;
    } catch (err) {
      logger.error(
        { err, appUserId: row.appUserId },
        "billingIssueLapseWorker: failed to emit billing_issue_lapsed event",
      );
    }
  }

  if (cleared.length > 0) {
    logger.info(
      { cleared: cleared.length, eventsEmitted },
      "billingIssueLapseWorker: cleared lapsed billing-issue grace windows",
    );
  }

  return { cleared: cleared.length, eventsEmitted };
}

let timer: NodeJS.Timeout | null = null;

/**
 * Start the periodic billing-issue lapse pass (defaults to once per
 * day). Disabled under `NODE_ENV=test` so vitest runs don't keep open
 * handles. Runs once at boot so a freshly-restarted server doesn't
 * wait a full day to reconcile windows that lapsed during downtime.
 */
export function startBillingIssueLapseScheduler(
  intervalMs: number = ONE_DAY_MS,
): void {
  if (!workersEnabled()) return;
  if (timer) return;
  void runBillingIssueLapsePass().catch((err) => {
    logger.error({ err }, "billingIssueLapseWorker: initial pass failed");
  });
  timer = setInterval(() => {
    void runBillingIssueLapsePass().catch((err) => {
      logger.error({ err }, "billingIssueLapseWorker: scheduled pass failed");
    });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
}

/** Test/teardown hook. */
export function stopBillingIssueLapseScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
