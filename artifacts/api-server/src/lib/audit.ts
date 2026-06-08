/**
 * Thin, non-fatal audit-log helper.
 *
 * Call insertAuditLog() immediately after every privileged action succeeds.
 * The call is fire-and-forget from the caller's perspective — any DB error
 * is logged but never re-thrown so a logging failure never blocks the primary
 * action.
 */

import { db, auditLogsTable } from "@workspace/db";
import { logger } from "./logger";

// ─── Action enum ─────────────────────────────────────────────────────────────

export type AuditAction =
  | "admin_impersonate"       // admin generated a sign-in token for a user
  | "admin_delete_user"       // admin triggered GDPR soft-delete for a user
  | "admin_provision_tester"  // admin created / promoted a tester account
  | "user_soft_delete"        // user deleted their own account (DELETE /me)
  | "user_data_export"        // user exported their own data (GET /me/export)
  | "system_hard_delete";     // hardDeleteWorker permanently erased a user

// ─── Insert helper ───────────────────────────────────────────────────────────

export interface AuditLogParams {
  /** appUserId of the admin performing the action. Null for system events. */
  actorAdminId?: string | null;
  /** Email address of the acting admin. Denormalised so records remain
   *  readable even after the admin account is later deleted. */
  actorAdminEmail?: string | null;
  /** appUserId of the user the action targets. Null for non-user actions. */
  targetUserId?: string | null;
  action: AuditAction;
  /** Optional action-specific context (e.g. { targetClerkId, created }). */
  metadata?: Record<string, unknown> | null;
}

export async function insertAuditLog(params: AuditLogParams): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      actorAdminId: params.actorAdminId ?? null,
      actorAdminEmail: params.actorAdminEmail ?? null,
      targetUserId: params.targetUserId ?? null,
      action: params.action,
      metadata: params.metadata ?? null,
    });
  } catch (err) {
    // Non-fatal: log the failure but never surface it to the caller.
    logger.error({ err, params }, "insertAuditLog: failed to write audit entry");
  }
}
