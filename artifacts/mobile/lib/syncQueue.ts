/**
 * Pure (testable) helpers for the offline write-through sync queue.
 *
 * The mobile client treats AsyncStorage as the local source of truth and
 * mirrors every write to the api-server via `enqueueSync` (see
 * `syncClient.ts`). Network failures, app cold-starts, and signal loss
 * all need to be transparent — so writes go through this queue, get
 * persisted to AsyncStorage, and a flusher attempts them in FIFO order
 * with exponential backoff.
 *
 * This module is intentionally side-effect free: no AsyncStorage calls,
 * no `fetch`, no `Date.now()` defaults that aren't passed in. Everything
 * is exposed as a function over a queue value so the unit tests can
 * exercise dedup, backoff, and drop semantics deterministically.
 */

export type SyncDomain =
  | "profile"
  | "nutrition"
  | "activity"
  | "meal-plan"
  | "supplements"
  | "gamification"
  | "wellbeing"
  | "assessment"
  | "outcomes";

export interface SyncQueueItem {
  /** Stable client id (used in tests + the persisted log). */
  id: string;
  domain: SyncDomain;
  /**
   * Dedup / coalesce key. For singleton domains (profile, supplements,
   * gamification) this is just the domain name — a newer enqueue wipes
   * out any earlier pending item under the same key. For per-day
   * domains (nutrition, activity, meal-plan) the key is `${domain}:${day}`.
   * Append-only domains (wellbeing, assessment, outcomes) use a unique
   * client-generated id so retries are idempotent but distinct entries
   * never collapse into one.
   */
  key: string;
  /** HTTP method to use when flushing. */
  method: "PUT" | "POST" | "DELETE";
  /** Path relative to the api-server `/api` base, e.g. `/sync/profile`. */
  path: string;
  /** Body payload. Stored as-is; serialised on flush. */
  body: unknown;
  /** Number of attempts already made. */
  attempts: number;
  /** Wall-clock ms when the item was first enqueued. */
  enqueuedAtMs: number;
  /** Earliest wall-clock ms at which the next attempt may run. */
  nextAttemptAtMs: number;
}

export const DEFAULT_MAX_ATTEMPTS = 6;
/** Backoff schedule in ms: 1s, 2s, 4s, 8s, 16s, 30s. */
export const BACKOFF_SCHEDULE_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

export interface EnqueueInput {
  domain: SyncDomain;
  key: string;
  method: "PUT" | "POST" | "DELETE";
  path: string;
  body: unknown;
}

/**
 * Append `input` to `queue`, coalescing it with any existing item that
 * shares the same `key` (last-write-wins). Returns a NEW array — callers
 * persist the result and never mutate the input.
 *
 * Dedup is what makes the offline queue safe to flush at any time: a
 * burst of writes to the same singleton/per-day key (e.g. the user
 * dragging a slider that fires 100 `upsertTodayNutrition` calls a
 * minute) collapses into a single network round-trip instead of 100.
 */
export function enqueue(
  queue: SyncQueueItem[],
  input: EnqueueInput,
  nowMs: number,
  idGen: () => string,
): SyncQueueItem[] {
  const next: SyncQueueItem = {
    id: idGen(),
    domain: input.domain,
    key: input.key,
    method: input.method,
    path: input.path,
    body: input.body,
    attempts: 0,
    enqueuedAtMs: nowMs,
    nextAttemptAtMs: nowMs,
  };
  // Drop any existing pending item with the same key so the latest
  // write wins. We don't preserve the `attempts` from the previous item
  // because the body has changed — the network call itself is brand new.
  const filtered = queue.filter((q) => q.key !== input.key);
  filtered.push(next);
  return filtered;
}

/** Items eligible to flush right now (FIFO order). */
export function pickReady(
  queue: SyncQueueItem[],
  nowMs: number,
): SyncQueueItem[] {
  return queue.filter((q) => q.nextAttemptAtMs <= nowMs);
}

/**
 * Mark `item` as attempted but failed. Returns the updated item with
 * `attempts++` and `nextAttemptAtMs` pushed out per the backoff
 * schedule, OR `null` if the item has exhausted `maxAttempts` and
 * should be dropped from the queue. The caller is expected to
 * `console.warn` once when an item is dropped so we get a breadcrumb.
 */
export function bumpFailure(
  item: SyncQueueItem,
  nowMs: number,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): SyncQueueItem | null {
  const attempts = item.attempts + 1;
  if (attempts >= maxAttempts) return null;
  // Use `attempts - 1` so the first failure waits BACKOFF_SCHEDULE_MS[0].
  const idx = Math.min(attempts - 1, BACKOFF_SCHEDULE_MS.length - 1);
  return {
    ...item,
    attempts,
    nextAttemptAtMs: nowMs + BACKOFF_SCHEDULE_MS[idx],
  };
}

/** Remove an item by id (used after a successful flush). */
export function removeById(
  queue: SyncQueueItem[],
  id: string,
): SyncQueueItem[] {
  return queue.filter((q) => q.id !== id);
}

/** Replace one item by id (used to bump the backoff after a failure). */
export function replaceById(
  queue: SyncQueueItem[],
  id: string,
  next: SyncQueueItem,
): SyncQueueItem[] {
  return queue.map((q) => (q.id === id ? next : q));
}

/**
 * Convenience builder for the dedup key used by the four "domain"
 * shapes the client knows about.
 */
export function buildKey(
  domain: SyncDomain,
  modifier: string | null,
): string {
  if (!modifier) return domain;
  return `${domain}:${modifier}`;
}
