/**
 * Per-domain behavioural snapshot from server-persisted data — mirrors
 * `BehaviouralStats` in api-server/src/lib/engagementProfile.ts. PII-free.
 *
 * Lives in its own tiny module (no `react-native` import) so pure-logic
 * helpers like `dailyFocus`, `smartFood`, and `weeklySnap` — and their
 * vitest suites — can import it without dragging the Expo runtime into
 * the test bundle. The fetcher layer in `engagementProfile.ts`
 * re-exports these symbols for backward compatibility with any code
 * that imports them from there.
 *
 * The numbers come from nutrition_logs / wellbeing_entries /
 * activity_logs / user_profile, NOT from rec_* engagement pings, so
 * they reflect what the user has actually been DOING (calcium logged,
 * sessions, active minutes) rather than how they reacted to
 * suggestions. Used to bias adaptive Today's Focus, prioritise Smart
 * Food suggestions, and override the weekly SNAP Shot when the server
 * has authoritative aggregates.
 */

export interface BehaviouralStats {
  nutrition: {
    /** Distinct days in the past 7 with at least one nutrition log row. */
    loggedDays7d: number;
    /** Mean per-day calcium (mg) across logged days; 0 if none logged. */
    avgCalciumMg7d: number;
    /** Mean per-day vitamin D (µg) across logged days; 0 if none. */
    avgVitaminDUg7d: number;
    /** Mean per-day protein (g) across logged days; 0 if none. */
    avgProteinG7d: number;
    /** Days the per-day calcium total met or exceeded the target. */
    calciumDaysOnTarget7d: number;
    /**
     * Calcium target (mg) used to compute `calciumDaysOnTarget7d` —
     * either the user's preference or the 1200 mg default.
     */
    calciumTargetMg: number;
    /** Most recent logged YYYY-MM-DD in the window, or null. */
    lastLoggedDay: string | null;
  };
  wellbeing: {
    /** Calm-studio sessions in the past 7 days. */
    sessions7d: number;
    /** Sessions in the prior 7 days (8–14 days back). */
    sessionsPrev7d: number;
    /** Most recent session timestamp (ms), or null. */
    lastSessionAtMs: number | null;
    /** Mean mood valence across this past week, or null when too few. */
    moodValence7d: number | null;
    /** Mean mood valence across the prior week, or null. */
    moodValencePrev7d: number | null;
    /** Direction of mood vs the prior week. "steady" when too little signal. */
    moodTrend: "improving" | "steady" | "dropping";
    /** Current consecutive-day session streak, including today / +1d grace. */
    currentStreak: number;
    /** All-time longest consecutive-day session streak. Always ≥ currentStreak. */
    longestStreak: number;
  };
  activity: {
    /** Sum of activeMinutes across the past 7 days. */
    activeMinutes7d: number;
    /** Days at or above the 10-minute active floor. */
    activeDays7d: number;
  };
  gamification: {
    level: number;
    xp: number;
    streakDays: number;
    totalPoints: number;
  };
}

/** Empty behavioural snapshot — safe to use as a default in pure code. */
export const EMPTY_BEHAVIOURAL_STATS: BehaviouralStats = {
  nutrition: {
    loggedDays7d: 0,
    avgCalciumMg7d: 0,
    avgVitaminDUg7d: 0,
    avgProteinG7d: 0,
    calciumDaysOnTarget7d: 0,
    calciumTargetMg: 1200,
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
  activity: { activeMinutes7d: 0, activeDays7d: 0 },
  gamification: { level: 1, xp: 0, streakDays: 0, totalPoints: 0 },
};
