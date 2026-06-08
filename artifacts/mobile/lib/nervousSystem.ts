/**
 * Nervous System derivation — maps a user's recent calm-studio behaviour onto
 * one of three states the rest of the app can render and react to:
 *
 *   • calm       — recently engaged, mostly positive moods
 *   • balanced   — some engagement, mixed moods, or quiet day
 *   • stressed   — long gap since last session, or a run of negative moods
 *
 * Pure & dependency-free so it can be reused on the server (push copy,
 * scheduled nudges) and inside React without an extra context.
 *
 * v1 keeps the logic deliberately simple and explainable. The Adaptive
 * Intelligence milestone (Task #6) will broaden the inputs (interaction
 * events, time-of-day patterns) and the windowing (7-day primary, 30-day
 * background trend).
 */

export type NervousSystemState = "calm" | "balanced" | "stressed";

export type SessionKind = "breathing" | "meditation";
export type Mood = "calm" | "energised" | "less_stressed" | "focused" | "still_tense";

const POSITIVE_MOODS = new Set<Mood>(["calm", "energised", "less_stressed", "focused"]);

export interface NervousSystemEntry {
  kind: SessionKind;
  mood: Mood;
  /** ms since epoch — typically `WellbeingEntry.completedAt`. */
  completedAt: number;
}

export interface NervousSystemInput {
  entries: NervousSystemEntry[];
  /** Override "now" for deterministic tests. Defaults to Date.now(). */
  now?: number;
}

export interface NervousSystemReadout {
  state: NervousSystemState;
  /** Short human label safe for UI ("Calm" / "Balanced" / "Stressed"). */
  label: string;
  /** One-line explanation of *why* the state was chosen. */
  reason: string;
  /** Recommended next session shape — UI can map to a specific session id. */
  recommendation: NervousSystemRecommendation;
}

export interface NervousSystemRecommendation {
  /** Which screen to send the user to. */
  surface: "breathing" | "meditation";
  /** Lightweight session hint (e.g. "calm", "energy", "focus", "sleep" for
   *  breathing; "stress-relief", "sleep-support", "focus-clarity",
   *  "confidence" for meditation). The mobile UI can honour this loosely. */
  sessionHint: string;
  /** Short, copy-ready title — already framed in plain conversational en-GB. */
  title: string;
  /** Optional one-line subtitle / why. */
  subtitle: string;
}

const ONE_DAY_MS = 86_400_000;

/**
 * Derive the user's current nervous-system state from recent calm-studio
 * activity. Last 7 days are weighted heaviest; older entries are ignored.
 */
export function deriveNervousSystem(input: NervousSystemInput): NervousSystemReadout {
  const now = input.now ?? Date.now();
  const sevenDaysAgo = now - 7 * ONE_DAY_MS;
  const recent = input.entries.filter((e) => e.completedAt >= sevenDaysAgo);
  const lastEntry = input.entries.reduce<NervousSystemEntry | null>(
    (acc, e) => (acc && acc.completedAt > e.completedAt ? acc : e),
    null,
  );

  // Stressed: no engagement at all in 7 days, or last 3 sessions were all
  // "still tense", or no entries on file.
  if (!lastEntry) {
    return readoutFor("stressed", "We haven't met in the calm studio yet.");
  }
  const hoursSinceLast = (now - lastEntry.completedAt) / 3_600_000;
  if (hoursSinceLast >= 168) {
    return readoutFor("stressed", "It's been over a week since your last reset.");
  }

  const lastThree = [...input.entries]
    .sort((a, b) => b.completedAt - a.completedAt)
    .slice(0, 3);
  const allTense =
    lastThree.length === 3 && lastThree.every((e) => e.mood === "still_tense");
  if (allTense) {
    return readoutFor("stressed", "Your last few sessions still felt tense.");
  }

  // Calm: at least 3 sessions in the past 7 days AND the most recent two
  // moods were positive.
  const lastTwo = lastThree.slice(0, 2);
  const lastTwoPositive =
    lastTwo.length >= 1 && lastTwo.every((e) => POSITIVE_MOODS.has(e.mood));
  if (recent.length >= 3 && lastTwoPositive) {
    return readoutFor(
      "calm",
      "You've shown up consistently and felt better afterwards.",
    );
  }

  // Balanced: anything in between.
  return readoutFor(
    "balanced",
    recent.length === 0
      ? "Quiet week so far — a small reset can keep you steady."
      : "You've been ticking along — a short session would top you up.",
  );
}

function readoutFor(state: NervousSystemState, reason: string): NervousSystemReadout {
  const label =
    state === "calm" ? "Calm" : state === "balanced" ? "Balanced" : "Stressed";
  return {
    state,
    label,
    reason,
    recommendation: recommendFor(state),
  };
}

/**
 * Map a state to the gentlest next session that suits it. Kept as a pure
 * function so push copy, dashboard cards and the Bone Buddy chat can all
 * agree on what to recommend.
 */
export function recommendFor(state: NervousSystemState): NervousSystemRecommendation {
  if (state === "calm") {
    return {
      surface: "meditation",
      sessionHint: "focus-clarity",
      title: "Keep your edge with a 5-min focus session",
      subtitle: "You're in a good rhythm — let's protect it.",
    };
  }
  if (state === "balanced") {
    return {
      surface: "breathing",
      sessionHint: "calm",
      title: "Try a 4-minute calm breathing reset",
      subtitle: "A small pause to top up how you're feeling today.",
    };
  }
  // stressed
  return {
    surface: "breathing",
    sessionHint: "calm",
    title: "Take 4 minutes to settle your nervous system",
    subtitle: "A slow, guided breath is the gentlest way back.",
  };
}
