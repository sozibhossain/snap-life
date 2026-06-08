import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Per-user bearer token used to authorise the small set of "per-user"
 * endpoints we expose to the mobile client (`/api/events`, `/api/push/*`).
 *
 * This is **not** a full identity system — SNAP Life still provisions its
 * `appUserId` client-side via AuthContext. The token is a trust-on-first-use
 * pairing: the first POST /api/auth/bootstrap for a given `appUserId` claims
 * the row and gets back an opaque random token. Any later bootstrap for the
 * same userId fails with 409 (so a second device cannot silently steal the
 * identity by guessing the userId).
 *
 * Tokens are never derived client-side and never leave AsyncStorage on the
 * device that created them.
 */
export const userTokensTable = pgTable(
  "user_tokens",
  {
    appUserId: text("app_user_id").primaryKey(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("user_tokens_token_idx").on(t.token)],
);

export type UserToken = typeof userTokensTable.$inferSelect;
export type NewUserToken = typeof userTokensTable.$inferInsert;
