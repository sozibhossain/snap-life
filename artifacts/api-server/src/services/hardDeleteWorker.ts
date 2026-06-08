/**
 * Hard-delete worker.
 *
 * GDPR right-to-erasure: `DELETE /api/me` flips users into a soft-
 * deleted state with `hardDeleteAfter = now + 30d`. This worker scans
 * the table on a fixed interval and, for each row whose grace window
 * has expired, hard-deletes the user row + every cascade table.
 *
 * Designed to be run in-process from `index.ts` via `startScheduler()`.
 * In a multi-instance deploy this should be moved to a dedicated cron
 * deployment, but the contract (idempotent SELECT-then-DELETE pass) is
 * already safe to run concurrently.
 */

import { lt, eq, and, isNotNull } from "drizzle-orm";
import {
  db,
  usersTable,
  userProfileTable,
  nutritionLogsTable,
  activityLogsTable,
  mealPlanDaysTable,
  wellbeingEntriesTable,
  gamificationStateTable,
  badgeUnlocksTable,
  assessmentResultsTable,
  supplementStateTable,
  pushTokensTable,
  pushUserStateTable,
  interactionEventsTable,
  userTokensTable,
  subscriptionEventsTable,
  feedbackTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { insertAuditLog } from "../lib/audit";

const ONE_HOUR_MS = 60 * 60 * 1000;

export interface HardDeleteResult {
  scanned: number;
  hardDeleted: number;
  errors: number;
}

/**
 * Shared cascade delete for a single user row.
 *
 * Removes every per-user table EXCEPT `audit_events` and `audit_logs` —
 * those rows are intentionally retained so the audit trail survives account
 * erasure (GDPR runbook §7). `subscribers` is also left intact because
 * RevenueCat may re-mirror it via webhook after the local user row is gone.
 *
 * Used by both `runHardDeletePass` (scheduled, grace-window-gated) and
 * `forceHardDeleteUser` (staging-only, immediate) to keep the two paths
 * in sync. Adding or removing a table here applies to both.
 */
async function hardDeleteUserCascade(appUserId: string, purgedAt: Date): Promise<void> {
  await Promise.all([
    db.delete(userProfileTable).where(eq(userProfileTable.appUserId, appUserId)),
    db.delete(nutritionLogsTable).where(eq(nutritionLogsTable.appUserId, appUserId)),
    db.delete(activityLogsTable).where(eq(activityLogsTable.appUserId, appUserId)),
    db.delete(mealPlanDaysTable).where(eq(mealPlanDaysTable.appUserId, appUserId)),
    db.delete(wellbeingEntriesTable).where(eq(wellbeingEntriesTable.appUserId, appUserId)),
    db.delete(gamificationStateTable).where(eq(gamificationStateTable.appUserId, appUserId)),
    db.delete(badgeUnlocksTable).where(eq(badgeUnlocksTable.appUserId, appUserId)),
    db.delete(assessmentResultsTable).where(eq(assessmentResultsTable.appUserId, appUserId)),
    db.delete(supplementStateTable).where(eq(supplementStateTable.appUserId, appUserId)),
    db.delete(pushTokensTable).where(eq(pushTokensTable.appUserId, appUserId)),
    db.delete(pushUserStateTable).where(eq(pushUserStateTable.appUserId, appUserId)),
    db.delete(interactionEventsTable).where(eq(interactionEventsTable.appUserId, appUserId)),
    db.delete(userTokensTable).where(eq(userTokensTable.appUserId, appUserId)),
    db.delete(subscriptionEventsTable).where(eq(subscriptionEventsTable.appUserId, appUserId)),
    db.delete(feedbackTable).where(eq(feedbackTable.appUserId, appUserId)),
  ]);
  await db.delete(usersTable).where(eq(usersTable.appUserId, appUserId));
  // Non-fatal audit entry — written after the delete succeeds.
  void insertAuditLog({
    targetUserId: appUserId,
    action: "system_hard_delete",
    metadata: { purgedAt: purgedAt.toISOString() },
  });
}

/**
 * Process every soft-deleted user whose grace window has expired.
 * Returns counters for logging/tests. Safe to call repeatedly.
 */
export async function runHardDeletePass(now: Date = new Date()): Promise<HardDeleteResult> {
  const due = await db
    .select({ appUserId: usersTable.appUserId })
    .from(usersTable)
    .where(
      and(
        isNotNull(usersTable.hardDeleteAfter),
        lt(usersTable.hardDeleteAfter, now),
      ),
    );

  let hardDeleted = 0;
  let errors = 0;

  for (const row of due) {
    const id = row.appUserId;
    try {
      await hardDeleteUserCascade(id, now);
      hardDeleted += 1;
    } catch (err) {
      errors += 1;
      logger.error(
        { err, appUserId: id },
        "hardDeleteWorker: failed to purge user (will retry on next pass)",
      );
    }
  }

  if (due.length > 0 || hardDeleted > 0) {
    logger.info(
      { scanned: due.length, hardDeleted, errors },
      "hardDeleteWorker: pass complete",
    );
  }

  return { scanned: due.length, hardDeleted, errors };
}

let timer: NodeJS.Timeout | null = null;

/**
 * Start the periodic hard-delete pass. Disabled under
 * `NODE_ENV=test` so vitest runs don't keep open handles.
 */
export function startHardDeleteScheduler(intervalMs: number = ONE_HOUR_MS): void {
  if (process.env.NODE_ENV === "test") return;
  if (timer) return;
  // Run once at boot so a freshly-restarted server doesn't wait an
  // hour to honour pending erasures.
  void runHardDeletePass().catch((err) => {
    logger.error({ err }, "hardDeleteWorker: initial pass failed");
  });
  timer = setInterval(() => {
    void runHardDeletePass().catch((err) => {
      logger.error({ err }, "hardDeleteWorker: scheduled pass failed");
    });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
}

/** Test/teardown hook. */
export function stopHardDeleteScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * Immediately hard-delete a single user by ID, bypassing the 30-day grace
 * window. Intended for staging-only use (via `POST /admin/users/:id/hard-delete`)
 * so that nightly E2E tests can verify the audit trail survives erasure without
 * waiting 30 days.
 *
 * Delegates to `hardDeleteUserCascade` — the same shared implementation used
 * by `runHardDeletePass` — so the two paths can never diverge.
 */
export async function forceHardDeleteUser(appUserId: string): Promise<{ found: boolean }> {
  const [existing] = await db
    .select({ appUserId: usersTable.appUserId })
    .from(usersTable)
    .where(eq(usersTable.appUserId, appUserId))
    .limit(1);

  if (!existing) return { found: false };

  await hardDeleteUserCascade(appUserId, new Date());
  return { found: true };
}
