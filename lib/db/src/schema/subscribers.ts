import { pgTable, text, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * `subscribers` mirrors the minimum subscription state needed for backend
 * authorization. RevenueCat is the source of truth for products, prices,
 * offerings, and entitlement definitions — we ONLY cache the per-user
 * entitlement status here so the API can gate features without round-tripping
 * to RevenueCat on every request.
 *
 * Updated by the RevenueCat webhook (POST /api/revenuecat/webhook) and by an
 * on-demand sync triggered after a successful client-side purchase.
 */
export const subscribersTable = pgTable(
  "subscribers",
  {
    appUserId: text("app_user_id").primaryKey(),
    entitlementId: text("entitlement_id").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    productId: text("product_id"),
    periodType: text("period_type"),
    store: text("store"),
    willRenew: boolean("will_renew").notNull().default(false),
    isInTrial: boolean("is_in_trial").notNull().default(false),
    /**
     * Provenance of the active trial period:
     *   "server" — 30-day Premium trial granted by us at registration
     *              (tracked entirely server-side, no payment method).
     *   "store"  — trial provided by Apple/Google through RevenueCat
     *              (legacy / future mid-trial store purchase).
     *   null     — no trial active (paid subscriber, free, or expired).
     * Set on insert in `upsertClerkUser`; cleared (set to null) by the
     * RevenueCat webhook + sync paths when a real store purchase arrives
     * so a mid-trial store purchase cleanly takes over.
     */
    trialSource: text("trial_source"),
    /**
     * Wall-clock end of the server-managed trial. Used by admin metrics
     * and the mobile `/api/subscription/me` endpoint to compute day-of-
     * trial / days-remaining. `null` when `trialSource != "server"`.
     */
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    /**
     * When the most recent BILLING_ISSUE webhook arrived (start of the
     * grace window). `null` once payment recovers (RENEWAL/etc clears it).
     * The mobile dashboard surfaces a banner while this is set and the
     * grace window is still open.
     */
    billingIssueAt: timestamp("billing_issue_at", { withTimezone: true }),
    /**
     * Wall-clock end of the grace window opened by `billingIssueAt`. While
     * `now < gracePeriodEndsAt` we keep `isActive = true` so the user
     * retains access; once it elapses the lazy-expiry path in
     * `/subscription/me` and admin metrics treats the row as inactive
     * (mirrors how `trialEndsAt` decays).
     */
    gracePeriodEndsAt: timestamp("grace_period_ends_at", { withTimezone: true }),
    originalPurchaseAt: timestamp("original_purchase_at", { withTimezone: true }),
    latestPurchaseAt: timestamp("latest_purchase_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    unsubscribeDetectedAt: timestamp("unsubscribe_detected_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    rawCustomerInfo: jsonb("raw_customer_info"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeIdx: index("subscribers_is_active_idx").on(t.isActive),
    expiresIdx: index("subscribers_expires_at_idx").on(t.expiresAt),
    trialSourceIdx: index("subscribers_trial_source_idx").on(t.trialSource),
    trialEndsAtIdx: index("subscribers_trial_ends_at_idx").on(t.trialEndsAt),
    gracePeriodEndsAtIdx: index("subscribers_grace_period_ends_at_idx").on(
      t.gracePeriodEndsAt,
    ),
  }),
);

export const insertSubscriberSchema = createInsertSchema(subscribersTable);
export type Subscriber = typeof subscribersTable.$inferSelect;
export type InsertSubscriber = z.infer<typeof insertSubscriberSchema>;
