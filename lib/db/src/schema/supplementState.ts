import {
  pgTable,
  text,
  jsonb,
  timestamp,
  bigint,
} from "drizzle-orm/pg-core";

/**
 * `supplement_state` — one row per user storing the user's current
 * supplement list (id, name, dose, frequency, taken, takenAt). Mirrors
 * the `Supplement[]` array from `HealthContext`. PUT replaces the whole
 * blob; the client always sends the canonical list it just rendered.
 */
export const supplementStateTable = pgTable("supplement_state", {
  appUserId: text("app_user_id").primaryKey(),
  /** Shape: { supplements: Supplement[] } */
  state: jsonb("state").notNull(),
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type SupplementStateRow = typeof supplementStateTable.$inferSelect;
export type NewSupplementStateRow = typeof supplementStateTable.$inferInsert;
