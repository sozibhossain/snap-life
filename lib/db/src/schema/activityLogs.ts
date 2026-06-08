import {
  pgTable,
  text,
  jsonb,
  timestamp,
  primaryKey,
  bigint,
  index,
} from "drizzle-orm/pg-core";

/**
 * `activity_logs` — one row per (user, local-day-ISO). Mirrors the
 * `ActivityLog` shape from `HealthContext` (steps / calories /
 * activeMinutes / distance) but kept as a flexible jsonb so adding
 * fields (heart rate, floors climbed, …) needs no migration.
 *
 * Same composite PK + last-write-wins semantics as `nutrition_logs` so
 * idempotent PUTs are trivial.
 */
export const activityLogsTable = pgTable(
  "activity_logs",
  {
    appUserId: text("app_user_id").notNull(),
    day: text("day").notNull(),
    log: jsonb("log").notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.appUserId, t.day] }),
    userDayIdx: index("activity_logs_user_day_idx").on(t.appUserId, t.day),
  }),
);

export type ActivityLogRow = typeof activityLogsTable.$inferSelect;
export type NewActivityLogRow = typeof activityLogsTable.$inferInsert;
