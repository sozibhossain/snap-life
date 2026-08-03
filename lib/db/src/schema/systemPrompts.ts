import { pgTable, text, serial, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Runtime-editable system prompts for AI surfaces.
 *
 * `key` is stable per product surface, e.g. "bone_buddy". The API keeps a
 * code fallback, but the normal path reads this table on every request so
 * prompt changes can be deployed through the backend/database layer.
 */
export const systemPromptsTable = pgTable(
  "system_prompts",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    content: text("content").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("system_prompts_key_uq").on(t.key)],
);

export type SystemPrompt = typeof systemPromptsTable.$inferSelect;
export type NewSystemPrompt = typeof systemPromptsTable.$inferInsert;
