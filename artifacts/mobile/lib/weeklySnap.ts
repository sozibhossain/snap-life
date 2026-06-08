
import type { Mood, WellbeingEntry } from "@/context/WellbeingContext";
import type { ActivityLog, NutritionLog } from "@/context/HealthContext";

const ONE_DAY_MS = 86_400_000;

export function isoYearWeek(d: Date = new Date()): string {
  // Copy so we don't mutate the input.
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // Set to Thursday in current ISO week (week containing Thursday).
  const dayNum = date.getUTCDay() || 7; // Sun → 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / ONE_DAY_MS + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** Local YYYY-MM-DD (matches NutritionContext / dailyFocus convention). */
export function todayLocalISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isWeeklySnapWindow(d: Date = new Date()): boolean {
  const day = d.getDay();
  return day === 0 || day === 1;
}

/** Mood → 0..1 valence on a calm scale (positive moods score higher). */
const MOOD_VALENCE: Record<Mood, number> = {
  calm: 1.0,
  energised: 0.85,
  less_stressed: 0.8,
  focused: 0.75,
  still_tense: 0.2,
};

export interface WeeklyMoodPoint {
  /** YYYY-MM-DD (local). Always 7 entries, oldest first. */
  date: string;
  /** Sessions completed that day. */
  count: number;
  /** Mean valence 0..1, or null if no sessions. */
  valence: number | null;
  /** Short weekday label "Mon"…"Sun". */
  weekday: string;
}

export interface WeeklySnapData {
  /** ISO-week id like "2026-W17" — used as the idempotency key. */
  isoYearWeek: string;
  /** Mood arc, oldest first. Always length 7. */
  moodArc: WeeklyMoodPoint[];
  /** Total wellbeing sessions (breathing + meditation) in the past 7 days. */
  sessionsCompleted: number;
  /** Sum of activeMinutes across all activity logs in the window. */
  activeMinutes: number;
  /** Number of days in the window the user hit their calcium target. */
  calciumDaysOnTarget: number;
  /** Calcium target used to compute the "on target" count (snapshot). */
  calciumTargetMg: number;
  /**
   * Average calcium intake (mg) per logged day in the window. 0 when no
   * nutrition was logged. The server view (mean per logged day from
   * `nutrition_logs`) is preferred when supplied; otherwise computed
   * client-side from the supplied logs.
   */
  averageCalciumMg: number;
  /** Current calm-studio streak, in days. */
  currentStreak: number;
  /** All-time longest consecutive-day calm-studio streak. Always ≥ currentStreak. */
  longestStreak: number;
  emotionalInsight: string;
  /** Identity-reinforcement line. Calm, never gamified. */
  identityLine: string;
}

/** Past-7-day plan-vs-manual breakdown of nutrition logs. Used by the
 *  Coach payload so weekly questions ("how am I doing on calcium this
 *  week?") can be answered with awareness of plan engagement, not just
 *  flat totals. Pure / no React deps so it can be tested without
 *  spinning up React Native. */
export interface WeekNutritionSourceSummary {
  /** Days where today's totals came purely from meal-plan ticks. */
  planOnlyDays: number;
  /** Days where the user typed totals into Log Nutrition with no plan
   *  ticks. */
  manualOnlyDays: number;
  /** Days that combined both sources. */
  mixedDays: number;
  /** Total days in the past 7 with ANY nutrition log. */
  totalLoggedDays: number;
}

export function summariseWeekSources(
  logs: ReadonlyArray<NutritionLog>,
  now: Date = new Date(),
): WeekNutritionSourceSummary {
  // Build a 7-day local-date window (oldest → today).
  const windowDates = new Set<string>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    windowDates.add(todayLocalISO(d));
  }
  // First occurrence per date wins — see contract above. Walking the
  // array in input order and skipping subsequent dupes preserves the
  // newest entry under HealthContext's prepend convention.
  const perDay = new Map<string, NutritionLog["source"]>();
  for (const l of logs) {
    if (!windowDates.has(l.date)) continue;
    if (perDay.has(l.date)) continue;
    perDay.set(l.date, l.source);
  }
  let planOnlyDays = 0;
  let manualOnlyDays = 0;
  let mixedDays = 0;
  for (const src of perDay.values()) {
    if (src === "meal_plan") planOnlyDays += 1;
    else if (src === "manual") manualOnlyDays += 1;
    else if (src === "manual+plan") mixedDays += 1;
  }
  return {
    planOnlyDays,
    manualOnlyDays,
    mixedDays,
    totalLoggedDays: perDay.size,
  };
}

/**
 * Authoritative server-side weekly aggregates. When supplied, these
 * values OVERRIDE the equivalent client-side computations in
 * `buildWeeklySnap` so the SNAP Shot reflects what the server's
 * persistence layer agrees happened, not whatever happens to be on
 * device. Useful when the user has logged from multiple devices, or
 * when on-device state has been pruned but the server hasn't.
 *
 * The mood arc itself is still computed client-side because it's
 * day-by-day shape and the `wellbeing_entries` row payload (which
 * carries the mood) is what the server would report anyway.
 */
export interface WeeklyServerAggregates {
  /** Sessions in the past 7 days (counts breathing + meditation). */
  sessionsCompleted?: number;
  /** Sum of activeMinutes across the past 7 days. */
  activeMinutes?: number;
  /** Days the user hit their calcium target in the past 7 days. */
  calciumDaysOnTarget?: number;
  /** Calcium target the server used — preferred over the client value. */
  calciumTargetMg?: number;
  /**
   * Mean calcium (mg) per logged day in the past 7, server view.
   * When supplied, displayed as the SNAP Shot's "average calcium intake"
   * line. Use 0 to mean "no logs yet" (we treat 0 as an explicit signal,
   * NOT as undefined, so the server can distinguish "no logs" from
   * "field not provided").
   */
  averageCalciumMg?: number;
  /** Current calm-studio streak in days, server view. */
  currentStreak?: number;
  /** All-time longest calm-studio streak in days, server view. */
  longestStreak?: number;
}

export interface AggregateInput {
  now?: number;
  wellbeingEntries: WellbeingEntry[];
  activityLogs: ActivityLog[];
  nutritionLogs: NutritionLog[];
  calciumTargetMg: number;
  currentStreak: number;
  /** First name if available — used to soften the identity line. */
  firstName?: string;
  /** Pre-rendered emotional insight from the engine. */
  emotionalInsight: string;
  /**
   * Optional server-side aggregates. Each defined field overrides the
   * corresponding client-computed value (sessionsCompleted,
   * activeMinutes, calciumDaysOnTarget, calciumTargetMg, currentStreak).
   * `undefined` fields fall back to the client computation, so partial
   * server payloads degrade gracefully.
   */
  serverAggregates?: WeeklyServerAggregates;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function buildWeeklySnap(input: AggregateInput): WeeklySnapData {
  const nowMs = input.now ?? Date.now();
  const today = new Date(nowMs);

  // 7 day buckets ending today, oldest first.
  const buckets: WeeklyMoodPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    buckets.push({
      date: todayLocalISO(d),
      count: 0,
      valence: null,
      weekday: WEEKDAY_LABELS[d.getDay()],
    });
  }
  const dateIndex = new Map<string, number>();
  buckets.forEach((b, i) => dateIndex.set(b.date, i));

  // Mood arc + client-side session count. The mood arc itself is always
  // built locally because it's day-by-day shape — the server agg only
  // supplies a single weekly total.
  let clientSessionsCompleted = 0;
  for (const e of input.wellbeingEntries) {
    const isoLocal = todayLocalISO(new Date(e.completedAt));
    const i = dateIndex.get(isoLocal);
    if (i === undefined) continue;
    clientSessionsCompleted += 1;
    const v = MOOD_VALENCE[e.mood] ?? 0.5;
    const b = buckets[i];
    b.count += 1;
    // Running mean: previous mean weighted by previous count.
    if (b.valence == null) b.valence = v;
    else b.valence = (b.valence * (b.count - 1) + v) / b.count;
  }

  // Active minutes — client view.
  let clientActiveMinutes = 0;
  for (const a of input.activityLogs) {
    if (!dateIndex.has(a.date)) continue;
    clientActiveMinutes += Math.max(0, a.activeMinutes ?? 0);
  }

  // Calcium target — server view wins when present and positive.
  const calciumTargetMg =
    input.serverAggregates?.calciumTargetMg !== undefined &&
    input.serverAggregates.calciumTargetMg > 0
      ? input.serverAggregates.calciumTargetMg
      : input.calciumTargetMg;

  // Calcium consistency + average — both computed in one pass over the
  // logs so we can offer a sensible client fallback if the server
  // doesn't supply `averageCalciumMg`. Sum calcium per day across logs
  // (multiple logs in a day can occur), then derive on-target count and
  // mean-per-logged-day in lockstep.
  let clientCalciumDaysOnTarget = 0;
  let clientAverageCalciumMg = 0;
  {
    const perDay = new Map<string, number>();
    for (const n of input.nutritionLogs) {
      if (!dateIndex.has(n.date)) continue;
      perDay.set(n.date, (perDay.get(n.date) ?? 0) + (n.calcium ?? 0));
    }
    let calciumSum = 0;
    for (const [, total] of perDay) {
      calciumSum += total;
      if (calciumTargetMg > 0 && total >= calciumTargetMg) {
        clientCalciumDaysOnTarget += 1;
      }
    }
    clientAverageCalciumMg = perDay.size > 0 ? calciumSum / perDay.size : 0;
  }

  // Apply server overrides field-by-field. `undefined` falls back to
  // the client value, so partial server payloads still help.
  const serverAgg = input.serverAggregates;
  const sessionsCompleted =
    serverAgg?.sessionsCompleted ?? clientSessionsCompleted;
  const activeMinutes = serverAgg?.activeMinutes ?? clientActiveMinutes;
  const calciumDaysOnTarget =
    serverAgg?.calciumDaysOnTarget ?? clientCalciumDaysOnTarget;
  const averageCalciumMg =
    serverAgg?.averageCalciumMg ?? clientAverageCalciumMg;
  const currentStreak = serverAgg?.currentStreak ?? input.currentStreak;
  // longestStreak: server view is authoritative (all-time history); fall
  // back to currentStreak when not supplied (safe — longest ≥ current).
  const longestStreak = serverAgg?.longestStreak ?? currentStreak;

  return {
    isoYearWeek: isoYearWeek(today),
    moodArc: buckets,
    sessionsCompleted,
    activeMinutes,
    calciumDaysOnTarget,
    calciumTargetMg,
    averageCalciumMg,
    currentStreak,
    longestStreak,
    emotionalInsight: input.emotionalInsight,
    identityLine: makeIdentityLine({
      firstName: input.firstName,
      sessionsCompleted,
      streak: currentStreak,
      calciumDaysOnTarget,
    }),
  };
}

interface IdentityInput {
  firstName?: string;
  sessionsCompleted: number;
  streak: number;
  calciumDaysOnTarget: number;
}

function makeIdentityLine(i: IdentityInput): string {
  const name = i.firstName?.trim();
  const prefix = name ? `${name}, ` : "";
  const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
  if (i.streak >= 5) {
    return `${cap(prefix)}you're becoming someone who shows up for their own bones — quietly, every day.`;
  }
  if (i.sessionsCompleted >= 3 && i.calciumDaysOnTarget >= 3) {
    return `${cap(prefix)}you're building two habits at once this week — the kind your future self will thank you for.`;
  }
  if (i.sessionsCompleted >= 3) {
    return `${cap(prefix)}three calm sessions in a week is the rhythm of someone taking themselves seriously.`;
  }
  if (i.calciumDaysOnTarget >= 3) {
    return `${cap(prefix)}you're feeding your bones consistently — the slow, important kind of care.`;
  }
  return `${cap(prefix)}every small bone-friendly choice this week is a deposit in your future self.`;
}
