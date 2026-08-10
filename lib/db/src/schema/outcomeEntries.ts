import {
  bigint,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Repeatable patient-reported outcome check-ins. Scores are stored as a
 * structured JSON object so the questionnaire can evolve while the stable
 * dimensions (confidence, mobility, sleep, stress, quality of life, falls
 * and fractures) remain aggregateable.
 */
export const outcomeEntriesTable = pgTable(
  "outcome_entries",
  {
    appUserId: text("app_user_id").notNull(),
    entryId: text("entry_id").notNull(),
    entry: jsonb("entry").notNull(),
    recordedAtMs: bigint("recorded_at_ms", { mode: "number" }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.appUserId, t.entryId] }),
    userTsIdx: index("outcome_entries_user_ts_idx").on(
      t.appUserId,
      t.recordedAtMs,
    ),
  }),
);

export type OutcomeEntryRow = typeof outcomeEntriesTable.$inferSelect;
export type NewOutcomeEntryRow = typeof outcomeEntriesTable.$inferInsert;
