import { db, pushTokensTable, pushUserStateTable } from "@workspace/db";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { logger } from "./logger";
import { sendWebPush } from "./webPushSender";

/**
 * Hard product rule: never send a personalised push to the same user
 * more often than once every 24h. Enforced server-side via a single
 * INSERT … ON CONFLICT DO UPDATE … WHERE … RETURNING on
 * `push_user_state`, so concurrent calls cannot both pass a pre-check
 * and double-send. Per-user state is intentionally separate from
 * `push_tokens` so adding a new device cannot reset the gate.
 */
const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface BoneBuddyPush {
  /** Required — Bone Buddy-personalised one-line copy. */
  body: string;
  /** Optional — short heading. Defaults to "Bone Buddy". */
  title?: string;
  /** Stable identifier for analytics dedupe (push_opened.copyId). */
  copyId?: string;
  /** Free-form deep-link / context — surfaces in `notification.request.content.data`. */
  data?: Record<string, unknown>;
}

export interface SendResult {
  status:
    | "sent"
    | "skipped_no_tokens"
    | "skipped_throttled"
    | "skipped_opted_out"
    | "error";
  sentCount: number;
  reason?: string;
}

/**
 * Send a single Bone Buddy push to a given app user, respecting opt-in
 * and the per-user 24h rate limit. Delivers to both native Expo push
 * tokens and browser Web Push subscriptions. Never throws — the caller
 * is typically a fire-and-forget trigger from a request handler.
 *
 * Concurrency model:
 *  1. Atomically claim the user-level 24h gate via UPSERT on
 *     `push_user_state`. Postgres serialises concurrent writers on the
 *     primary key. The losing writers' ON CONFLICT DO UPDATE has a
 *     `WHERE last_sent_at IS NULL OR < cutoff` guard, so they get
 *     zero rows back in RETURNING and bail out.
 *  2. Only after winning the claim do we read the user's opted-in
 *     tokens / subscriptions. If the user has neither, the claim is
 *     rolled back so the gate isn't burnt on a no-op.
 *  3. If the actual delivery call fails, the gate stays claimed
 *     (fail-safe: better to miss one push than to risk spamming).
 */
export async function sendBoneBuddyPush(
  appUserId: string,
  push: BoneBuddyPush,
): Promise<SendResult> {
  if (!appUserId) return { status: "error", sentCount: 0, reason: "appUserId required" };
  if (!push?.body || typeof push.body !== "string") {
    return { status: "error", sentCount: 0, reason: "body required" };
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - MIN_INTERVAL_MS);

  // (1) Atomic per-user claim. New row → insert succeeds, returns 1 row.
  // Existing row with stale lastSentAt → ON CONFLICT WHERE matches,
  // update succeeds, returns 1 row. Existing row inside window → WHERE
  // rejects, returns 0 rows. Concurrent claims serialise on the PK.
  let claimed: { appUserId: string }[];
  try {
    claimed = await db
      .insert(pushUserStateTable)
      .values({ appUserId, lastSentAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: pushUserStateTable.appUserId,
        set: { lastSentAt: now, updatedAt: now },
        setWhere: or(
          isNull(pushUserStateTable.lastSentAt),
          lt(pushUserStateTable.lastSentAt, cutoff),
        ),
      })
      .returning({ appUserId: pushUserStateTable.appUserId });
  } catch (err) {
    logger.error({ err, appUserId }, "pushSender: atomic per-user claim failed");
    return { status: "error", sentCount: 0, reason: "db claim failed" };
  }

  if (claimed.length === 0) {
    return { status: "skipped_throttled", sentCount: 0 };
  }

  // (2) Gate is ours — read all opted-in Expo tokens and Web Push
  // subscriptions for the user in parallel.
  let expoTokens: { expoToken: string }[];
  try {
    expoTokens = await db
      .select({ expoToken: pushTokensTable.expoToken })
      .from(pushTokensTable)
      .where(
        and(
          eq(pushTokensTable.appUserId, appUserId),
          eq(pushTokensTable.optedIn, true),
        ),
      );
  } catch (err) {
    logger.error({ err, appUserId }, "pushSender: failed to load expo tokens after claim");
    await rollbackClaim(appUserId).catch(() => undefined);
    return { status: "error", sentCount: 0, reason: "db read failed" };
  }

  const pushData = { copyId: push.copyId ?? null, ...(push.data ?? {}) };

  // Fire web push in parallel with expo — both can proceed independently.
  const webPushPromise = sendWebPush(appUserId, {
    title: push.title?.trim() || "Bone Buddy",
    body: push.body,
    data: pushData,
  });

  // (3) Send Expo push if there are opted-in tokens.
  let expoSentCount = 0;
  if (expoTokens.length > 0) {
    const messages = expoTokens.map((t) => ({
      to: t.expoToken,
      sound: "default" as const,
      title: push.title?.trim() || "Bone Buddy",
      body: push.body,
      data: pushData,
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
          { status: resp.status, text, appUserId, tokenCount: expoTokens.length },
          "expo push API error — gate remains claimed (fail-safe)",
        );
      } else {
        const payload = await resp.json().catch(() => null) as
          | {
              data?: Array<{
                status?: "ok" | "error";
                details?: { error?: string };
              }>;
            }
          | null;
        const tickets = payload?.data ?? [];
        expoSentCount = tickets.length > 0
          ? tickets.filter((ticket) => ticket.status === "ok").length
          : messages.length;

        // Expo reports permanently invalid installations synchronously on
        // some sends. Disable those tokens so every future daily pass does
        // not keep retrying a device that has uninstalled the app.
        await Promise.all(
          tickets.map(async (ticket, index) => {
            if (ticket.details?.error !== "DeviceNotRegistered") return;
            const token = expoTokens[index]?.expoToken;
            if (!token) return;
            await db
              .update(pushTokensTable)
              .set({ optedIn: false, updatedAt: new Date() })
              .where(
                and(
                  eq(pushTokensTable.appUserId, appUserId),
                  eq(pushTokensTable.expoToken, token),
                ),
              )
              .catch((err) => {
                logger.warn({ err, appUserId }, "pushSender: failed to disable invalid token");
              });
          }),
        );
      }
    } catch (err) {
      logger.error(
        { err, appUserId, tokenCount: expoTokens.length },
        "expo push network error — gate remains claimed (fail-safe)",
      );
    }
  }

  // (4) Collect web push result.
  const webResult = await webPushPromise;
  const totalSent = expoSentCount + webResult.sentCount;

  // If nothing was delivered and nothing was even registered, roll back
  // the gate so the user isn't silently throttled for 24h on a no-op.
  if (expoTokens.length === 0 && webResult.sentCount === 0 && webResult.failCount === 0) {
    await rollbackClaim(appUserId).catch(() => undefined);
    return { status: "skipped_opted_out", sentCount: 0 };
  }

  return { status: totalSent > 0 ? "sent" : "error", sentCount: totalSent };
}

/**
 * Reset the user's gate to its previous state by clearing `lastSentAt`.
 * Only used when we hold a fresh claim but discover there's nothing to
 * actually deliver (no opted-in tokens). Best-effort.
 */
async function rollbackClaim(appUserId: string): Promise<void> {
  await db
    .update(pushUserStateTable)
    .set({ lastSentAt: sql`NULL`, updatedAt: new Date() })
    .where(eq(pushUserStateTable.appUserId, appUserId));
}
