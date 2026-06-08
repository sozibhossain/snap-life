import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * `push_user_state` is the single source of truth for the
 * "≤1 personalised push per user per 24h" hard limit. One row per
 * `appUserId`. The gate is claimed via `INSERT ... ON CONFLICT
 * DO UPDATE SET last_sent_at = now WHERE last_sent_at IS NULL
 * OR last_sent_at < cutoff RETURNING` — Postgres serialises
 * concurrent claims on the unique key, so only the first writer
 * within the 24h window gets a non-empty RETURNING and proceeds
 * to actually deliver. The loser sees zero rows and skips.
 *
 * Throttle state is intentionally decoupled from `push_tokens`
 * so adding a new device cannot accidentally reset the gate.
 */
export const pushUserStateTable = pgTable("push_user_state", {
  appUserId: text("app_user_id").primaryKey(),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PushUserState = typeof pushUserStateTable.$inferSelect;
