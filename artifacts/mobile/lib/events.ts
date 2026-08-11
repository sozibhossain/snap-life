/**
 * Durable mobile behavioural-event queue.
 *
 * Callers stay fire-and-forget, but events are persisted before delivery and
 * retried with bounded exponential backoff. Progress data therefore survives
 * flaky networks, backgrounding and app restarts without blocking the UI.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiBaseUrl } from "./serverIdentity";
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
  "rec_shown",
  "rec_completed",
  "rec_dismissed",
  "wearables_interest",
  "outcome_checkin_completed",
  "medication_missed",
] as const;

export type EventKind = (typeof ALLOWED_KINDS)[number];

export interface LogEventInput {
  appUserId: string | null | undefined;
  kind: EventKind;
  payload?: Record<string, unknown>;
  occurredAtMs?: number;
}

interface EventBody {
  clientEventId: string;
  kind: EventKind;
  payload: Record<string, unknown>;
  occurredAtMs: number;
}

interface QueuedEvent {
  id: string;
  body: EventBody;
  attempts: number;
  nextAttemptAtMs: number;
}

const EVENT_QUEUE_PREFIX = "@snaplife/interactionEvents/v2:";
const MAX_QUEUED_EVENTS = 500;
const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_BACKOFF_MS = 15 * 60 * 1_000;
const queueLocks = new Map<string, Promise<unknown>>();
const activeFlushes = new Map<string, Promise<void>>();

function queueKey(appUserId: string): string {
  return `${EVENT_QUEUE_PREFIX}${appUserId}`;
}

function createClientEventId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

function withQueueLock<T>(appUserId: string, task: () => Promise<T>): Promise<T> {
  const previous = queueLocks.get(appUserId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  queueLocks.set(appUserId, current);
  void current.finally(() => {
    if (queueLocks.get(appUserId) === current) queueLocks.delete(appUserId);
  });
  return current;
}

async function loadEventQueue(appUserId: string): Promise<QueuedEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(queueKey(appUserId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - EVENT_RETENTION_MS;
    return parsed.filter((item): item is QueuedEvent => {
      if (!item || typeof item !== "object") return false;
      const row = item as Partial<QueuedEvent>;
      return (
        typeof row.id === "string" &&
        typeof row.body?.clientEventId === "string" &&
        typeof row.body?.kind === "string" &&
        typeof row.body?.occurredAtMs === "number" &&
        row.body.occurredAtMs >= cutoff &&
        typeof row.attempts === "number" &&
        typeof row.nextAttemptAtMs === "number"
      );
    });
  } catch {
    return [];
  }
}

async function saveEventQueue(appUserId: string, queue: QueuedEvent[]): Promise<void> {
  if (queue.length === 0) {
    await AsyncStorage.removeItem(queueKey(appUserId));
    return;
  }
  await AsyncStorage.setItem(
    queueKey(appUserId),
    JSON.stringify(queue.slice(-MAX_QUEUED_EVENTS)),
  );
}

/** Fire-and-forget for callers; persistence and delivery happen in-order. */
export function logInteractionEvent(input: LogEventInput): void {
  if (!input.appUserId) return;
  const userId = input.appUserId;
  const clientEventId = createClientEventId();
  const body: EventBody = {
    clientEventId,
    kind: input.kind,
    payload: input.payload ?? {},
    occurredAtMs: input.occurredAtMs ?? Date.now(),
  };
  void withQueueLock(userId, async () => {
    const queue = await loadEventQueue(userId);
    queue.push({ id: clientEventId, body, attempts: 0, nextAttemptAtMs: 0 });
    await saveEventQueue(userId, queue);
  }).then(() => flushInteractionEvents(userId));
}

async function dispatch(
  appUserId: string,
  body: EventBody,
): Promise<"sent" | "retry" | "discard"> {
  const base = getApiBaseUrl();
  if (!base) return "retry";
  try {
    const auth = await authHeader(appUserId);
    if (!auth.Authorization) return "retry";
    const response = await fetch(`${base}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify(body),
    });
    if (response.ok) return "sent";
    if ([400, 403, 404, 413, 422].includes(response.status)) return "discard";
    return "retry";
  } catch {
    return "retry";
  }
}

/**
 * Drain ready events for a user. Concurrent sign-in, foreground and periodic
 * calls collapse into a single flush.
 */
export function flushInteractionEvents(appUserId: string): Promise<void> {
  const active = activeFlushes.get(appUserId);
  if (active) return active;

  const run = (async () => {
    const snapshot = await withQueueLock(appUserId, () => loadEventQueue(appUserId));
    const ready = snapshot
      .filter((item) => item.nextAttemptAtMs <= Date.now())
      .slice(0, 50);
    for (const item of ready) {
      const result = await dispatch(appUserId, item.body);
      await withQueueLock(appUserId, async () => {
        const current = await loadEventQueue(appUserId);
        const index = current.findIndex((queued) => queued.id === item.id);
        if (index < 0) return;
        if (result === "sent" || result === "discard") {
          current.splice(index, 1);
        } else {
          const attempts = current[index]!.attempts + 1;
          current[index] = {
            ...current[index]!,
            attempts,
            nextAttemptAtMs:
              Date.now() +
              Math.min(MAX_BACKOFF_MS, 5_000 * 2 ** Math.min(attempts - 1, 8)),
          };
        }
        await saveEventQueue(appUserId, current);
      });
      if (result === "retry") break;
    }
  })();

  activeFlushes.set(appUserId, run);
  return run.finally(() => {
    if (activeFlushes.get(appUserId) === run) activeFlushes.delete(appUserId);
  });
}

/** Best-effort detection of the device's IANA timezone. */
function getDeviceTimeZone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === "string" && tz.length > 0 ? tz : null;
  } catch {
    return null;
  }
}

export interface WeeklyEventSummary {
  counts: Record<string, number>;
  daily: Record<string, Record<string, number>>;
}

export async function fetchWeeklyEventCounts(
  appUserId: string,
): Promise<Record<string, number>> {
  return (await fetchWeeklyEventSummary(appUserId)).counts;
}

export async function fetchWeeklyEventSummary(
  appUserId: string,
): Promise<WeeklyEventSummary> {
  await flushInteractionEvents(appUserId);
  const base = getApiBaseUrl();
  if (!base) return { counts: {}, daily: {} };
  try {
    const auth = await authHeader(appUserId);
    if (!auth.Authorization) return { counts: {}, daily: {} };
    const tz = getDeviceTimeZone();
    const url = tz
      ? `${base}/api/events/weekly?tz=${encodeURIComponent(tz)}`
      : `${base}/api/events/weekly`;
    const response = await fetch(url, { headers: auth });
    if (!response.ok) return { counts: {}, daily: {} };
    const json = (await response.json()) as Partial<WeeklyEventSummary>;
    return {
      counts: json.counts ?? {},
      daily: json.daily ?? {},
    };
  } catch {
    return { counts: {}, daily: {} };
  }
}
