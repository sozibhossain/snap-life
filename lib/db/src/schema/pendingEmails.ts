import { pgTable, text, timestamp, serial, jsonb, index, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Outbound transactional-email queue.
 *
 * The api-server itself doesn't talk to SES/SendGrid — it just appends
 * a row here and lets a downstream worker (or the deployed Replit
 * "scheduled deployment") fan rows out to the real provider. This keeps
 * email delivery decoupled from request latency and gives us at-least-
 * once semantics (the worker resets `sentAt` on failure).
 *
 * Initial use: GDPR account-deletion confirmations queued by
 * `DELETE /api/me`. Future kinds (welcome, weekly digest, etc.) can
 * reuse the same table by setting `kind`.
 */
export const pendingEmailsTable = pgTable(
  "pending_emails",
  {
    id: serial("id").primaryKey(),
    /** e.g. `account_deletion_confirmation` */
    kind: text("kind").notNull(),
    toAddress: text("to_address").notNull(),
    /** Free-form payload the renderer interpolates into the template. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** When the worker last successfully handed the email off. NULL while pending. */
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** Last delivery error, for debug. NULL if never attempted or last attempt succeeded. */
    lastError: text("last_error"),
    /**
     * Retry counter; the worker increments it on each failed delivery.
     * Integer (not text) so the worker can do arithmetic + filter on
     * `attempts < MAX_ATTEMPTS` directly in SQL.
     */
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Optional idempotency key for email kinds that must be sent at most
     * once per incident (e.g. `billing_issue`). The unique index below
     * makes `.onConflictDoNothing()` safe even under concurrent webhook
     * retries. Null for email kinds that don't need dedup.
     *
     * Convention: `${kind}:${appUserId}:${incidentAt.toISOString()}`
     */
    externalId: text("external_id"),
  },
  (t) => ({
    pendingIdx: index("pending_emails_pending_idx").on(t.sentAt),
    kindIdx: index("pending_emails_kind_idx").on(t.kind),
    externalIdIdx: uniqueIndex("pending_emails_external_id_uidx")
      .on(t.externalId)
      .where(sql`external_id IS NOT NULL`),
  }),
);

export type PendingEmail = typeof pendingEmailsTable.$inferSelect;
export type InsertPendingEmail = typeof pendingEmailsTable.$inferInsert;
