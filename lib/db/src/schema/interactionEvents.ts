import { pgTable, text, bigint, timestamp, jsonb, index, uniqueIndex, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * `interaction_events` is a thin, append-only behavioural log used by the
 * Adaptive Intelligence milestone to power short-window personalisation
 * (Today's Focus reordering, Bone Buddy tone shifts, push targeting).
 *
 * Kept deliberately schema-light: a `kind` discriminator + a flexible
 * `payload` jsonb means new event shapes don't need migrations. We index
 * `(appUserId, ts)` for the common "events for user X in last N days"
 * read path.
 *
 * Examples of `kind` values used in v1:
 *   - "session_completed"      payload: { kind, sessionId, mood }
 *   - "meal_swapped"           payload: { from, to, mealType }
 *   - "calcium_logged"         payload: { mg }
 *   - "snap_shot_read"         payload: { tipId }
 *   - "today_focus_completed"  payload: { focusId }
 *   - "push_opened"            payload: { copyId, hoursAfterSent }
 */
export const interactionEventsTable = pgTable(
  "interaction_events",
  {
    id: serial("id").primaryKey(),
    appUserId: text("app_user_id").notNull(),
    /** Stable mobile-generated id used to make queued retries idempotent. */
    clientEventId: text("client_event_id"),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().default({}),
    /**
     * Client-supplied event timestamp (ms since epoch). Stored as bigint
     * because `Date.now()` (~1.7e12 in 2026) overflows Postgres int4
     * (max ~2.1e9), which silently dropped the value on every insert and
     * forced the weekly aggregate to fall back to `receivedAt` on every
     * row. `mode: "number"` keeps the JS surface as a plain number — ms
     * timestamps are well inside `Number.MAX_SAFE_INTEGER` (~9e15).
     */
    occurredAtMs: bigint("occurred_at_ms", { mode: "number" }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userTsIdx: index("interaction_events_user_ts_idx").on(t.appUserId, t.receivedAt),
    // Mirrors `userTsIdx` for the `occurredAtMs` branch of the weekly
    // aggregate predicate (see artifacts/api-server/src/routes/events.ts).
    // Without this, `(app_user_id = ? AND occurred_at_ms >= ?)` falls back
    // to a per-user seq scan as the table grows; with it, Postgres can
    // either pick this index directly or bitmap-or it with `userTsIdx`
    // for the null-occurredAtMs fallback path.
    userOccurredAtIdx: index("interaction_events_user_occurred_at_idx").on(
      t.appUserId,
      t.occurredAtMs,
    ),
    kindIdx: index("interaction_events_kind_idx").on(t.kind),
    clientEventIdx: uniqueIndex("interaction_events_user_client_event_uidx").on(
      t.appUserId,
      t.clientEventId,
    ),
  }),
);

export const insertInteractionEventSchema = createInsertSchema(interactionEventsTable);
export type InteractionEvent = typeof interactionEventsTable.$inferSelect;
export type InsertInteractionEvent = z.infer<typeof insertInteractionEventSchema>;
