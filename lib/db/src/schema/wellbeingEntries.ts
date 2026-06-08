import {
  pgTable,
  text,
  jsonb,
  timestamp,
  bigint,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

/**
 * `wellbeing_entries` — append-only history of completed breathing /
 * meditation sessions (covers the task's "wellbeing_entries" + "sessions"
 * domains; both share a single shape on the client — see
 * `WellbeingContext.WellbeingEntry`). Each row carries the full client
 * entry (kind, sessionId, sessionName, mood, durationSec, completedAt) in
 * jsonb so we can extend it without touching the schema.
 *
 * Idempotency key: `(appUserId, entryId)` where `entryId` is the
 * client-generated id from `WellbeingContext.logSession`. POSTing the
 * same `entryId` twice is a no-op.
 */
export const wellbeingEntriesTable = pgTable(
  "wellbeing_entries",
  {
    appUserId: text("app_user_id").notNull(),
    entryId: text("entry_id").notNull(),
    entry: jsonb("entry").notNull(),
    /** Client-supplied completion ms (mirrors entry.completedAt), used for
     *  the (userId, ts) read index. */
    completedAtMs: bigint("completed_at_ms", { mode: "number" }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Composite PK gives idempotency on the client-supplied entryId so a
    // re-flush of the offline queue never duplicates rows.
    pk: primaryKey({ columns: [t.appUserId, t.entryId] }),
    userTsIdx: index("wellbeing_entries_user_ts_idx").on(
      t.appUserId,
      t.completedAtMs,
    ),
  }),
);

export type WellbeingEntryRow = typeof wellbeingEntriesTable.$inferSelect;
export type NewWellbeingEntryRow = typeof wellbeingEntriesTable.$inferInsert;
