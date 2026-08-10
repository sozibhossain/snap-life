import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  bigint,
} from "drizzle-orm/pg-core";

/**
 * `user_profile` — server-side mirror of the per-user profile fields the
 * SNAP Life mobile app keeps in `AuthContext.User`. Holds editable identity
 * (name / age / gender / condition), gamification scalars (level / xp /
 * streak / total points), the `joinedAt` first-launch date, and a flexible
 * `preferences` jsonb blob for dietary preferences and any future profile
 * extensions.
 *
 * One row per user keyed by the existing opaque `appUserId` so it joins
 * cleanly to `users`, `user_tokens`, etc. No auth gates here — every
 * routes that touches this table must require the user's own id from the
 * bearer token (see `requireUserAuth`).
 *
 * Conflict policy: server-side last-write-wins. The mobile client keeps
 * the canonical local copy in AsyncStorage and pushes a complete snapshot
 * via PUT /sync/profile; we do not attempt to merge field-by-field
 * because the offline queue may flush several minutes' worth of
 * superseded edits in one go.
 */
export const userProfileTable = pgTable("user_profile", {
  appUserId: text("app_user_id").primaryKey(),
  name: text("name"),
  email: text("email"),
  avatar: text("avatar"),
  age: integer("age"),
  gender: text("gender"),
  condition: text("condition"),
  joinedAt: text("joined_at"),
  /** ISO-3166-1 alpha-2 country code (e.g. `GB`, `US`). Optional. */
  country: text("country"),
  /** IANA timezone name (e.g. `Europe/London`). Optional. */
  timezone: text("timezone"),
  /** Calendar year the user was first diagnosed, when applicable. */
  diagnosisYear: integer("diagnosis_year"),
  /** Stable goal identifiers selected during onboarding/profile editing. */
  goals: jsonb("goals").notNull().default([]),
  /** User-entered co-existing condition identifiers; never free text in reports. */
  coexistingConditions: jsonb("coexisting_conditions").notNull().default([]),
  /** Structured self-reported fractures: year + anatomical location. */
  fractureHistory: jsonb("fracture_history").notNull().default([]),
  level: integer("level").notNull().default(1),
  xp: integer("xp").notNull().default(0),
  xpToNextLevel: integer("xp_to_next_level").notNull().default(500),
  streakDays: integer("streak_days").notNull().default(0),
  totalPoints: integer("total_points").notNull().default(0),
  /** Free-form jsonb blob: dietary prefs, FRAX inputs, future bits. */
  preferences: jsonb("preferences").notNull().default({}),
  /**
   * Client-supplied moment of the last write (ms since epoch). Bigint
   * because `Date.now()` overflows int4 — see `interactionEvents.ts`
   * for the same fix. Used to log conflicts but the merge policy is
   * still last-write-wins on the server.
   */
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type UserProfileRow = typeof userProfileTable.$inferSelect;
export type NewUserProfileRow = typeof userProfileTable.$inferInsert;
