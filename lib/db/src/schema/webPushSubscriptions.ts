import { pgTable, text, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * `web_push_subscriptions` mirrors `push_tokens` for browser-based
 * Web Push (RFC 8030 / VAPID). One row per (appUserId, endpoint) pair
 * so a user can have subscriptions on multiple browsers / devices.
 *
 * The three fields needed to send a Web Push message are:
 *   endpoint  — the push service URL (unique per subscription)
 *   p256dhKey — the client's Diffie-Hellman public key (base64url)
 *   authKey   — the auth secret (base64url)
 *
 * `optedIn=false` rows are kept for analytics; the sender filters them out.
 */
export const webPushSubscriptionsTable = pgTable(
  "web_push_subscriptions",
  {
    appUserId: text("app_user_id").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dhKey: text("p256dh_key").notNull(),
    authKey: text("auth_key").notNull(),
    optedIn: boolean("opted_in").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("web_push_subs_user_idx").on(t.appUserId),
    endpointUq: uniqueIndex("web_push_subs_endpoint_uq").on(t.appUserId, t.endpoint),
  }),
);

export const insertWebPushSubscriptionSchema = createInsertSchema(webPushSubscriptionsTable);
export type WebPushSubscription = typeof webPushSubscriptionsTable.$inferSelect;
export type InsertWebPushSubscription = z.infer<typeof insertWebPushSubscriptionSchema>;
