/**
 * Monthly newsletter worker.
 *
 * On the 1st of each month, enqueues a `monthly_newsletter` email for
 * every active, non-deleted user who has an email address.
 *
 * Idempotency: externalId = `monthly_newsletter:{appUserId}:{YYYY-MM}`
 * maps to the unique partial index on `pending_emails.external_id`.
 * Concurrent runs and retries produce at most one row per user per month.
 *
 * Cadence: checks every hour; only fires when today is the 1st of the
 * month. Disabled under NODE_ENV=test.
 */

import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { db, pendingEmailsTable, usersTable } from "@workspace/db";
import { logger } from "../lib/logger";

const HOUR_MS = 60 * 60 * 1000;

function yearMonthKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthLabel(now: Date): string {
  return now.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

// Monthly content — in production this would come from a CMS or admin config.
// For now we use a static payload the template can render.
function getMonthlyContent(yearMonth: string): {
  headline: string;
  updates: string[];
  tip: string;
} {
  // Deterministic rotation by month number
  const monthNum = parseInt(yearMonth.split("-")[1] ?? "1", 10);

  const UPDATES_POOL = [
    [
      "Bone Buddy AI updated with the latest bone health research",
      "New guided meditations added to the Wellness Hub",
      "Community coaching sessions now available to book in-app",
    ],
    [
      "Improved DEXA scan trend visualisations on the dashboard",
      "New calcium-rich meal plan recipes this month",
      "Breathing Studio: three new expert-led sessions added",
    ],
    [
      "Referral programme launched — share your code, earn XP",
      "New fracture risk calculator available in the Bone Tracker",
      "Wellness challenges updated for the new month",
    ],
    [
      "Weekly SNAP Shots now include personalised bone tips",
      "Achievement badges redesigned — check your new collection",
      "Systemic coaching with Catherine Shaw — limited slots available",
    ],
  ];

  const TIPS_POOL = [
    "Did you know? Weight-bearing exercise for just 30 minutes a day can significantly improve bone density over time.",
    "Vitamin K2 works alongside vitamin D to direct calcium into your bones rather than your arteries. Consider adding fermented foods to your diet.",
    "Stress raises cortisol, which can interfere with bone formation over time. Even 10 minutes of daily breathing practice makes a measurable difference.",
    "Bone density naturally peaks in your 30s — but the right lifestyle choices can maintain and even improve it well into later life.",
  ];

  const idx = (monthNum - 1) % UPDATES_POOL.length;
  return {
    headline: "What's new in SNAP Life",
    updates: UPDATES_POOL[idx],
    tip: TIPS_POOL[idx],
  };
}

export interface MonthlyNewsletterResult {
  scanned: number;
  enqueued: number;
  skipped: number;
  errors: number;
}

export async function runMonthlyNewsletterPass(
  now: Date = new Date(),
): Promise<MonthlyNewsletterResult> {
  let enqueued = 0;
  let skipped = 0;
  let errors = 0;

  const yearMonth = yearMonthKey(now);
  const label = monthLabel(now);
  const content = getMonthlyContent(yearMonth);

  const users = await db
    .select({
      appUserId: usersTable.appUserId,
      email: usersTable.email,
      displayName: usersTable.displayName,
    })
    .from(usersTable)
    .where(and(isNull(usersTable.deletedAt), isNotNull(usersTable.email)));

  for (const user of users) {
    try {
      const externalId = `monthly_newsletter:${user.appUserId}:${yearMonth}`;

      const [existing] = await db
        .select({ id: pendingEmailsTable.id })
        .from(pendingEmailsTable)
        .where(eq(pendingEmailsTable.externalId, externalId))
        .limit(1);

      if (existing) {
        skipped++;
        continue;
      }

      await db
        .insert(pendingEmailsTable)
        .values({
          kind: "monthly_newsletter",
          toAddress: user.email!,
          externalId,
          payload: {
            appUserId: user.appUserId,
            displayName: user.displayName ?? "there",
            monthLabel: label,
            yearMonth,
            ...content,
          },
        })
        .onConflictDoNothing();

      enqueued++;
    } catch (err) {
      errors++;
      logger.error(
        { err, appUserId: user.appUserId },
        "monthlyNewsletterWorker: failed to process user",
      );
    }
  }

  if (users.length > 0 || enqueued > 0) {
    logger.info(
      { scanned: users.length, enqueued, skipped, errors, yearMonth },
      "monthlyNewsletterWorker: pass complete",
    );
  }

  return { scanned: users.length, enqueued, skipped, errors };
}

let timer: NodeJS.Timeout | null = null;

/**
 * Start the monthly newsletter scheduler.
 * Checks hourly; only fires on the 1st of the month.
 * Disabled under NODE_ENV=test.
 */
export function startMonthlyNewsletterScheduler(
  intervalMs: number = HOUR_MS,
): void {
  if (process.env.NODE_ENV === "test") return;
  if (timer) return;

  const maybeSend = () => {
    const now = new Date();
    if (now.getDate() !== 1) return; // Only on the 1st of each month
    void runMonthlyNewsletterPass(now).catch((err) => {
      logger.error({ err }, "monthlyNewsletterWorker: pass failed");
    });
  };

  maybeSend();
  timer = setInterval(maybeSend, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
}

export function stopMonthlyNewsletterScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
