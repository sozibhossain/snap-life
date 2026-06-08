import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

/**
 * Persistent audit trail for all privileged actions.
 *
 * actorAdminId / actorAdminEmail — the admin who performed the action.
 *   Both nullable so system-initiated events (e.g. hard-delete worker)
 *   can be stored with actorAdminId = null and action = "system_hard_delete".
 *
 * targetUserId — the user the action was performed on. Nullable for
 *   actions that are not user-specific.
 *
 * action — one of the AuditAction literals defined in
 *   artifacts/api-server/src/lib/audit.ts.
 *
 * metadata — optional jsonb bag for action-specific context
 *   (e.g. targetClerkId for impersonation, created:bool for tester provisioning).
 *
 * Rows are intentionally append-only. Never update or hard-delete audit rows.
 */
export const auditLogsTable = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    actorAdminId: text("actor_admin_id"),
    actorAdminEmail: text("actor_admin_email"),
    targetUserId: text("target_user_id"),
    action: text("action").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_logs_action_idx").on(t.action),
    index("audit_logs_target_user_idx").on(t.targetUserId),
    index("audit_logs_created_at_idx").on(t.createdAt),
  ],
);

export type AuditLog = typeof auditLogsTable.$inferSelect;
export type NewAuditLog = typeof auditLogsTable.$inferInsert;
