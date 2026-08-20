import { eq } from "drizzle-orm";
import {
  db,
  pushTokensTable,
  userProfileTable,
  webPushSubscriptionsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { workersEnabled } from "../lib/workerGate";
import { sendBoneBuddyPush } from "../lib/pushSender";

const ONE_HOUR_MS = 60 * 60 * 1000;
const DEFAULT_TIMEZONE = "Europe/London";

function localHour(now: Date, timeZone: string): number | null {
  try {
    const part = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      hour12: false,
    }).formatToParts(now).find((p) => p.type === "hour")?.value;
    if (!part) return null;
    return Number(part === "24" ? "0" : part);
  } catch {
    return null;
  }
}

export interface DailyPushWorkerResult {
  eligible: number;
  attempted: number;
  sent: number;
  skipped: number;
  errors: number;
}

/** Send the opted-in user's daily Bone Buddy nudge at 09:00 local time. */
export async function runDailyPushPass(
  now: Date = new Date(),
): Promise<DailyPushWorkerResult> {
  const [expoUsers, webUsers, profiles] = await Promise.all([
    db
      .selectDistinct({ appUserId: pushTokensTable.appUserId })
      .from(pushTokensTable)
      .where(eq(pushTokensTable.optedIn, true)),
    db
      .selectDistinct({ appUserId: webPushSubscriptionsTable.appUserId })
      .from(webPushSubscriptionsTable)
      .where(eq(webPushSubscriptionsTable.optedIn, true)),
    db
      .select({
        appUserId: userProfileTable.appUserId,
        timezone: userProfileTable.timezone,
        name: userProfileTable.name,
      })
      .from(userProfileTable),
  ]);

  const profileByUser = new Map(profiles.map((profile) => [profile.appUserId, profile]));
  const userIds = new Set([
    ...expoUsers.map((row) => row.appUserId),
    ...webUsers.map((row) => row.appUserId),
  ]);

  let attempted = 0;
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const appUserId of userIds) {
    const profile = profileByUser.get(appUserId);
    const timezone = profile?.timezone || DEFAULT_TIMEZONE;
    const hour = localHour(now, timezone) ?? localHour(now, DEFAULT_TIMEZONE);
    if (hour !== 9) {
      skipped += 1;
      continue;
    }

    attempted += 1;
    const firstName = profile?.name?.trim().split(/\s+/)[0];
    const result = await sendBoneBuddyPush(appUserId, {
      title: "Bone Buddy",
      body: firstName
        ? `Good morning, ${firstName}. What small thing would help you feel supported today?`
        : "Good morning. What small thing would help you feel supported today?",
      copyId: "scheduled-daily-nudge-v1",
      data: { kind: "daily-nudge", route: "/(tabs)/coach" },
    });
    if (result.status === "sent") sent += 1;
    else if (result.status === "error") errors += 1;
    else skipped += 1;
  }

  return { eligible: userIds.size, attempted, sent, skipped, errors };
}

export function startDailyPushScheduler(): void {
  if (!workersEnabled()) return;

  let lastRunHour = "";
  const run = async () => {
    const now = new Date();
    const hourKey = now.toISOString().slice(0, 13);
    if (lastRunHour === hourKey) return;
    lastRunHour = hourKey;
    try {
      const result = await runDailyPushPass(now);
      if (result.attempted > 0 || result.errors > 0) {
        logger.info(result, "dailyPushWorker: pass complete");
      }
    } catch (err) {
      logger.error({ err }, "dailyPushWorker: pass failed");
    }
  };

  void run();
  const timer = setInterval(() => void run(), ONE_HOUR_MS);
  timer.unref?.();
}

