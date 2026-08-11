import { Router, type IRouter } from "express";
import { db, interactionEventsTable } from "@workspace/db";
import { and, eq, gte, isNotNull, isNull, or, sql } from "drizzle-orm";
import { assertSelf, requireUserAuth } from "../lib/auth";
import { eventsLimiter } from "../middlewares/rateLimit";

const router: IRouter = Router();

// 60/min/user. Mounted only on the write path; reads aren't limited.
router.post("/events", eventsLimiter as never);

/**
 * Whitelisted event kinds — keeps the table tidy and prevents arbitrary
 * client-supplied strings ballooning the kind cardinality. Add new kinds
 * here as the product needs them.
 */
const ALLOWED_KINDS = new Set<string>([
  "session_completed",
  "meal_swapped",
  "calcium_logged",
  "snap_shot_read",
  "today_focus_completed",
  "today_focus_dismissed",
  "push_opened",
  "push_dismissed",
  "bone_buddy_opened",
  "bone_buddy_message_sent",
  "dexa_logged",
  "frax_logged",
  "activity_logged",
  "nutrition_logged",
  "meal_plan_completed",
  "supplement_taken",
  "medication_taken",
  "lesson_completed",
  "breathing_session_completed",
  "meditation_session_completed",
  "community_tab_opened",
  "coaching_booking_requested",
  "expert_support_requested",
  // Recommendation lifecycle — powers the Premium-only adaptive
  // engagement profile (see lib/engagementProfile.ts). Payload should
  // include { surface, recId, recKind } so we can group by surface kind.
  "rec_shown",
  "rec_completed",
  "rec_dismissed",
  // User tapped "Notify me when ready" on the Wearables placeholder
  // screen. Used to size demand for real wearable integrations later.
  "wearables_interest",
  "outcome_checkin_completed",
  "medication_missed",
]);

const MAX_PAYLOAD_BYTES = 4_096;
const DAY_MS = 86_400_000;

interface ValidatedEvent {
  clientEventId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  occurredAtMs: number | null;
  /** Optional client-supplied appUserId — must match the authed user if set. */
  claimedUserId: string | null;
}

function validate(body: unknown): { ok: true; data: ValidatedEvent } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "body required" };
  const b = body as Record<string, unknown>;
  let clientEventId: string | null = null;
  if (b.clientEventId != null) {
    if (
      typeof b.clientEventId !== "string" ||
      b.clientEventId.length < 8 ||
      b.clientEventId.length > 128 ||
      !/^[A-Za-z0-9_-]+$/.test(b.clientEventId)
    ) {
      return { ok: false, error: "clientEventId invalid" };
    }
    clientEventId = b.clientEventId;
  }
  if (typeof b.kind !== "string" || !ALLOWED_KINDS.has(b.kind)) {
    return { ok: false, error: "kind not allowed" };
  }
  let payload: Record<string, unknown> = {};
  if (b.payload != null) {
    if (typeof b.payload !== "object" || Array.isArray(b.payload)) {
      return { ok: false, error: "payload must be an object" };
    }
    try {
      const json = JSON.stringify(b.payload);
      if (json.length > MAX_PAYLOAD_BYTES) {
        return { ok: false, error: "payload too large" };
      }
      payload = JSON.parse(json);
    } catch {
      return { ok: false, error: "payload not serialisable" };
    }
  }
  let occurredAtMs: number | null = null;
  if (b.occurredAtMs != null) {
    const n = Number(b.occurredAtMs);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: "occurredAtMs invalid" };
    occurredAtMs = Math.floor(n);
  }
  const claimedUserId =
    typeof b.appUserId === "string" && b.appUserId.length > 0 ? b.appUserId : null;
  return {
    ok: true,
    data: { clientEventId, kind: b.kind, payload, occurredAtMs, claimedUserId },
  };
}

/**
 * Best-effort write of a single behavioural event. The mobile client fires
 * these in the background and never awaits the response — so we keep the
 * response small and fast (no row returned). Identity comes from the bearer
 * token; any client-supplied `appUserId` is sanity-checked against it.
 */
router.post("/events", async (req, res) => {
  const appUserId = await requireUserAuth(req, res);
  if (!appUserId) return;
  const result = validate(req.body);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  if (assertSelf(res, appUserId, result.data.claimedUserId)) return;
  try {
    await db
      .insert(interactionEventsTable)
      .values({
        appUserId,
        clientEventId: result.data.clientEventId,
        kind: result.data.kind,
        payload: result.data.payload,
        occurredAtMs: result.data.occurredAtMs,
      })
      .onConflictDoNothing();
    res.json({ ok: true });
  } catch (err) {
    req.log?.error({ err }, "interaction event insert failed");
    res.status(500).json({ error: "internal" });
  }
});

/** Cheap IANA timezone validator — `Intl.DateTimeFormat` throws on bad ids. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Return the UTC `Date` whose wall-clock reading in `timeZone` is
 * 00:00:00 on the same calendar day as `now`.
 *
 * The naive shortcut "subtract today's local h/m/s from `now`" is wrong
 * across DST transitions (a spring-forward day measures 23 wall-clock
 * hours from midnight, not 24). So we instead find the local Y/M/D, then
 * fix-point on a UTC candidate: ask the formatter what wall clock that
 * candidate maps to in `timeZone` and shift by the difference. One pass
 * covers any sane offset; two passes is enough for a DST boundary.
 */
function startOfLocalDayUTC(now: Date, timeZone: string): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const partsNow: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) partsNow[p.type] = p.value;
  // hour: "2-digit" + hour12:false in en-CA returns "00".."24"; clamp 24→0
  // (some implementations return "24" at midnight) so the target maths below
  // never lands on the next day.
  const hourPart = partsNow.hour === "24" ? "00" : partsNow.hour;
  const targetY = +partsNow.year;
  const targetMo = +partsNow.month;
  const targetD = +partsNow.day;
  const targetLocalAsUtc = Date.UTC(targetY, targetMo - 1, targetD, 0, 0, 0);
  // Use the wall-clock right now to seed a guess that's already close
  // enough that the loop converges in a single iteration outside of DST.
  const sinceLocalMidnightMs =
    +hourPart * 3_600_000 +
    +partsNow.minute * 60_000 +
    +partsNow.second * 1_000;
  let guess = now.getTime() - sinceLocalMidnightMs;
  for (let i = 0; i < 3; i++) {
    const g: Record<string, string> = {};
    for (const p of fmt.formatToParts(new Date(guess))) g[p.type] = p.value;
    const gh = g.hour === "24" ? "00" : g.hour;
    const guessLocalAsUtc = Date.UTC(
      +g.year,
      +g.month - 1,
      +g.day,
      +gh,
      +g.minute,
      +g.second,
    );
    const delta = targetLocalAsUtc - guessLocalAsUtc;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
}

function localDateISO(value: Date, timeZone: string): string {
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value)) {
    parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Per-user weekly aggregate — counts by kind for the last 7 days for the
 * authed user. Used by later milestones to power the weekly SNAP Shot
 * summary and the adaptive Today's Focus reordering. The user id is taken
 * from the bearer token; there is no user-controlled identifier in the URL.
 *
 * Window semantics:
 *   • Caller may pass `?tz=<IANA name>` (e.g. `Asia/Tokyo`). When present
 *     and valid, the window starts at the beginning of *today in that
 *     timezone* and reaches back six prior local days, so the response
 *     covers the user's last seven calendar days. Without `tz` we fall
 *     back to UTC, which preserves the previous behaviour for any caller
 *     that hasn't been updated yet.
 *   • Each row is bucketed by its client-supplied `occurredAtMs` (the
 *     moment the user actually performed the action). When the client
 *     didn't send one — older events, or kinds we never instrumented —
 *     we fall back to the server-side `receivedAt`.
 */
router.get("/events/weekly", async (req, res) => {
  const appUserId = await requireUserAuth(req, res);
  if (!appUserId) return;

  const tzRaw = typeof req.query.tz === "string" ? req.query.tz : "";
  const tz = tzRaw && isValidTimeZone(tzRaw) ? tzRaw : "UTC";
  const now = new Date();
  const localStartOfToday = startOfLocalDayUTC(now, tz);
  const windowStart = new Date(localStartOfToday.getTime() - 6 * DAY_MS);
  const windowStartMs = windowStart.getTime();

  try {
    const rows = await db
      .select({
        kind: interactionEventsTable.kind,
        count: sql<number>`count(*)::int`,
        occurredAtMs: interactionEventsTable.occurredAtMs,
        receivedAt: interactionEventsTable.receivedAt,
      })
      .from(interactionEventsTable)
      .where(
        and(
          eq(interactionEventsTable.appUserId, appUserId),
          // Prefer `occurredAtMs` (the user's local moment of action);
          // fall back to `receivedAt` for rows where the client never
          // sent one. Splitting on null/not-null instead of `coalesce`
          // keeps the predicate index-friendly on either column.
          or(
            and(
              isNotNull(interactionEventsTable.occurredAtMs),
              gte(interactionEventsTable.occurredAtMs, windowStartMs),
            ),
            and(
              isNull(interactionEventsTable.occurredAtMs),
              gte(interactionEventsTable.receivedAt, windowStart),
            ),
          ),
        ),
      )
      .groupBy(
        interactionEventsTable.kind,
        interactionEventsTable.occurredAtMs,
        interactionEventsTable.receivedAt,
      );
    const counts: Record<string, number> = {};
    const daily: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      counts[r.kind] = (counts[r.kind] ?? 0) + r.count;
      const eventDate =
        r.occurredAtMs != null
          ? new Date(Number(r.occurredAtMs))
          : r.receivedAt instanceof Date
            ? r.receivedAt
            : null;
      if (!eventDate || Number.isNaN(eventDate.getTime())) continue;
      const date = localDateISO(eventDate, tz);
      daily[date] ??= {};
      daily[date][r.kind] = (daily[date][r.kind] ?? 0) + r.count;
    }
    res.json({ appUserId, windowDays: 7, tz, windowStartMs, counts, daily });
  } catch (err) {
    req.log?.error({ err }, "interaction events weekly aggregate failed");
    res.status(500).json({ error: "internal" });
  }
});

export default router;
