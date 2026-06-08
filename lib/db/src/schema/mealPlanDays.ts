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
 * `meal_plan_days` — one row per (user, day) capturing the day's
 * `DailyPlan` (the chosen recipes), the user's dietary `preferences`
 * snapshot at the time the plan was generated, and their `favourites`
 * list. Stored as a single jsonb so swap / regenerate flows can save
 * the entire shape with a single PUT.
 *
 * Why one row per day rather than one row per user?
 *   - The plan rolls over at local midnight (see NutritionContext date
 *     rollover effect) and the user can browse historical plans —
 *     keeping per-day rows makes "show me last Tuesday" trivial later.
 *   - Favourites and dietary prefs are denormalised onto each day's row
 *     so the snapshot truly captures what the plan was generated from.
 *     The most-recent row is treated as the canonical preferences/
 *     favourites view by the client.
 */
export const mealPlanDaysTable = pgTable(
  "meal_plan_days",
  {
    appUserId: text("app_user_id").notNull(),
    day: text("day").notNull(),
    /** Shape: { plan: DailyPlan, preferences: DietaryPreferences, favourites: string[] } */
    payload: jsonb("payload").notNull(),
    updatedAtMs: bigint("updated_at_ms", { mode: "number" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.appUserId, t.day] }),
    userDayIdx: index("meal_plan_days_user_day_idx").on(t.appUserId, t.day),
  }),
);

export type MealPlanDayRow = typeof mealPlanDaysTable.$inferSelect;
export type NewMealPlanDayRow = typeof mealPlanDaysTable.$inferInsert;
