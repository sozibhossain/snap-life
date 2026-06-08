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
 * `assessment_results` — append-only history of clinical assessments
 * recorded by the user: DEXA scans (T-score, Z-score, BMD per anatomical
 * site) and FRAX risk inputs. Stored as a flexible jsonb so we don't have
 * to migrate every time the client adds a new field.
 *
 * Idempotency: composite PK on `(appUserId, resultId)` where `resultId`
 * is the client-generated id from `HealthContext.addDexaScan`. POSTing
 * the same id twice is a no-op.
 */
export const assessmentResultsTable = pgTable(
  "assessment_results",
  {
    appUserId: text("app_user_id").notNull(),
    resultId: text("result_id").notNull(),
    /** "dexa" | "frax" | <future> */
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    /** Client-supplied moment the assessment was taken. */
    takenAtMs: bigint("taken_at_ms", { mode: "number" }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.appUserId, t.resultId] }),
    userTsIdx: index("assessment_results_user_ts_idx").on(
      t.appUserId,
      t.takenAtMs,
    ),
  }),
);

export type AssessmentResultRow = typeof assessmentResultsTable.$inferSelect;
export type NewAssessmentResultRow =
  typeof assessmentResultsTable.$inferInsert;
