import { pgTable, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Canonical user record. Joins the Clerk identity (`clerkUserId`) to the
 * stable opaque `appUserId` we already use across `events`, `push_*`,
 * `feedback`, etc.
 *
 * Why both columns?
 *   - `appUserId` is the existing primary key used everywhere downstream.
 *     We do not rewrite the data model; instead we keep this id stable for
 *     the lifetime of the account.
 *   - `clerkUserId` is the Clerk-issued id (e.g. `user_xxx`). Nullable so
 *     legacy / pre-migration records can exist without a Clerk session
 *     (they will continue to authenticate via the legacy bearer token in
 *     `user_tokens` until the device next signs in with Clerk and calls
 *     `POST /api/auth/link`).
 *   - `isAdmin` gates the future admin dashboard. Default false.
 */
export const usersTable = pgTable(
  "users",
  {
    appUserId: text("app_user_id").primaryKey(),
    clerkUserId: text("clerk_user_id"),
    email: text("email"),
    displayName: text("display_name"),
    isAdmin: boolean("is_admin").notNull().default(false),
    /**
     * `isTester` flags the seeded staging test accounts. Testers gain
     * access to the in-app "Reset my data" action and the staging-only
     * `POST /api/me/reset` endpoint. Production users always see this
     * column as false.
     */
    isTester: boolean("is_tester").notNull().default(false),
    /**
     * GDPR soft-delete columns.
     *
     * `deletedAt` is set when the user invokes `DELETE /api/me`. The row
     * is retained — but redacted (email/displayName nulled) — so foreign
     * keys in events / sync tables remain valid for auditing.
     *
     * `hardDeleteAfter` is `deletedAt + 30d`. A future cron / job may
     * physically purge the rows after that grace window. The window
     * lets users undo the deletion via support if they change their
     * mind. `requireUser` rejects every authed request once `deletedAt`
     * is set so the account is effectively closed immediately.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    hardDeleteAfter: timestamp("hard_delete_after", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("users_clerk_user_id_uq").on(t.clerkUserId)],
);

export type AppUser = typeof usersTable.$inferSelect;
export type NewAppUser = typeof usersTable.$inferInsert;
