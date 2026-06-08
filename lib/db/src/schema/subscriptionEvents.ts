import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Append-only audit log of every RevenueCat webhook event we receive.
 * Used for debugging, support and idempotent webhook processing
 * (eventId is unique — duplicate deliveries are ignored).
 */
export const subscriptionEventsTable = pgTable(
  "subscription_events",
  {
    eventId: text("event_id").primaryKey(),
    eventType: text("event_type").notNull(),
    appUserId: text("app_user_id").notNull(),
    productId: text("product_id"),
    environment: text("environment"),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("subscription_events_user_idx").on(t.appUserId),
    receivedIdx: index("subscription_events_received_idx").on(t.receivedAt),
  }),
);

export const insertSubscriptionEventSchema = createInsertSchema(subscriptionEventsTable);
export type SubscriptionEvent = typeof subscriptionEventsTable.$inferSelect;
export type InsertSubscriptionEvent = z.infer<typeof insertSubscriptionEventSchema>;
