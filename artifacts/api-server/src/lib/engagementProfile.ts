/**
 * Engagement profile — distilled per-user view of how the user has
 * interacted with our recommendation surfaces AND what they have
 * actually been doing inside the app (nutrition logs, wellbeing
 * sessions, activity, gamification). Two halves:
 *
 *   • `sevenDay` / `thirtyDayTrend` — recommendation lifecycle counts
 *     scanned from `interaction_events` (rec_shown / completed /
 *     dismissed). Drives the adaptive ranker on Today's Focus and the
 *     base trend used by the tone selector.
 *   • `behavioural` — persisted product behaviour aggregated from
 *     `nutrition_logs`, `wellbeing_entries`, `activity_logs`, and the
 *     scalar gamification columns on `user_profile`. Drives the Bone
 *     Buddy "recent behaviour" snippet, the behavioural bias on the
 *     adaptive ranker, the weekly SNAP Shot's server cross-check, and
 *     the second wave of tone-selector signals.
 *
 * Both halves come back from a single `buildEngagementProfile` call
 * because they share the same 1h cache and the same set of consumers.
 *
 * Privacy: nothing in here leaves the user's row. There is no
 * cross-user learning anywhere.
 *
 * Caching:
 *   • 1h profile cache per user (rebuilt lazily on miss / expiry)
 *   • 24h tone cache per user (so the persona doesn't flip on the user
 *     between two chat turns the same evening)
 */

import {
  db,
  interactionEventsTable,
  nutritionLogsTable,
  wellbeingEntriesTable,
  activityLogsTable,
  userProfileTable,
  type NutritionLogRow,
  type WellbeingEntryRow,
  type ActivityLogRow,
} from "@workspace/db";
import { and, eq, gte, lt, sql } from "drizzle-orm";

const SEVEN_DAYS_MS = 7 * 86_400_000;
const FOURTEEN_DAYS_MS = 14 * 86_400_000;
const THIRTY_DAYS_MS = 30 * 86_400_000;
const PROFILE_TTL_MS = 60 * 60 * 1_000; // 1 hour
const TONE_TTL_MS = 24 * 60 * 60 * 1_000; // 24 hours

/** Fallback when no nutrition target is on file. The UK NOS guidance
 *  for adults at risk is ~1000–1200 mg/day; we keep the same floor the
 *  mobile meal-plan generator uses. */
export const DEFAULT_CALCIUM_TARGET_MG = 1200;
/** A day "counts" as active when activeMinutes ≥ this. Filters out the
 *  noise of step trackers that sometimes log a stray minute or two from
 *  background data. */
const ACTIVE_DAY_MIN_MINUTES = 10;
/** Swing in mood valence (0..1 scale) needed to call the mood trend
 *  improving / dropping. Same 10-percentage-point bar we use for the
 *  rec_* trend so the two signals feel consistent. */
const MOOD_TREND_THRESHOLD = 0.10;
/** Minimum sessions in EACH window before a mood trend label is allowed. */
const MOOD_TREND_MIN_SESSIONS = 2;

/** Recommendation lifecycle event kinds. */
export const REC_KINDS = ["rec_shown", "rec_completed", "rec_dismissed"] as const;
export type RecKind = (typeof REC_KINDS)[number];

/** Tones the Bone Buddy chat persona can adopt for Premium users. */
export const TONES = ["encouraging", "gentle", "energising"] as const;
export type AdaptiveTone = (typeof TONES)[number];

/**
 * Mood → 0..1 valence (positive moods score higher). Mirrors the
 * client-side `MOOD_VALENCE` in `lib/weeklySnap.ts` so the two halves
 * of the system rank moods identically. Anything outside this set is
 * treated as 0.5 (neutral) by the aggregator.
 */
export const MOOD_VALENCE: Record<string, number> = {
  calm: 1.0,
  energised: 0.85,
  less_stressed: 0.8,
  focused: 0.75,
  still_tense: 0.2,
};

export interface EngagementByKind {
  /** Number of `rec_shown` events in the last 7 days for this surface kind. */
  shown: number;
  /** Number of `rec_completed` events in the last 7 days. */
  completed: number;
  /** Number of `rec_dismissed` events in the last 7 days. */
  dismissed: number;
  /** completed / shown, clamped to [0,1]. 0 when shown is 0. */
  rate: number;
}

export interface BehaviouralNutritionStats {
  /** Distinct days in the last 7 with any nutrition log row. */
  loggedDays7d: number;
  /** Mean calcium (mg/day) across logged days in the window. 0 when no logs. */
  avgCalciumMg7d: number;
  /** Mean vitamin D (µg/day) across logged days in the window. */
  avgVitaminDUg7d: number;
  /** Mean protein (g/day) across logged days in the window. */
  avgProteinG7d: number;
  /** Days the user hit (or exceeded) their calcium target in the window. */
  calciumDaysOnTarget7d: number;
  /** Calcium target snapshot used for the on-target count (mg). */
  calciumTargetMg: number;
  /** ISO date (YYYY-MM-DD) of the most recent nutrition log on file. */
  lastLoggedDay: string | null;
}

export interface BehaviouralWellbeingStats {
  /** Sessions completed in the last 7 days. */
  sessions7d: number;
  /** Sessions completed in the prior 7-day window (8–14 days ago). */
  sessionsPrev7d: number;
  /** ms since epoch of the most recent session, or null. */
  lastSessionAtMs: number | null;
  /** Mean mood valence over the 7d window (0..1). null when no sessions. */
  moodValence7d: number | null;
  /** Mean mood valence over the prior 7d window. null when no sessions. */
  moodValencePrev7d: number | null;
  /** Mood trend label — needs ≥2 sessions in EACH window for anything
   *  other than "steady". 10pp swing on the valence scale flips it. */
  moodTrend: "improving" | "steady" | "dropping";
  /** Consecutive days with at least one session, ending today (or
   *  yesterday if no session today — same one-day grace as the mobile
   *  client's `WellbeingContext.computeStreak`). */
  currentStreak: number;
  /** All-time longest consecutive-day session streak the user has ever
   *  achieved. Computed from the full wellbeing_entries history. Always
   *  ≥ currentStreak. */
  longestStreak: number;
}

export interface BehaviouralActivityStats {
  /** Sum of activeMinutes across the 7d window. */
  activeMinutes7d: number;
  /** Distinct days in the window with ≥10 active minutes. */
  activeDays7d: number;
}

export interface BehaviouralGamificationStats {
  level: number;
  xp: number;
  streakDays: number;
  totalPoints: number;
}

export interface BehaviouralStats {
  nutrition: BehaviouralNutritionStats;
  wellbeing: BehaviouralWellbeingStats;
  activity: BehaviouralActivityStats;
  gamification: BehaviouralGamificationStats;
}

/** Empty default — used when all per-table queries fail OR the user is
 *  brand new and has no data yet. Keeps callers from having to null-check
 *  every leaf. */
export const EMPTY_BEHAVIOURAL_STATS: BehaviouralStats = {
  nutrition: {
    loggedDays7d: 0,
    avgCalciumMg7d: 0,
    avgVitaminDUg7d: 0,
    avgProteinG7d: 0,
    calciumDaysOnTarget7d: 0,
    calciumTargetMg: DEFAULT_CALCIUM_TARGET_MG,
    lastLoggedDay: null,
  },
  wellbeing: {
    sessions7d: 0,
    sessionsPrev7d: 0,
    lastSessionAtMs: null,
    moodValence7d: null,
    moodValencePrev7d: null,
    moodTrend: "steady",
    currentStreak: 0,
    longestStreak: 0,
  },
  activity: {
    activeMinutes7d: 0,
    activeDays7d: 0,
  },
  gamification: {
    level: 1,
    xp: 0,
    streakDays: 0,
    totalPoints: 0,
  },
};

export interface EngagementProfile {
  /**
   * Per-recommendation-kind counts over the last 7 days. The "kind" key
   * is the value of `payload.recKind` we asked the client to attach when
   * emitting rec_* events (e.g. "nutrition", "wellbeing", "lifestyle",
   * "insight", "weekly_snap", "bone_buddy_suggestion"). Surfaces that
   * never emitted will simply be absent from this map.
   */
  sevenDay: {
    byKind: Record<string, EngagementByKind>;
    /** Total rec_shown across all kinds in the last 7 days. */
    totalShown: number;
    /** Total rec_completed across all kinds in the last 7 days. */
    totalCompleted: number;
    /** Total rec_dismissed across all kinds in the last 7 days. */
    totalDismissed: number;
    /** Aggregate completion rate, completed / shown. 0 when nothing shown. */
    rate: number;
  };
  /**
   * Hybrid trend: how this week's completion rate compares to the prior
   * 23 days (so the two windows together span 30 days and don't overlap).
   * 'steady' covers the case where the user has too little data for a
   * confident swing in either direction.
   */
  thirtyDayTrend: "improving" | "steady" | "dropping";
  /**
   * Behavioural snapshot derived from the persisted product tables.
   * Distinct from the rec_* counts above — these reflect what the user
   * has actually been doing (logging meals, completing sessions, racking
   * up active minutes), not just how they reacted to a recommendation.
   */
  behavioural: BehaviouralStats;
  /** ms since epoch — when this profile was assembled. */
  generatedAtMs: number;
}

interface ProfileCacheEntry {
  profile: EngagementProfile;
  expiresAtMs: number;
}

interface ToneCacheEntry {
  tone: AdaptiveTone;
  expiresAtMs: number;
}

const profileCache = new Map<string, ProfileCacheEntry>();
const toneCache = new Map<string, ToneCacheEntry>();

/** Test/diagnostic helper — clears both caches. */
export function __resetEngagementCaches(): void {
  profileCache.clear();
  toneCache.clear();
}

interface GroupedRow {
  kind: string;
  recKind: string | null;
  count: number;
}

/**
 * Group rec_* events by their `payload.recKind` for a given window.
 * Uses a single SQL aggregate keyed on (kind, payload->>'recKind').
 *
 * Rows where payload.recKind is null/missing are still counted in the
 * totals but not bucketed under any specific kind — they show up in
 * `totalShown/Completed/Dismissed` but not in `byKind`.
 */
async function groupRecEvents(
  appUserId: string,
  sinceMs: number,
  untilMs?: number,
): Promise<GroupedRow[]> {
  const since = new Date(sinceMs);
  const conds = [
    eq(interactionEventsTable.appUserId, appUserId),
    gte(interactionEventsTable.receivedAt, since),
    sql`${interactionEventsTable.kind} IN ('rec_shown','rec_completed','rec_dismissed')`,
  ];
  if (untilMs != null) {
    conds.push(lt(interactionEventsTable.receivedAt, new Date(untilMs)));
  }
  const rows = await db
    .select({
      kind: interactionEventsTable.kind,
      recKind: sql<string | null>`(${interactionEventsTable.payload} ->> 'recKind')`,
      count: sql<number>`count(*)::int`,
    })
    .from(interactionEventsTable)
    .where(and(...conds))
    .groupBy(
      interactionEventsTable.kind,
      sql`(${interactionEventsTable.payload} ->> 'recKind')`,
    );
  return rows.map((r) => ({
    kind: r.kind,
    recKind: r.recKind,
    count: r.count,
  }));
}

function computeRate(shown: number, completed: number): number {
  if (shown <= 0) return 0;
  return Math.max(0, Math.min(1, completed / shown));
}

/**
 * Compare a recent vs. prior completion rate and assign a trend label.
 * Exported so the threshold (10pp swing) can be unit-tested directly.
 */
export function classifyTrend(
  recentRate: number,
  recentShown: number,
  priorRate: number,
  priorShown: number,
): EngagementProfile["thirtyDayTrend"] {
  // Need at least a handful of events on each side before drawing a line.
  if (recentShown < 5 || priorShown < 5) return "steady";
  const diff = recentRate - priorRate;
  // 10 percentage points either way is a meaningful swing for our purposes.
  if (diff >= 0.1) return "improving";
  if (diff <= -0.1) return "dropping";
  return "steady";
}

// ---- Behavioural aggregators (pure, exported for unit tests) -------------

/**
 * Pull the user's calcium target out of `userProfile.preferences`. The
 * blob is a free-form jsonb so we walk it defensively. Falls back to
 * `DEFAULT_CALCIUM_TARGET_MG` when the value is missing or not a finite
 * positive number.
 */
export function pickCalciumTarget(prefs: unknown): number {
  if (!prefs || typeof prefs !== "object") return DEFAULT_CALCIUM_TARGET_MG;
  const targets = (prefs as Record<string, unknown>).nutritionTargets;
  if (!targets || typeof targets !== "object") return DEFAULT_CALCIUM_TARGET_MG;
  const calcium = (targets as Record<string, unknown>).calcium;
  if (typeof calcium !== "number" || !Number.isFinite(calcium) || calcium <= 0) {
    return DEFAULT_CALCIUM_TARGET_MG;
  }
  return calcium;
}

function readNumber(o: unknown, key: string): number {
  if (!o || typeof o !== "object") return 0;
  const v = (o as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function localIsoFromMs(ms: number): string {
  // The nutrition_logs.day column is the user's LOCAL date as written by
  // the mobile client. The server runs UTC, so we use UTC math here only
  // to bucket *server-side* derived days (e.g. "today" for the streak
  // grace window). Day strings stored on rows are kept verbatim.
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Aggregate nutrition rows into the 7-day behavioural snapshot. Each
 * row's `log` jsonb is treated defensively because the schema is
 * intentionally flexible — we only read the fields we know about and
 * fall back to 0 when a field is missing or non-numeric.
 *
 * `rows` should already be filtered to the user's last 7 logged days
 * (the caller does the SQL window). Multiple rows for the same `day`
 * (which the schema's PK should prevent, but belt-and-braces) are
 * summed within the day before averaging.
 */
export function aggregateNutrition(
  rows: ReadonlyArray<Pick<NutritionLogRow, "day" | "log">>,
  calciumTargetMg: number,
): BehaviouralNutritionStats {
  if (rows.length === 0) {
    return {
      loggedDays7d: 0,
      avgCalciumMg7d: 0,
      avgVitaminDUg7d: 0,
      avgProteinG7d: 0,
      calciumDaysOnTarget7d: 0,
      calciumTargetMg,
      lastLoggedDay: null,
    };
  }
  const perDay = new Map<
    string,
    { calcium: number; vitaminD: number; protein: number }
  >();
  let lastLoggedDay: string | null = null;
  for (const r of rows) {
    if (!perDay.has(r.day)) {
      perDay.set(r.day, { calcium: 0, vitaminD: 0, protein: 0 });
    }
    const slot = perDay.get(r.day)!;
    slot.calcium += readNumber(r.log, "calcium");
    slot.vitaminD += readNumber(r.log, "vitaminD");
    slot.protein += readNumber(r.log, "protein");
    if (lastLoggedDay === null || r.day > lastLoggedDay) lastLoggedDay = r.day;
  }
  const loggedDays7d = perDay.size;
  let calciumSum = 0;
  let vitaminDSum = 0;
  let proteinSum = 0;
  let calciumDaysOnTarget7d = 0;
  for (const totals of perDay.values()) {
    calciumSum += totals.calcium;
    vitaminDSum += totals.vitaminD;
    proteinSum += totals.protein;
    if (calciumTargetMg > 0 && totals.calcium >= calciumTargetMg) {
      calciumDaysOnTarget7d += 1;
    }
  }
  return {
    loggedDays7d,
    avgCalciumMg7d: loggedDays7d > 0 ? calciumSum / loggedDays7d : 0,
    avgVitaminDUg7d: loggedDays7d > 0 ? vitaminDSum / loggedDays7d : 0,
    avgProteinG7d: loggedDays7d > 0 ? proteinSum / loggedDays7d : 0,
    calciumDaysOnTarget7d,
    calciumTargetMg,
    lastLoggedDay,
  };
}

/**
 * Compute the all-time longest consecutive-day session streak from an
 * array of UTC day buckets (epoch-day integers from `completedAtMs /
 * 86_400_000`). Exported for unit tests.
 */
export function computeLongestStreak(allDayBuckets: ReadonlyArray<number>): number {
  if (allDayBuckets.length === 0) return 0;
  const sorted = [...new Set(allDayBuckets)].sort((a, b) => a - b);
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]! - sorted[i - 1]! === 1) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }
  return longest;
}

/**
 * Aggregate wellbeing entries spanning the 14-day window the caller
 * fetched. We split them in JS so a single SELECT covers both the
 * primary 7d and the prior-7d comparison window.
 *
 * Mood valence is averaged per window (each session counts once with
 * its own valence — multiple sessions in a day are NOT day-collapsed
 * because mood is a per-session signal).
 *
 * Streak is computed from the entries spanning the window and uses the
 * same one-day grace as the mobile client (`WellbeingContext.computeStreak`).
 *
 * `allTimeCompletedAtMs` — optional array of every historical
 * `completedAtMs` value for the user. When supplied, it is used to
 * compute `longestStreak`; otherwise `longestStreak` falls back to the
 * `currentStreak` derived from `rows` (safe default for callers that
 * only have the 14-day window).
 */
export function aggregateWellbeing(
  rows: ReadonlyArray<Pick<WellbeingEntryRow, "entry" | "completedAtMs">>,
  nowMs: number,
  allTimeCompletedAtMs?: ReadonlyArray<number>,
): BehaviouralWellbeingStats {
  if (rows.length === 0) {
    const longestStreak =
      allTimeCompletedAtMs && allTimeCompletedAtMs.length > 0
        ? computeLongestStreak(allTimeCompletedAtMs.map((ms) => Math.floor(ms / 86_400_000)))
        : 0;
    return {
      sessions7d: 0,
      sessionsPrev7d: 0,
      lastSessionAtMs: null,
      moodValence7d: null,
      moodValencePrev7d: null,
      moodTrend: "steady",
      currentStreak: 0,
      longestStreak,
    };
  }
  const sevenAgoMs = nowMs - SEVEN_DAYS_MS;
  const fourteenAgoMs = nowMs - FOURTEEN_DAYS_MS;

  let sessions7d = 0;
  let sessionsPrev7d = 0;
  let valenceSum7d = 0;
  let valenceSumPrev7d = 0;
  let lastSessionAtMs: number | null = null;
  // Day buckets for the streak calc. We use UTC day buckets server-side
  // — close enough since the 24h cache hides any TZ jitter at the
  // streak-flip moment for the chat use case.
  const sessionDayBuckets = new Set<number>();

  for (const r of rows) {
    if (typeof r.completedAtMs !== "number") continue;
    if (lastSessionAtMs === null || r.completedAtMs > lastSessionAtMs) {
      lastSessionAtMs = r.completedAtMs;
    }
    const moodRaw = (r.entry as Record<string, unknown> | null)?.mood;
    const valence =
      typeof moodRaw === "string" && moodRaw in MOOD_VALENCE
        ? MOOD_VALENCE[moodRaw]!
        : 0.5;

    if (r.completedAtMs >= sevenAgoMs && r.completedAtMs <= nowMs) {
      sessions7d += 1;
      valenceSum7d += valence;
      sessionDayBuckets.add(Math.floor(r.completedAtMs / 86_400_000));
    } else if (r.completedAtMs >= fourteenAgoMs && r.completedAtMs < sevenAgoMs) {
      sessionsPrev7d += 1;
      valenceSumPrev7d += valence;
    }
  }

  const moodValence7d = sessions7d > 0 ? valenceSum7d / sessions7d : null;
  const moodValencePrev7d =
    sessionsPrev7d > 0 ? valenceSumPrev7d / sessionsPrev7d : null;

  let moodTrend: BehaviouralWellbeingStats["moodTrend"] = "steady";
  if (
    moodValence7d != null &&
    moodValencePrev7d != null &&
    sessions7d >= MOOD_TREND_MIN_SESSIONS &&
    sessionsPrev7d >= MOOD_TREND_MIN_SESSIONS
  ) {
    const diff = moodValence7d - moodValencePrev7d;
    if (diff >= MOOD_TREND_THRESHOLD) moodTrend = "improving";
    else if (diff <= -MOOD_TREND_THRESHOLD) moodTrend = "dropping";
  }

  const currentStreak = computeStreak(sessionDayBuckets, nowMs);

  // Longest streak — prefer the all-time feed when available; otherwise
  // fall back to computing from the 14-day window rows (can only equal
  // or undercount the true longest, but keeps old callers safe).
  const allDayBuckets =
    allTimeCompletedAtMs && allTimeCompletedAtMs.length > 0
      ? allTimeCompletedAtMs.map((ms) => Math.floor(ms / 86_400_000))
      : [...sessionDayBuckets];
  const longestStreak = Math.max(currentStreak, computeLongestStreak(allDayBuckets));

  return {
    sessions7d,
    sessionsPrev7d,
    lastSessionAtMs,
    moodValence7d,
    moodValencePrev7d,
    moodTrend,
    currentStreak,
    longestStreak,
  };
}

/** Mirrors `WellbeingContext.computeStreak` using day buckets (UTC).
 *  Walks back from today (with one-day grace if today has no session). */
function computeStreak(dayBuckets: Set<number>, nowMs: number): number {
  if (dayBuckets.size === 0) return 0;
  const today = Math.floor(nowMs / 86_400_000);
  let cursor = today;
  if (!dayBuckets.has(cursor)) {
    if (dayBuckets.has(today - 1)) cursor = today - 1;
    else return 0;
  }
  let streak = 0;
  while (dayBuckets.has(cursor)) {
    streak += 1;
    cursor -= 1;
  }
  return streak;
}

/**
 * Aggregate activity rows into the 7-day behavioural snapshot. Same
 * defensive jsonb walk as `aggregateNutrition`. Multiple rows per day
 * are summed; a day counts as "active" once it crosses the 10-minute
 * floor.
 */
export function aggregateActivity(
  rows: ReadonlyArray<Pick<ActivityLogRow, "day" | "log">>,
): BehaviouralActivityStats {
  if (rows.length === 0) {
    return { activeMinutes7d: 0, activeDays7d: 0 };
  }
  const perDay = new Map<string, number>();
  for (const r of rows) {
    const mins = readNumber(r.log, "activeMinutes");
    perDay.set(r.day, (perDay.get(r.day) ?? 0) + mins);
  }
  let activeMinutes7d = 0;
  let activeDays7d = 0;
  for (const mins of perDay.values()) {
    activeMinutes7d += mins;
    if (mins >= ACTIVE_DAY_MIN_MINUTES) activeDays7d += 1;
  }
  return { activeMinutes7d, activeDays7d };
}

/**
 * Pull the per-table aggregates that make up `behavioural`. Wrapped in
 * `Promise.allSettled` so a transient failure in (say) the activity
 * table doesn't blank the whole snapshot — each table degrades to its
 * empty default independently.
 */
async function loadBehaviouralStats(
  appUserId: string,
  nowMs: number,
): Promise<BehaviouralStats> {
  const sevenAgoMs = nowMs - SEVEN_DAYS_MS;
  const sevenAgoIso = localIsoFromMs(sevenAgoMs);
  const fourteenAgoMs = nowMs - FOURTEEN_DAYS_MS;

  const [profileRes, nutritionRes, wellbeingRes, activityRes, allWellbeingRes] =
    await Promise.allSettled([
      db
        .select({
          level: userProfileTable.level,
          xp: userProfileTable.xp,
          streakDays: userProfileTable.streakDays,
          totalPoints: userProfileTable.totalPoints,
          preferences: userProfileTable.preferences,
        })
        .from(userProfileTable)
        .where(eq(userProfileTable.appUserId, appUserId))
        .limit(1),
      db
        .select({
          day: nutritionLogsTable.day,
          log: nutritionLogsTable.log,
        })
        .from(nutritionLogsTable)
        .where(
          and(
            eq(nutritionLogsTable.appUserId, appUserId),
            gte(nutritionLogsTable.day, sevenAgoIso),
          ),
        ),
      db
        .select({
          entry: wellbeingEntriesTable.entry,
          completedAtMs: wellbeingEntriesTable.completedAtMs,
        })
        .from(wellbeingEntriesTable)
        .where(
          and(
            eq(wellbeingEntriesTable.appUserId, appUserId),
            gte(wellbeingEntriesTable.completedAtMs, fourteenAgoMs),
          ),
        ),
      db
        .select({
          day: activityLogsTable.day,
          log: activityLogsTable.log,
        })
        .from(activityLogsTable)
        .where(
          and(
            eq(activityLogsTable.appUserId, appUserId),
            gte(activityLogsTable.day, sevenAgoIso),
          ),
        ),
      // All-time completedAtMs — only this column so the payload stays
      // small. Used to compute the all-time longest streak without
      // re-fetching the full entry jsonb for every historical session.
      db
        .select({ completedAtMs: wellbeingEntriesTable.completedAtMs })
        .from(wellbeingEntriesTable)
        .where(eq(wellbeingEntriesTable.appUserId, appUserId)),
    ]);

  const profileRow =
    profileRes.status === "fulfilled" ? profileRes.value[0] ?? null : null;
  const calciumTargetMg = pickCalciumTarget(profileRow?.preferences);
  const nutritionRows =
    nutritionRes.status === "fulfilled" ? nutritionRes.value : [];
  const wellbeingRows =
    wellbeingRes.status === "fulfilled" ? wellbeingRes.value : [];
  const activityRows =
    activityRes.status === "fulfilled" ? activityRes.value : [];
  const allWellbeingMs: number[] =
    allWellbeingRes.status === "fulfilled"
      ? allWellbeingRes.value.map((r) => r.completedAtMs)
      : [];

  return {
    nutrition: aggregateNutrition(
      nutritionRows as ReadonlyArray<Pick<NutritionLogRow, "day" | "log">>,
      calciumTargetMg,
    ),
    wellbeing: aggregateWellbeing(
      wellbeingRows as ReadonlyArray<
        Pick<WellbeingEntryRow, "entry" | "completedAtMs">
      >,
      nowMs,
      allWellbeingMs,
    ),
    activity: aggregateActivity(
      activityRows as ReadonlyArray<Pick<ActivityLogRow, "day" | "log">>,
    ),
    gamification: {
      level: profileRow?.level ?? EMPTY_BEHAVIOURAL_STATS.gamification.level,
      xp: profileRow?.xp ?? 0,
      streakDays: profileRow?.streakDays ?? 0,
      totalPoints: profileRow?.totalPoints ?? 0,
    },
  };
}

/**
 * Build the engagement profile for a user. Cheap enough to call on every
 * relevant request, but cached for an hour so we don't beat up the
 * events table with the same scan over and over.
 */
export async function buildEngagementProfile(
  appUserId: string,
): Promise<EngagementProfile> {
  const now = Date.now();
  const cached = profileCache.get(appUserId);
  if (cached && cached.expiresAtMs > now) return cached.profile;

  // 7-day window for primary signal.
  const sevenDayRows = await groupRecEvents(appUserId, now - SEVEN_DAYS_MS);

  const byKind: Record<string, EngagementByKind> = {};
  let totalShown = 0;
  let totalCompleted = 0;
  let totalDismissed = 0;
  for (const r of sevenDayRows) {
    if (r.kind === "rec_shown") totalShown += r.count;
    else if (r.kind === "rec_completed") totalCompleted += r.count;
    else if (r.kind === "rec_dismissed") totalDismissed += r.count;
    if (!r.recKind) continue;
    const slot = (byKind[r.recKind] ??= {
      shown: 0,
      completed: 0,
      dismissed: 0,
      rate: 0,
    });
    if (r.kind === "rec_shown") slot.shown += r.count;
    else if (r.kind === "rec_completed") slot.completed += r.count;
    else if (r.kind === "rec_dismissed") slot.dismissed += r.count;
  }
  for (const k of Object.keys(byKind)) {
    byKind[k].rate = computeRate(byKind[k].shown, byKind[k].completed);
  }

  // 30-day trend: compare last 7 days vs the 23 days before that.
  const priorRows = await groupRecEvents(
    appUserId,
    now - THIRTY_DAYS_MS,
    now - SEVEN_DAYS_MS,
  );
  let priorShown = 0;
  let priorCompleted = 0;
  for (const r of priorRows) {
    if (r.kind === "rec_shown") priorShown += r.count;
    else if (r.kind === "rec_completed") priorCompleted += r.count;
  }
  const thirtyDayTrend = classifyTrend(
    computeRate(totalShown, totalCompleted),
    totalShown,
    computeRate(priorShown, priorCompleted),
    priorShown,
  );

  // Behavioural pull is best-effort — degrade to empty stats so the
  // adaptive surfaces still get the rec_* half of the profile.
  let behavioural: BehaviouralStats;
  try {
    behavioural = await loadBehaviouralStats(appUserId, now);
  } catch {
    behavioural = EMPTY_BEHAVIOURAL_STATS;
  }

  const profile: EngagementProfile = {
    sevenDay: {
      byKind,
      totalShown,
      totalCompleted,
      totalDismissed,
      rate: computeRate(totalShown, totalCompleted),
    },
    thirtyDayTrend,
    behavioural,
    generatedAtMs: now,
  };

  profileCache.set(appUserId, {
    profile,
    expiresAtMs: now + PROFILE_TTL_MS,
  });
  return profile;
}

/**
 * Decide which conversational tone Bone Buddy should adopt for this
 * Premium user. Stable for 24h per user — flipping voice between two
 * chat turns the same evening is jarring, so we cache the decision.
 *
 * Heuristics (deliberately simple — no ML, easy to reason about):
 *   • 30d rec trend dropping, OR low mood (mean valence ≤ 0.35 over the
 *     past week, with at least one mood-bearing session in the window),
 *     OR high dismiss rate (≥40% of shown), OR clear slipping
 *     (`sessionsPrev7d ≥ 3` AND week-on-week drop of at least 3) →
 *     'gentle'.
 *   • Trend improving, OR mood trend improving with a 3+ day wellbeing
 *     streak, OR completion rate ≥60% with ≥10 shown → 'energising'.
 *   • Otherwise → 'encouraging' (the warm default).
 *
 * Order matters: `gentle` short-circuits over everything else so a
 * user who is also clocking high completions but is clearly slipping
 * still gets a softer voice.
 */
const LOW_MOOD_VALENCE_CEILING = 0.35;
const SLIPPING_PRIOR_WEEK_FLOOR = 3;
const SLIPPING_DROP_FLOOR = 3;

export function selectTone(profile: EngagementProfile): AdaptiveTone {
  const { sevenDay, thirtyDayTrend, behavioural } = profile;
  const dismissRate =
    sevenDay.totalShown > 0
      ? sevenDay.totalDismissed / sevenDay.totalShown
      : 0;

  // ---- gentle (override-anything) ---------------------------------------
  if (thirtyDayTrend === "dropping") return "gentle";
  // Low mean mood valence over the past week. We only flag this when
  // we actually have mood data (`moodValence7d` is null when the user
  // logged no mood-bearing sessions in the window) so a brand-new
  // account doesn't get a sad voice by default.
  if (
    behavioural.wellbeing.moodValence7d !== null &&
    behavioural.wellbeing.moodValence7d <= LOW_MOOD_VALENCE_CEILING
  ) {
    return "gentle";
  }
  if (dismissRate >= 0.4 && sevenDay.totalShown >= 5) return "gentle";
  // Slipping = the user had a real prior-week habit (≥3 sessions) and
  // their session count has fallen by at least 3 this past week. Catches
  // the "was using the app, then stopped" pattern that the rec_* trend
  // can miss when the user simply stops opening tiles.
  if (
    behavioural.wellbeing.sessionsPrev7d >= SLIPPING_PRIOR_WEEK_FLOOR &&
    behavioural.wellbeing.sessionsPrev7d - behavioural.wellbeing.sessions7d >=
      SLIPPING_DROP_FLOOR
  ) {
    return "gentle";
  }

  // ---- energising -------------------------------------------------------
  if (thirtyDayTrend === "improving") return "energising";
  if (
    behavioural.wellbeing.moodTrend === "improving" &&
    behavioural.wellbeing.currentStreak >= 3
  ) {
    return "energising";
  }
  if (sevenDay.totalShown >= 10 && sevenDay.rate >= 0.6) return "energising";

  return "encouraging";
}

/**
 * Cached tone for a Premium user — guarantees stability for at least 24h.
 * Builds the profile if not cached, then chooses + caches the tone.
 */
export async function getCachedTone(appUserId: string): Promise<AdaptiveTone> {
  const now = Date.now();
  const cached = toneCache.get(appUserId);
  if (cached && cached.expiresAtMs > now) return cached.tone;
  const profile = await buildEngagementProfile(appUserId);
  const tone = selectTone(profile);
  toneCache.set(appUserId, {
    tone,
    expiresAtMs: now + TONE_TTL_MS,
  });
  return tone;
}

/**
 * Short, plain-English clause that gets appended to the persona prompt
 * when the user is Premium. Kept compact and non-prescriptive — it nudges
 * the model's voice rather than overriding the persona.
 */
export function toneClause(tone: AdaptiveTone): string {
  switch (tone) {
    case "gentle":
      return `\n\nADAPTIVE TONE — gentle. The user has been finding things heavy lately. Soften your voice, lower the bar. Acknowledge effort over outcomes. No big asks. One tiny, easy suggestion at most. Avoid "you should" or "make sure" — try "if it feels right" or "no pressure".`;
    case "energising":
      return `\n\nADAPTIVE TONE — energising. The user is on a roll. You can be a touch more upbeat and direct. Celebrate one specific thing they're doing well, and offer one slightly more ambitious next step. Keep it warm, never showy.`;
    case "encouraging":
    default:
      return `\n\nADAPTIVE TONE — encouraging. Stay warmly motivating. Recognise small wins. Keep nudges light and concrete.`;
  }
}

/**
 * Render the behavioural snapshot as a short, PII-free system-prompt
 * snippet for Bone Buddy. Lives next to the engagement profile (rather
 * than in `chat.ts`) so the same wording is reused everywhere we want
 * to ground a model on what the user has actually been doing — and so
 * unit tests can pin the wording without spinning up the chat route.
 *
 * Wording rules:
 *   • Plain numbers, no patient identifiers, no exact dates.
 *   • Always reads as a single block of bullets the model can weave one
 *     or two of into a reply, never repeat verbatim.
 *   • Returns "" when there is nothing meaningful to say (brand-new
 *     user, all aggregates empty) so the caller can append unconditionally.
 */
export function renderBehaviouralContext(
  behavioural: BehaviouralStats,
): string {
  const lines: string[] = [];
  const n = behavioural.nutrition;
  if (n.loggedDays7d > 0) {
    const calcium = Math.round(n.avgCalciumMg7d);
    lines.push(
      `Past 7 days: logged nutrition on ${n.loggedDays7d} day${n.loggedDays7d === 1 ? "" : "s"}, averaging ${calcium} mg calcium/day (target ${n.calciumTargetMg} mg).`,
    );
    if (n.calciumDaysOnTarget7d > 0) {
      lines.push(
        `Hit the calcium target on ${n.calciumDaysOnTarget7d} of those day${n.calciumDaysOnTarget7d === 1 ? "" : "s"}.`,
      );
    }
  }

  const w = behavioural.wellbeing;
  if (w.sessions7d > 0 || w.sessionsPrev7d > 0) {
    const wbBits: string[] = [];
    wbBits.push(
      `${w.sessions7d} wellbeing session${w.sessions7d === 1 ? "" : "s"} this past week`,
    );
    if (w.currentStreak > 0) {
      wbBits.push(`${w.currentStreak}-day current streak`);
    }
    if (w.moodTrend === "improving") {
      wbBits.push("mood is trending up vs the previous week");
    } else if (w.moodTrend === "dropping") {
      wbBits.push("mood has been heavier than the previous week");
    }
    lines.push(`Calm studio: ${wbBits.join(", ")}.`);
  }

  const a = behavioural.activity;
  if (a.activeMinutes7d > 0 || a.activeDays7d > 0) {
    lines.push(
      `Activity: ${Math.round(a.activeMinutes7d)} active minutes across ${a.activeDays7d} day${a.activeDays7d === 1 ? "" : "s"} this past week.`,
    );
  }

  const g = behavioural.gamification;
  if (g.streakDays > 0 || g.totalPoints > 0) {
    const gBits: string[] = [`level ${g.level}`];
    if (g.streakDays > 0) gBits.push(`${g.streakDays}-day overall streak`);
    if (g.totalPoints > 0) gBits.push(`${g.totalPoints} XP total`);
    lines.push(`Progress: ${gBits.join(", ")}.`);
  }

  if (lines.length === 0) return "";
  return `\n\nRECENT BEHAVIOUR (private — use to ground your reply; weave in at most one or two, never list verbatim):\n${lines.map((l) => `• ${l}`).join("\n")}`;
}
