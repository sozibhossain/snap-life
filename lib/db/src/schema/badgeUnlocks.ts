import {
  pgTable,
  text,
  timestamp,
  bigint,
  primaryKey,
} from "drizzle-orm/pg-core";

/**
 * `badge_unlocks` — append-only audit log of achievement unlocks. The
 * client also keeps the `earned` flag inside `gamification_state.state`,
 * but persisting one row per unlock here gives us a permanent server-side
 * timeline (used by future analytics dashboards + the admin view in
 * milestone N+1).
 *
 * Idempotency: composite PK on `(appUserId, achievementId)` so a re-flush
 * of the offline queue can re-POST without inflating counts.
 */
export const badgeUnlocksTable = pgTable(
  "badge_unlocks",
  {
    appUserId: text("app_user_id").notNull(),
    achievementId: text("achievement_id").notNull(),
    /** ms timestamp the achievement was awarded (client-supplied). */
    unlockedAtMs: bigint("unlocked_at_ms", { mode: "number" }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.appUserId, t.achievementId] }),
  }),
);

export type BadgeUnlockRow = typeof badgeUnlocksTable.$inferSelect;
export type NewBadgeUnlockRow = typeof badgeUnlocksTable.$inferInsert;
