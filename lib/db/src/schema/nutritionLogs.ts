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
 * `nutrition_logs` — one row per (user, local-day-ISO) carrying a serialised
 * `BridgeNutritionLog` payload (calcium / vitamin D / protein / magnesium /
 * calories totals, plan-only `planTotals`, per-slot `mealsCompleted`,
 * `mealsContributions`, `mealPortions`, `meals[]`, and the `source`
 * discriminator). Storing the whole blob means the existing client model
 * does not need to be normalised into columns.
 *
 * Composite PK enforces the per-user-per-day uniqueness the mobile client
 * already assumes (see `HealthContext.upsertTodayNutrition`). Routes use
 * this with `INSERT ... ON CONFLICT DO UPDATE` for idempotent PUTs.
 */
export const nutritionLogsTable = pgTable(
  "nutrition_logs",
  {
    appUserId: text("app_user_id").notNull(),
    /** Local-time YYYY-MM-DD (e.g. "2026-05-02"). */
    day: text("day").notNull(),
    log: jsonb("log").notNull(),
    /** Last-write-wins ms timestamp from the client. See userProfile. */
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.appUserId, t.day] }),
    // Read path: "all logs for user X" returns this user's history without
    // a per-user table scan.
    userDayIdx: index("nutrition_logs_user_day_idx").on(t.appUserId, t.day),
  }),
);

export type NutritionLogRow = typeof nutritionLogsTable.$inferSelect;
export type NewNutritionLogRow = typeof nutritionLogsTable.$inferInsert;
