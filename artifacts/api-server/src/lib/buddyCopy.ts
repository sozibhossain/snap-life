/**
 * Bone Buddy push-copy composer.
 *
 * Generates one short, calm, name-aware line for the daily nudge by
 * calling the same LLM the chat surface uses, with a tightly-scoped
 * persona prompt. Falls back to a small static line on any error so
 * the push pipeline never silently fails.
 *
 * Kept deliberately tiny (no streaming, ~120-token cap, low retry
 * budget) — push copy is a one-shot, latency-sensitive call.
 */

import OpenAI from "openai";

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

const openai = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL ?? process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  // Placeholder so the SDK construction doesn't throw when no key is set;
  // composeDailyNudgeLine() short-circuits to the static fallback above
  // when OPENAI_API_KEY is unset, so this is never used.
  apiKey: OPENAI_API_KEY ?? "missing-openai-key",
});

const PUSH_PERSONA = `You are Bone Buddy — a warm, calm companion in the SNAP Life bone-health app. Compose a single notification body line.

VOICE
- Warm, calm, plain British English. Like a kind friend texting.
- Absolutely no markdown, no emojis, no bullet points, no headings.
- Maximum 140 characters total.
- One sentence. Two short sentences only if the second is a tiny invitation ("Want to take a four-minute breath?").
- Never push or shame. Never use red-flag urgency words ("must", "should", "you need to").

PERSONAL
- If a first name is provided, lead with it warmly ("Hi <name> — ...").
- If recent context is provided (streak, calcium, last mood), gently weave at most ONE of those facts in.

OUTPUT
- Return ONLY the line itself, with no quotes, no labels, no preamble.`;

export interface BuddyPushFacts {
  firstName?: string;
  /** Current calm-studio streak in days, if any. */
  wellbeingStreak?: number;
  /** Calcium target met (true/false) for today, if known. */
  calciumOnTarget?: boolean;
  /** Recent self-reported mood word from the last calm-studio session. */
  lastMood?: string;
  /** Today's SNAP Life local date (YYYY-MM-DD), used for context only. */
  todayLocalDate?: string;
}

function staticFallback(facts: BuddyPushFacts): string {
  const greeting = facts.firstName ? `Hi ${facts.firstName} — ` : "";
  return `${greeting}just here when you're ready. A four-minute breath would gently top you up.`;
}

function renderFacts(f: BuddyPushFacts): string {
  const lines: string[] = [];
  if (f.firstName) lines.push(`First name: ${f.firstName}`);
  if (typeof f.wellbeingStreak === "number" && f.wellbeingStreak > 0)
    lines.push(`Calm-studio streak: ${f.wellbeingStreak} day(s)`);
  if (typeof f.calciumOnTarget === "boolean")
    lines.push(`Calcium today: ${f.calciumOnTarget ? "on target" : "below target"}`);
  if (f.lastMood) lines.push(`Last mood word: ${f.lastMood}`);
  if (f.todayLocalDate) lines.push(`Today: ${f.todayLocalDate}`);
  return lines.length ? `\n\nUSER FACTS\n${lines.join("\n")}` : "";
}

/**
 * Compose a calm, name-aware daily-nudge line via the chat backend's
 * LLM. Returns the line on success, or a small static fallback on any
 * error / empty response. Never throws.
 */
export async function composeDailyNudgeLine(
  facts: BuddyPushFacts,
): Promise<string> {
  // If the backend isn't configured (local dev without a key), skip the
  // round-trip entirely and use the static fallback.
  if (!OPENAI_API_KEY) {
    return staticFallback(facts);
  }
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 120,
      messages: [
        { role: "system", content: PUSH_PERSONA + renderFacts(facts) },
        {
          role: "user",
          content:
            "Compose today's daily nudge line — one calm, supportive sentence.",
        },
      ],
    });
    const raw = completion.choices?.[0]?.message?.content ?? "";
    const trimmed = raw.trim().replace(/^["']|["']$/g, "");
    // Hard-cap length defensively in case the model overflows.
    const capped = trimmed.length > 180 ? trimmed.slice(0, 177) + "…" : trimmed;
    return capped.length > 0 ? capped : staticFallback(facts);
  } catch {
    return staticFallback(facts);
  }
}
