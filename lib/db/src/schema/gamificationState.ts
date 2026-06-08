import {
  pgTable,
  text,
  jsonb,
  timestamp,
  bigint,
} from "drizzle-orm/pg-core";

/**
 * `gamification_state` — one row per user holding the full Gamification
 * state blob (achievements / challenges / rewards) as a single jsonb. The
 * client owns the catalog merge, we just persist the resulting view.
 *
 * Idempotent PUT semantics with last-write-wins. The append-only badge
 * unlock log lives in `badge_unlocks` so we have a permanent record of
 * what was earned and when (used by future analytics + the admin
 * dashboard).
 */
export const gamificationStateTable = pgTable("gamification_state", {
  appUserId: text("app_user_id").primaryKey(),
  /** Shape: { achievements: Achievement[], challenges: Challenge[], rewards: Reward[] } */
  state: jsonb("state").notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type GamificationStateRow =
  typeof gamificationStateTable.$inferSelect;
export type NewGamificationStateRow =
  typeof gamificationStateTable.$inferInsert;
