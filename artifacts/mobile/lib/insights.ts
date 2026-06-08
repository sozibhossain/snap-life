/**
 * Insights engine — turns the user's existing data (wellbeing, nutrition,
 * mood, sessions, FRAX, streak) into 1-3 short, encouraging, non-clinical
 * lines we can surface anywhere in the app (dashboard strip, Bone Buddy
 * proactive prompts, weekly SNAP Shot).
 *
 * Deterministic by design: same input → same output. The Adaptive
 * Intelligence milestone (Task #6) layers an LLM on top of this for richer
 * voice; v1 keeps the copy in code so we can ship without an LLM call on
 * the hot path.
 *
 * Public contract:
 *   generateInsights(profile)        → string[] of length 1..3 (never empty)
 *   generateRankedInsights(profile)  → Insight[] (id/priority/text) for
 *                                      callers that need metadata (e.g. dedupe
 *                                      across renders, A/B telemetry).
 *
 * Tone: intelligent, calm, personal, never over-gamified. No emojis.
 * Always written as a complete sentence in plain conversational en-GB.
 */

import type { NervousSystemState } from "./nervousSystem";

export interface InsightProfile {
  /** First name if available — used to soften the voice when present. */
  firstName?: string;
  /** Days the user has been on SNAP Life. */
  appUsageDays?: number;
  /** Current calm-studio streak in days. */
  wellbeingStreak?: number;
  /** Sessions completed in the past 7 days. */
  weekSessions?: number;
  /** Wellbeing 0-100 today (calm-studio score). */
  todayScore?: number;
  /** Nervous-system readout — see deriveNervousSystem. */
  nervousState?: NervousSystemState;
  /** Today's calcium intake in mg. */
  calciumTodayMg?: number;
  /** Calcium target in mg. */
  calciumTargetMg?: number;
  /** Number of days in the past 7 the user hit their calcium target. */
  calciumDaysOnTarget7d?: number;
  /** FRAX risk band derived from latest DEXA. */
  fractureRisk?: "low" | "moderate" | "high";
  /** Has the user ever logged a DEXA scan. */
  hasDexa?: boolean;
  /** Mood of the most recent calm session, if any. */
  lastMood?: "calm" | "energised" | "less_stressed" | "focused" | "still_tense";
  /** ms since epoch the user opened/used the app last; used to detect quiet stretches. */
  lastActiveAt?: number;
  /** Override "now" for deterministic tests. */
  now?: number;
}

/**
 * Internal ranked insight shape. `id` lets callers dedupe across renders,
 * `priority` orders the picks (higher first), `text` is the user-facing line.
 */
export interface Insight {
  id: string;
  priority: number;
  text: string;
}

const ONE_DAY_MS = 86_400_000;
const MAX_INSIGHTS = 3;

/**
 * Build the ranked candidate list. Stable across renders for identical input.
 * Always returns at least one line (the gentle welcome fallback) so callers
 * never have to handle an empty array.
 */
export function generateRankedInsights(profile: InsightProfile): Insight[] {
  const candidates: Insight[] = [];
  const name = profile.firstName?.trim();
  const namePrefix = name ? `${name}, ` : "";
  const now = profile.now ?? Date.now();

  // 1) Consistency win — strong streak or solid week.
  if ((profile.wellbeingStreak ?? 0) >= 3) {
    candidates.push({
      id: "consistency-streak",
      priority: 80,
      text: `${cap(namePrefix)}you've kept a ${profile.wellbeingStreak}-day calm streak going — that's exactly the rhythm bones love.`,
    });
  } else if ((profile.weekSessions ?? 0) >= 4) {
    candidates.push({
      id: "consistency-week",
      priority: 70,
      text: `${cap(namePrefix)}four sessions this week is a quietly impressive run — keep it gentle and steady.`,
    });
  }

  // 2) Mood improvement after sessions.
  if (profile.lastMood && profile.lastMood !== "still_tense") {
    const moodLine =
      profile.lastMood === "calm"
        ? "you felt calm after your last session"
        : profile.lastMood === "energised"
          ? "you came out of your last session a little more energised"
          : profile.lastMood === "less_stressed"
            ? "your last session helped you feel less stressed"
            : "your last session helped you feel more focused";
    candidates.push({
      id: "mood-after-session",
      priority: 65,
      text: `${cap(namePrefix)}${moodLine} — that's worth noticing.`,
    });
  }

  // 3) Calcium streak supporting bones.
  const target = profile.calciumTargetMg ?? 0;
  const today = profile.calciumTodayMg ?? 0;
  const onTarget7d = profile.calciumDaysOnTarget7d ?? 0;
  if (target > 0 && onTarget7d >= 4) {
    candidates.push({
      id: "calcium-streak",
      priority: 75,
      text: `${cap(namePrefix)}you've hit your calcium goal on ${onTarget7d} of the last 7 days — your bones are getting what they need.`,
    });
  } else if (target > 0 && today >= target) {
    candidates.push({
      id: "calcium-today",
      priority: 55,
      text: `${cap(namePrefix)}you're already at your calcium goal for today — a nice quiet win.`,
    });
  }

  // 4) Low-engagement gentle nudge — only if quiet for a while.
  const lastActive = profile.lastActiveAt;
  if (lastActive && now - lastActive >= 3 * ONE_DAY_MS) {
    candidates.push({
      id: "gentle-return",
      priority: 50,
      text: `${cap(namePrefix)}a few quiet days here is fine — when you're ready, even a four-minute breathing reset will help.`,
    });
  }

  // 5) Nervous-state acknowledgement.
  if (profile.nervousState === "stressed") {
    candidates.push({
      id: "nervous-stressed",
      priority: 90,
      text: `${cap(namePrefix)}things have felt a bit tense lately — a slow, guided breath is the gentlest way back.`,
    });
  } else if (profile.nervousState === "calm") {
    candidates.push({
      id: "nervous-calm",
      priority: 60,
      text: `${cap(namePrefix)}your nervous system is reading calm right now — a lovely place to protect.`,
    });
  } else if (profile.nervousState === "balanced") {
    candidates.push({
      id: "nervous-balanced",
      priority: 45,
      text: `${cap(namePrefix)}you're sitting in a balanced spot today — a small top-up will keep it that way.`,
    });
  }

  // 6) Weekly identity reinforcement — softer "who you're becoming" line.
  const usage = profile.appUsageDays ?? 0;
  if (usage >= 14) {
    if (profile.fractureRisk === "high") {
      candidates.push({
        id: "identity-high-risk",
        priority: 40,
        text: `${cap(namePrefix)}two weeks in and you're showing up for your bones every week — that consistency matters more than any single number.`,
      });
    } else if (profile.hasDexa) {
      candidates.push({
        id: "identity-tracking",
        priority: 35,
        text: `${cap(namePrefix)}you're someone who tracks and acts on their bone health now — that quiet identity shift is the win.`,
      });
    } else {
      candidates.push({
        id: "identity-general",
        priority: 30,
        text: `${cap(namePrefix)}two weeks of small, daily care for your bones — that's the habit doing its work.`,
      });
    }
  }

  // De-dupe by id, sort by priority, return top 3.
  const seen = new Set<string>();
  const ordered = candidates
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_INSIGHTS);

  // Deterministic fallback so callers never receive an empty list.
  if (ordered.length === 0) {
    ordered.push({
      id: "welcome",
      priority: 10,
      text: `${cap(namePrefix)}every small bone-friendly choice today is one your future self will thank you for.`,
    });
  }
  return ordered;
}

/**
 * Public surface. Returns 1..3 ready-to-render strings (deterministic,
 * never empty). Use this in the UI; reach for `generateRankedInsights`
 * only when you also need ids/priorities for telemetry or de-dupe.
 */
export function generateInsights(profile: InsightProfile): string[] {
  return generateRankedInsights(profile).map((i) => i.text);
}

/** Capitalise the first letter — handy when a name prefix is missing. */
function cap(s: string): string {
  if (!s) return s;
  return s[0]!.toUpperCase() + s.slice(1);
}
