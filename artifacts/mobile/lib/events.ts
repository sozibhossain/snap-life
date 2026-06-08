/**
 * Mobile-side helper for firing a single behavioural event up to the
 * api-server. Intentionally fire-and-forget: callers never await, errors
 * are swallowed, and there's no retry loop — losing the occasional event
 * is far better than blocking the UI or stalling on a flaky network.
 *
 * Auth: every per-user request includes the bearer token issued by
 * `bootstrapUserToken` (see `lib/userToken.ts`). The server rejects
 * unauthenticated calls with 401, so we silently skip dispatch when no
 * token can be obtained for the current user.
 */

import { Platform } from "react-native";
import { authHeader } from "./userToken";

const ALLOWED_KINDS = [
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
  "supplement_taken",
  // Recommendation lifecycle — powers the Premium-only adaptive
  // engagement profile. Payload conventions:
  //   { surface: string, recId: string, recKind: string }
  // surface = where it appeared (e.g. "today_focus", "insights",
  // "weekly_snap", "bone_buddy"), recKind = the bucket we group by
  // (e.g. "nutrition", "wellbeing", "lifestyle", "insight",
  // "weekly_snap", "bone_buddy_suggestion").
  "rec_shown",
  "rec_completed",
  "rec_dismissed",
  // User tapped "Notify me when ready" on the Wearables placeholder
  // screen. Used to size demand for real wearable integrations later.
  "wearables_interest",
] as const;

export type EventKind = (typeof ALLOWED_KINDS)[number];

function getApiBaseUrl(): string {
  const override = process.env.EXPO_PUBLIC_API_URL;
  if (override) return override.replace(/\/$/, "");
  if (Platform.OS === "web") return "";
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) return "";
  return domain.startsWith("http") ? domain : `https://${domain}`;
}

export interface LogEventInput {
  appUserId: string | null | undefined;
  kind: EventKind;
  payload?: Record<string, unknown>;
  occurredAtMs?: number;
}

/**
 * Fire-and-forget event log. Returns immediately; never throws.
 * Silently no-ops when there is no signed-in user.
 */
export function logInteractionEvent(input: LogEventInput): void {
  if (!input.appUserId) return;
  const userId = input.appUserId;
  const body = {
    kind: input.kind,
    payload: input.payload ?? {},
    occurredAtMs: input.occurredAtMs ?? Date.now(),
  };
  void dispatch(userId, body);
}

async function dispatch(appUserId: string, body: unknown): Promise<void> {
  const base = getApiBaseUrl();
  if (!base) return;
  try {
    const auth = await authHeader(appUserId);
    if (!auth.Authorization) return; // No token → don't waste a 401 round-trip.
    await fetch(`${base}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify(body),
    });
  } catch {
    // Intentionally swallow — events are best-effort telemetry.
  }
}

/**
 * Best-effort detection of the device's IANA timezone so the server can
 * align "the last 7 days" with the user's local calendar. Returns `null`
 * on the rare runtime that doesn't expose `resolvedOptions().timeZone`.
 */
function getDeviceTimeZone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === "string" && tz.length > 0 ? tz : null;
  } catch {
    return null;
  }
}

/**
 * Fetch the current weekly aggregate of event counts for the *authed*
 * user. The server derives identity from the bearer token, so the user
 * id is no longer in the URL. Returns an empty object on any failure.
 *
 * Sends the device's IANA timezone via `?tz=…` so the server can use the
 * user's local-day boundary. The server falls back to UTC if the param is
 * missing or unrecognised, so this is safe on older clients/runtimes.
 */
export async function fetchWeeklyEventCounts(
  appUserId: string,
): Promise<Record<string, number>> {
  const base = getApiBaseUrl();
  if (!base) return {};
  try {
    const auth = await authHeader(appUserId);
    if (!auth.Authorization) return {};
    const tz = getDeviceTimeZone();
    const url = tz
      ? `${base}/api/events/weekly?tz=${encodeURIComponent(tz)}`
      : `${base}/api/events/weekly`;
    const r = await fetch(url, { headers: auth });
    if (!r.ok) return {};
    const json = (await r.json()) as { counts?: Record<string, number> };
    return json?.counts ?? {};
  } catch {
    return {};
  }
}
