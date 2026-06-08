/**
 * Insights state — persistence + selection helpers for the dashboard
 * Insights strip and Bone Buddy proactive surface.
 *
 * Design:
 *   - The deterministic engine (`generateRankedInsights`) produces 1..3
 *     insights per render. We persist a small `{ insightId → dismissedAtMs }`
 *     map per user and treat any dismissal as honoured for 24h. After
 *     that the insight is eligible to re-cycle.
 *   - Reads are best-effort and never throw — local state is non-critical
 *     UX state.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Insight } from "./insights";

const ONE_DAY_MS = 86_400_000;
const KEY_PREFIX = "snap_insights_dismissed:";

interface DismissalState {
  /** Map of insight id → ms-since-epoch when it was dismissed. */
  byId: Record<string, number>;
}

const EMPTY_STATE: DismissalState = { byId: {} };

function keyFor(userId: string | null | undefined): string {
  return `${KEY_PREFIX}${userId ?? "anon"}`;
}

export async function loadDismissals(
  userId: string | null | undefined,
): Promise<DismissalState> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (!raw) return { byId: {} };
    const parsed = JSON.parse(raw) as Partial<DismissalState>;
    const byId: Record<string, number> = {};
    if (parsed && typeof parsed.byId === "object" && parsed.byId) {
      for (const [id, ts] of Object.entries(parsed.byId)) {
        if (typeof ts === "number" && Number.isFinite(ts)) byId[id] = ts;
      }
    }
    return { byId };
  } catch {
    return { byId: {} };
  }
}

async function save(
  userId: string | null | undefined,
  state: DismissalState,
): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(state));
  } catch {
    // soft-fail — UX nicety, not load-bearing
  }
}

/** Persist a dismissal at `now` for a single insight id. */
export async function dismissInsight(
  userId: string | null | undefined,
  insightId: string,
  now: number = Date.now(),
): Promise<DismissalState> {
  const state = await loadDismissals(userId);
  state.byId[insightId] = now;
  await save(userId, state);
  notifyDismissalChange();
  return state;
}

/**
 * Tiny pub/sub for dismissal-state changes. Surfaces other than the
 * InsightsStrip itself (e.g. the Coach tab badge predicate) need to
 * recompute the active set whenever a dismissal lands. AsyncStorage has
 * no change events, so we expose an in-process bus that `dismissInsight`
 * fires synchronously after a successful save.
 */
type Listener = () => void;
const dismissalListeners = new Set<Listener>();

export function subscribeDismissals(listener: Listener): () => void {
  dismissalListeners.add(listener);
  return () => {
    dismissalListeners.delete(listener);
  };
}

function notifyDismissalChange(): void {
  for (const l of Array.from(dismissalListeners)) {
    try {
      l();
    } catch {
      // soft-fail — UX bus, never load-bearing
    }
  }
}

/** Reset a single dismissal (useful for tests). */
export async function clearDismissal(
  userId: string | null | undefined,
  insightId: string,
): Promise<void> {
  const state = await loadDismissals(userId);
  if (state.byId[insightId] !== undefined) {
    delete state.byId[insightId];
    await save(userId, state);
  }
}

/**
 * Filter ranked insights by an in-memory dismissal map. Pure — call sites
 * load the map once on mount and pass it in. An insight is excluded when
 * its last dismissal was within the past 24h.
 */
export function activeInsights(
  ranked: Insight[],
  state: DismissalState | null,
  now: number = Date.now(),
): Insight[] {
  if (!state) return ranked;
  return ranked.filter((i) => {
    const ts = state.byId[i.id];
    if (typeof ts !== "number") return true;
    return now - ts >= ONE_DAY_MS;
  });
}

/**
 * Tiny string hash (FNV-1a 32-bit). Stable across runs and platforms,
 * just used for deterministic daily rotation seeding.
 */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * Pick today's rotating window from a ranked list — the dashboard
 * insights strip is supposed to surface 1–2 short insights that rotate
 * day to day, not the full ranked set. Determinism comes from a
 * `userId+YYYY-MM-DD` seed, so:
 *   - The same user sees the same window all day (no jitter on rerender).
 *   - Different users on the same day see different starting points.
 *   - The window slides automatically with the local date.
 *
 * If `available` is shorter than `take`, returns the entire list.
 */
export function selectDailyRotation<T>(
  available: T[],
  opts: {
    userId: string | null | undefined;
    isoDate: string;
    take?: number;
  },
): T[] {
  const take = Math.max(1, Math.min(2, opts.take ?? 2));
  if (available.length === 0) return [];
  if (available.length <= take) return available.slice(0, take);
  const seed = fnv1a(`${opts.userId ?? "anon"}:${opts.isoDate}`);
  const start = seed % available.length;
  const out: T[] = [];
  for (let i = 0; i < take; i++) {
    out.push(available[(start + i) % available.length]);
  }
  return out;
}

export const INSIGHT_DISMISS_TTL_MS = ONE_DAY_MS;
