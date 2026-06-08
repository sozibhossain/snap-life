import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { enqueueSync, SyncPaths } from "@/lib/syncClient";

export type Mood = "calm" | "energised" | "less_stressed" | "focused" | "still_tense";

export const MOOD_LABELS: Record<Mood, string> = {
  calm: "Calm",
  energised: "Energised",
  less_stressed: "Less stressed",
  focused: "Focused",
  still_tense: "Still tense",
};

export type SessionKind = "breathing" | "meditation";

export interface WellbeingEntry {
  id: string;
  kind: SessionKind;
  sessionId: string;
  sessionName: string;
  mood: Mood;
  durationSec: number;
  completedAt: number;
}

interface WellbeingState {
  entries: WellbeingEntry[];
  /** Number of consecutive days with at least one completed session, ending today (or yesterday if no session today). */
  currentStreak: number;
  /** Sessions completed today. */
  todayCount: number;
  /** Sessions completed in the past 7 days. */
  weekCount: number;
  /** A 0-100 score representing today's wellbeing: completion + mood + streak. */
  todayScore: number;
}

interface WellbeingContextValue extends WellbeingState {
  isReady: boolean;
  logSession: (input: Omit<WellbeingEntry, "id" | "completedAt">) => Promise<WellbeingEntry>;
  reset: () => Promise<void>;
}

/**
 * Per-user scoped storage key. Pre-sync builds wrote every user's
 * sessions into the global `@snaplife/wellbeing/v1` key — on a
 * shared device that allowed user A's entries to leak into user
 * B's view. We now key by the active appUserId, and the migration
 * walker handles backfilling the legacy global blob into the
 * server (and from there into the scoped local cache via
 * `applySnapshotToAsyncStorage`). A signed-out session falls back
 * to the legacy key so the screen still renders something pre-auth.
 */
const LEGACY_STORAGE_KEY = "@snaplife/wellbeing/v1";
function storageKeyFor(userId: string | null): string {
  return userId ? `${LEGACY_STORAGE_KEY}:${userId}` : LEGACY_STORAGE_KEY;
}

const POSITIVE_MOODS: Mood[] = ["calm", "energised", "less_stressed", "focused"];

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function daysBetween(a: number, b: number): number {
  const oneDay = 86_400_000;
  return Math.round((startOfDay(b) - startOfDay(a)) / oneDay);
}

function computeStreak(entries: WellbeingEntry[], now: number): number {
  if (entries.length === 0) return 0;
  // Unique day buckets (sorted descending)
  const days = Array.from(
    new Set(entries.map((e) => startOfDay(e.completedAt))),
  ).sort((a, b) => b - a);

  const today = startOfDay(now);
  // Allow the streak to continue if the user hasn't logged today yet but did yesterday.
  let cursor = today;
  if (days[0] !== today) {
    if (days[0] === today - 86_400_000) {
      cursor = today - 86_400_000;
    } else {
      return 0;
    }
  }

  let streak = 0;
  for (const day of days) {
    if (day === cursor) {
      streak += 1;
      cursor -= 86_400_000;
    } else if (day < cursor) {
      break;
    }
  }
  return streak;
}

function computeWellbeing(entries: WellbeingEntry[], now: number): Omit<WellbeingState, "entries"> {
  const todayStart = startOfDay(now);
  const weekStart = todayStart - 6 * 86_400_000;

  const today = entries.filter((e) => e.completedAt >= todayStart);
  const week = entries.filter((e) => e.completedAt >= weekStart);
  const currentStreak = computeStreak(entries, now);

  // Score: 40 base for at least one session today, +10 per additional (capped at 70),
  //        +20 if all today's moods are positive, +10 for streak >= 3.
  let score = 0;
  if (today.length > 0) {
    score = Math.min(70, 40 + (today.length - 1) * 10);
    const positive = today.filter((e) => POSITIVE_MOODS.includes(e.mood)).length;
    if (positive === today.length) score += 20;
    else if (positive > 0) score += 10;
    if (currentStreak >= 3) score += 10;
  }

  return {
    currentStreak,
    todayCount: today.length,
    weekCount: week.length,
    todayScore: Math.min(100, score),
  };
}

const WellbeingContext = createContext<WellbeingContextValue | null>(null);

export function WellbeingProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [entries, setEntries] = useState<WellbeingEntry[]>([]);
  const [isReady, setIsReady] = useState(false);

  // Re-hydrate whenever the active appUserId changes (sign in/out,
  // shared-device user switch). On a fresh sign-in the AuthContext has
  // already populated the scoped key from the server snapshot, so we
  // just read it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsReady(false);
      try {
        const raw = await AsyncStorage.getItem(storageKeyFor(userId));
        if (cancelled) return;
        if (raw) {
          const parsed = JSON.parse(raw) as WellbeingEntry[];
          if (Array.isArray(parsed)) setEntries(parsed);
          else setEntries([]);
        } else {
          setEntries([]);
        }
      } catch (err) {
        if (!cancelled) console.warn("[Wellbeing] Failed to load:", err);
      } finally {
        if (!cancelled) setIsReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const persist = useCallback(
    async (next: WellbeingEntry[]) => {
      try {
        await AsyncStorage.setItem(storageKeyFor(userId), JSON.stringify(next));
      } catch (err) {
        console.warn("[Wellbeing] Failed to persist:", err);
      }
    },
    [userId],
  );

  const logSession = useCallback<WellbeingContextValue["logSession"]>(
    async (input) => {
      const entry: WellbeingEntry = {
        ...input,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        completedAt: Date.now(),
      };
      const next = [entry, ...entries].slice(0, 500);
      setEntries(next);
      await persist(next);
      // Append-only on the server, idempotent on entryId.
      enqueueSync({
        appUserId: userId,
        domain: "wellbeing",
        modifier: entry.id,
        method: "POST",
        path: SyncPaths.wellbeing(),
        body: {
          entryId: entry.id,
          entry,
          completedAtMs: entry.completedAt,
        },
      });
      return entry;
    },
    [entries, persist, userId],
  );

  const reset = useCallback(async () => {
    setEntries([]);
    await AsyncStorage.removeItem(storageKeyFor(userId));
  }, [userId]);

  const computed = useMemo(() => computeWellbeing(entries, Date.now()), [entries]);

  const value: WellbeingContextValue = {
    entries,
    ...computed,
    isReady,
    logSession,
    reset,
  };

  return <WellbeingContext.Provider value={value}>{children}</WellbeingContext.Provider>;
}

export function useWellbeing(): WellbeingContextValue {
  const ctx = useContext(WellbeingContext);
  if (!ctx) throw new Error("useWellbeing must be used inside WellbeingProvider");
  return ctx;
}

export { daysBetween };
