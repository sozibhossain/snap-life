/**
 * Email sender worker.
 *
 * Processes rows from the `pending_emails` table where `sentAt IS NULL`
 * and `attempts < MAX_ATTEMPTS`. For each row it:
 *   1. Renders the template (subject + HTML) via emailTemplates.ts
 *   2. Calls Resend to deliver the email
 *   3. Marks `sentAt = now` on success, or increments `attempts` + records
 *      `lastError` on failure.
 *
 * Idempotency: uses `FOR UPDATE SKIP LOCKED` to safely run concurrent
 * instances without double-sending. Each row is processed at most
 * MAX_ATTEMPTS times before being abandoned (lastError stays set).
 *
 * Cadence: runs every 5 minutes via setInterval. Disabled under
 * NODE_ENV=test so vitest runs don't keep open handles.
 *
 * For billing_issue rows the `toAddress` column holds the appUserId
 * rather than a real email (because the email wasn't available at
 * enqueue time from the webhook path). The worker resolves the real
 * address at send time.
 */

import { Resend } from "resend";
import { and, isNull, lt, sql } from "drizzle-orm";
import { db, pendingEmailsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { renderEmail } from "../lib/emailTemplates";
import { logger } from "../lib/logger";
import { workersEnabled } from "../lib/workerGate";

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;
const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const FROM_ADDRESS = "SNAP Life <notifications@snaplife.co.uk>";
const FROM_FALLBACK = "SNAP Life <onboarding@resend.dev>";

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    logger.warn("emailSenderWorker: RESEND_API_KEY not set — skipping send");
    return null;
  }
  return new Resend(key);
}

function getFromAddress(): string {
  return process.env.RESEND_FROM_ADDRESS ?? FROM_FALLBACK;
}

/**
 * Resolve the recipient email address for a pending_emails row.
 *
 * For most kinds `toAddress` is a real email. For `billing_issue` rows
 * enqueued from the RevenueCat webhook path, `toAddress` holds the
 * `appUserId` (a lookup was not done at enqueue time to keep webhook
 * latency low). We detect this by checking whether `toAddress` looks
 * like an email; if not, we do a DB lookup.
 */
async function resolveToAddress(
  toAddress: string,
  payload: Record<string, unknown>,
): Promise<string | null> {
  if (toAddress.includes("@")) return toAddress;

  // toAddress is an appUserId — look up the real email
  const appUserId =
    (payload.appUserId as string | undefined) ?? toAddress;
  const [row] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.appUserId, appUserId))
    .limit(1);
  return row?.email ?? null;
}

export interface EmailSenderResult {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Run one batch pass of the email sender.
 * Picks up to BATCH_SIZE unsent rows, renders them, and calls Resend.
 */
export async function runEmailSenderPass(): Promise<EmailSenderResult> {
  const resend = getResend();
  if (!resend) {
    return { processed: 0, sent: 0, failed: 0, skipped: 0 };
  }

  // Pick pending rows — FOR UPDATE SKIP LOCKED prevents concurrent
  // worker instances from processing the same row simultaneously.
  const rows = await db
    .select()
    .from(pendingEmailsTable)
    .where(
      and(
        isNull(pendingEmailsTable.sentAt),
        lt(pendingEmailsTable.attempts, MAX_ATTEMPTS),
      ),
    )
    .limit(BATCH_SIZE)
    .for("update", { skipLocked: true });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    const rendered = renderEmail(row.kind, row.payload ?? {});

    if (!rendered) {
      // Unknown kind — skip and mark as permanently failed so it
      // doesn't keep appearing in every pass.
      await db
        .update(pendingEmailsTable)
        .set({
          attempts: MAX_ATTEMPTS,
          lastError: `No renderer for kind: ${row.kind}`,
        })
        .where(eq(pendingEmailsTable.id, row.id));
      skipped += 1;
      logger.warn(
        { id: row.id, kind: row.kind },
        "emailSenderWorker: no renderer — permanently skipping",
      );
      continue;
    }

    // Resolve the actual recipient address
    const toAddress = await resolveToAddress(
      row.toAddress,
      row.payload ?? {},
    ).catch(() => null);

    if (!toAddress) {
      await db
        .update(pendingEmailsTable)
        .set({
          attempts: MAX_ATTEMPTS,
          lastError: "Could not resolve recipient email address",
        })
        .where(eq(pendingEmailsTable.id, row.id));
      skipped += 1;
      logger.warn(
        { id: row.id, kind: row.kind, rawTo: row.toAddress },
        "emailSenderWorker: could not resolve toAddress — permanently skipping",
      );
      continue;
    }

    try {
      const { error } = await resend.emails.send({
        from: getFromAddress(),
        to: toAddress,
        subject: rendered.subject,
        html: rendered.html,
      });

      if (error) {
        throw new Error(error.message ?? "Resend API error");
      }

      await db
        .update(pendingEmailsTable)
        .set({ sentAt: sql`NOW()`, lastError: null })
        .where(eq(pendingEmailsTable.id, row.id));

      sent += 1;
      logger.info(
        { id: row.id, kind: row.kind, to: toAddress },
        "emailSenderWorker: sent",
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await db
        .update(pendingEmailsTable)
        .set({
          attempts: sql`${pendingEmailsTable.attempts} + 1`,
          lastError: errMsg.slice(0, 500),
        })
        .where(eq(pendingEmailsTable.id, row.id));

      failed += 1;
      logger.error(
        { err, id: row.id, kind: row.kind, to: toAddress },
        "emailSenderWorker: send failed",
      );
    }
  }

  if (rows.length > 0) {
    logger.info(
      { processed: rows.length, sent, failed, skipped },
      "emailSenderWorker: pass complete",
    );
  }

  return { processed: rows.length, sent, failed, skipped };
}

let timer: NodeJS.Timeout | null = null;

/**
 * Start the periodic email sender. Disabled under NODE_ENV=test.
 * Runs immediately on start, then every INTERVAL_MS.
 */
export function startEmailSenderScheduler(
  intervalMs: number = INTERVAL_MS,
): void {
  if (!workersEnabled()) return;
  if (timer) return;

  void runEmailSenderPass().catch((err) => {
    logger.error({ err }, "emailSenderWorker: initial pass failed");
  });

  timer = setInterval(() => {
    void runEmailSenderPass().catch((err) => {
      logger.error({ err }, "emailSenderWorker: scheduled pass failed");
    });
  }, intervalMs);

  if (typeof timer.unref === "function") timer.unref();
}

export function stopEmailSenderScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
