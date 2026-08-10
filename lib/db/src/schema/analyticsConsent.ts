import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Explicit, versioned permission for secondary analytics and research use.
 *
 * Product telemetry needed to operate a user's own account can still be
 * written to the operational tables, but Community Insights queries MUST
 * join this table and include only rows with `communityAnalytics = true`.
 * Research exports additionally require `researchUse = true`.
 */
export const analyticsConsentTable = pgTable("analytics_consent", {
  appUserId: text("app_user_id").primaryKey(),
  communityAnalytics: boolean("community_analytics").notNull().default(false),
  researchUse: boolean("research_use").notNull().default(false),
  consentVersion: text("consent_version").notNull().default("community-v1"),
  consentedAt: timestamp("consented_at", { withTimezone: true }),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AnalyticsConsent = typeof analyticsConsentTable.$inferSelect;
export type NewAnalyticsConsent = typeof analyticsConsentTable.$inferInsert;
