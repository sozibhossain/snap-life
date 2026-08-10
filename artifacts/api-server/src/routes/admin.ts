import { Router, type IRouter } from "express";
import {
  db,
  usersTable,
  subscribersTable,
  feedbackTable,
  wellbeingEntriesTable,
  interactionEventsTable,
  mealPlanDaysTable,
  pushUserStateTable,
  userProfileTable,
  auditEventsTable,
  auditLogsTable,
  analyticsConsentTable,
  assessmentResultsTable,
  nutritionLogsTable,
  activityLogsTable,
  supplementStateTable,
  gamificationStateTable,
  outcomeEntriesTable,
} from "@workspace/db";
import { insertAuditLog } from "../lib/audit";
import { and, count, desc, eq, gte, inArray, lt, lte, or, sql, ilike } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { requireAdminUser } from "../lib/auth";
import {
  GetAdminFeedbackQueryParams,
  GetAdminUserLookupQueryParams,
  GetAdminAuditQueryParams,
} from "@workspace/api-zod";
import { softDeleteAccount } from "./me";
import { forceHardDeleteUser } from "../services/hardDeleteWorker";
import {
  monthlyPriceCents,
  tierFromProductId,
} from "../lib/subscriptionPricing";

const router: IRouter = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------- *
 * Helpers
 * -------------------------------------------------------------------------- */

/**
 * Distinct app users with ≥1 interaction event since the supplied cutoff.
 * Used by both DAU/WAU/MAU and the user-metrics activeLast7/30d counts so
 * the two surfaces stay numerically consistent.
 */
async function distinctActiveUsers(sinceDate: Date): Promise<number> {
  const rows = await db
    .select({
      c: sql<number>`count(distinct ${interactionEventsTable.appUserId})`,
    })
    .from(interactionEventsTable)
    .where(gte(interactionEventsTable.receivedAt, sinceDate));
  return Number(rows[0]?.c ?? 0);
}

/* -------------------------------------------------------------------------- *
 * GET /admin/me
 *
 * Lightweight authorization probe used by the admin web app to gate ALL
 * admin pages on initial load — without this, a non-admin signed-in user
 * could see admin chrome (e.g. the User Lookup search box) before any
 * data-bearing query fired. By hitting this endpoint at the route level
 * the UI can immediately render <NotAuthorised> on a 403.
 * -------------------------------------------------------------------------- */
router.get("/admin/me", async (req, res): Promise<void> => {
  const u = await requireAdminUser(req, res);
  if (!u) return;
  res.json({ isAdmin: true });
});

/* -------------------------------------------------------------------------- *
 * GET /admin/metrics/users
 * -------------------------------------------------------------------------- */
router.get("/admin/metrics/users", async (req, res): Promise<void> => {
  const u = await requireAdminUser(req, res);
  if (!u) return;

  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

    const [totalRow] = await db.select({ value: count() }).from(usersTable);
    const [adminRow] = await db
      .select({ value: count() })
      .from(usersTable)
      .where(eq(usersTable.isAdmin, true));
    const [last7dRow] = await db
      .select({ value: count() })
      .from(usersTable)
      .where(gte(usersTable.createdAt, sevenDaysAgo));
    const [last30dRow] = await db
      .select({ value: count() })
      .from(usersTable)
      .where(gte(usersTable.createdAt, thirtyDaysAgo));

    const [activeLast7d, activeLast30d] = await Promise.all([
      distinctActiveUsers(sevenDaysAgo),
      distinctActiveUsers(thirtyDaysAgo),
    ]);

    // Tier breakdown — derive each user's tier from the subscribers row.
    // - free: no subscribers row
    // - trial: row exists, isInTrial = true
    // - plus / premium: active row, product maps to that tier
    // - lapsed: row exists but neither active nor in trial (was paying)
    const tierRows = await db
      .select({
        productId: subscribersTable.productId,
        isInTrial: subscribersTable.isInTrial,
        isActive: subscribersTable.isActive,
        c: count(),
      })
      .from(subscribersTable)
      .groupBy(
        subscribersTable.productId,
        subscribersTable.isInTrial,
        subscribersTable.isActive,
      );

    const byTier = { free: 0, trial: 0, plus: 0, premium: 0, lapsed: 0 };
    let usersWithSubscriberRow = 0;
    for (const row of tierRows) {
      const c = Number(row.c);
      usersWithSubscriberRow += c;
      if (!row.isActive && !row.isInTrial) {
        byTier.lapsed += c;
        continue;
      }
      if (row.isInTrial) {
        byTier.trial += c;
        continue;
      }
      const tier = tierFromProductId(row.productId);
      if (tier === "plus") byTier.plus += c;
      else if (tier === "premium") byTier.premium += c;
      else byTier.trial += c; // unknown product but active → bucket as trial
    }
    byTier.free = Math.max(
      0,
      Number(totalRow?.value ?? 0) - usersWithSubscriberRow,
    );

    res.json({
      totalUsers: Number(totalRow?.value ?? 0),
      adminCount: Number(adminRow?.value ?? 0),
      newUsersLast7d: Number(last7dRow?.value ?? 0),
      newUsersLast30d: Number(last30dRow?.value ?? 0),
      activeLast7d,
      activeLast30d,
      byTier,
    });
  } catch (err) {
    req.log?.error({ err }, "admin user metrics failed");
    res.status(500).json({ error: "internal" });
  }
});

/* -------------------------------------------------------------------------- *
 * GET /admin/metrics/engagement
 * -------------------------------------------------------------------------- */
router.get("/admin/metrics/engagement", async (req, res): Promise<void> => {
  const u = await requireAdminUser(req, res);
  if (!u) return;

  try {
    const now = Date.now();
    const oneDayAgoMs = now - DAY_MS;
    const sevenDaysAgoMs = now - 7 * DAY_MS;
    const thirtyDaysAgoMs = now - 30 * DAY_MS;
    const sevenDaysAgoDate = new Date(sevenDaysAgoMs);

    const [dau, wau, mau] = await Promise.all([
      distinctActiveUsers(new Date(oneDayAgoMs)),
      distinctActiveUsers(sevenDaysAgoDate),
      distinctActiveUsers(new Date(thirtyDaysAgoMs)),
    ]);

    // Wellbeing sessions in last 7d, grouped by entry.kind.
    const wellbeingRows = await db
      .select({
        kind: sql<string>`coalesce(${wellbeingEntriesTable.entry}->>'kind', 'other')`,
        c: count(),
      })
      .from(wellbeingEntriesTable)
      .where(gte(wellbeingEntriesTable.completedAtMs, sevenDaysAgoMs))
      .groupBy(sql`coalesce(${wellbeingEntriesTable.entry}->>'kind', 'other')`);
    const wellbeing = { breathing: 0, meditation: 0, other: 0 };
    for (const r of wellbeingRows) {
      const c = Number(r.c);
      if (r.kind === "breathing") wellbeing.breathing += c;
      else if (r.kind === "meditation") wellbeing.meditation += c;
      else wellbeing.other += c;
    }

    // Meal-plan engagement — count of distinct (user, day) rows touched in
    // the last 7d. Approximates "users actively planning meals". Each
    // mealPlanDays row is unique on (appUserId, day) by primary key, so a
    // simple row count over the window is the distinct count.
    const [mealPlanRow] = await db
      .select({ value: count() })
      .from(mealPlanDaysTable)
      .where(gte(mealPlanDaysTable.updatedAt, sevenDaysAgoDate));
    const mealPlansLast7d = Number(mealPlanRow?.value ?? 0);

    // Push delivery — `pushUserState` has one row per user with their
    // last send time. Filtering on `lastSentAt >= 7d ago` is effectively
    // a distinct-recipient count for the window.
    const [pushRecipRow] = await db
      .select({ value: count() })
      .from(pushUserStateTable)
      .where(gte(pushUserStateTable.lastSentAt, sevenDaysAgoDate));
    const pushRecipientsLast7d = Number(pushRecipRow?.value ?? 0);

    // Push opens — distinct openers in the last 7d. Only "push_opened"
    // events are counted; multiple opens from the same user collapse to
    // one so the rate cannot exceed 1.0.
    const pushOpenedRows = await db
      .select({
        c: sql<number>`count(distinct ${interactionEventsTable.appUserId})`,
      })
      .from(interactionEventsTable)
      .where(
        and(
          eq(interactionEventsTable.kind, "push_opened"),
          gte(interactionEventsTable.receivedAt, sevenDaysAgoDate),
        ),
      );
    const pushOpenedLast7d = Number(pushOpenedRows[0]?.c ?? 0);

    const pushOpenRate =
      pushRecipientsLast7d > 0
        ? Math.min(1, pushOpenedLast7d / pushRecipientsLast7d)
        : null;

    // Bone Buddy = the daily nudge push (every push in v1 is the
    // Bone Buddy daily nudge — see pushSender.sendBoneBuddyPush). The
    // total open count (NOT distinct) is the closest signal we have to
    // "Bone Buddy interactions" without instrumenting the chat route.
    const [boneBuddyRow] = await db
      .select({ value: count() })
      .from(interactionEventsTable)
      .where(
        and(
          eq(interactionEventsTable.kind, "push_opened"),
          gte(interactionEventsTable.receivedAt, sevenDaysAgoDate),
        ),
      );
    const boneBuddyInteractionsLast7d = Number(boneBuddyRow?.value ?? 0);

    // Event counts by kind, last 7d (top 10).
    const eventRows = await db
      .select({
        kind: interactionEventsTable.kind,
        c: count(),
      })
      .from(interactionEventsTable)
      .where(gte(interactionEventsTable.receivedAt, sevenDaysAgoDate))
      .groupBy(interactionEventsTable.kind)
      .orderBy(desc(count()));

    // Weekly activity sparkline — one bucket per UTC day for the last 7
    // days, oldest first. Built in TypeScript (rather than via SQL
    // `date_trunc`) so unit tests don't have to teach the mock
    // interpreter about date_trunc semantics.
    const dayBuckets: Array<{ date: string; activeUsers: number }> = [];
    const startOfTodayUtc = Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    );
    for (let i = 6; i >= 0; i -= 1) {
      const start = new Date(startOfTodayUtc - i * DAY_MS);
      const end = new Date(start.getTime() + DAY_MS);
      const rows = await db
        .select({
          c: sql<number>`count(distinct ${interactionEventsTable.appUserId})`,
        })
        .from(interactionEventsTable)
        .where(
          and(
            gte(interactionEventsTable.receivedAt, start),
            lt(interactionEventsTable.receivedAt, end),
          ),
        );
      dayBuckets.push({
        date: start.toISOString().slice(0, 10),
        activeUsers: Number(rows[0]?.c ?? 0),
      });
    }

    res.json({
      dau,
      wau,
      mau,
      wellbeingSessionsLast7d: wellbeing,
      mealPlansLast7d,
      boneBuddyInteractionsLast7d,
      pushRecipientsLast7d,
      pushOpenedLast7d,
      pushOpenRate,
      weeklyActivity: dayBuckets,
      eventCountsLast7d: eventRows.map((r) => ({
        kind: r.kind,
        count: Number(r.c),
      })),
    });
  } catch (err) {
    req.log?.error({ err }, "admin engagement metrics failed");
    res.status(500).json({ error: "internal" });
  }
});

/* -------------------------------------------------------------------------- *
 * GET /admin/metrics/community-insights
 *
 * Aggregate-only Community Insights foundation. This intentionally returns
 * counts, buckets, and demand signals only; no raw messages or user rows are
 * exposed from the admin API.
 * -------------------------------------------------------------------------- */
router.get("/admin/metrics/community-insights", async (req, res): Promise<void> => {
  const u = await requireAdminUser(req, res);
  if (!u) return;

  try {
    const now = Date.now();
    const sevenDaysAgoMs = now - 7 * DAY_MS;
    const thirtyDaysAgoMs = now - 30 * DAY_MS;
    const sevenDaysAgoDate = new Date(sevenDaysAgoMs);
    const thirtyDaysAgoDate = new Date(thirtyDaysAgoMs);
    const thirtyDaysAgoIso = thirtyDaysAgoDate.toISOString().slice(0, 10);
    const configuredMin = Number(process.env.COMMUNITY_MIN_COHORT_SIZE);
    const minCohortSize = Number.isFinite(configuredMin)
      ? Math.max(3, Math.floor(configuredMin))
      : 10;

    const consentRows = await db
      .select({ appUserId: analyticsConsentTable.appUserId })
      .from(analyticsConsentTable)
      .where(eq(analyticsConsentTable.communityAnalytics, true));
    const consentedUserIds = consentRows.map((row) => row.appUserId);

    const suppressCount = (value: number) =>
      value >= minCohortSize ? value : null;
    const suppressAverage = (
      values: number[],
      participantCount = values.length,
    ) =>
      participantCount >= minCohortSize
        ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2))
        : null;
    const asRecord = (value: unknown): Record<string, unknown> =>
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const finite = (value: unknown): number | null =>
      typeof value === "number" && Number.isFinite(value) ? value : null;
    const stringArray = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string" && v.length > 0)
        : [];
    const increment = (map: Map<string, number>, key: string) =>
      map.set(key, (map.get(key) ?? 0) + 1);
    const grouped = (map: Map<string, number>) => {
      const visible: Array<{
        label: string;
        count: number | null;
        suppressed: boolean;
      }> = [...map.entries()]
        .filter(([, rawCount]) => rawCount >= minCohortSize)
        .map(([label, rawCount]) => ({
          label,
          count: rawCount,
          suppressed: false,
        }));
      const suppressedTotal = [...map.values()]
        .filter((rawCount) => rawCount < minCohortSize)
        .reduce((sum, rawCount) => sum + rawCount, 0);
      if (suppressedTotal > 0) {
        visible.push({
          label: "Other / suppressed",
          count: suppressCount(suppressedTotal),
          suppressed: true,
        });
      }
      return visible.sort((a, b) => (b.count ?? -1) - (a.count ?? -1));
    };

    if (consentedUserIds.length < minCohortSize) {
      res.json({
        generatedAt: new Date(now).toISOString(),
        privacy: {
          minCohortSize,
          consentedParticipants: null,
          suppressed: true,
          consentVersion: "community-v1",
        },
        overview: null,
        boneHealth: null,
        nutrition: null,
        medicationAndSupplements: null,
        exercise: null,
        learningAndWellness: null,
        outcomes: null,
        impact: null,
      });
      return;
    }

    const consentFilter = inArray(
      interactionEventsTable.appUserId,
      consentedUserIds,
    );

    const events30d = await db
      .select({
        kind: interactionEventsTable.kind,
        count: count(),
        users: sql<number>`count(distinct ${interactionEventsTable.appUserId})`,
      })
      .from(interactionEventsTable)
      .where(
        and(
          consentFilter,
          gte(interactionEventsTable.receivedAt, thirtyDaysAgoDate),
        ),
      )
      .groupBy(interactionEventsTable.kind);

    const events7d = await db
      .select({
        kind: interactionEventsTable.kind,
        count: count(),
        users: sql<number>`count(distinct ${interactionEventsTable.appUserId})`,
      })
      .from(interactionEventsTable)
      .where(
        and(
          consentFilter,
          gte(interactionEventsTable.receivedAt, sevenDaysAgoDate),
        ),
      )
      .groupBy(interactionEventsTable.kind);

    const byKind30d = new Map(
      events30d.map((r) => [
        r.kind,
        { count: Number(r.count), users: Number(r.users ?? 0) },
      ]),
    );
    const byKind7d = new Map(
      events7d.map((r) => [
        r.kind,
        { count: Number(r.count), users: Number(r.users ?? 0) },
      ]),
    );
    const eventStats = (kind: string) => {
      const seven = byKind7d.get(kind) ?? { count: 0, users: 0 };
      const thirty = byKind30d.get(kind) ?? { count: 0, users: 0 };
      return {
        count7d: seven.users >= minCohortSize ? seven.count : null,
        users7d: suppressCount(seven.users),
        count30d: thirty.users >= minCohortSize ? thirty.count : null,
        users30d: suppressCount(thirty.users),
      };
    };

    const wellbeingMoodRows = await db
      .select({
        kind: sql<string>`coalesce(${wellbeingEntriesTable.entry}->>'kind', 'other')`,
        mood: sql<string>`coalesce(${wellbeingEntriesTable.entry}->>'mood', 'unknown')`,
        count: count(),
        users: sql<number>`count(distinct ${wellbeingEntriesTable.appUserId})`,
      })
      .from(wellbeingEntriesTable)
      .where(
        and(
          inArray(wellbeingEntriesTable.appUserId, consentedUserIds),
          gte(wellbeingEntriesTable.completedAtMs, sevenDaysAgoMs),
        ),
      )
      .groupBy(
        sql`coalesce(${wellbeingEntriesTable.entry}->>'kind', 'other')`,
        sql`coalesce(${wellbeingEntriesTable.entry}->>'mood', 'unknown')`,
      );

    const topLearningPathways = await db
      .select({
        pathway: sql<string>`coalesce(${interactionEventsTable.payload}->>'pathway', 'Unknown')`,
        count: count(),
        users: sql<number>`count(distinct ${interactionEventsTable.appUserId})`,
      })
      .from(interactionEventsTable)
      .where(
        and(
          eq(interactionEventsTable.kind, "lesson_completed"),
          consentFilter,
          gte(interactionEventsTable.receivedAt, thirtyDaysAgoDate),
        ),
      )
      .groupBy(sql`coalesce(${interactionEventsTable.payload}->>'pathway', 'Unknown')`)
      .orderBy(desc(count()))
      .limit(10);

    const coachingBySession = await db
      .select({
        sessionId: sql<string>`coalesce(${interactionEventsTable.payload}->>'sessionId', 'unknown')`,
        count: count(),
        users: sql<number>`count(distinct ${interactionEventsTable.appUserId})`,
      })
      .from(interactionEventsTable)
      .where(
        and(
          eq(interactionEventsTable.kind, "coaching_booking_requested"),
          consentFilter,
          gte(interactionEventsTable.receivedAt, thirtyDaysAgoDate),
        ),
      )
      .groupBy(sql`coalesce(${interactionEventsTable.payload}->>'sessionId', 'unknown')`);

    const expertByConsultant = await db
      .select({
        consultantId: sql<string>`coalesce(${interactionEventsTable.payload}->>'consultantId', 'unknown')`,
        count: count(),
        users: sql<number>`count(distinct ${interactionEventsTable.appUserId})`,
      })
      .from(interactionEventsTable)
      .where(
        and(
          eq(interactionEventsTable.kind, "expert_support_requested"),
          consentFilter,
          gte(interactionEventsTable.receivedAt, thirtyDaysAgoDate),
        ),
      )
      .groupBy(sql`coalesce(${interactionEventsTable.payload}->>'consultantId', 'unknown')`);

    const [
      profiles,
      assessments,
      nutritionRows,
      activityRows,
      supplementRows,
      gamificationRows,
      outcomeRows,
      learningRows,
      lifetimeEventRows,
    ] = await Promise.all([
      db
        .select({
          appUserId: userProfileTable.appUserId,
          age: userProfileTable.age,
          gender: userProfileTable.gender,
          condition: userProfileTable.condition,
          country: userProfileTable.country,
          diagnosisYear: userProfileTable.diagnosisYear,
          goals: userProfileTable.goals,
          coexistingConditions: userProfileTable.coexistingConditions,
          fractureHistory: userProfileTable.fractureHistory,
          streakDays: userProfileTable.streakDays,
        })
        .from(userProfileTable)
        .where(inArray(userProfileTable.appUserId, consentedUserIds)),
      db
        .select({
          appUserId: assessmentResultsTable.appUserId,
          kind: assessmentResultsTable.kind,
          payload: assessmentResultsTable.payload,
        })
        .from(assessmentResultsTable)
        .where(inArray(assessmentResultsTable.appUserId, consentedUserIds)),
      db
        .select({
          appUserId: nutritionLogsTable.appUserId,
          log: nutritionLogsTable.log,
        })
        .from(nutritionLogsTable)
        .where(
          and(
            inArray(nutritionLogsTable.appUserId, consentedUserIds),
            gte(nutritionLogsTable.day, thirtyDaysAgoIso),
          ),
        ),
      db
        .select({
          appUserId: activityLogsTable.appUserId,
          log: activityLogsTable.log,
        })
        .from(activityLogsTable)
        .where(
          and(
            inArray(activityLogsTable.appUserId, consentedUserIds),
            gte(activityLogsTable.day, thirtyDaysAgoIso),
          ),
        ),
      db
        .select({
          appUserId: supplementStateTable.appUserId,
          state: supplementStateTable.state,
        })
        .from(supplementStateTable)
        .where(inArray(supplementStateTable.appUserId, consentedUserIds)),
      db
        .select({
          appUserId: gamificationStateTable.appUserId,
          state: gamificationStateTable.state,
        })
        .from(gamificationStateTable)
        .where(inArray(gamificationStateTable.appUserId, consentedUserIds)),
      db
        .select({
          appUserId: outcomeEntriesTable.appUserId,
          entry: outcomeEntriesTable.entry,
          recordedAtMs: outcomeEntriesTable.recordedAtMs,
        })
        .from(outcomeEntriesTable)
        .where(inArray(outcomeEntriesTable.appUserId, consentedUserIds)),
      db
        .select({
          appUserId: interactionEventsTable.appUserId,
          payload: interactionEventsTable.payload,
        })
        .from(interactionEventsTable)
        .where(
          and(
            consentFilter,
            eq(interactionEventsTable.kind, "lesson_completed"),
            gte(interactionEventsTable.receivedAt, thirtyDaysAgoDate),
          ),
        ),
      db
        .select({
          kind: interactionEventsTable.kind,
          count: count(),
          users: sql<number>`count(distinct ${interactionEventsTable.appUserId})`,
        })
        .from(interactionEventsTable)
        .where(consentFilter)
        .groupBy(interactionEventsTable.kind),
    ]);

    const ageGroups = new Map<string, number>();
    const genderGroups = new Map<string, number>();
    const conditionGroups = new Map<string, number>();
    const countryGroups = new Map<string, number>();
    const goalGroups = new Map<string, number>();
    const coexistGroups = new Map<string, number>();
    const fractureLocations = new Map<string, number>();
    const diagnosisYears: number[] = [];
    const streaks: number[] = [];
    for (const profile of profiles) {
      const age = profile.age;
      if (age != null) {
        const bucket =
          age < 35 ? "18–34" : age < 45 ? "35–44" : age < 55 ? "45–54" : age < 65 ? "55–64" : age < 75 ? "65–74" : "75+";
        increment(ageGroups, bucket);
      }
      increment(genderGroups, profile.gender?.trim() || "Not provided");
      increment(conditionGroups, profile.condition?.trim() || "Not provided");
      increment(countryGroups, profile.country?.trim() || "Not provided");
      for (const goal of stringArray(profile.goals)) increment(goalGroups, goal);
      for (const item of stringArray(profile.coexistingConditions)) increment(coexistGroups, item);
      if (Array.isArray(profile.fractureHistory)) {
        for (const item of profile.fractureHistory) {
          const location = asRecord(item).location;
          if (typeof location === "string") increment(fractureLocations, location);
        }
      }
      if (profile.diagnosisYear && profile.diagnosisYear > 1900) {
        diagnosisYears.push(new Date(now).getUTCFullYear() - profile.diagnosisYear);
      }
      if (typeof profile.streakDays === "number") streaks.push(profile.streakDays);
    }

    const tScores: number[] = [];
    const fraxMajor: number[] = [];
    const fraxHip: number[] = [];
    const bmis: number[] = [];
    const tScoreUsers = new Set<string>();
    const fraxMajorUsers = new Set<string>();
    const fraxHipUsers = new Set<string>();
    const bmiUsers = new Set<string>();
    const riskFactors = new Map<string, number>();
    const riskFactorUsers = new Map<string, Set<string>>();
    const previousFractureUsers = new Set<string>();
    let previousFractures = 0;
    for (const row of assessments) {
      const payload = asRecord(row.payload);
      if (row.kind === "dexa") {
        const values = [payload.spineTScore, payload.hipTScore, payload.tScore]
          .map(finite)
          .filter((v): v is number => v !== null);
        if (values.length > 0) {
          tScores.push(Math.min(...values));
          tScoreUsers.add(row.appUserId);
        }
        const bmi = finite(payload.bmi);
        if (bmi !== null) {
          bmis.push(bmi);
          bmiUsers.add(row.appUserId);
        }
      } else if (row.kind === "frax") {
        const major = finite(payload.majorFractureRisk);
        const hip = finite(payload.hipFractureRisk);
        if (major !== null) {
          fraxMajor.push(major);
          fraxMajorUsers.add(row.appUserId);
        }
        if (hip !== null) {
          fraxHip.push(hip);
          fraxHipUsers.add(row.appUserId);
        }
        const inputs = asRecord(payload.inputs);
        for (const key of [
          "previousFracture",
          "parentHipFracture",
          "smoking",
          "alcohol",
          "glucocorticoids",
          "rheumatoidArthritis",
          "secondaryOsteoporosis",
        ]) {
          if (inputs[key] === true) {
            const users = riskFactorUsers.get(key) ?? new Set<string>();
            users.add(row.appUserId);
            riskFactorUsers.set(key, users);
          }
        }
        if (inputs.previousFracture === true) previousFractureUsers.add(row.appUserId);
      }
    }
    for (const [key, users] of riskFactorUsers) {
      riskFactors.set(key, users.size);
    }
    previousFractures = previousFractureUsers.size;

    const nutrientValues: Record<string, number[]> = {
      calcium: [], protein: [], vitaminD: [], magnesium: [], calories: [],
    };
    const nutrientUsers: Record<string, Set<string>> = Object.fromEntries(
      Object.keys(nutrientValues).map((key) => [key, new Set<string>()]),
    );
    for (const row of nutritionRows) {
      const log = asRecord(row.log);
      for (const key of Object.keys(nutrientValues)) {
        const value = finite(log[key]);
        if (value !== null) {
          nutrientValues[key]!.push(value);
          nutrientUsers[key]!.add(row.appUserId);
        }
      }
    }

    const supplementNames = new Map<string, number>();
    const medicationNames = new Map<string, number>();
    let currentTaken = 0;
    let currentTracked = 0;
    for (const row of supplementRows) {
      const items = asRecord(row.state).supplements;
      if (!Array.isArray(items)) continue;
      for (const rawItem of items) {
        const item = asRecord(rawItem);
        const name = typeof item.name === "string" ? item.name.trim() : "Unknown";
        const target = item.category === "medication" ? medicationNames : supplementNames;
        increment(target, name || "Unknown");
        currentTracked += 1;
        if (item.taken === true) currentTaken += 1;
      }
    }

    const steps: number[] = [];
    const activeMinutes: number[] = [];
    const stepUsers = new Set<string>();
    const activeMinuteUsers = new Set<string>();
    const exerciseTypes = new Map<string, number>();
    const exerciseTypeUsers = new Map<string, Set<string>>();
    for (const row of activityRows) {
      const log = asRecord(row.log);
      const step = finite(log.steps);
      const minutes = finite(log.activeMinutes);
      if (step !== null) {
        steps.push(step);
        stepUsers.add(row.appUserId);
      }
      if (minutes !== null) {
        activeMinutes.push(minutes);
        activeMinuteUsers.add(row.appUserId);
      }
      if (Array.isArray(log.exerciseSessions)) {
        for (const session of log.exerciseSessions) {
          const kind = asRecord(session).kind;
          if (typeof kind === "string") {
            const users = exerciseTypeUsers.get(kind) ?? new Set<string>();
            users.add(row.appUserId);
            exerciseTypeUsers.set(kind, users);
          }
        }
      }
    }
    for (const [kind, users] of exerciseTypeUsers) {
      exerciseTypes.set(kind, users.size);
    }

    const lessonNames = new Map<string, number>();
    const lessonUsers = new Map<string, Set<string>>();
    let learningDurationSec = 0;
    for (const row of learningRows) {
      const payload = asRecord(row.payload);
      const title = typeof payload.title === "string" ? payload.title : "Unknown";
      const users = lessonUsers.get(title) ?? new Set<string>();
      users.add(row.appUserId);
      lessonUsers.set(title, users);
      learningDurationSec += finite(payload.durationSec) ?? 0;
    }
    for (const [title, users] of lessonUsers) {
      lessonNames.set(title, users.size);
    }

    const latestOutcomeByUser = new Map<string, { at: number; entry: Record<string, unknown> }>();
    for (const row of outcomeRows) {
      const prior = latestOutcomeByUser.get(row.appUserId);
      if (!prior || row.recordedAtMs > prior.at) {
        latestOutcomeByUser.set(row.appUserId, {
          at: row.recordedAtMs,
          entry: asRecord(row.entry),
        });
      }
    }
    const outcomeDimensions = [
      "confidence",
      "knowledge",
      "mobility",
      "exerciseParticipation",
      "nutritionQuality",
      "sleepQuality",
      "stressLevel",
      "qualityOfLife",
    ];
    const outcomeAverages: Record<string, number | null> = {};
    for (const dimension of outcomeDimensions) {
      const values = [...latestOutcomeByUser.values()]
        .map((v) => finite(v.entry[dimension]))
        .filter((v): v is number => v !== null);
      outcomeAverages[dimension] = suppressAverage(values);
    }
    const falls = [...latestOutcomeByUser.values()]
      .map((v) => finite(v.entry.fallsLast90Days))
      .filter((v): v is number => v !== null);
    const fractures = [...latestOutcomeByUser.values()]
      .map((v) => finite(v.entry.fracturesLast12Months))
      .filter((v): v is number => v !== null);

    const lifetimeEvents = new Map<string, number | null>(
      lifetimeEventRows.map((r) => [
        r.kind,
        Number(r.users) >= minCohortSize ? Number(r.count) : null,
      ]),
    );
    const lifetimeCount = (kind: string): number | null =>
      lifetimeEvents.get(kind) ?? null;
    const safeSum = (...values: Array<number | null>): number | null =>
      values.every((value): value is number => value !== null)
        ? values.reduce((sum, value) => sum + value, 0)
        : null;

    res.json({
      generatedAt: new Date(now).toISOString(),
      privacy: {
        minCohortSize,
        consentedParticipants: suppressCount(consentedUserIds.length),
        suppressed: consentedUserIds.length < minCohortSize,
        consentVersion: "community-v1",
      },
      windows: {
        last7dStart: sevenDaysAgoDate.toISOString(),
        last30dStart: thirtyDaysAgoDate.toISOString(),
      },
      community: {
        opens: eventStats("community_tab_opened"),
        coachingRequests: eventStats("coaching_booking_requested"),
        expertSupportRequests: eventStats("expert_support_requested"),
      },
      productActivity: {
        learning: eventStats("lesson_completed"),
        boneBuddyMessages: eventStats("bone_buddy_message_sent"),
        boneBuddyOpens: eventStats("bone_buddy_opened"),
        breathing: eventStats("breathing_session_completed"),
        meditation: eventStats("meditation_session_completed"),
        nutrition: eventStats("nutrition_logged"),
        mealPlan: eventStats("meal_plan_completed"),
        supplements: eventStats("supplement_taken"),
        medications: eventStats("medication_taken"),
        dexa: eventStats("dexa_logged"),
        frax: eventStats("frax_logged"),
        activity: eventStats("activity_logged"),
        outcomes: eventStats("outcome_checkin_completed"),
      },
      wellbeingSupportNeeds7d: wellbeingMoodRows.map((r) => ({
        kind: Number(r.users) >= minCohortSize ? r.kind : "suppressed",
        mood: Number(r.users) >= minCohortSize ? r.mood : "suppressed",
        count: Number(r.users) >= minCohortSize ? Number(r.count) : null,
      })),
      topLearningPathways30d: topLearningPathways.map((r) => ({
        pathway: Number(r.users) >= minCohortSize ? r.pathway : "suppressed",
        count: Number(r.users) >= minCohortSize ? Number(r.count) : null,
      })),
      coachingDemand30d: coachingBySession.map((r) => ({
        sessionId: Number(r.users) >= minCohortSize ? r.sessionId : "suppressed",
        count: Number(r.users) >= minCohortSize ? Number(r.count) : null,
      })),
      expertDemand30d: expertByConsultant.map((r) => ({
        consultantId: Number(r.users) >= minCohortSize ? r.consultantId : "suppressed",
        count: Number(r.users) >= minCohortSize ? Number(r.count) : null,
      })),
      overview: {
        age: grouped(ageGroups),
        gender: grouped(genderGroups),
        condition: grouped(conditionGroups),
        country: grouped(countryGroups),
        goals: grouped(goalGroups),
        averageYearsSinceDiagnosis: suppressAverage(diagnosisYears),
      },
      boneHealth: {
        averageTScore: suppressAverage(tScores, tScoreUsers.size),
        averageFraxMajorRisk: suppressAverage(fraxMajor, fraxMajorUsers.size),
        averageFraxHipRisk: suppressAverage(fraxHip, fraxHipUsers.size),
        averageBmi: suppressAverage(bmis, bmiUsers.size),
        previousFractureReports: suppressCount(previousFractures),
        fractureLocations: grouped(fractureLocations),
        riskFactors: grouped(riskFactors),
        coexistingConditions: grouped(coexistGroups),
      },
      nutrition: Object.fromEntries(
        Object.entries(nutrientValues).map(([key, values]) => [
          key,
          {
            average30d: suppressAverage(values, nutrientUsers[key]!.size),
            loggedDays:
              nutrientUsers[key]!.size >= minCohortSize ? values.length : null,
          },
        ]),
      ),
      medicationAndSupplements: {
        commonSupplements: grouped(supplementNames),
        commonMedications: grouped(medicationNames),
        currentAdherenceRate:
          supplementRows.length >= minCohortSize
            ? Number((currentTaken / currentTracked).toFixed(3))
            : null,
        supplementTaken: eventStats("supplement_taken"),
        medicationTaken: eventStats("medication_taken"),
        medicationMissed: eventStats("medication_missed"),
      },
      exercise: {
        averageSteps30d: suppressAverage(steps, stepUsers.size),
        averageActiveMinutes30d: suppressAverage(
          activeMinutes,
          activeMinuteUsers.size,
        ),
        sessionTypes30d: grouped(exerciseTypes),
      },
      learningAndWellness: {
        mostCompletedLessons30d: grouped(lessonNames).slice(0, 10),
        leastCompletedLessons30d: grouped(lessonNames).reverse().slice(0, 10),
        totalLearningHours30d:
          new Set(learningRows.map((row) => row.appUserId)).size >= minCohortSize
            ? Number((learningDurationSec / 3600).toFixed(1))
            : null,
        averageCommunityStreak: suppressAverage(streaks),
      },
      outcomes: {
        participantCount: suppressCount(latestOutcomeByUser.size),
        averages: outcomeAverages,
        averageFallsLast90Days: suppressAverage(falls),
        averageFracturesLast12Months: suppressAverage(fractures),
      },
      impact: {
        learningSessions: lifetimeCount("lesson_completed"),
        wellnessSessions: safeSum(
          lifetimeCount("breathing_session_completed"),
          lifetimeCount("meditation_session_completed"),
        ),
        medicationsLogged: lifetimeCount("medication_taken"),
        supplementsLogged: lifetimeCount("supplement_taken"),
        exerciseLogs: lifetimeCount("activity_logged"),
        boneBuddyMessages: lifetimeCount("bone_buddy_message_sent"),
        outcomeCheckIns: lifetimeCount("outcome_checkin_completed"),
        achievementStates: suppressCount(gamificationRows.length),
      },
    });
  } catch (err) {
    req.log?.error({ err }, "admin community insights metrics failed");
    res.status(500).json({ error: "internal" });
  }
});

/* -------------------------------------------------------------------------- *
 * GET /admin/metrics/subscriptions
 * -------------------------------------------------------------------------- */
router.get("/admin/metrics/subscriptions", async (req, res): Promise<void> => {
  const u = await requireAdminUser(req, res);
  if (!u) return;

  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

    // All rows we may need to inspect. We over-select (no `isActive` filter)
    // because the new server-managed trial leaves rows with `isActive=true`
    // even after `trialEndsAt` has passed (lazy expiry). We re-derive the
    // effective active state in TS so the metrics agree with what the
    // mobile client sees via /subscription/me.
    const allRows = await db
      .select({
        appUserId: subscribersTable.appUserId,
        productId: subscribersTable.productId,
        isInTrial: subscribersTable.isInTrial,
        isActive: subscribersTable.isActive,
        willRenew: subscribersTable.willRenew,
        periodType: subscribersTable.periodType,
        trialSource: subscribersTable.trialSource,
        trialEndsAt: subscribersTable.trialEndsAt,
        billingIssueAt: subscribersTable.billingIssueAt,
        gracePeriodEndsAt: subscribersTable.gracePeriodEndsAt,
        createdAt: subscribersTable.createdAt,
      })
      .from(subscribersTable);

    let inTrialCount = 0;
    let willRenewCount = 0;
    let approxMrrCents = 0;
    let activeCount = 0;
    let trialsActiveCount = 0;
    let billingIssueCount = 0;
    const byTier = { trial: 0, plus: 0, premium: 0 };

    interface ProductBucket {
      productId: string | null;
      tier: string;
      activeCount: number;
      monthlyCents: number;
    }
    const productBuckets = new Map<string, ProductBucket>();

    for (const row of allRows) {
      // A server-managed trial is "in flight" only while trialEndsAt > now.
      // Once expired, the row drops out of every active/in-trial/by-tier
      // bucket — those users are functionally on the free tier.
      const serverTrialActive =
        row.trialSource === "server" &&
        !!row.trialEndsAt &&
        row.trialEndsAt.getTime() > now.getTime();
      const serverTrialExpired =
        row.trialSource === "server" &&
        !!row.trialEndsAt &&
        row.trialEndsAt.getTime() <= now.getTime();

      // Billing-issue grace: BILLING_ISSUE keeps `isActive=true` until
      // `gracePeriodEndsAt` elapses. Once it has, lazy-expire here so
      // the metric agrees with /subscription/me.
      const billingGraceOpen =
        !!row.billingIssueAt &&
        !!row.gracePeriodEndsAt &&
        row.gracePeriodEndsAt.getTime() > now.getTime();
      const billingGraceExpired =
        !!row.billingIssueAt &&
        !!row.gracePeriodEndsAt &&
        row.gracePeriodEndsAt.getTime() <= now.getTime();

      // Effective active state. A bare server-trial row whose window has
      // elapsed is NOT active. Everything else uses the stored flag.
      const effectivelyActive =
        row.isActive && !serverTrialExpired && !billingGraceExpired;
      if (!effectivelyActive) continue;

      if (billingGraceOpen) billingIssueCount += 1;

      activeCount += 1;
      if (serverTrialActive) trialsActiveCount += 1;
      if (row.isInTrial || serverTrialActive) inTrialCount += 1;
      if (row.willRenew) willRenewCount += 1;

      const tier = tierFromProductId(row.productId);
      if (row.isInTrial || serverTrialActive) {
        byTier.trial += 1;
      } else if (tier === "plus") {
        byTier.plus += 1;
      } else if (tier === "premium") {
        byTier.premium += 1;
      } else {
        // Active row, not on a trial, no recognised product → bucket as
        // trial (legacy behaviour, preserved for back-compat).
        byTier.trial += 1;
      }

      // Per-product revenue — only paying (non-trial) seats contribute,
      // matching the OpenAPI contract. Server trials count as trials, not
      // revenue, even though they sit on the snap_premium entitlement.
      if (!row.isInTrial && !serverTrialActive) {
        const productKey = row.productId ?? "__null__";
        const lineCents = monthlyPriceCents(row.productId, row.periodType);
        approxMrrCents += lineCents;
        const existing = productBuckets.get(productKey);
        if (existing) {
          existing.activeCount += 1;
          existing.monthlyCents += lineCents;
        } else {
          productBuckets.set(productKey, {
            productId: row.productId ?? null,
            tier: tier === "none" ? "unknown" : tier,
            activeCount: 1,
            monthlyCents: lineCents,
          });
        }
      }
    }

    const revenueByProduct = [...productBuckets.values()].sort(
      (a, b) => b.monthlyCents - a.monthlyCents,
    );

    // Cancellations + expirations in last 30d — see prior contract notes
    // re: OR semantics + de-duplication via row count.
    const churnWindow = or(
      gte(subscribersTable.cancelledAt, thirtyDaysAgo),
      and(
        gte(subscribersTable.expiresAt, thirtyDaysAgo),
        lt(subscribersTable.expiresAt, now),
      ),
    );
    const [cancRow] = await db
      .select({ value: count() })
      .from(subscribersTable)
      .where(churnWindow);
    const cancelledLast30d = Number(cancRow?.value ?? 0);

    const baseline = activeCount + cancelledLast30d;
    const churnRate30d = baseline > 0 ? cancelledLast30d / baseline : null;

    // Trial starts + conversion + expiry, all walked in a single pass so
    // they share the same row inspection.
    //
    // A "trial start" in the new (server-managed) world is any row whose
    // `subscribers.createdAt` falls in the window AND that shows at least
    // one trial signal:
    //   - currently a server trial (`trialSource = "server"`), OR
    //   - currently a store-side trial (`isInTrial = true`), OR
    //   - has since converted to a paying product (the RC webhook clears
    //     `trialSource` on conversion, so we recognise this case via the
    //     fact that the row is active and `productId` resolves to a known
    //     paying tier).
    // This excludes pre-migration legacy rows that never had a trial.
    let trialsStartedLast30d = 0;
    let trialsConvertedToPaidLast30d = 0;
    let trialsConvertedToPlusLast30d = 0;
    let trialsConvertedToPremiumLast30d = 0;
    let trialsExpiredWithoutConversionLast30d = 0;
    for (const row of allRows) {
      const startedInWindow =
        !!row.createdAt && row.createdAt.getTime() >= thirtyDaysAgo.getTime();

      const productTier = tierFromProductId(row.productId);
      const convertedToPayingProduct =
        row.isActive &&
        !row.isInTrial &&
        row.trialSource !== "server" &&
        (productTier === "plus" || productTier === "premium");

      if (
        startedInWindow &&
        (row.trialSource === "server" || row.isInTrial || convertedToPayingProduct)
      ) {
        trialsStartedLast30d += 1;
      }

      if (startedInWindow && convertedToPayingProduct) {
        trialsConvertedToPaidLast30d += 1;
        if (productTier === "plus") trialsConvertedToPlusLast30d += 1;
        else trialsConvertedToPremiumLast30d += 1;
      }

      // Server trial that has passed its end date within the last 30 days
      // AND has not been overwritten by a store-side trial / paid product.
      // The webhook clears `trialSource = "server"` on real RC writes, so
      // seeing it persist past expiry means "trial → free" leakage.
      if (
        row.trialSource === "server" &&
        row.trialEndsAt &&
        row.trialEndsAt.getTime() <= now.getTime() &&
        row.trialEndsAt.getTime() >= thirtyDaysAgo.getTime()
      ) {
        trialsExpiredWithoutConversionLast30d += 1;
      }
    }

    const trialToPaidRate =
      trialsStartedLast30d > 0
        ? trialsConvertedToPaidLast30d / trialsStartedLast30d
        : null;

    res.json({
      activeCount,
      inTrialCount,
      willRenewCount,
      cancelledLast30d,
      churnRate30d,
      approxMrrCents,
      approxArrCents: approxMrrCents * 12,
      trialsStartedLast30d,
      trialsActiveCount,
      trialsConvertedToPaidLast30d,
      trialsConvertedToPlusLast30d,
      trialsConvertedToPremiumLast30d,
      trialsExpiredWithoutConversionLast30d,
      billingIssueCount,
      // DEPRECATED alias kept so admin dashboard tiles keep rendering
      // until they migrate to `trialsConvertedToPaidLast30d`.
      paidConvertedLast30d: trialsConvertedToPaidLast30d,
      trialToPaidRate,
      byTier,
      revenueByProduct,
    });
  } catch (err) {
    req.log?.error({ err }, "admin subscription metrics failed");
    res.status(500).json({ error: "internal" });
  }
});

/* -------------------------------------------------------------------------- *
 * GET /admin/audit
 *
 * Paginated, reverse-chronological audit trail of privileged admin actions
 * and self-service GDPR operations. Rows are append-only and survive account
 * deletion so the trail stays intact for security reviews.
 * Supports query params:
 *   limit          — rows per page, default 50, max 200
 *   offset         — row offset, default 0
 *   action         — exact match on action column
 *   targetAppUserId — exact match on target_app_user_id column
 *   actorAppUserId  — exact match on actor_app_user_id column
 * -------------------------------------------------------------------------- */
router.get("/admin/audit", async (req, res): Promise<void> => {
  const u = await requireAdminUser(req, res);
  if (!u) return;

  const parsed = GetAdminAuditQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { limit, offset, action, targetAppUserId, actorAppUserId, from, to } = parsed.data;
  const effectiveLimit = limit ?? 50;
  const effectiveOffset = offset ?? 0;

  const conditions = [];
  if (action) conditions.push(eq(auditEventsTable.action, action));
  if (targetAppUserId)
    conditions.push(eq(auditEventsTable.targetAppUserId, targetAppUserId));
  if (actorAppUserId)
    conditions.push(eq(auditEventsTable.actorAppUserId, actorAppUserId));
  if (from) conditions.push(gte(auditEventsTable.createdAt, from));
  if (to) conditions.push(lte(auditEventsTable.createdAt, to));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  try {

    const [rows, totalRow] = await Promise.all([
      db
        .select()
        .from(auditEventsTable)
        .where(where)
        .orderBy(desc(auditEventsTable.createdAt))
        .limit(effectiveLimit)
        .offset(effectiveOffset),
      db.select({ value: count() }).from(auditEventsTable).where(where),
    ]);

    res.json({
      items: rows.map((r) => ({
        id: r.id,
        actorAppUserId: r.actorAppUserId,
        targetAppUserId: r.targetAppUserId,
        action: r.action,
        payload: r.payload ?? {},
        createdAt: r.createdAt.toISOString(),
      })),
      total: Number(totalRow[0]?.value ?? 0),
      limit: effectiveLimit,
      offset: effectiveOffset,
    });
  } catch (err) {
    req.log?.error({ err }, "GET /admin/audit failed");
    res.status(500).json({ error: "internal" });
  }
});

/* -------------------------------------------------------------------------- *
 * GET /admin/feedback
 * -------------------------------------------------------------------------- */
router.get("/admin/feedback", async (req, res): Promise<void> => {
  const u = await requireAdminUser(req, res);
  if (!u) return;

  const parsed = GetAdminFeedbackQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { limit, feedbackType, tier, testimonialOnly } = parsed.data;
  const effectiveLimit = limit ?? 100;

  try {
    const conds = [];
    if (feedbackType) conds.push(eq(feedbackTable.feedbackType, feedbackType));
    if (tier) conds.push(eq(feedbackTable.tier, tier));
    if (testimonialOnly === true)
      conds.push(eq(feedbackTable.allowTestimonialUse, true));
    const where =
      conds.length === 0
        ? undefined
        : conds.length === 1
          ? conds[0]
          : and(...conds);

    const rows = await db
      .select()
      .from(feedbackTable)
      .where(where)
      .orderBy(desc(feedbackTable.createdAt))
      .limit(effectiveLimit);

    const [totalRow] = await db
      .select({ value: count() })
      .from(feedbackTable)
      .where(where);

    res.json({
      items: rows.map((row) => ({
        id: row.id,
        appUserId: row.appUserId,
        tier: row.tier,
        feedbackType: row.feedbackType,
        message: row.message,
        tags: Array.isArray(row.tags) ? row.tags : [],
        allowTestimonialUse: row.allowTestimonialUse,
        platform: row.platform,
        appVersion: row.appVersion,
        createdAt: row.createdAt.toISOString(),
      })),
      total: Number(totalRow?.value ?? 0),
    });
  } catch (err) {
    req.log?.error({ err }, "admin feedback list failed");
    res.status(500).json({ error: "internal" });
  }
});

/* -------------------------------------------------------------------------- *
 * GET /admin/users/lookup
 * -------------------------------------------------------------------------- */

interface RecentSessionPayload {
  kind: string;
  sessionName: string | null;
  durationSec: number | null;
  mood: string | null;
  completedAt: string;
}

function readSessionEntry(
  raw: unknown,
  fallbackMs: number,
): RecentSessionPayload {
  const entry =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const kind =
    typeof entry.kind === "string" && entry.kind.length > 0
      ? entry.kind
      : "other";
  const sessionName =
    typeof entry.sessionName === "string" ? entry.sessionName : null;
  const durationSec =
    typeof entry.durationSec === "number" && Number.isFinite(entry.durationSec)
      ? Math.trunc(entry.durationSec)
      : null;
  const mood = typeof entry.mood === "string" ? entry.mood : null;
  const completedAtMs =
    typeof entry.completedAt === "number" && Number.isFinite(entry.completedAt)
      ? entry.completedAt
      : fallbackMs;
  return {
    kind,
    sessionName,
    durationSec,
    mood,
    completedAt: new Date(completedAtMs).toISOString(),
  };
}

/* -------------------------------------------------------------------------- *
 * GET /admin/users
 *
 * Paginated list of every user for the admin "All Users" table. Supports an
 * optional case-insensitive `search` (email or display name) plus
 * `limit`/`offset`. Returns `{ items, total }` so the UI can paginate.
 * -------------------------------------------------------------------------- */
router.get("/admin/users", async (req, res): Promise<void> => {
  const u = await requireAdminUser(req, res);
  if (!u) return;

  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const search =
    typeof req.query.search === "string" ? req.query.search.trim() : "";

  try {
    const escaped = search.replace(/[\\%_]/g, "\\$&");
    const where = search
      ? or(
          ilike(usersTable.email, `%${escaped}%`),
          ilike(usersTable.displayName, `%${escaped}%`),
        )
      : undefined;

    const [totalRow] = await db
      .select({ value: count() })
      .from(usersTable)
      .where(where);
    const total = Number(totalRow?.value ?? 0);

    const rows = await db
      .select({
        appUserId: usersTable.appUserId,
        clerkUserId: usersTable.clerkUserId,
        email: usersTable.email,
        displayName: usersTable.displayName,
        isAdmin: usersTable.isAdmin,
        isTester: usersTable.isTester,
        deletedAt: usersTable.deletedAt,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(where)
      .orderBy(desc(usersTable.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({
      items: rows.map((r) => ({
        appUserId: r.appUserId,
        clerkUserId: r.clerkUserId,
        email: r.email,
        displayName: r.displayName,
        isAdmin: r.isAdmin,
        isTester: r.isTester,
        deletedAt:
          r.deletedAt instanceof Date
            ? r.deletedAt.toISOString()
            : (r.deletedAt ?? null),
        createdAt:
          r.createdAt instanceof Date
            ? r.createdAt.toISOString()
            : (r.createdAt ?? null),
      })),
      total,
    });
  } catch (err) {
    req.log.error({ err }, "admin/users list failed");
    res.status(500).json({ error: "internal_error" });
  }
});

router.get("/admin/users/lookup", async (req, res): Promise<void> => {
  const u = await requireAdminUser(req, res);
  if (!u) return;

  const parsed = GetAdminUserLookupQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.trim();
  // Escape LIKE metacharacters — see prior comment in earlier revisions
  // and the "wildcards stay literal" test in admin.test.ts.
  const escapedEmail = email.replace(/[\\%_]/g, "\\$&");

  try {
    const [userRow] = await db
      .select()
      .from(usersTable)
      .where(ilike(usersTable.email, escapedEmail))
      .limit(1);

    if (!userRow) {
      res.status(404).json({ error: "not found" });
      return;
    }

    const [subRow] = await db
      .select()
      .from(subscribersTable)
      .where(eq(subscribersTable.appUserId, userRow.appUserId))
      .limit(1);

    // Pull the user_profile row so the lookup card can show the profile
    // photo, country and timezone the user set in the mobile app.
    const [profileRow] = await db
      .select({
        avatar: userProfileTable.avatar,
        country: userProfileTable.country,
        timezone: userProfileTable.timezone,
      })
      .from(userProfileTable)
      .where(eq(userProfileTable.appUserId, userRow.appUserId))
      .limit(1);

    const [wellbeingCountRow] = await db
      .select({ value: count() })
      .from(wellbeingEntriesTable)
      .where(eq(wellbeingEntriesTable.appUserId, userRow.appUserId));
    const [eventsCountRow] = await db
      .select({ value: count() })
      .from(interactionEventsTable)
      .where(eq(interactionEventsTable.appUserId, userRow.appUserId));
    const [feedbackCountRow] = await db
      .select({ value: count() })
      .from(feedbackTable)
      .where(eq(feedbackTable.appUserId, userRow.appUserId));

    // lastActiveAt — most recent receivedAt across interaction_events.
    const lastEventRows = await db
      .select({ receivedAt: interactionEventsTable.receivedAt })
      .from(interactionEventsTable)
      .where(eq(interactionEventsTable.appUserId, userRow.appUserId))
      .orderBy(desc(interactionEventsTable.receivedAt))
      .limit(1);
    const lastEvent = lastEventRows[0];
    const lastActiveAt =
      lastEvent && lastEvent.receivedAt instanceof Date
        ? lastEvent.receivedAt.toISOString()
        : null;

    // Recent sessions (last 30d, top 10 newest).
    const thirtyDaysAgoMs = Date.now() - 30 * DAY_MS;
    const sessionRows = await db
      .select({
        entry: wellbeingEntriesTable.entry,
        completedAtMs: wellbeingEntriesTable.completedAtMs,
      })
      .from(wellbeingEntriesTable)
      .where(
        and(
          eq(wellbeingEntriesTable.appUserId, userRow.appUserId),
          gte(wellbeingEntriesTable.completedAtMs, thirtyDaysAgoMs),
        ),
      )
      .orderBy(desc(wellbeingEntriesTable.completedAtMs))
      .limit(10);
    const recentSessions = sessionRows.map((row) =>
      readSessionEntry(row.entry, Number(row.completedAtMs ?? 0)),
    );

    // Recent feedback (top 10 newest).
    const fbRows = await db
      .select()
      .from(feedbackTable)
      .where(eq(feedbackTable.appUserId, userRow.appUserId))
      .orderBy(desc(feedbackTable.createdAt))
      .limit(10);
    const recentFeedback = fbRows.map((row) => ({
      id: row.id,
      feedbackType: row.feedbackType,
      tier: row.tier,
      message: row.message,
      allowTestimonialUse: row.allowTestimonialUse,
      createdAt: row.createdAt.toISOString(),
    }));

    res.json({
      user: {
        appUserId: userRow.appUserId,
        clerkUserId: userRow.clerkUserId,
        email: userRow.email,
        displayName: userRow.displayName,
        isAdmin: userRow.isAdmin,
        createdAt: userRow.createdAt.toISOString(),
        lastActiveAt,
        avatar: profileRow?.avatar ?? null,
        country: profileRow?.country ?? null,
        timezone: profileRow?.timezone ?? null,
      },
      subscription: subRow
        ? {
            entitlementId: subRow.entitlementId,
            isActive: subRow.isActive,
            isInTrial: subRow.isInTrial,
            willRenew: subRow.willRenew,
            productId: subRow.productId,
            periodType: subRow.periodType,
            store: subRow.store,
            expiresAt: subRow.expiresAt
              ? subRow.expiresAt.toISOString()
              : null,
            cancelledAt: subRow.cancelledAt
              ? subRow.cancelledAt.toISOString()
              : null,
          }
        : null,
      counts: {
        wellbeingEntries: Number(wellbeingCountRow?.value ?? 0),
        interactionEvents: Number(eventsCountRow?.value ?? 0),
        feedbackSubmissions: Number(feedbackCountRow?.value ?? 0),
      },
      recentSessions,
      recentFeedback,
    });
  } catch (err) {
    req.log?.error({ err }, "admin user lookup failed");
    res.status(500).json({ error: "internal" });
  }
});

/* -------------------------------------------------------------------------- *
 * POST /admin/test-accounts
 *
 * Provision a tester account that the staging environment seeds so QA can
 * walk through onboarding + paywall + Bone Buddy without juggling real
 * Clerk accounts. The body specifies an email + display name and an
 * optional clerkUserId (when the QA account already exists in Clerk and
 * we just need to flip `isTester`).
 *
 * Idempotent on `email`: re-issuing the call upgrades an existing row
 * to `isTester=true` rather than 409-ing — staging redeploys repeatedly
 * call this and we want the contract to be "after this call, the row
 * exists with isTester=true".
 * -------------------------------------------------------------------------- */
router.post("/admin/test-accounts", async (req, res): Promise<void> => {
  // Staging-only guardrail. Mirrors `POST /api/me/reset`: production
  // deployments never set `SNAP_LIFE_ENV=staging`, so this endpoint
  // 404s in prod even for admins. Tester provisioning is a staging
  // feature; the equivalent production workflow is to use Clerk's own
  // user management UI.
  if (process.env.SNAP_LIFE_ENV !== "staging") {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const u = await requireAdminUser(req, res);
  if (!u) return;

  const body = req.body as
    | { email?: unknown; displayName?: unknown; clerkUserId?: unknown }
    | undefined;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const displayName =
    typeof body?.displayName === "string" ? body.displayName.trim() : "";
  const clerkUserId =
    typeof body?.clerkUserId === "string" && body.clerkUserId.trim().length > 0
      ? body.clerkUserId.trim()
      : null;

  if (!email || email.length > 320 || !email.includes("@")) {
    res.status(400).json({ error: "email_required" });
    return;
  }
  if (!displayName || displayName.length > 200) {
    res.status(400).json({ error: "displayName_required" });
    return;
  }

  try {
    // First try to upgrade an existing row that matches email or clerk id.
    const matchClause = clerkUserId
      ? or(eq(usersTable.email, email), eq(usersTable.clerkUserId, clerkUserId))
      : eq(usersTable.email, email);
    const [existing] = await db
      .select({
        appUserId: usersTable.appUserId,
        isTester: usersTable.isTester,
      })
      .from(usersTable)
      .where(matchClause)
      .limit(1);

    if (existing) {
      await db.transaction(async (tx) => {
        await tx
          .update(usersTable)
          .set({
            isTester: true,
            email,
            displayName,
            ...(clerkUserId ? { clerkUserId } : {}),
            // If the row was previously soft-deleted, reactivate it so the
            // tester can log back in. The 30d hard-delete window is a
            // user-facing recovery feature; admins always trump it.
            deletedAt: null,
            hardDeleteAfter: null,
            updatedAt: new Date(),
          })
          .where(eq(usersTable.appUserId, existing.appUserId));
        await tx.insert(auditEventsTable).values({
          actorAppUserId: u.appUserId,
          targetAppUserId: existing.appUserId,
          action: "test_account_provisioned",
          payload: { email, displayName, created: false },
        });
      });
      res.json({
        appUserId: existing.appUserId,
        isTester: true,
        created: false,
      });
      void insertAuditLog({
        actorAdminId: u.appUserId,
        actorAdminEmail: u.email,
        targetUserId: existing.appUserId,
        action: "admin_provision_tester",
        metadata: { email, displayName, created: false },
      });
      return;
    }

    // Otherwise mint a fresh row with a synthesised app user id (the
    // Clerk session, when the tester logs in, will rendezvous via the
    // matching email or clerkUserId we stored here).
    const appUserId = `tester_${randomBytes(8).toString("hex")}`;
    await db.transaction(async (tx) => {
      await tx.insert(usersTable).values({
        appUserId,
        clerkUserId,
        email,
        displayName,
        isAdmin: false,
        isTester: true,
      });
      await tx.insert(auditEventsTable).values({
        actorAppUserId: u.appUserId,
        targetAppUserId: appUserId,
        action: "test_account_provisioned",
        payload: { email, displayName, created: true },
      });
    });
    res.status(201).json({ appUserId, isTester: true, created: true });
    void insertAuditLog({
      actorAdminId: u.appUserId,
      actorAdminEmail: u.email,
      targetUserId: appUserId,
      action: "admin_provision_tester",
      metadata: { email, displayName, created: true },
    });
  } catch (err) {
    req.log?.error({ err }, "POST /admin/test-accounts failed");
    res.status(500).json({ error: "internal" });
  }
});

/* -------------------------------------------------------------------------- *
 * POST /admin/users/:clerkId/sign-in-token
 *
 * Generates a Clerk sign-in token for the given Clerk user ID. The token
 * bypasses all authentication requirements (including Force MFA) and is
 * valid for 30 days. Intended for QA / test-account access when the
 * Clerk dashboard is unavailable or MFA blocks the normal sign-in flow.
 * -------------------------------------------------------------------------- */
router.post(
  "/admin/users/:clerkId/sign-in-token",
  async (req, res): Promise<void> => {
    const u = await requireAdminUser(req, res);
    if (!u) return;

    const clerkId = req.params.clerkId;
    if (!clerkId || typeof clerkId !== "string") {
      res.status(400).json({ error: "clerkId_required" });
      return;
    }

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      req.log?.error("CLERK_SECRET_KEY not set");
      res.status(500).json({ error: "internal" });
      return;
    }

    try {
      const clerkRes = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ user_id: clerkId }),
      });

      if (!clerkRes.ok) {
        const body = await clerkRes.text();
        req.log?.error({ status: clerkRes.status, body }, "Clerk sign_in_token failed");
        res.status(502).json({ error: "clerk_error" });
        return;
      }

      // Resolve the target's appUserId before responding so the audit row
      // always carries a real app-level identifier. The lookup happens after
      // the Clerk API call succeeds but before we respond so that we can log
      // a warning (and still record the event) if the clerkId has no matching
      // row in our users table (e.g. a Clerk-only account not yet synced).
      const [targetUser] = await db
        .select({ appUserId: usersTable.appUserId })
        .from(usersTable)
        .where(eq(usersTable.clerkUserId, clerkId))
        .limit(1);
      const targetAppUserId = targetUser?.appUserId ?? `clerk:${clerkId}`;
      if (!targetUser) {
        req.log?.warn(
          { clerkId },
          "sign-in-token: no users row found for clerkId; audit will use clerk: fallback",
        );
      }

      const data = (await clerkRes.json()) as { token: string; url: string };

      db.insert(auditEventsTable)
        .values({
          actorAppUserId: u.appUserId,
          targetAppUserId,
          action: "sign_in_token_generated",
          payload: { targetClerkId: clerkId },
        })
        .catch((auditErr: unknown) => {
          req.log?.error(
            { err: auditErr, actorAppUserId: u.appUserId, targetAppUserId },
            "sign-in-token: failed to write audit_events row",
          );
        });

      res.json({ token: data.token, url: data.url });
    } catch (err) {
      req.log?.error({ err }, "sign-in-token generation failed");
      res.status(500).json({ error: "internal" });
    }
  },
);

/* -------------------------------------------------------------------------- *
 * DELETE /admin/users/:id
 *
 * Admin-gated GDPR delete. Reuses the same soft-delete cascade as
 * `DELETE /me` (`softDeleteAccount`) so the runbook's section 7 promise —
 * "fast path for honouring a manual GDPR delete request" — is identical
 * regardless of whether the user or an admin triggered it.
 * -------------------------------------------------------------------------- */
router.delete("/admin/users/:id", async (req, res): Promise<void> => {
  const u = await requireAdminUser(req, res);
  if (!u) return;

  const targetId = req.params.id;
  if (!targetId || typeof targetId !== "string") {
    res.status(400).json({ error: "id_required" });
    return;
  }

  // Refuse to let an admin delete their own account through this surface;
  // the user-facing `DELETE /me` is the right path for that and avoids
  // the awkward post-delete state where the admin's own session is
  // immediately revoked mid-request.
  if (targetId === u.appUserId) {
    res.status(400).json({ error: "cannot_delete_self" });
    return;
  }

  try {
    const result = await softDeleteAccount(targetId, u.appUserId, req.log);
    if (!result.found) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(200).json({
      ok: true,
      appUserId: targetId,
      deletedAt: result.deletedAt,
      hardDeleteAfter: result.hardDeleteAfter,
      confirmationEmailQueued: result.confirmationEmailQueued,
    });
    void insertAuditLog({
      actorAdminId: u.appUserId,
      actorAdminEmail: u.email,
      targetUserId: targetId,
      action: "admin_delete_user",
      metadata: {
        deletedAt: result.deletedAt,
        hardDeleteAfter: result.hardDeleteAfter,
      },
    });
  } catch (err) {
    req.log?.error(
      { err, targetId },
      "DELETE /admin/users/:id failed",
    );
    res.status(500).json({ error: "internal" });
  }
});

/* -------------------------------------------------------------------------- *
 * POST /admin/users/:id/hard-delete   (STAGING ONLY)
 *
 * Immediately hard-delete a specific user, bypassing the normal 30-day
 * grace window. Active only when `SNAP_LIFE_ENV=staging` — returns 404
 * in production, just like `POST /admin/test-accounts`.
 *
 * Purpose: lets the nightly E2E test verify that `audit_logs` rows survive
 * a hard-delete without waiting 30 days. The cascade is identical to what
 * `hardDeleteWorker` does — `audit_logs` and `audit_events` are
 * intentionally excluded from the wipe.
 * -------------------------------------------------------------------------- */
router.post("/admin/users/:id/hard-delete", async (req, res): Promise<void> => {
  if (process.env.SNAP_LIFE_ENV !== "staging") {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const u = await requireAdminUser(req, res);
  if (!u) return;

  const targetId = req.params.id;
  if (!targetId || typeof targetId !== "string") {
    res.status(400).json({ error: "id_required" });
    return;
  }

  if (targetId === u.appUserId) {
    res.status(400).json({ error: "cannot_delete_self" });
    return;
  }

  try {
    const result = await forceHardDeleteUser(targetId);
    if (!result.found) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ ok: true, appUserId: targetId });
  } catch (err) {
    req.log?.error({ err, targetId }, "POST /admin/users/:id/hard-delete failed");
    res.status(500).json({ error: "internal" });
  }
});

/* -------------------------------------------------------------------------- *
 * GET /admin/audit-logs
 *
 * Paginated, filterable read-only view of the audit_logs table.
 * Supports query params:
 *   limit       — rows per page, default 50, max 200
 *   offset      — row offset, default 0
 *   action      — exact match on action column
 *   targetUserId — exact match on target_user_id column
 * -------------------------------------------------------------------------- */
router.get("/admin/audit-logs", async (req, res): Promise<void> => {
  const u = await requireAdminUser(req, res);
  if (!u) return;

  const rawLimit  = Number(req.query.limit  ?? 50);
  const rawOffset = Number(req.query.offset ?? 0);
  const limit  = Math.min(Math.max(1, isNaN(rawLimit)  ? 50 : rawLimit),  200);
  const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);

  const filterAction =
    typeof req.query.action === "string" && req.query.action.trim()
      ? req.query.action.trim()
      : null;
  const filterTarget =
    typeof req.query.targetUserId === "string" && req.query.targetUserId.trim()
      ? req.query.targetUserId.trim()
      : null;

  try {
    const conds = [];
    if (filterAction) conds.push(eq(auditLogsTable.action, filterAction));
    if (filterTarget) conds.push(eq(auditLogsTable.targetUserId, filterTarget));
    const where =
      conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);

    const [items, totalRow] = await Promise.all([
      db
        .select({
          id: auditLogsTable.id,
          actorAdminId: auditLogsTable.actorAdminId,
          actorAdminEmail: auditLogsTable.actorAdminEmail,
          targetUserId: auditLogsTable.targetUserId,
          action: auditLogsTable.action,
          metadata: auditLogsTable.metadata,
          createdAt: auditLogsTable.createdAt,
          targetUserExists: sql<boolean>`(${usersTable.appUserId} IS NOT NULL)`,
        })
        .from(auditLogsTable)
        .leftJoin(usersTable, eq(auditLogsTable.targetUserId, usersTable.appUserId))
        .where(where)
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ value: count() }).from(auditLogsTable).where(where),
    ]);

    res.json({
      items: items.map((r) => ({
        id: r.id,
        actorAdminId: r.actorAdminId,
        actorAdminEmail: r.actorAdminEmail,
        targetUserId: r.targetUserId,
        action: r.action,
        metadata: r.metadata ?? null,
        createdAt: r.createdAt.toISOString(),
        targetUserDeleted: r.targetUserId !== null && !r.targetUserExists,
      })),
      total: Number(totalRow[0]?.value ?? 0),
    });
  } catch (err) {
    req.log?.error({ err }, "GET /admin/audit-logs failed");
    res.status(500).json({ error: "internal" });
  }
});

export default router;
