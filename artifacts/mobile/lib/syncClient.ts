/**
 * Stateful glue around the pure sync queue (`syncQueue.ts`):
 *   - `enqueueSync(...)` for context write-throughs to call.
 *   - `flushQueue(...)` for periodic / on-foreground / post-mutation
 *     flushers (`AuthContext` schedules these).
 *   - `pullSnapshot(...)` for the AuthContext launch path.
 *   - `applySnapshotToAsyncStorage(...)` to seed every domain's
 *     AsyncStorage key from the server before contexts hydrate.
 *
 * The queue is persisted at `@snaplife/syncQueue/v1:{appUserId}` so
 * pending writes survive a cold start. Inflight protection is a
 * module-level promise so a flusher fired from two places (foreground
 * + post-mutation) doesn't race against itself and double-flush.
 *
 * Network failures are silent; we only `console.warn` when an item is
 * dropped after exhausting its retries (so the device log carries a
 * breadcrumb but the UI never surfaces a red toast for a transient
 * outage).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  buildKey,
  bumpFailure,
  enqueue,
  pickReady,
  removeById,
  replaceById,
  type EnqueueInput,
  type SyncDomain,
  type SyncQueueItem,
} from "./syncQueue";

const QUEUE_KEY_PREFIX = "@snaplife/syncQueue/v1:";

function queueKey(appUserId: string): string {
  return `${QUEUE_KEY_PREFIX}${appUserId}`;
}

const inflight = new Map<string, Promise<void>>();

/**
 * Per-user serialisation chain. Every read-modify-write against the
 * persisted queue MUST go through this lock — otherwise concurrent
 * `enqueueSync` calls (or an enqueue racing the flusher) load the
 * same snapshot, mutate independently, and the second `saveQueue`
 * silently overwrites the first, dropping items.
 *
 * The chain catches its own errors so a single failed op doesn't
 * poison subsequent ops, but the original error still propagates to
 * the caller via the returned promise.
 */
const queueLocks = new Map<string, Promise<unknown>>();

function withQueueLock<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = queueLocks.get(userId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  queueLocks.set(
    userId,
    next.catch(() => undefined),
  );
  return next;
}

function newId(): string {
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function loadQueue(appUserId: string): Promise<SyncQueueItem[]> {
  try {
    const raw = await AsyncStorage.getItem(queueKey(appUserId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as SyncQueueItem[];
  } catch {
    return [];
  }
}

async function saveQueue(
  appUserId: string,
  queue: SyncQueueItem[],
): Promise<void> {
  try {
    await AsyncStorage.setItem(queueKey(appUserId), JSON.stringify(queue));
  } catch {
    // Best effort — a single failed persist is recoverable on the next
    // enqueue/flush cycle.
  }
}

export interface EnqueueArgs {
  appUserId: string | null | undefined;
  domain: SyncDomain;
  /** null for singleton domains, day-ISO for per-day, unique id for append-only. */
  modifier: string | null;
  method: "PUT" | "POST";
  path: string;
  body: unknown;
}

/**
 * Public entry point used by every domain context to mirror an
 * AsyncStorage write to the server.
 *
 * Returns a `Promise<void>` that resolves once the item has been
 * persisted to the offline queue. Domain contexts can fire-and-forget
 * (`void enqueueSync(...)`); the migration walker `await`s it so the
 * marker is only stamped once every legacy item is durably queued.
 *
 * Persisting goes through `withQueueLock` so concurrent enqueues
 * cannot clobber each other's writes. No-ops when there is no
 * signed-in user (anonymous writes never leave the device).
 */
export function enqueueSync(args: EnqueueArgs): Promise<void> {
  if (!args.appUserId) return Promise.resolve();
  const userId = args.appUserId;
  const input: EnqueueInput = {
    domain: args.domain,
    key: buildKey(args.domain, args.modifier),
    method: args.method,
    path: args.path,
    body: args.body,
  };
  return withQueueLock(userId, async () => {
    const queue = await loadQueue(userId);
    const next = enqueue(queue, input, Date.now(), newId);
    await saveQueue(userId, next);
  });
}

/**
 * Move every queued write from `fromUserId`'s namespace into
 * `toUserId`'s namespace, preserving coalescing semantics. Used by
 * AuthContext when the deferred `/auth/me` call upgrades a session
 * from a provisional clerk id to the canonical appUserId — without
 * this the items enqueued during the provisional window would be
 * orphaned (the flusher only drains the active appUserId queue).
 */
export async function migrateQueueOwner(
  fromUserId: string,
  toUserId: string,
): Promise<void> {
  if (fromUserId === toUserId) return;
  const taken = await withQueueLock(fromUserId, async () => {
    const q = await loadQueue(fromUserId);
    if (q.length === 0) return [] as SyncQueueItem[];
    try {
      await AsyncStorage.removeItem(queueKey(fromUserId));
    } catch {
      // best-effort
    }
    return q;
  });
  if (taken.length === 0) return;
  await withQueueLock(toUserId, async () => {
    let merged = await loadQueue(toUserId);
    for (const item of taken) {
      merged = enqueue(
        merged,
        {
          domain: item.domain,
          key: item.key,
          method: item.method,
          path: item.path,
          body: item.body,
        },
        item.enqueuedAtMs,
        () => item.id,
      );
    }
    await saveQueue(toUserId, merged);
  });
}

export interface FlushArgs {
  appUserId: string;
  apiBaseUrl: string;
  /** Returns the bearer header value (full string), or null to skip. */
  getAuthHeader: () => Promise<string | null>;
  /** Override Date.now() for tests. */
  nowMs?: number;
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Maximum items to flush per call (back-pressure). Default 50. */
  maxItems?: number;
}

/**
 * Drain ready items from the persisted queue in FIFO order. Each item
 * is attempted once; on success it's removed, on failure it's bumped
 * with backoff or dropped after `DEFAULT_MAX_ATTEMPTS`.
 *
 * Concurrent calls for the same user share the same in-flight promise
 * so a periodic flusher and a foreground flusher firing at once won't
 * stomp on each other.
 */
export async function flushQueue(args: FlushArgs): Promise<void> {
  const existing = inflight.get(args.appUserId);
  if (existing) return existing;
  const p = doFlush(args).finally(() => {
    inflight.delete(args.appUserId);
  });
  inflight.set(args.appUserId, p);
  return p;
}

async function doFlush(args: FlushArgs): Promise<void> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const now = args.nowMs ?? Date.now();
  const max = args.maxItems ?? 50;
  const auth = await args.getAuthHeader();
  if (!auth) return;
  // Snapshot the ready set under the lock so a concurrent enqueue
  // can't be picked up mid-loop (it'll be drained on the next flush).
  const ready = await withQueueLock(args.appUserId, async () => {
    const q = await loadQueue(args.appUserId);
    return pickReady(q, now).slice(0, max);
  });
  if (ready.length === 0) return;
  for (const item of ready) {
    let outcome: "ok" | "drop" | "fail" = "fail";
    try {
      const r = await fetchImpl(`${args.apiBaseUrl}/api${item.path}`, {
        method: item.method,
        headers: {
          "Content-Type": "application/json",
          Authorization: auth,
        },
        body: JSON.stringify(item.body),
      });
      // 4xx (other than 401) means the body is permanently bad — dropping
      // is better than retrying forever. 401 means the token rolled and
      // we want to try again next flush; treat as failure.
      if (r.ok) {
        outcome = "ok";
      } else if (r.status >= 400 && r.status < 500 && r.status !== 401) {
        outcome = "drop";
        console.warn(
          `[sync] dropping ${item.method} ${item.path} after ${r.status}`,
        );
      }
    } catch {
      // network blip — fall through as "fail" → bump
    }
    // Re-load the queue under the lock for each modification so a
    // concurrent enqueue (which may have coalesced over this same
    // key) isn't clobbered by writing back a stale copy.
    await withQueueLock(args.appUserId, async () => {
      let q = await loadQueue(args.appUserId);
      if (outcome === "ok" || outcome === "drop") {
        q = removeById(q, item.id);
      } else {
        // The item may have been replaced by a newer enqueue (same key,
        // new id). In that case there's nothing to bump — the new item
        // will be picked up on the next flush.
        const current = q.find((x) => x.id === item.id);
        if (!current) return;
        const bumped = bumpFailure(current, now);
        if (bumped) {
          q = replaceById(q, item.id, bumped);
        } else {
          console.warn(
            `[sync] dropping ${item.method} ${item.path} after max retries`,
          );
          q = removeById(q, item.id);
        }
      }
      await saveQueue(args.appUserId, q);
    });
  }
}

// ---- Snapshot pull -------------------------------------------------------

export interface SyncSnapshot {
  appUserId: string;
  profile: { profile: Record<string, unknown>; updatedAtMs?: number | null } | null;
  nutrition: Array<{ day: string; data: unknown; updatedAtMs?: number | null }>;
  activity: Array<{ day: string; data: unknown; updatedAtMs?: number | null }>;
  mealPlan: Array<{ day: string; data: unknown; updatedAtMs?: number | null }>;
  wellbeing: Array<{ entryId: string; entry: unknown; completedAtMs: number }>;
  gamification: { state: Record<string, unknown>; updatedAtMs?: number | null } | null;
  supplements: { state: Record<string, unknown>; updatedAtMs?: number | null } | null;
  assessments: Array<{
    resultId: string;
    kind: string;
    payload: unknown;
    takenAtMs: number;
  }>;
}

export interface PullArgs {
  apiBaseUrl: string;
  getAuthHeader: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

/** Returns the full sync snapshot or null if the network/auth call fails. */
export async function pullSnapshot(args: PullArgs): Promise<SyncSnapshot | null> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const auth = await args.getAuthHeader();
  if (!auth) return null;
  try {
    const r = await fetchImpl(`${args.apiBaseUrl}/api/sync/snapshot`, {
      method: "GET",
      headers: { Authorization: auth },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as SyncSnapshot;
    if (!j || typeof j !== "object" || typeof j.appUserId !== "string") {
      return null;
    }
    return j;
  } catch {
    return null;
  }
}

// ---- Snapshot apply ------------------------------------------------------

/**
 * Per-domain AsyncStorage key conventions (mirrors the existing keys
 * each context already reads from on hydrate). Centralised here so
 * snapshot apply and the eventual one-time migration walker stay in
 * lockstep with the contexts.
 */
function snapshotKeys(appUserId: string, clerkUserId: string | null) {
  return {
    nutrition: `snap_nutrition:${appUserId}`,
    activity: `snap_activity:${appUserId}`,
    supplements: `snap_supplements:${appUserId}`,
    dexa: `snap_dexa:${appUserId}`,
    nutritionState: `snap_nutrition_state:${appUserId}`,
    gamification: `snap_gamification:${appUserId}`,
    // Per-user scoped key. Pre-sync builds used a global key
    // (`@snaplife/wellbeing/v1`); the migration walker still reads the
    // legacy key as a fallback, but every fresh write lands in this
    // scoped namespace so a shared device can no longer leak one
    // user's sessions into another's view.
    wellbeing: `@snaplife/wellbeing/v1:${appUserId}`,
    profile: clerkUserId ? `@snaplife/profile/v1:${clerkUserId}` : null,
  };
}

export interface ApplyArgs {
  snapshot: SyncSnapshot;
  /** AppUserId the local AsyncStorage namespaces are keyed by. */
  appUserId: string;
  /**
   * Clerk user id (used to scope the profile blob, which AuthContext
   * persists under the clerk id rather than the app id). Pass null to
   * skip the profile write.
   */
  clerkUserId: string | null;
}

/**
 * Write the server snapshot into the AsyncStorage keys the existing
 * domain contexts hydrate from. Called BEFORE any context mounts on
 * sign-in so a fresh device starts up with the same view the user last
 * saw on their other devices.
 *
 * For per-day domains we write the *latest* row's payload directly
 * into the per-user key the client already uses (AuthContext +
 * HealthContext). For the per-day nutrition / activity arrays we
 * collapse multiple days into the array shape the contexts expect.
 */
export async function applySnapshotToAsyncStorage(
  args: ApplyArgs,
): Promise<void> {
  const k = snapshotKeys(args.appUserId, args.clerkUserId);
  const writes: Array<Promise<void>> = [];

  // --- Profile (under clerk id) ---
  if (k.profile && args.snapshot.profile?.profile) {
    writes.push(
      AsyncStorage.setItem(
        k.profile,
        JSON.stringify(args.snapshot.profile.profile),
      ),
    );
  }

  // --- Nutrition logs: array of NutritionLog, newest first ---
  if (args.snapshot.nutrition.length > 0) {
    const sorted = [...args.snapshot.nutrition].sort((a, b) =>
      a.day < b.day ? 1 : a.day > b.day ? -1 : 0,
    );
    const logs = sorted.map((d) => d.data);
    writes.push(AsyncStorage.setItem(k.nutrition, JSON.stringify(logs)));
  }

  // --- Activity logs ---
  if (args.snapshot.activity.length > 0) {
    const sorted = [...args.snapshot.activity].sort((a, b) =>
      a.day < b.day ? 1 : a.day > b.day ? -1 : 0,
    );
    const logs = sorted.map((d) => d.data);
    writes.push(AsyncStorage.setItem(k.activity, JSON.stringify(logs)));
  }

  // --- Meal plan: client uses the most recent day's payload ---
  if (args.snapshot.mealPlan.length > 0) {
    const newest = [...args.snapshot.mealPlan].sort((a, b) =>
      a.day < b.day ? 1 : a.day > b.day ? -1 : 0,
    )[0];
    writes.push(
      AsyncStorage.setItem(k.nutritionState, JSON.stringify(newest.data)),
    );
  }

  // --- Supplements: stored shape on device is the bare list ---
  if (args.snapshot.supplements?.state) {
    const list =
      (args.snapshot.supplements.state as { supplements?: unknown }).supplements ??
      args.snapshot.supplements.state;
    writes.push(AsyncStorage.setItem(k.supplements, JSON.stringify(list)));
  }

  // --- Gamification: { achievements, challenges, rewards } ---
  if (args.snapshot.gamification?.state) {
    writes.push(
      AsyncStorage.setItem(
        k.gamification,
        JSON.stringify(args.snapshot.gamification.state),
      ),
    );
  }

  // --- Wellbeing entries: client stores a flat array, newest first ---
  if (args.snapshot.wellbeing.length > 0) {
    const entries = [...args.snapshot.wellbeing]
      .sort((a, b) => b.completedAtMs - a.completedAtMs)
      .map((e) => e.entry);
    writes.push(AsyncStorage.setItem(k.wellbeing, JSON.stringify(entries)));
  }

  // --- DEXA / FRAX assessments → snap_dexa key on device ---
  if (args.snapshot.assessments.length > 0) {
    const dexa = args.snapshot.assessments
      .filter((a) => a.kind === "dexa")
      .sort((a, b) => b.takenAtMs - a.takenAtMs)
      .map((a) => a.payload);
    if (dexa.length > 0) {
      writes.push(AsyncStorage.setItem(k.dexa, JSON.stringify(dexa)));
    }
  }

  await Promise.all(writes);
}

// ---- Path helpers exposed for context write-throughs --------------------

export const SyncPaths = {
  profile: () => "/sync/profile",
  nutritionDay: (day: string) => `/sync/nutrition/${day}`,
  activityDay: (day: string) => `/sync/activity/${day}`,
  mealPlanDay: (day: string) => `/sync/meal-plan/${day}`,
  supplements: () => "/sync/supplements",
  gamification: () => "/sync/gamification",
  wellbeing: () => "/sync/wellbeing",
  assessment: () => "/sync/assessment",
} as const;
