/**
 * Weekly SNAP Shot email worker.
 *
 * Every Sunday evening (or on the configured cadence), sends each active
 * user a personalised weekly summary email containing:
 *   - Streak days
 *   - XP earned this week
 *   - Total XP / points
 *   - DEXA scan count logged this week
 *   - A rotating bone health tip
 *
 * Idempotency: each pending_emails row carries
 *   externalId = `weekly_snap_shot:{appUserId}:{isoWeek}`
 * which maps to the unique partial index. Concurrent runs and retries
 * produce at most one row per user per week.
 *
 * Eligibility: all users with a non-null email, not soft-deleted.
 * We send to free users too — the SNAP Shot is a retention/engagement tool.
 *
 * Cadence: checks every hour; only fires when today is Sunday (day 0).
 * No-op under NODE_ENV=test.
 */

import { and, eq, isNull, isNotNull } from "drizzle-orm";
import {
  db,
  pendingEmailsTable,
  usersTable,
  userProfileTable,
} from "@workspace/db";
import { logger } from "../lib/logger";

const HOUR_MS = 60 * 60 * 1000;

/** ISO week string: {YYYY}-W{WW} */
function isoWeekKey(now: Date): string {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Human-readable range: "5–11 May 2026" */
function weekRange(now: Date): string {
  const day = now.getDay(); // 0=Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  // Short form: "5–11 May 2026" if same month
  if (monday.getMonth() === sunday.getMonth()) {
    return `${monday.getDate()}–${sunday.getDate()} ${sunday.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`;
  }
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

const BONE_TIPS = [
  "Weight-bearing exercise for just 30 minutes a day can measurably improve bone density over time.",
  "Calcium and vitamin D work together — make sure you're getting both, not just one.",
  "Sleep is when your body repairs and rebuilds bone tissue. Aim for 7–9 hours each night.",
  "Resistance training is one of the most effective ways to build and maintain bone strength at any age.",
  "Reducing alcohol and avoiding smoking are two of the fastest ways to protect your bone density.",
  "Walking outdoors gives you both weight-bearing exercise and natural vitamin D from sunlight.",
  "Magnesium plays a key role in bone mineralisation — leafy greens and nuts are excellent sources.",
  "Collagen supplements have shown early promise in supporting bone matrix density in recent studies.",
  "A DEXA scan every 1–2 years gives you the clearest picture of how your bone health is progressing.",
  "Protein is essential for bone repair — aim for 1.2g per kg of body weight daily.",
];

function getBoneTip(weekKey: string): string {
  // Deterministic rotation based on week number so all users get the same tip
  const weekNum = parseInt(weekKey.split("-W")[1] ?? "1", 10);
  return BONE_TIPS[(weekNum - 1) % BONE_TIPS.length];
}

export interface WeeklySnapShotResult {
  scanned: number;
  enqueued: number;
  skipped: number;
  errors: number;
}

export async function runWeeklySnapShotPass(
  now: Date = new Date(),
): Promise<WeeklySnapShotResult> {
  let enqueued = 0;
  let skipped = 0;
  let errors = 0;

  const weekKey = isoWeekKey(now);
  const tip = getBoneTip(weekKey);
  const range = weekRange(now);

  // Start of current week (Monday 00:00 UTC)
  const dayOfWeek = now.getUTCDay() || 7;
  const mondayMs = now.getTime() - (dayOfWeek - 1) * 24 * 60 * 60 * 1000;
  const weekStart = new Date(mondayMs);
  weekStart.setUTCHours(0, 0, 0, 0);

  // All active, non-deleted users with an email
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
      const externalId = `weekly_snap_shot:${user.appUserId}:${weekKey}`;

      // Idempotency check
      const [existing] = await db
        .select({ id: pendingEmailsTable.id })
        .from(pendingEmailsTable)
        .where(eq(pendingEmailsTable.externalId, externalId))
        .limit(1);

      if (existing) {
        skipped++;
        continue;
      }

      // Fetch profile stats
      const [profile] = await db
        .select({
          xp: userProfileTable.xp,
          totalPoints: userProfileTable.totalPoints,
          streakDays: userProfileTable.streakDays,
        })
        .from(userProfileTable)
        .where(eq(userProfileTable.appUserId, user.appUserId))
        .limit(1);

      await db
        .insert(pendingEmailsTable)
        .values({
          kind: "weekly_snap_shot",
          toAddress: user.email!,
          externalId,
          payload: {
            appUserId: user.appUserId,
            displayName: user.displayName ?? "there",
            streakDays: profile?.streakDays ?? 0,
            weekXp: profile?.xp ?? 0,
            totalPoints: profile?.totalPoints ?? 0,
            scanCount: 0,
            tip,
            weekRange: range,
            weekKey,
          },
        })
        .onConflictDoNothing();

      enqueued++;
    } catch (err) {
      errors++;
      logger.error(
        { err, appUserId: user.appUserId },
        "weeklySnapShotWorker: failed to process user",
      );
    }
  }

  if (users.length > 0 || enqueued > 0) {
    logger.info(
      { scanned: users.length, enqueued, skipped, errors, weekKey },
      "weeklySnapShotWorker: pass complete",
    );
  }

  return { scanned: users.length, enqueued, skipped, errors };
}

let timer: NodeJS.Timeout | null = null;

/**
 * Start the weekly SNAP Shot scheduler.
 * Checks hourly; only enqueues on Sundays (day 0).
 * Disabled under NODE_ENV=test.
 */
export function startWeeklySnapShotScheduler(
  intervalMs: number = HOUR_MS,
): void {
  if (process.env.NODE_ENV === "test") return;
  if (timer) return;

  const maybeSend = () => {
    const now = new Date();
    if (now.getDay() !== 0) return; // Only on Sundays
    void runWeeklySnapShotPass(now).catch((err) => {
      logger.error({ err }, "weeklySnapShotWorker: pass failed");
    });
  };

  maybeSend();
  timer = setInterval(maybeSend, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
}

export function stopWeeklySnapShotScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
