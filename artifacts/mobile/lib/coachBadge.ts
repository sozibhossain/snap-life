/**
 * Coach badge state — a tiny pub/sub that lets the dashboard, the Coach
 * tab icon, and the Coach screen agree on whether there's a "new daily
 * insight or recommended action pending" for Bone Buddy.
 *
 * Persistence model:
 *   - We persist the YYYY-MM-DD when the user last opened Coach.
 *   - The badge is shown when today's local-date is later than that
 *     stored date AND there's at least one undismissed insight available
 *     for them today.
 *   - Opening Coach calls `markCoachOpenedToday(userId)` which writes
 *     today and notifies subscribers so the badge clears immediately.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { todayLocalISO } from "./weeklySnap";

const KEY_PREFIX = "snap_coach_badge_seen:";

type Listener = () => void;
const listeners = new Set<Listener>();

function keyFor(userId: string | null | undefined): string {
  return `${KEY_PREFIX}${userId ?? "anon"}`;
}

export async function loadLastSeenDate(
  userId: string | null | undefined,
): Promise<string | null> {
  try {
    return (await AsyncStorage.getItem(keyFor(userId))) ?? null;
  } catch {
    return null;
  }
}

export async function markCoachOpenedToday(
  userId: string | null | undefined,
): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(userId), todayLocalISO());
  } catch {
    // soft-fail
  }
  for (const l of listeners) {
    try {
      l();
    } catch {
      // ignore listener errors
    }
  }
}

/** Subscribe to badge-state changes (e.g. coach was just opened). */
export function subscribeCoachBadge(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
