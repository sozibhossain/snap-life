import { pgTable, text, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * `push_tokens` stores a user's Expo push token plus their opt-in state
 * and the last time we sent them a Bone Buddy nudge — the latter lets the
 * sender enforce a hard "≤1 personalised push per user per 24h" rule
 * without keeping a separate scheduling table.
 *
 * One row per (appUserId, expoToken) pair so a user can have a token on
 * multiple devices. `optedIn=false` rows are kept for analytics; the
 * sender filters them out.
 */
export const pushTokensTable = pgTable(
  "push_tokens",
  {
    appUserId: text("app_user_id").notNull(),
    expoToken: text("expo_token").notNull(),
    platform: text("platform"),
    optedIn: boolean("opted_in").notNull().default(true),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("push_tokens_user_idx").on(t.appUserId),
    tokenUq: uniqueIndex("push_tokens_user_token_uq").on(t.appUserId, t.expoToken),
  }),
);

export const insertPushTokenSchema = createInsertSchema(pushTokensTable);
export type PushToken = typeof pushTokensTable.$inferSelect;
export type InsertPushToken = z.infer<typeof insertPushTokenSchema>;
