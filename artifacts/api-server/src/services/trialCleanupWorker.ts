/**
 * Trial-cleanup worker.
 *
 * The 30-day server-managed Premium trial is granted at registration by
 * writing a `subscribers` row with `trialSource = "server"`,
 * `trialEndsAt = now + 30d`, and `isActive = true`. Read paths
 * (`/api/subscription/me`, admin metrics) honour "lazy expiry" — they
 * compare `trialEndsAt` against the wall clock and treat the row as
 * inactive once the window has elapsed, so users *experience* the trial
 * ending on time without any scheduled write.
 *
 * Lazy expiry is correct but leaves rows marked `isActive = true`
 * forever. Over years that bloats the table, slows admin metric
 * aggregations, and clutters the subscribers listing. This worker
 * periodically flips `isActive = false` on long-expired server-trial
 * rows so the persisted state matches the lazy-derived state.
 *
 * Designed to be run in-process from `index.ts` via
 * `startTrialCleanupScheduler()`. Idempotent: a second pass over the
 * same rows is a no-op because `isActive = true` is part of the WHERE
 * clause.
 */

import { and, eq, lt } from "drizzle-orm";
import { db, subscribersTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { workersEnabled } from "../lib/workerGate";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface TrialCleanupResult {
  deactivated: number;
}

/**
 * Flip `isActive = false` on every server-trial row whose
 * `trialEndsAt` has passed. Returns the number of rows updated for
 * logging/tests. Safe to call repeatedly.
 *
 * Note: we deliberately leave `trialSource = "server"` and
 * `trialEndsAt` intact so the "recently-ended trial" banner in
 * `/api/subscription/me` (7-day window) and the
 * `trialsExpiredWithoutConversionLast30d` admin metric keep working.
 */
export async function runTrialCleanupPass(
  now: Date = new Date(),
): Promise<TrialCleanupResult> {
  const updated = await db
    .update(subscribersTable)
    .set({ isActive: false, updatedAt: now })
    .where(
      and(
        eq(subscribersTable.trialSource, "server"),
        eq(subscribersTable.isActive, true),
        lt(subscribersTable.trialEndsAt, now),
      ),
    )
    .returning({ appUserId: subscribersTable.appUserId });

  const deactivated = updated.length;
  if (deactivated > 0) {
    logger.info(
      { deactivated },
      "trialCleanupWorker: deactivated expired server-trial rows",
    );
  }
  return { deactivated };
}

let timer: NodeJS.Timeout | null = null;

/**
 * Start the periodic trial-cleanup pass (defaults to once per day).
 * Disabled under `NODE_ENV=test` so vitest runs don't keep open
 * handles.
 */
export function startTrialCleanupScheduler(
  intervalMs: number = ONE_DAY_MS,
): void {
  if (!workersEnabled()) return;
  if (timer) return;
  // Run once at boot so a freshly-restarted server doesn't wait a
  // full day to reconcile rows that expired while it was down.
  void runTrialCleanupPass().catch((err) => {
    logger.error({ err }, "trialCleanupWorker: initial pass failed");
  });
  timer = setInterval(() => {
    void runTrialCleanupPass().catch((err) => {
      logger.error({ err }, "trialCleanupWorker: scheduled pass failed");
    });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
}

/** Test/teardown hook. */
export function stopTrialCleanupScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
