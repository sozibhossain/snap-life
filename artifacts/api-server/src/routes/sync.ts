/**
 * /api/sync/* — server-side persistence for per-user app state.
 *
 * Each per-user document the SNAP Life mobile app cares about (profile +
 * preferences, daily nutrition / activity / meal-plan rows, supplement
 * state, gamification state, and the append-only wellbeing & assessment
 * histories) gets a single endpoint here. The mobile client treats
 * AsyncStorage as the local source of truth, write-throughs land here in
 * the background, and on launch we pull the full snapshot to reconcile
 * across devices. Conflict policy is last-write-wins on the per-row
 * `updated_at_ms` we receive from the client (we still always write — the
 * field is purely diagnostic) so we don't need merge logic for the offline
 * queue.
 *
 * Identity is sourced exclusively from the bearer token via
 * `requireUserAuth`. There is no user-controlled identifier in any URL or
 * body — the `date` path param identifies the day, never the user.
 */

import { Router, type IRouter } from "express";
import {
  db,
  userProfileTable,
  nutritionLogsTable,
  activityLogsTable,
  mealPlanDaysTable,
  wellbeingEntriesTable,
  gamificationStateTable,
  assessmentResultsTable,
  supplementStateTable,
  outcomeEntriesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  PutSyncProfileBody,
  PutSyncNutritionDayBody,
  PutSyncNutritionDayParams,
  PutSyncActivityDayBody,
  PutSyncActivityDayParams,
  PutSyncMealPlanDayBody,
  PutSyncMealPlanDayParams,
  PutSyncSupplementsBody,
  PutSyncGamificationBody,
  PostSyncWellbeingEntryBody,
  PostSyncAssessmentBody,
} from "@workspace/api-zod";
import { requireUserAuth } from "../lib/auth";
import { isValidTimeZone } from "./events";

/** ISO 3166-1 alpha-2: two uppercase A-Z letters. */
const ISO_COUNTRY_RE = /^[A-Z]{2}$/;

// Structural alias for the generated zod schemas — we only call
// `safeParse` so we don't need to depend on the `zod` package directly
// from the server (the schemas come transitively through @workspace/api-zod).
interface ZodLike {
  safeParse(value: unknown):
    | { success: true; data: unknown }
    | { success: false; error: { issues: { message?: string }[] } };
}

const router: IRouter = Router();

// 1 MiB ceiling. Sized to accommodate a base64-encoded profile photo
// (`user.avatar` is a `data:image/...;base64,...` URI written to
// `user_profile.avatar`). A 0.6-quality 1024×1024 JPEG is typically
// 200–300 KB → ~400 KB base64, leaving comfortable headroom for the
// rest of the profile payload while still being small enough to keep
// any malicious blob out of `jsonb` columns.
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Run a generated Zod schema against the request body, capping the
 * serialised size first so a misbehaving (or malicious) client cannot
 * push multi-MB blobs into our jsonb columns. Returns either the
 * validated payload or sends a 400 and returns null.
 */
function validateOrReject<T>(
  body: unknown,
  schema: ZodLike,
  res: import("express").Response,
): T | null {
  let serialised: string;
  try {
    serialised = JSON.stringify(body ?? null);
  } catch {
    res.status(400).json({ error: "body not serialisable" });
    return null;
  }
  if (serialised.length > MAX_BODY_BYTES) {
    res.status(400).json({ error: "body too large" });
    return null;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "invalid body" });
    return null;
  }
  return parsed.data as T;
}

/**
 * PUT /sync/profile — replace the user's profile row.
 *
 * Stores the entire StoredProfile-shaped object the mobile client owns
 * (name / age / gender / condition / xp / level / preferences …) as a
 * jsonb. Server-side fields (`level`, `xp`, …) are also normalised into
 * typed columns where the client provides them so future analytics can
 * query without unpacking the blob. We never reject "unknown" extra
 * fields — they ride along inside `preferences` so the client can roll
 * out new profile attributes without an API change.
 */
router.put("/sync/profile", async (req, res) => {
  const appUserId = await requireUserAuth(req, res);
  if (!appUserId) return;
  const body = validateOrReject<{
    profile: Record<string, unknown>;
    updatedAtMs?: number;
  }>(req.body, PutSyncProfileBody, res);
  if (!body) return;

  const p = body.profile;
  const pickStr = (k: string) =>
    typeof p[k] === "string" ? (p[k] as string) : null;
  const pickInt = (k: string) =>
    typeof p[k] === "number" && Number.isFinite(p[k]) ? Math.floor(p[k] as number) : null;
  const pickStringArray = (k: string, max = 20) =>
    Array.isArray(p[k])
      ? (p[k] as unknown[])
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim().slice(0, 80))
          .filter(Boolean)
          .slice(0, max)
      : [];
  const fractureHistory = Array.isArray(p.fractureHistory)
    ? (p.fractureHistory as unknown[])
        .filter(
          (v): v is { year?: unknown; location?: unknown } =>
            typeof v === "object" && v !== null,
        )
        .map((v) => ({
          year:
            typeof v.year === "number" && Number.isFinite(v.year)
              ? Math.floor(v.year)
              : null,
          location:
            typeof v.location === "string"
              ? v.location.trim().slice(0, 60)
              : "other",
        }))
        .slice(0, 30)
    : [];

  // Locale fields are validated even on the loosely-typed sync path
  // so the canonical /api/me/profile contract isn't bypassable by
  // pushing junk through /sync/profile. Invalid values are dropped
  // (treated as "not set") rather than rejecting the whole upsert,
  // which would lose the rest of the profile blob.
  const rawCountry = pickStr("country");
  const country =
    rawCountry && ISO_COUNTRY_RE.test(rawCountry) ? rawCountry : null;
  const rawTz = pickStr("timezone");
  const timezone = rawTz && isValidTimeZone(rawTz) ? rawTz : null;

  // Carry typed scalars into the dedicated columns AND keep the full
  // blob in `preferences` so the client's roundtrip is loss-free even
  // for fields we haven't typed yet.
  const row = {
    appUserId,
    name: pickStr("name"),
    email: pickStr("email"),
    avatar: pickStr("avatar"),
    age: pickInt("age"),
    gender: pickStr("gender"),
    condition: pickStr("condition"),
    joinedAt: pickStr("joinedAt"),
    country,
    timezone,
    diagnosisYear: pickInt("diagnosisYear"),
    goals: pickStringArray("goals"),
    coexistingConditions: pickStringArray("coexistingConditions"),
    fractureHistory,
    level: pickInt("level") ?? 1,
    xp: pickInt("xp") ?? 0,
    xpToNextLevel: pickInt("xpToNextLevel") ?? 500,
    streakDays: pickInt("streakDays") ?? 0,
    totalPoints: pickInt("totalPoints") ?? 0,
    preferences: p,
    updatedAtMs: body.updatedAtMs ?? null,
    updatedAt: new Date(),
  };

  try {
    await db
      .insert(userProfileTable)
      .values(row)
      .onConflictDoUpdate({
        target: userProfileTable.appUserId,
        set: {
          name: row.name,
          email: row.email,
          avatar: row.avatar,
          age: row.age,
          gender: row.gender,
          condition: row.condition,
          joinedAt: row.joinedAt,
          country: row.country,
          timezone: row.timezone,
          diagnosisYear: row.diagnosisYear,
          goals: row.goals,
          coexistingConditions: row.coexistingConditions,
          fractureHistory: row.fractureHistory,
          level: row.level,
          xp: row.xp,
          xpToNextLevel: row.xpToNextLevel,
          streakDays: row.streakDays,
          totalPoints: row.totalPoints,
          preferences: row.preferences,
          updatedAtMs: row.updatedAtMs,
          updatedAt: row.updatedAt,
        },
      });
    res.json({ ok: true });
  } catch (err) {
    req.log?.error({ err }, "sync/profile upsert failed");
    res.status(500).json({ error: "internal" });
  }
});

/**
 * Shared per-day upsert helper — every per-(user, day) endpoint
 * (nutrition / activity / meal-plan) collapses to "validate the date,
 * validate the body, upsert keyed on (appUserId, day)". Keeping this in
 * one place means a future schema tweak (e.g. adding a sync version
 * marker) lands once.
 */
async function putDay(
  req: import("express").Request,
  res: import("express").Response,
  table:
    | typeof nutritionLogsTable
    | typeof activityLogsTable
    | typeof mealPlanDaysTable,
  payloadCol: "log" | "payload",
  bodySchema: ZodLike,
  paramsSchema: ZodLike,
) {
  const appUserId = await requireUserAuth(req, res);
  if (!appUserId) return;
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "invalid date" });
    return;
  }
  const day = (params.data as { date: string }).date;
  const body = validateOrReject<{
    data: Record<string, unknown>;
    updatedAtMs?: number;
  }>(req.body, bodySchema, res);
  if (!body) return;

  const values = {
    appUserId,
    day,
    [payloadCol]: body.data,
    updatedAtMs: body.updatedAtMs ?? null,
    updatedAt: new Date(),
  } as typeof table.$inferInsert;

  const setClause = {
    [payloadCol]: body.data,
    updatedAtMs: body.updatedAtMs ?? null,
    updatedAt: new Date(),
  } as Partial<typeof table.$inferInsert>;

  try {
    await db
      .insert(table)
      .values(values)
      .onConflictDoUpdate({
        target: [table.appUserId, table.day],
        set: setClause,
      });
    res.json({ ok: true });
  } catch (err) {
    req.log?.error({ err, table: payloadCol }, "sync per-day upsert failed");
    res.status(500).json({ error: "internal" });
  }
}

router.put("/sync/nutrition/:date", (req, res) =>
  putDay(
    req,
    res,
    nutritionLogsTable,
    "log",
    PutSyncNutritionDayBody,
    PutSyncNutritionDayParams,
  ),
);

router.put("/sync/activity/:date", (req, res) =>
  putDay(
    req,
    res,
    activityLogsTable,
    "log",
    PutSyncActivityDayBody,
    PutSyncActivityDayParams,
  ),
);

router.put("/sync/meal-plan/:date", (req, res) =>
  putDay(
    req,
    res,
    mealPlanDaysTable,
    "payload",
    PutSyncMealPlanDayBody,
    PutSyncMealPlanDayParams,
  ),
);

/**
 * Shared full-state upsert helper for the singleton-per-user blobs
 * (supplements, gamification). Both replace the entire `state` jsonb
 * with whatever the client just sent — last-write-wins.
 */
async function putState(
  req: import("express").Request,
  res: import("express").Response,
  table: typeof supplementStateTable | typeof gamificationStateTable,
  bodySchema: ZodLike,
) {
  const appUserId = await requireUserAuth(req, res);
  if (!appUserId) return;
  const body = validateOrReject<{
    state: Record<string, unknown>;
    updatedAtMs?: number;
  }>(req.body, bodySchema, res);
  if (!body) return;
  try {
    await db
      .insert(table)
      .values({
        appUserId,
        state: body.state,
        updatedAtMs: body.updatedAtMs ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: table.appUserId,
        set: {
          state: body.state,
          updatedAtMs: body.updatedAtMs ?? null,
          updatedAt: new Date(),
        },
      });
    res.json({ ok: true });
  } catch (err) {
    req.log?.error({ err }, "sync state upsert failed");
    res.status(500).json({ error: "internal" });
  }
}

router.put("/sync/supplements", (req, res) =>
  putState(req, res, supplementStateTable, PutSyncSupplementsBody),
);

router.put("/sync/gamification", (req, res) =>
  putState(req, res, gamificationStateTable, PutSyncGamificationBody),
);

/**
 * POST /sync/wellbeing — append a wellbeing entry (breathing or
 * meditation session). Idempotent on the client-supplied `entryId`: a
 * re-flush of the offline queue is a no-op.
 */
router.post("/sync/wellbeing", async (req, res) => {
  const appUserId = await requireUserAuth(req, res);
  if (!appUserId) return;
  const body = validateOrReject<{
    entryId: string;
    entry: Record<string, unknown>;
    completedAtMs: number;
  }>(req.body, PostSyncWellbeingEntryBody, res);
  if (!body) return;
  try {
    await db
      .insert(wellbeingEntriesTable)
      .values({
        appUserId,
        entryId: body.entryId,
        entry: body.entry,
        completedAtMs: body.completedAtMs,
      })
      .onConflictDoNothing({
        target: [wellbeingEntriesTable.appUserId, wellbeingEntriesTable.entryId],
      });
    res.json({ ok: true });
  } catch (err) {
    req.log?.error({ err }, "sync wellbeing append failed");
    res.status(500).json({ error: "internal" });
  }
});

/**
 * POST /sync/assessment — append a clinical assessment (DEXA / FRAX).
 * Same idempotency story as wellbeing.
 */
router.post("/sync/assessment", async (req, res) => {
  const appUserId = await requireUserAuth(req, res);
  if (!appUserId) return;
  const body = validateOrReject<{
    resultId: string;
    kind: string;
    payload: Record<string, unknown>;
    takenAtMs: number;
  }>(req.body, PostSyncAssessmentBody, res);
  if (!body) return;
  try {
    await db
      .insert(assessmentResultsTable)
      .values({
        appUserId,
        resultId: body.resultId,
        kind: body.kind,
        payload: body.payload,
        takenAtMs: body.takenAtMs,
      })
      .onConflictDoNothing({
        target: [
          assessmentResultsTable.appUserId,
          assessmentResultsTable.resultId,
        ],
      });
    res.json({ ok: true });
  } catch (err) {
    req.log?.error({ err }, "sync assessment append failed");
    res.status(500).json({ error: "internal" });
  }
});

/** Append a repeatable, structured patient-reported outcome check-in. */
router.post("/sync/outcomes", async (req, res) => {
  const appUserId = await requireUserAuth(req, res);
  if (!appUserId) return;
  const raw = req.body as
    | { entryId?: unknown; entry?: unknown; recordedAtMs?: unknown }
    | undefined;
  const entry = raw?.entry;
  if (
    typeof raw?.entryId !== "string" ||
    raw.entryId.length < 1 ||
    raw.entryId.length > 100 ||
    typeof entry !== "object" ||
    entry === null ||
    typeof raw.recordedAtMs !== "number" ||
    !Number.isFinite(raw.recordedAtMs)
  ) {
    res.status(400).json({ error: "invalid outcome entry" });
    return;
  }
  if (JSON.stringify(raw).length > 16 * 1024) {
    res.status(400).json({ error: "body too large" });
    return;
  }
  try {
    await db
      .insert(outcomeEntriesTable)
      .values({
        appUserId,
        entryId: raw.entryId,
        entry,
        recordedAtMs: raw.recordedAtMs,
      })
      .onConflictDoNothing({
        target: [outcomeEntriesTable.appUserId, outcomeEntriesTable.entryId],
      });
    res.json({ ok: true });
  } catch (err) {
    req.log?.error({ err }, "sync outcomes append failed");
    res.status(500).json({ error: "internal" });
  }
});

/**
 * GET /sync/snapshot — return the full per-user snapshot. Used by the
 * mobile client on app launch (and after a sign-in flow) to seed
 * AsyncStorage from the server before any context hydrates, so a fresh
 * device starts up with the same state the user last saw on their other
 * devices.
 *
 * We do this in parallel with `Promise.all` because each sub-query is
 * scoped to a single user (small N) and the round-trip dominates wall
 * time.
 */
router.get("/sync/snapshot", async (req, res) => {
  const appUserId = await requireUserAuth(req, res);
  if (!appUserId) return;
  try {
    const [
      profileRows,
      nutritionRows,
      activityRows,
      mealPlanRows,
      wellbeingRows,
      gamificationRows,
      supplementRows,
      assessmentRows,
      outcomeRows,
    ] = await Promise.all([
      db
        .select()
        .from(userProfileTable)
        .where(eq(userProfileTable.appUserId, appUserId))
        .limit(1),
      db
        .select()
        .from(nutritionLogsTable)
        .where(eq(nutritionLogsTable.appUserId, appUserId)),
      db
        .select()
        .from(activityLogsTable)
        .where(eq(activityLogsTable.appUserId, appUserId)),
      db
        .select()
        .from(mealPlanDaysTable)
        .where(eq(mealPlanDaysTable.appUserId, appUserId)),
      db
        .select()
        .from(wellbeingEntriesTable)
        .where(eq(wellbeingEntriesTable.appUserId, appUserId)),
      db
        .select()
        .from(gamificationStateTable)
        .where(eq(gamificationStateTable.appUserId, appUserId))
        .limit(1),
      db
        .select()
        .from(supplementStateTable)
        .where(eq(supplementStateTable.appUserId, appUserId))
        .limit(1),
      db
        .select()
        .from(assessmentResultsTable)
        .where(eq(assessmentResultsTable.appUserId, appUserId)),
      db
        .select()
        .from(outcomeEntriesTable)
        .where(eq(outcomeEntriesTable.appUserId, appUserId)),
    ]);

    const profileRow = profileRows[0] ?? null;
    const gamificationRow = gamificationRows[0] ?? null;
    const supplementRow = supplementRows[0] ?? null;

    res.json({
      appUserId,
      profile: profileRow
        ? {
            // The full StoredProfile blob is in `preferences`; the
            // typed columns are denormalised copies for analytics.
            profile: profileRow.preferences,
            updatedAtMs: profileRow.updatedAtMs,
          }
        : null,
      nutrition: nutritionRows.map((r) => ({
        day: r.day,
        data: r.log,
        updatedAtMs: r.updatedAtMs,
      })),
      activity: activityRows.map((r) => ({
        day: r.day,
        data: r.log,
        updatedAtMs: r.updatedAtMs,
      })),
      mealPlan: mealPlanRows.map((r) => ({
        day: r.day,
        data: r.payload,
        updatedAtMs: r.updatedAtMs,
      })),
      wellbeing: wellbeingRows.map((r) => ({
        entryId: r.entryId,
        entry: r.entry,
        completedAtMs: r.completedAtMs,
      })),
      gamification: gamificationRow
        ? {
            state: gamificationRow.state,
            updatedAtMs: gamificationRow.updatedAtMs,
          }
        : null,
      supplements: supplementRow
        ? {
            state: supplementRow.state,
            updatedAtMs: supplementRow.updatedAtMs,
          }
        : null,
      assessments: assessmentRows.map((r) => ({
        resultId: r.resultId,
        kind: r.kind,
        payload: r.payload,
        takenAtMs: r.takenAtMs,
      })),
      outcomes: outcomeRows.map((r) => ({
        entryId: r.entryId,
        entry: r.entry,
        recordedAtMs: r.recordedAtMs,
      })),
      // NOTE: `badge_unlocks` table is provisioned (and reserved for a
      // future per-unlock timeline / notification feature) but is NOT
      // round-tripped via this snapshot. Achievement state already
      // reaches every device through `gamification.state.achievements`,
      // and round-tripping unlocks separately without a paired write
      // path on the client would just produce stale empty arrays.
    });
  } catch (err) {
    req.log?.error({ err }, "sync snapshot read failed");
    res.status(500).json({ error: "internal" });
  }
});

export default router;
