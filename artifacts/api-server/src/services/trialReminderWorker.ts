/**
 * Trial reminder worker.
 *
 * Sends reminder notifications (push + email) before a user's first payment
 * is processed, giving them time to cancel if they don't want to continue.
 *
 * Cadence:
 *   - Day 23 of 30  → 7 days before first payment  (`trial_reminder_7d`)
 *   - Day 28 of 30  → 2 days before first payment  (`trial_reminder_2d`)
 *
 * Each reminder sends:
 *   1. A push notification (Expo) — delivered immediately, respects opt-in.
 *   2. An email via the `pending_emails` queue — processed by the email sender.
 *
 * Scans both trialSource = 'server' (legacy) and trialSource = 'store'
 * (new RC IAP trial flow) so all trial users receive reminders regardless
 * of how their trial was started.
 *
 * "Day X" is derived from `subscribers.trialEndsAt` — the day-of trigger
 * is a one-full-calendar-day window so the worker can run hourly without a
 * wall-clock alignment constraint.
 *
 * Idempotency: each `pending_emails` row carries the `trialEndsAt` ISO
 * timestamp in its payload; the worker checks for an existing row of the
 * same `(kind, appUserId, trialEndsAt)` before inserting. Push notifications
 * use the same gate — a separate `reminderPushAlreadySent` check on the
 * payload. A re-granted trial gets fresh reminders because its `trialEndsAt`
 * value will differ.
 *
 * Notification preferences: if a user has push token rows and every single
 * one is `optedIn = false`, both push and email are skipped. Users with no
 * push tokens are treated as opted-in (column default = true).
 */

import { and, eq, gt, inArray, isNotNull, lte, sql } from "drizzle-orm";
import {
  db,
  pendingEmailsTable,
  pushTokensTable,
  subscribersTable,
  usersTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { workersEnabled } from "../lib/workerGate";

const ONE_HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_LENGTH_DAYS = 30;

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Per-reminder definition.
 *
 * `triggerDayOf`  — the trial day on which the reminder fires.
 * `daysRemaining` — days remaining when this reminder fires (for copy).
 * `emailKind`     — `pending_emails.kind` identifier.
 * `pushKind`      — used as the idempotency key for push delivery.
 */
interface ReminderDef {
  triggerDayOf: number;
  daysRemaining: number;
  emailKind: string;
  pushKind: string;
  pushTitle: string;
  pushBody: string;
}

const REMINDERS: readonly ReminderDef[] = [
  {
    triggerDayOf: 23,
    daysRemaining: 7,
    emailKind: "trial_reminder_7d",
    pushKind: "trial_reminder_push_7d",
    pushTitle: "Your free trial ends in 7 days",
    pushBody:
      "Your SNAP Life free month ends in 7 days. You'll be charged when it ends — cancel anytime before then in your app store settings.",
  },
  {
    triggerDayOf: 28,
    daysRemaining: 2,
    emailKind: "trial_reminder_2d",
    pushKind: "trial_reminder_push_2d",
    pushTitle: "2 days left on your free trial",
    pushBody:
      "Your SNAP Life free trial ends in 2 days. If you don't want to be charged, cancel now in your app store settings.",
  },
];

export interface TrialReminderResult {
  scanned: number;
  enqueued: number;
  skipped: number;
  errors: number;
}

/**
 * Compute the integer day-of-trial from `trialEndsAt`. Same formula as
 * `dayOfFromEnd` in `routes/subscription.ts` — duplicated here so the
 * worker doesn't take a routes-layer dependency.
 */
function dayOfFromEnd(trialEndsAt: Date, now: Date): number {
  const remainingMs = trialEndsAt.getTime() - now.getTime();
  const remainingDays = Math.ceil(remainingMs / DAY_MS);
  const day =
    TRIAL_LENGTH_DAYS -
    Math.max(0, Math.min(TRIAL_LENGTH_DAYS, remainingDays)) +
    1;
  return Math.max(1, Math.min(TRIAL_LENGTH_DAYS, day));
}

/**
 * Returns `true` if the user has an explicit "no engagement notifications"
 * preference: they have at least one push_tokens row AND every row is
 * optedIn = false. Users with no tokens are NOT treated as opted-out.
 */
async function userHasOptedOutOfNotifications(
  appUserId: string,
): Promise<boolean> {
  const tokens = await db
    .select({ optedIn: pushTokensTable.optedIn })
    .from(pushTokensTable)
    .where(eq(pushTokensTable.appUserId, appUserId));
  if (tokens.length === 0) return false;
  return tokens.every((t) => t.optedIn === false);
}

/**
 * Check whether this `(kind, appUserId, trialEndsAt)` combination has already
 * been enqueued. Matches on JSONB payload fields rather than createdAt so a
 * re-granted trial gets a fresh reminder while re-runs stay idempotent.
 */
async function reminderAlreadyEnqueued(
  kind: string,
  appUserId: string,
  trialEndsAt: Date,
): Promise<boolean> {
  const iso = trialEndsAt.toISOString();
  const rows = await db
    .select({ id: pendingEmailsTable.id })
    .from(pendingEmailsTable)
    .where(
      and(
        eq(pendingEmailsTable.kind, kind),
        sql`${pendingEmailsTable.payload}->>'appUserId' = ${appUserId}`,
        sql`${pendingEmailsTable.payload}->>'trialEndsAt' = ${iso}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Check whether a push for this `(pushKind, appUserId, trialEndsAt)` has
 * already been delivered. Uses the same pending_emails table as an audit
 * log — we insert a row with kind = pushKind after a successful send.
 */
async function pushAlreadySent(
  pushKind: string,
  appUserId: string,
  trialEndsAt: Date,
): Promise<boolean> {
  const iso = trialEndsAt.toISOString();
  const rows = await db
    .select({ id: pendingEmailsTable.id })
    .from(pendingEmailsTable)
    .where(
      and(
        eq(pendingEmailsTable.kind, pushKind),
        sql`${pendingEmailsTable.payload}->>'appUserId' = ${appUserId}`,
        sql`${pendingEmailsTable.payload}->>'trialEndsAt' = ${iso}`,
        isNotNull(pendingEmailsTable.sentAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Send a transactional push notification directly to all of a user's
 * opted-in Expo push tokens. Bypasses the 24h Bone Buddy rate limit
 * intentionally — trial reminders are high-priority transactional
 * notifications, not daily nudges. Idempotency is handled by the caller
 * via `pushAlreadySent`.
 */
async function sendTrialReminderPush(
  appUserId: string,
  reminder: ReminderDef,
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
    logger.error({ err, appUserId }, "trialReminderWorker: failed to load push tokens");
    return "error";
  }

  if (tokens.length === 0) return "no_tokens";

  const messages = tokens.map((t) => ({
    to: t.expoToken,
    sound: "default" as const,
    title: reminder.pushTitle,
    body: reminder.pushBody,
    data: {
      type: reminder.pushKind,
      daysRemaining: reminder.daysRemaining,
    },
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
        "trialReminderWorker: Expo push API error",
      );
      return "error";
    }
    return "sent";
  } catch (err) {
    logger.error({ err, appUserId }, "trialReminderWorker: Expo push network error");
    return "error";
  }
}

/**
 * Single worker pass. Selects every active trial subscriber whose trial
 * has not yet ended (both 'server' and 'store' sources), computes day-of,
 * and for each due reminder:
 *   1. Sends a push notification (if tokens available and not yet sent).
 *   2. Enqueues an email in `pending_emails` (if not already enqueued).
 *
 * Safe to call repeatedly — all writes are guarded by idempotency checks.
 */
export async function runTrialReminderPass(
  now: Date = new Date(),
): Promise<TrialReminderResult> {
  let enqueued = 0;
  let skipped = 0;
  let errors = 0;

  // Scan active trials from both sources: 'server' (legacy) and 'store'
  // (new RC IAP trial flow). Narrow on the SQL side: only trials that
  // haven't ended and are within the current trial-length window.
  const candidates = await db
    .select({
      appUserId: subscribersTable.appUserId,
      trialEndsAt: subscribersTable.trialEndsAt,
      email: usersTable.email,
      deletedAt: usersTable.deletedAt,
    })
    .from(subscribersTable)
    .innerJoin(usersTable, eq(usersTable.appUserId, subscribersTable.appUserId))
    .where(
      and(
        inArray(subscribersTable.trialSource, ["server", "store"]),
        isNotNull(subscribersTable.trialEndsAt),
        gt(subscribersTable.trialEndsAt, now),
        lte(
          subscribersTable.trialEndsAt,
          new Date(now.getTime() + TRIAL_LENGTH_DAYS * DAY_MS),
        ),
      ),
    );

  for (const row of candidates) {
    const trialEndsAt = row.trialEndsAt;
    if (!trialEndsAt) continue;

    if (row.deletedAt) {
      skipped += 1;
      continue;
    }

    const dayOf = dayOfFromEnd(trialEndsAt, now);
    const dueReminders = REMINDERS.filter((r) => r.triggerDayOf === dayOf);
    if (dueReminders.length === 0) continue;

    // Lazy-resolve opt-out once per user (covers all due reminders).
    let optedOut: boolean | null = null;

    for (const reminder of dueReminders) {
      try {
        if (optedOut === null) {
          optedOut = await userHasOptedOutOfNotifications(row.appUserId);
        }
        if (optedOut) {
          skipped += 1;
          continue;
        }

        const daysRemaining = Math.max(
          0,
          Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS),
        );
        const reminderPayload = {
          appUserId: row.appUserId,
          trialEndsAt: trialEndsAt.toISOString(),
          trialDayOf: dayOf,
          trialLengthDays: TRIAL_LENGTH_DAYS,
          daysRemaining,
        };

        // ── 1. Push notification ───────────────────────────────────────
        const alreadyPushed = await pushAlreadySent(
          reminder.pushKind,
          row.appUserId,
          trialEndsAt,
        );
        if (!alreadyPushed) {
          const pushResult = await sendTrialReminderPush(row.appUserId, reminder);
          if (pushResult === "sent") {
            // Record successful push delivery as an audit row (sentAt = now).
            await db.insert(pendingEmailsTable).values({
              kind: reminder.pushKind,
              toAddress: row.email ?? "push-only",
              payload: reminderPayload,
              sentAt: now,
            }).onConflictDoNothing();
            enqueued += 1;
          } else if (pushResult === "error") {
            errors += 1;
          }
          // "no_tokens" is a normal state — user hasn't enabled push; fall through to email.
        }

        // ── 2. Email reminder ──────────────────────────────────────────
        if (!row.email) {
          // No email address — skip email but push may have still gone out.
          skipped += 1;
          continue;
        }

        const alreadyQueued = await reminderAlreadyEnqueued(
          reminder.emailKind,
          row.appUserId,
          trialEndsAt,
        );
        if (alreadyQueued) continue;

        await db.insert(pendingEmailsTable).values({
          kind: reminder.emailKind,
          toAddress: row.email,
          payload: reminderPayload,
        });
        enqueued += 1;
      } catch (err) {
        errors += 1;
        logger.error(
          { err, appUserId: row.appUserId, emailKind: reminder.emailKind },
          "trialReminderWorker: failed to process reminder",
        );
      }
    }
  }

  if (candidates.length > 0 || enqueued > 0) {
    logger.info(
      { scanned: candidates.length, enqueued, skipped, errors },
      "trialReminderWorker: pass complete",
    );
  }

  return { scanned: candidates.length, enqueued, skipped, errors };
}

let timer: NodeJS.Timeout | null = null;

/**
 * Start the periodic trial-reminder pass. Disabled under
 * `NODE_ENV=test` so vitest runs don't keep open handles. Hourly is
 * fine: the day-of trigger is a one-day-wide window, so as long as
 * we tick at least once per day the right user gets exactly one
 * reminder per window per trial cycle.
 */
export function startTrialReminderScheduler(
  intervalMs: number = ONE_HOUR_MS,
): void {
  if (!workersEnabled()) return;
  if (timer) return;
  // Run once at boot so a freshly-restarted server doesn't wait an
  // hour to fire a reminder that came due during downtime.
  void runTrialReminderPass().catch((err) => {
    logger.error({ err }, "trialReminderWorker: initial pass failed");
  });
  timer = setInterval(() => {
    void runTrialReminderPass().catch((err) => {
      logger.error({ err }, "trialReminderWorker: scheduled pass failed");
    });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
}

/** Test/teardown hook. */
export function stopTrialReminderScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
