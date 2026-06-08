import { pgTable, text, boolean, timestamp, jsonb, index, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * In-app user feedback. Captures three types of input:
 *   - "general"     -> "How can we improve the app?"
 *   - "testimonial" -> "What are you enjoying about Snap Life?"
 *   - "experience"  -> "Are you having fun? What do you like most?"
 *
 * Storage-only (no email pipeline yet). Admins can read this table to triage
 * bug reports, surface testimonials (gated by `allowTestimonialUse`), and
 * track engagement signals over time.
 */
export const feedbackTable = pgTable(
  "feedback",
  {
    id: serial("id").primaryKey(),
    appUserId: text("app_user_id"),
    tier: text("tier").notNull(),
    feedbackType: text("feedback_type").notNull(),
    message: text("message").notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    allowTestimonialUse: boolean("allow_testimonial_use").notNull().default(false),
    platform: text("platform"),
    appVersion: text("app_version"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    typeIdx: index("feedback_type_idx").on(t.feedbackType),
    userIdx: index("feedback_user_idx").on(t.appUserId),
    createdIdx: index("feedback_created_at_idx").on(t.createdAt),
  }),
);

export const insertFeedbackSchema = createInsertSchema(feedbackTable).omit({
  id: true,
  createdAt: true,
});
export type Feedback = typeof feedbackTable.$inferSelect;
export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;
