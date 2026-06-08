import {
  pgTable,
  text,
  timestamp,
  serial,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

/**
 * Referral tracking table.
 *
 * Each user gets one referral code (lazy-generated on first GET /api/referral).
 * When a new user signs up using a referral link, their refereeAppUserId
 * is recorded and XP is awarded to the referrer.
 *
 * Idempotency: refereeAppUserId is unique (partial) — a user can only be referred once.
 */
export const referralsTable = pgTable(
  "referrals",
  {
    id: serial("id").primaryKey(),
    /** The 8-char uppercase code embedded in the share link (e.g. SNAP1A2B). */
    code: text("code").notNull(),
    /** The user who owns this code (the referrer). */
    referrerAppUserId: text("referrer_app_user_id")
      .notNull()
      .references(() => usersTable.appUserId),
    /**
     * Set when a new user signs up using this code. NULL while the code
     * has been generated but not yet used.
     */
    refereeAppUserId: text("referee_app_user_id").references(
      () => usersTable.appUserId,
    ),
    /** Whether the XP bonus has been awarded to the referrer. */
    xpAwarded: boolean("xp_awarded").notNull().default(false),
    /** Timestamp when the referee completed sign-up / onboarding. */
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("referrals_code_uq").on(t.code),
    uniqueIndex("referrals_referee_uq")
      .on(t.refereeAppUserId)
      .where(sql`referee_app_user_id IS NOT NULL`),
    index("referrals_referrer_idx").on(t.referrerAppUserId),
  ],
);

export type Referral = typeof referralsTable.$inferSelect;
export type InsertReferral = typeof referralsTable.$inferInsert;
