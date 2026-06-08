import { pgTable, text, serial, timestamp, jsonb, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * `audit_events` is an append-only record of privileged admin actions and
 * user-initiated GDPR operations. Rows are intentionally never deleted,
 * including after a soft/hard delete of the target account, so the trail
 * stays intact for security reviews and GDPR audit purposes.
 *
 * `actorAppUserId` is set to "self" when the affected user triggered the
 * action themselves (e.g. `DELETE /me`); otherwise it holds the admin's
 * `appUserId`.
 *
 * Supported `action` values (v1):
 *   - "test_account_provisioned"  — POST /admin/test-accounts
 *   - "account_deleted"           — DELETE /me  or  DELETE /admin/users/:id
 *   - "tester_data_reset"         — POST /me/reset
 *   - "sign_in_token_generated"   — POST /admin/users/:clerkId/sign-in-token
 */
export const auditEventsTable = pgTable(
  "audit_events",
  {
    id: serial("id").primaryKey(),
    actorAppUserId: text("actor_app_user_id").notNull(),
    targetAppUserId: text("target_app_user_id").notNull(),
    action: text("action").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    targetIdx: index("audit_events_target_idx").on(t.targetAppUserId, t.createdAt),
    actorIdx: index("audit_events_actor_idx").on(t.actorAppUserId, t.createdAt),
    actionIdx: index("audit_events_action_idx").on(t.action),
    actionCheck: check(
      "audit_events_action_check",
      sql`${t.action} IN ('test_account_provisioned','account_deleted','tester_data_reset','sign_in_token_generated')`,
    ),
  }),
);

export const insertAuditEventSchema = createInsertSchema(auditEventsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAuditEvent = z.infer<typeof insertAuditEventSchema>;
export type AuditEvent = typeof auditEventsTable.$inferSelect;
