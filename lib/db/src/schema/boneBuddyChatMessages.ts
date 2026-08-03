import { pgTable, text, serial, timestamp, index, integer } from "drizzle-orm/pg-core";

/**
 * Persisted Bone Buddy turns for admin review and support/debug workflows.
 *
 * The mobile client still owns its local UX history, but every authenticated
 * backend request records the newest user turn and the generated assistant
 * reply here once the API can resolve the bearer to an appUserId.
 */
export const boneBuddyChatMessagesTable = pgTable(
  "bone_buddy_chat_messages",
  {
    id: serial("id").primaryKey(),
    requestId: text("request_id").notNull(),
    appUserId: text("app_user_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    promptKey: text("prompt_key").notNull().default("bone_buddy"),
    promptVersion: integer("prompt_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userCreatedIdx: index("bone_buddy_chat_messages_user_created_idx").on(
      t.appUserId,
      t.createdAt,
    ),
    createdIdx: index("bone_buddy_chat_messages_created_idx").on(t.createdAt),
    requestIdx: index("bone_buddy_chat_messages_request_idx").on(t.requestId),
  }),
);

export type BoneBuddyChatMessage = typeof boneBuddyChatMessagesTable.$inferSelect;
export type NewBoneBuddyChatMessage = typeof boneBuddyChatMessagesTable.$inferInsert;
