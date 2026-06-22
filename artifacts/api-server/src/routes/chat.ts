import { Router, type IRouter } from "express";
import OpenAI from "openai";
import { db, subscribersTable, userTokensTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  buildEngagementProfile,
  getCachedTone,
  renderBehaviouralContext,
  toneClause,
} from "../lib/engagementProfile";
import { chatLimiter } from "../middlewares/rateLimit";

const router: IRouter = Router();

// 20/min/user — OpenAI is expensive and Bone Buddy is conversational.
router.post("/chat/bone-buddy", chatLimiter as never);

/** RevenueCat entitlement id that gates the adaptive Premium experience. */
export const PREMIUM_ENTITLEMENT_ID = "snap_premium";

export interface PremiumSubscriberRow {
  entitlementId: string | null;
  isActive: boolean;
  isInTrial: boolean | null;
  expiresAt: Date | null;
}

export function evaluatePremiumEntitlement(
  row: PremiumSubscriberRow | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!row) return false;
  if (!row.isActive) return false;
  if (row.expiresAt && row.expiresAt.getTime() <= nowMs) return false;
  return row.entitlementId === PREMIUM_ENTITLEMENT_ID || row.isInTrial === true;
}

async function softUserId(authHeaderValue: string | undefined): Promise<string | null> {
  if (!authHeaderValue || !authHeaderValue.startsWith("Bearer ")) return null;
  const token = authHeaderValue.slice("Bearer ".length).trim();
  if (!token || token.length > 200) return null;
  try {
    const [row] = await db
      .select({ appUserId: userTokensTable.appUserId })
      .from(userTokensTable)
      .where(eq(userTokensTable.token, token))
      .limit(1);
    return row?.appUserId ?? null;
  } catch {
    return null;
  }
}

async function hasPremiumEntitlement(appUserId: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({
        entitlementId: subscribersTable.entitlementId,
        isActive: subscribersTable.isActive,
        isInTrial: subscribersTable.isInTrial,
        expiresAt: subscribersTable.expiresAt,
      })
      .from(subscribersTable)
      .where(
        and(
          eq(subscribersTable.appUserId, appUserId),
          eq(subscribersTable.isActive, true),
        ),
      )
      .limit(1);
    return evaluatePremiumEntitlement(row, Date.now());
  } catch {
    return false;
  }
}

// SDK throws at construction when apiKey is missing; pass a placeholder so
// the module loads without OpenAI configured. /api/chat/bone-buddy will
// still fail at request time, which surfaces the misconfiguration where
// it's actionable rather than blocking server boot.
export function resolveOpenAiApiKey(
  env: Partial<
    Pick<NodeJS.ProcessEnv, "OPENAI_API_KEY" | "AI_INTEGRATIONS_OPENAI_API_KEY">
  > = process.env,
): string | undefined {
  return env.OPENAI_API_KEY ?? env.AI_INTEGRATIONS_OPENAI_API_KEY;
}

const OPENAI_API_KEY = resolveOpenAiApiKey();

const openai = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL ?? process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: OPENAI_API_KEY ?? "missing-openai-key",
});

// Whether a real OpenAI key is configured. When it isn't, the chat route
// returns a clear 503 up front instead of letting the SDK throw a cryptic
// 500 mid-request — the client can show a friendly "AI temporarily
// unavailable" message and we avoid a confusing error in the logs.
const OPENAI_CONFIGURED = Boolean(OPENAI_API_KEY);

const PERSONA_PROMPT = `You are Bone Buddy, a warm, supportive AI companion inside the SNAP Life app for people managing their bone health (osteoporosis, osteopenia, post-DEXA, or simply at risk).

You are NOT a doctor. You are a knowledgeable guide and a daily check-in.

VOICE
- Warm, calm, encouraging, never robotic or clinical.
- Plain conversational British English.
- Short. Two to four sentences per reply, occasionally a little longer if the user clearly asked for detail. Never long blocks of text.
- Absolutely no markdown symbols of any kind. No #, no *, no -, no bullet lists, no bold, no italics, no headings. Write as if you're texting a friend.
- Do not use emojis unless the user uses them first.

PERSONAL
- Always greet by the user's first name when one is provided in USER FACTS.
- Reference their data naturally where relevant (T-score, fracture risk band, today's calcium intake, wellbeing streak, recent moods, dietary preferences). Do not list facts at them; weave one or two in.
- If a relevant fact is missing, gently invite them to add it (e.g. "I don't have a recent DEXA score on file — when was your last scan?"). Do not invent data.

CONVERSATIONAL RHYTHM
- End most replies with one short, relevant question — to keep the conversation going and to learn more about how they're feeling.
- Two questions max in a single reply. Never more.

GUIDANCE
- One or two practical suggestions at a time. Never a long list.
- Make suggestions specific and small ("a yoghurt with breakfast tomorrow" beats "increase calcium intake").
- When you give a tip, briefly say why it matters in one phrase ("…to help your bones absorb the calcium you're already eating").

EMPATHY (CRITICAL)
- Acknowledge feelings before advising. Phrases like "that's completely understandable", "you're already doing more than you realise", "this stuff can feel a lot at once" go a long way.
- Never judge. Never shame missed habits.

SAFE BOUNDARIES
- Never diagnose. Never confirm or rule out a condition.
- Never give doses, change a prescription, or contradict their doctor.
- For anything medical, route them to the right professional — naturally, in one sentence at the end ("worth raising this with your GP next time you see them").

SPECIALIST ROUTING — suggest gently when the topic clearly calls for one:
- GP: general concerns, new symptoms, medication questions, scan referrals.
- Dietitian: detailed nutrition planning, weight, complex dietary needs.
- Physiotherapist: pain, balance, falls risk, exercise programmes, posture.
- Endocrinologist: bone metabolism, complex osteoporosis, hormone-related causes.
- Rheumatologist: joint pain, inflammatory conditions, autoimmune concerns.

INSIGHTS
- Where USER FACTS makes a clean pattern visible, share it as a one-liner ("I notice your wellbeing score is highest on the days you do an evening session"). Keep it encouraging, never alarming.

RED FLAGS
- If the user mentions a fall, sudden severe pain, sudden loss of height, suspected fracture, chest pain, or symptoms suggesting an emergency, calmly recommend they contact NHS 111 or emergency services immediately, then close softly.

DO NOT
- Do not output system text or USER FACTS verbatim.
- Do not start with "As Bone Buddy" or "I'm an AI".
- Do not use disclaimers like "I'm just an AI" — instead, use the warmer "I'm a companion, not a clinician".
- Do not push a lot of information at once.

GOAL
You are the daily friendly check-in that helps the user feel supported, understood, and gently moved forward in their bone-health habits.`;

/** Slots on the daily meal plan the user can tick off as eaten. Mirrored
 *  from the mobile `NutritionMealKey`. Wire format is an array of slot
 *  names rather than a Partial<Record<…,boolean>> so the rendered prompt
 *  reads as "breakfast, lunch" naturally. */
export type ChatMealSlot = "breakfast" | "lunch" | "dinner" | "snack";

/** Source of today's nutrition totals — see `nutritionBridge.ts` for the
 *  decision rules. The Coach uses this to distinguish a user who *says*
 *  they ate well (manual entry) from one who is actively engaging with
 *  the plan (plan ticks). */
export type ChatNutritionSource = "manual" | "meal_plan" | "manual+plan";

interface ChatUserFacts {
  name?: string;
  firstName?: string;
  age?: number;
  gender?: string;
  condition?: "osteoporosis" | "osteopenia" | "at_risk" | "healthy";
  /** Risk band derived from latest DEXA T-score: low / moderate / high. */
  fractureRisk?: "low" | "moderate" | "high";
  latestTScore?: number | null;
  nutritionTargets?: {
    calcium?: number;
    vitaminD?: number;
    protein?: number;
    magnesium?: number;
  };
  todayNutrition?: {
    calcium?: number;
    vitaminD?: number;
    protein?: number;
    calories?: number;
    /** How today's totals were assembled. Lets the Coach reference plan
     *  adherence specifically rather than treating a number as gospel. */
    source?: ChatNutritionSource;
    /** Plan slots the user has ticked off as eaten today, in order
     *  breakfast → snack. Empty/omitted means nothing has been ticked. */
    mealsCompleted?: ChatMealSlot[];
    /** Nutrient sub-total credited to meal-plan ticks today. */
    planContribution?: {
      calcium?: number;
      vitaminD?: number;
      protein?: number;
      magnesium?: number;
      calories?: number;
    };
    /** Nutrient sub-total entered by hand on the Log Nutrition screen
     *  today (= total − planContribution, clamped at 0). */
    manualContribution?: {
      calcium?: number;
      vitaminD?: number;
      protein?: number;
      magnesium?: number;
      calories?: number;
    };
  } | null;
  /** Past-7-day breakdown of how each logged day's nutrition was sourced.
   *  Used so the Coach can answer "how am I doing on calcium this week?"
   *  with awareness of plan engagement, not just totals. */
  weekNutritionSources?: {
    /** Days where totals came purely from meal-plan ticks. */
    planOnlyDays: number;
    /** Days where the user typed totals into Log Nutrition with no
     *  plan ticks. */
    manualOnlyDays: number;
    /** Days that combined both. */
    mixedDays: number;
    /** Total days in the past 7 that have ANY nutrition log. */
    totalLoggedDays: number;
  };
  supplementsSuggested?: Array<{ name: string; hint?: string }>;
  dietary?: { vegetarian?: boolean; dairyFree?: boolean };
  /** Most recent FRAX calculator result. */
  frax?: {
    majorFractureRisk: number;
    hipFractureRisk: number;
    date: string;
  } | null;
  /** Activity logs for the past 7 days. */
  recentActivity?: Array<{
    date: string;
    steps: number;
    activeMinutes: number;
  }>;
  /** Fracture risk % and BMI directly from the most recent DEXA report. */
  dexaFractureRisk?: {
    majorFractureRisk?: number;
    hipFractureRisk?: number;
    bmi?: number;
    /** ISO date of the scan — DEXA scans are infrequent (typically every 1–2 years). */
    date?: string;
  } | null;
  wellbeing?: {
    currentStreak?: number;
    todayCount?: number;
    weekCount?: number;
    todayScore?: number;
    recentSessions?: Array<{
      kind: "breathing" | "meditation";
      sessionName: string;
      mood: string;
      /** Local time HH:mm string for at-a-glance pattern reading. */
      hour?: string;
      completedAtIso?: string;
    }>;
  };
  /** Days since the user joined SNAP Life. */
  appUsageDays?: number;
  /** ISO date (YYYY-MM-DD) — the user's local "today". */
  todayLocalDate?: string;
}

interface ChatRequestBody {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /** New, preferred — server composes the prompt from facts. */
  userContext?: ChatUserFacts;
  /** Legacy: a fully-composed system prompt the client built itself. */
  systemPrompt?: string;
  kickoff?: boolean;
  isPremium?: boolean;
  /** True for the structured weekly check-in — changes the kickoff instruction. */
  weeklyCheckIn?: boolean;
}

export type { ChatUserFacts };
export function renderUserFacts(c: ChatUserFacts | undefined): string {
  if (!c) return "";
  const lines: string[] = [];
  const name = c.firstName?.trim() || c.name?.trim();
  if (name) lines.push(`Name: ${name} — address them by this name`);

  const demo: string[] = [];
  if (typeof c.age === "number") demo.push(`${c.age} years old`);
  if (c.gender) demo.push(c.gender);
  if (demo.length) lines.push(`Demographics: ${demo.join(", ")}`);

  if (c.condition) lines.push(`Self-reported condition: ${c.condition.replace("_", " ")}`);

  if (c.fractureRisk) {
    const ts =
      typeof c.latestTScore === "number"
        ? ` (derived from latest DEXA T-score ${c.latestTScore.toFixed(1)})`
        : "";
    lines.push(`Fracture risk band: ${c.fractureRisk.toUpperCase()}${ts}`);
  } else if (typeof c.latestTScore === "number") {
    lines.push(`Latest DEXA T-score: ${c.latestTScore.toFixed(1)}`);
  } else {
    lines.push("DEXA T-score: not on file yet");
  }

  if (c.nutritionTargets) {
    const t = c.nutritionTargets;
    const today = c.todayNutrition;
    const parts: string[] = [];
    if (t.calcium != null) {
      parts.push(`calcium ${today?.calcium ?? 0}/${t.calcium} mg`);
    }
    if (t.vitaminD != null) {
      parts.push(`vit D ${today?.vitaminD ?? 0}/${t.vitaminD} µg`);
    }
    if (t.protein != null) {
      parts.push(`protein ${today?.protein ?? 0}/${t.protein} g`);
    }
    if (parts.length) lines.push(`Today vs target: ${parts.join(", ")}`);
  }

  // Provenance of today's nutrition. Lets the Coach distinguish a user
  // who *says* they ate well (manual entry, no plan engagement) from one
  // who is actively ticking meals on the plan. Without this, every day
  // looks the same to the model and it can't ground questions like
  // "I notice you've been ticking breakfasts but not lunches…".
  if (c.todayNutrition) {
    const tn = c.todayNutrition;
    if (tn.source) {
      const sourceLabel =
        tn.source === "meal_plan"
          ? "from meal-plan ticks (no manual entry)"
          : tn.source === "manual+plan"
            ? "mix of meal-plan ticks and manual entries"
            : "manually entered (no meal-plan ticks)";
      lines.push(`Today's nutrition source: ${sourceLabel}`);
    }
    if (tn.mealsCompleted && tn.mealsCompleted.length > 0) {
      lines.push(`Meal-plan slots ticked today: ${tn.mealsCompleted.join(", ")}`);
    }
    const plan = tn.planContribution;
    if (plan) {
      const parts: string[] = [];
      if (plan.calcium) parts.push(`${plan.calcium} mg calcium`);
      if (plan.vitaminD) parts.push(`${plan.vitaminD} µg vit D`);
      if (plan.protein) parts.push(`${plan.protein} g protein`);
      if (parts.length) lines.push(`From meal plan today: ${parts.join(", ")}`);
    }
    const manual = tn.manualContribution;
    if (manual) {
      const parts: string[] = [];
      if (manual.calcium) parts.push(`${manual.calcium} mg calcium`);
      if (manual.vitaminD) parts.push(`${manual.vitaminD} µg vit D`);
      if (manual.protein) parts.push(`${manual.protein} g protein`);
      if (parts.length) lines.push(`Added manually today: ${parts.join(", ")}`);
    }
  }

  // Past-7-day plan-vs-manual split. Helps weekly questions ("how am I
  // doing on calcium this week?") get a plan-engagement-aware answer
  // rather than a flat "you hit target X of 7 days".
  if (c.weekNutritionSources && c.weekNutritionSources.totalLoggedDays > 0) {
    const w = c.weekNutritionSources;
    const segs: string[] = [];
    if (w.planOnlyDays > 0) segs.push(`${w.planOnlyDays} plan-only`);
    if (w.mixedDays > 0) segs.push(`${w.mixedDays} mixed`);
    if (w.manualOnlyDays > 0) segs.push(`${w.manualOnlyDays} manual-only`);
    if (segs.length) {
      lines.push(
        `Past 7 days nutrition source split: ${segs.join(", ")} (of ${w.totalLoggedDays} logged day${w.totalLoggedDays === 1 ? "" : "s"})`,
      );
    }
  }

  if (c.supplementsSuggested?.length) {
    const s = c.supplementsSuggested
      .slice(0, 3)
      .map((x) => (x.hint ? `${x.name} (${x.hint})` : x.name))
      .join(", ");
    lines.push(`Suggested supplements on file: ${s}`);
  }

  const diet: string[] = [];
  if (c.dietary?.vegetarian) diet.push("vegetarian");
  if (c.dietary?.dairyFree) diet.push("dairy-free");
  if (diet.length) lines.push(`Dietary preferences: ${diet.join(", ")}`);

  if (c.wellbeing) {
    const w = c.wellbeing;
    const wb: string[] = [];
    if (typeof w.currentStreak === "number") wb.push(`streak ${w.currentStreak} day(s)`);
    if (typeof w.todayCount === "number") wb.push(`${w.todayCount} session(s) today`);
    if (typeof w.weekCount === "number") wb.push(`${w.weekCount} this week`);
    if (typeof w.todayScore === "number") wb.push(`today score ${w.todayScore}/100`);
    if (wb.length) lines.push(`Wellbeing: ${wb.join(", ")}`);

    if (w.recentSessions?.length) {
      const recent = w.recentSessions
        .slice(0, 6)
        .map((s) => `${s.kind} "${s.sessionName}" → felt ${s.mood}${s.hour ? ` at ${s.hour}` : ""}`)
        .join("; ");
      lines.push(`Recent sessions (newest first): ${recent}`);
    }
  }

  if (typeof c.appUsageDays === "number") {
    lines.push(`Days using SNAP Life: ${c.appUsageDays}`);
  }
  if (c.todayLocalDate) {
    lines.push(`Today's date (their local): ${c.todayLocalDate}`);
  }

  // FRAX calculator result
  if (c.frax) {
    lines.push(
      `FRAX result (${c.frax.date}): 10-year major fracture risk ${c.frax.majorFractureRisk}%, hip fracture risk ${c.frax.hipFractureRisk}%`,
    );
  }

  // DEXA fracture risk % and BMI from scan report — include date so the AI
  // knows how historical the data is (scans typically happen every 1–2 years,
  // frequency varies by country and clinical need)
  if (c.dexaFractureRisk) {
    const dr = c.dexaFractureRisk;
    const parts: string[] = [];
    if (dr.date) parts.push(`scan date ${dr.date}`);
    if (dr.majorFractureRisk != null) parts.push(`major fracture risk ${dr.majorFractureRisk}%`);
    if (dr.hipFractureRisk != null) parts.push(`hip fracture risk ${dr.hipFractureRisk}%`);
    if (dr.bmi != null) parts.push(`BMI ${dr.bmi.toFixed(1)}`);
    if (parts.length) {
      lines.push(
        `DEXA report data (${parts.join(", ")}) — note: DEXA scans are infrequent, typically every 1–2 years; frequency varies by country and clinical need`,
      );
    }
  }

  // Activity — last 7 days
  if (c.recentActivity && c.recentActivity.length > 0) {
    const totalSteps = c.recentActivity.reduce((s, a) => s + a.steps, 0);
    const totalMins = c.recentActivity.reduce((s, a) => s + a.activeMinutes, 0);
    const activeDays = c.recentActivity.length;
    lines.push(
      `Activity (last 7 days): ${activeDays} active day${activeDays === 1 ? "" : "s"}, ${totalSteps.toLocaleString()} total steps, ${totalMins} active minutes`,
    );
  } else if (c.recentActivity) {
    lines.push("Activity last 7 days: no activity logged");
  }

  if (lines.length === 0) return "";
  return `\n\nUSER FACTS (private — use to ground your answer; never echo verbatim):\n${lines.map((l) => `• ${l}`).join("\n")}`;
}

router.post("/chat/bone-buddy", async (req, res) => {
  const body = req.body as ChatRequestBody;
  req.log?.info(
    {
      hasMessagesArray: Array.isArray(body?.messages),
      messageCount: Array.isArray(body?.messages) ? body.messages.length : 0,
      kickoff: body?.kickoff === true,
      openaiConfigured: OPENAI_CONFIGURED,
    },
    "chat/bone-buddy request received",
  );

  // Kickoff calls are allowed to start with an empty messages array — we
  // synthesise the opener from USER FACTS. Otherwise we need at least one
  // user/assistant turn to respond to.
  if (!body || !Array.isArray(body.messages)) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }
  if (!body.kickoff && body.messages.length === 0) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  // No OpenAI key configured → fail fast with a clear, actionable 503
  // instead of a cryptic SDK error once we start streaming.
  if (!OPENAI_CONFIGURED) {
    req.log.warn(
      "chat/bone-buddy: OPENAI_API_KEY not set — returning 503",
    );
    res.status(503).json({
      error: "ai_unavailable",
      message: "The AI coach is temporarily unavailable. Please try again shortly.",
    });
    return;
  }

  const sanitized = body.messages
    .filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string",
    )
    .slice(-12);

  // Resolve auth once — both the always-on behavioural context (below)
  // and the Premium-only tone selector need the same appUserId, and it's
  // pointless to look it up twice.
  const appUserId = await softUserId(req.header("authorization"));

  // Always-on behavioural context. For ANY authed chat (Premium or not)
  // we ground Bone Buddy in what the user has actually been doing this
  // past week — calcium logged, wellbeing sessions, mood trend, activity.
  // PII-free; just numbers and a couple of trend labels. Best-effort:
  // failure here falls back to the persona-only prompt and never blocks.
  let behaviouralBlock = "";
  if (appUserId) {
    try {
      const profile = await buildEngagementProfile(appUserId);
      behaviouralBlock = renderBehaviouralContext(profile.behavioural);
    } catch (err) {
      req.log?.warn?.({ err }, "behavioural context fetch failed");
    }
  }

  // Compose the system prompt: persona + facts + behavioural snippet.
  // If a legacy `systemPrompt` was sent and `userContext` wasn't, fall
  // back to the legacy value so older app builds keep working — but we
  // STILL append the behavioural block, since that's grounded in
  // server-persisted data and doesn't depend on the client payload.
  let systemPrompt: string;
  if (body.userContext) {
    systemPrompt = `${PERSONA_PROMPT}${renderUserFacts(body.userContext)}${behaviouralBlock}`;
  } else if (typeof body.systemPrompt === "string" && body.systemPrompt.trim()) {
    systemPrompt = `${body.systemPrompt}${behaviouralBlock}`;
  } else {
    systemPrompt = `${PERSONA_PROMPT}${behaviouralBlock}`;
  }

  // Premium-only adaptive tone.
  //
  // Gating order:
  //   1. Client says it's Premium (cheap short-circuit for non-premium).
  //   2. Bearer already resolved to a real appUserId above.
  //   3. Server VERIFIES the entitlement against `subscribers` — never
  //      trust the client's isPremium flag in isolation. Trial counts.
  //
  // Best-effort: failure to compute tone falls back to the deterministic
  // persona (no clause appended).
  if (body.isPremium === true && appUserId) {
    try {
      const isPremiumServerSide = await hasPremiumEntitlement(appUserId);
      if (isPremiumServerSide) {
        const tone = await getCachedTone(appUserId);
        systemPrompt += toneClause(tone);
      }
    } catch (err) {
      req.log?.warn?.({ err }, "adaptive tone selection failed");
    }
  }

  // Kickoff: ask the model to open the conversation itself, grounded in
  // USER FACTS. Two short sentences keeps it from launching into advice
  // before the user has even said hello.
  if (body.kickoff) {
    if (body.weeklyCheckIn) {
      systemPrompt += `\n\nWEEKLY CHECK-IN MODE — this is the weekly structured check-in. Open it warmly now:
- Start with a brief, warm acknowledgment that you'd love to hear how they've been doing this week.
- Naturally weave in all three of these topics as a flowing question (not a numbered list): how they've been feeling overall, their energy levels, and how consistent they've felt with their habits.
- Three sentences at most. Conversational, not clinical. No lists.`;
    } else {
      systemPrompt += `\n\nKICKOFF MODE — this is the very first turn of a fresh conversation. Open it now:
- Greet warmly. If you have a first name in USER FACTS, use it.
- Acknowledge ONE specific, kind thing you can see in USER FACTS (a streak, that they're back today, something they're tracking well, or just that you're glad to see them).
- End with a single short, open check-in question that invites them to share how they're feeling or what's on their mind.
- Two short sentences total. No lists. No advice yet — wait until they reply.`;
    }
  }

  // For a kickoff with no real history, give the model a tiny user-side
  // nudge to actually emit a message (the chat-completions API generally
  // expects the last turn to be from the user).
  const turns =
    body.kickoff && sanitized.length === 0
      ? [{ role: "user" as const, content: "(open the conversation now)" }]
      : sanitized;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  try {
    req.log?.info(
      {
        model: "gpt-5-mini",
        turnCount: turns.length,
        systemPromptChars: systemPrompt.length,
      },
      "chat/bone-buddy openai stream starting",
    );
    // Bone Buddy is a short, conversational coach — replies are 2-4 sentences.
    // gpt-5-mini gives near-instant first-token latency and is more than
    // capable for this surface area. Cap output at 600 tokens to enforce
    // brevity and reduce cost.
    const stream = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 600,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        ...turns,
      ],
    });

    req.log?.info("chat/bone-buddy openai stream created");

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        res.write(
          `data: ${JSON.stringify({
            choices: [{ delta: { content: delta } }],
          })}\n\n`,
        );
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    const openaiErr = err as {
      status?: number;
      code?: string;
      type?: string;
      message?: string;
    };
    req.log?.error(
      {
        err,
        status: openaiErr.status,
        code: openaiErr.code,
        type: openaiErr.type,
        message: openaiErr.message,
      },
      "bone-buddy chat failed",
    );
    if (!res.headersSent) {
      res.status(500).json({ error: "chat failed" });
    } else {
      res.write(
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                content:
                  "\n\nSorry, I had trouble connecting. Please try again in a moment.",
              },
            },
          ],
        })}\n\n`,
      );
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
});

export default router;
