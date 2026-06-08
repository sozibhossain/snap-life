import webpush from "web-push";
import { db, webPushSubscriptionsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";
import { validateWebPushEndpoint } from "./webPushValidation";

/**
 * Lazy VAPID configuration — reads from environment variables on first use.
 * Required vars:
 *   VAPID_PUBLIC_KEY   — base64url VAPID public key (safe to expose publicly)
 *   VAPID_PRIVATE_KEY  — base64url VAPID private key (server secret)
 *   VAPID_SUBJECT      — contact URI, e.g. "mailto:admin@snaplife.app"
 *
 * If any var is missing, web push is silently disabled so the server can
 * start without the keys configured (e.g. in local dev without push needed).
 */
let vapidConfigured = false;

function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const sub = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !sub) {
    return false;
  }
  try {
    webpush.setVapidDetails(sub, pub, priv);
    vapidConfigured = true;
    return true;
  } catch (err) {
    logger.error({ err }, "webPushSender: failed to configure VAPID details");
    return false;
  }
}

export interface WebPushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface WebPushSendResult {
  sentCount: number;
  failCount: number;
}

/**
 * Send a Web Push notification to all opted-in browser subscriptions for
 * a given user. Dead subscriptions (410 Gone) are automatically removed.
 * Never throws — returns counts of sent vs. failed deliveries.
 */
export async function sendWebPush(
  appUserId: string,
  payload: WebPushPayload,
): Promise<WebPushSendResult> {
  if (!ensureVapid()) {
    return { sentCount: 0, failCount: 0 };
  }

  let subs: { endpoint: string; p256dhKey: string; authKey: string }[];
  try {
    subs = await db
      .select({
        endpoint: webPushSubscriptionsTable.endpoint,
        p256dhKey: webPushSubscriptionsTable.p256dhKey,
        authKey: webPushSubscriptionsTable.authKey,
      })
      .from(webPushSubscriptionsTable)
      .where(
        and(
          eq(webPushSubscriptionsTable.appUserId, appUserId),
          eq(webPushSubscriptionsTable.optedIn, true),
        ),
      );
  } catch (err) {
    logger.error({ err, appUserId }, "webPushSender: failed to load subscriptions");
    return { sentCount: 0, failCount: 0 };
  }

  if (subs.length === 0) {
    return { sentCount: 0, failCount: 0 };
  }

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
  });

  let sentCount = 0;
  let failCount = 0;

  await Promise.all(
    subs.map(async (sub) => {
      // Defense-in-depth: re-validate the endpoint before every dispatch
      // in case a row was inserted before the allowlist was in place.
      if (!validateWebPushEndpoint(sub.endpoint)) {
        logger.error(
          { appUserId, endpoint: sub.endpoint },
          "webPushSender: rejecting stored endpoint not on allowlist (SSRF guard)",
        );
        await db
          .update(webPushSubscriptionsTable)
          .set({ optedIn: false, updatedAt: new Date() })
          .where(
            and(
              eq(webPushSubscriptionsTable.appUserId, appUserId),
              eq(webPushSubscriptionsTable.endpoint, sub.endpoint),
            ),
          )
          .catch(() => undefined);
        failCount++;
        return;
      }
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dhKey, auth: sub.authKey },
          },
          body,
        );
        sentCount++;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 410 || status === 404) {
          // Subscription expired / unsubscribed — prune it silently.
          await db
            .update(webPushSubscriptionsTable)
            .set({ optedIn: false, updatedAt: new Date() })
            .where(
              and(
                eq(webPushSubscriptionsTable.appUserId, appUserId),
                eq(webPushSubscriptionsTable.endpoint, sub.endpoint),
              ),
            )
            .catch(() => undefined);
        } else {
          logger.error(
            { err, appUserId, status },
            "webPushSender: delivery error",
          );
          failCount++;
        }
      }
    }),
  );

  return { sentCount, failCount };
}

