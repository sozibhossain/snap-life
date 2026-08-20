/**
 * Monthly testimonial request worker.
 *
 * Once per calendar month per eligible active paid subscriber, sends:
 *   1. A push notification asking them to share their story.
 *   2. An email of kind "testimonial_request" via the pending_emails queue.
 *
 * Eligibility criteria:
 *   - subscribers.isActive = true
 *   - subscribers.isInTrial = false (paid subscribers only — no trial users)
 *   - subscribers.latestPurchaseAt >= 30 days ago (at least one month in)
 *   - users.deletedAt IS NULL
 *
 * Idempotency:
 *   One notification per user per calendar month. Each pending_emails row
 *   carries externalId = `testimonial_request:{appUserId}:{YYYY-MM}` which
 *   maps to a unique partial index. Concurrent runs and retries produce at
 *   most one row via onConflictDoNothing.
 *
 * Cadence:
 *   Runs daily (once per day) — the monthly gate prevents spam. Disabled
 *   under NODE_ENV=test so vitest runs don't keep open handles.
 */

import { and, eq, isNull, lte } from "drizzle-orm";
import {
  db,
  pendingEmailsTable,
  pushTokensTable,
  subscribersTable,
  usersTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { workersEnabled } from "../lib/workerGate";

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const PUSH_TITLE = "How's SNAP Life working for you?";
const PUSH_BODY =
  "We'd love to hear your story — it takes just a minute and helps others on their bone health journey.";

export interface TestimonialWorkerResult {
  scanned: number;
  enqueued: number;
  skipped: number;
  errors: number;
}

/** Returns the current calendar month as "YYYY-MM". */
function currentYearMonth(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** True if a testimonial_request for this user+month already exists. */
async function testimonialAlreadyEnqueued(
  appUserId: string,
  yearMonth: string,
): Promise<boolean> {
  const externalId = `testimonial_request:${appUserId}:${yearMonth}`;
  const rows = await db
    .select({ id: pendingEmailsTable.id })
    .from(pendingEmailsTable)
    .where(eq(pendingEmailsTable.externalId, externalId))
    .limit(1);
  return rows.length > 0;
}

/**
 * True if the user has explicitly opted out of all push notifications.
 * Users with no tokens are treated as opted-in (column default = true).
 */
async function userHasOptedOutOfNotifications(appUserId: string): Promise<boolean> {
  const tokens = await db
    .select({ optedIn: pushTokensTable.optedIn })
    .from(pushTokensTable)
    .where(eq(pushTokensTable.appUserId, appUserId));
  if (tokens.length === 0) return false;
  return tokens.every((t) => t.optedIn === false);
}

/**
 * Send a testimonial-request push to all opted-in Expo push tokens.
 * Fire-and-forget from the caller's perspective — failures are logged
 * but never block the email enqueue.
 */
async function sendTestimonialPush(
  appUserId: string,
): Promise<"sent" | "no_tokens" | "error"> {
  let tokens: { expoToken: string }[];
  try {
    tokens = await db
      .select({ expoToken: pushTokensTable.expoToken })
      .from(pushTokensTable)
      .where(
        and(
          eq(pushTokensTable.appUserId, appUserId),
          eq(pushTokensTable.optedIn, true),
        ),
      );
  } catch (err) {
    logger.error({ err, appUserId }, "testimonialWorker: failed to load push tokens");
    return "error";
  }

  if (tokens.length === 0) return "no_tokens";

  const messages = tokens.map((t) => ({
    to: t.expoToken,
    sound: "default" as const,
    title: PUSH_TITLE,
    body: PUSH_BODY,
    data: { type: "testimonial_request" },
  }));

  try {
    const resp = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(messages),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      logger.error(
        { status: resp.status, text, appUserId },
        "testimonialWorker: Expo push API error",
      );
      return "error";
    }
    return "sent";
  } catch (err) {
    logger.error({ err, appUserId }, "testimonialWorker: Expo push network error");
    return "error";
  }
}

/**
 * Single worker pass.
 *
 * Selects eligible paid subscribers and, for each one not yet contacted
 * this month, sends a push notification and enqueues a testimonial_request
 * email. Safe to call repeatedly — all writes are guarded by idempotency
 * checks and the onConflictDoNothing constraint.
 */
export async function runTestimonialWorkerPass(
  now: Date = new Date(),
): Promise<TestimonialWorkerResult> {
  let enqueued = 0;
  let skipped = 0;
  let errors = 0;

  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
  const yearMonth = currentYearMonth(now);

  const candidates = await db
    .select({
      appUserId: subscribersTable.appUserId,
      email: usersTable.email,
    })
    .from(subscribersTable)
    .innerJoin(usersTable, eq(usersTable.appUserId, subscribersTable.appUserId))
    .where(
      and(
        eq(subscribersTable.isActive, true),
        eq(subscribersTable.isInTrial, false),
        lte(subscribersTable.latestPurchaseAt, thirtyDaysAgo),
        isNull(usersTable.deletedAt),
      ),
    );

  for (const row of candidates) {
    try {
      const alreadyEnqueued = await testimonialAlreadyEnqueued(row.appUserId, yearMonth);
      if (alreadyEnqueued) {
        skipped += 1;
        continue;
      }

      const optedOut = await userHasOptedOutOfNotifications(row.appUserId);
      if (optedOut) {
        skipped += 1;
        continue;
      }

      await sendTestimonialPush(row.appUserId);

      if (!row.email) {
        skipped += 1;
        continue;
      }

      const externalId = `testimonial_request:${row.appUserId}:${yearMonth}`;
      await db
        .insert(pendingEmailsTable)
        .values({
          kind: "testimonial_request",
          toAddress: row.email,
          externalId,
          payload: { appUserId: row.appUserId, yearMonth },
        })
        .onConflictDoNothing();

      enqueued += 1;
    } catch (err) {
      errors += 1;
      logger.error(
        { err, appUserId: row.appUserId },
        "testimonialWorker: failed to process user",
      );
    }
  }

  if (candidates.length > 0 || enqueued > 0) {
    logger.info(
      { scanned: candidates.length, enqueued, skipped, errors, yearMonth },
      "testimonialWorker: pass complete",
    );
  }

  return { scanned: candidates.length, enqueued, skipped, errors };
}

let timer: NodeJS.Timeout | null = null;

/**
 * Start the daily testimonial-request pass. Disabled under NODE_ENV=test.
 * Daily cadence is sufficient — the monthly externalId gate prevents repeat
 * sends for the same user within a calendar month.
 */
export function startTestimonialScheduler(
  intervalMs: number = 24 * 60 * 60 * 1000,
): void {
  if (!workersEnabled()) return;
  if (timer) return;
  void runTestimonialWorkerPass().catch((err) => {
    logger.error({ err }, "testimonialWorker: initial pass failed");
  });
  timer = setInterval(() => {
    void runTestimonialWorkerPass().catch((err) => {
      logger.error({ err }, "testimonialWorker: scheduled pass failed");
    });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
}

/** Test/teardown hook. */
export function stopTestimonialScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
