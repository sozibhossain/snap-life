/**
 * Audio rotation engine for Breathing Studio and Meditation.
 *
 * Responsibilities:
 *   - Track play history per emotion (AsyncStorage, max 3 entries).
 *   - Pick a track from a pool that:
 *       1. Matches the current time-of-day preference.
 *       2. Has not been played recently (anti-repetition).
 *       3. Falls back gracefully if the pool is small.
 *   - Record each play so the next session avoids it.
 *
 * Usage:
 *   const tod  = getTimeOfDay();
 *   const hist = await getTrackHistory("calm");
 *   const pick = pickTrack(BREATHING_POOLS.calm, hist, tod);
 *   recordTrackPlay("calm", pick.url).catch(() => {});  // fire-and-forget
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AudioTrack, TimeOfDay } from "./wellbeingAudio";

const HISTORY_PREFIX = "snap_audio_history:";
const MAX_HISTORY    = 3;

// ─── Time of day ─────────────────────────────────────────────────────────────

/**
 * Derives the broad time-of-day bucket from the local clock.
 *   morning   06:00 – 11:59
 *   afternoon 12:00 – 16:59
 *   evening   17:00 – 05:59
 */
export function getTimeOfDay(): TimeOfDay {
  const h = new Date().getHours();
  if (h >= 6  && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  return "evening";
}

// ─── History persistence ──────────────────────────────────────────────────────

/**
 * Returns the last `MAX_HISTORY` track URLs played for a given emotion key.
 * Returns an empty array on any read/parse failure.
 */
export async function getTrackHistory(emotionKey: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(`${HISTORY_PREFIX}${emotionKey}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Prepends `url` to the play history for `emotionKey`, deduplicates, and
 * trims to `MAX_HISTORY`. Fire-and-forget — callers should `.catch(() => {})`.
 */
export async function recordTrackPlay(emotionKey: string, url: string): Promise<void> {
  try {
    const existing = await getTrackHistory(emotionKey);
    const next = [url, ...existing.filter((u) => u !== url)].slice(0, MAX_HISTORY);
    await AsyncStorage.setItem(`${HISTORY_PREFIX}${emotionKey}`, JSON.stringify(next));
  } catch {
    // best-effort — never throw from a history write
  }
}

// ─── Track selection ──────────────────────────────────────────────────────────

/**
 * Picks the best track from `pool` given the current time of day and recent
 * play history, using the following priority order:
 *
 *   1. Time-appropriate AND not recently played  ← ideal
 *   2. Time-appropriate  (may repeat if pool is small)
 *   3. Not recently played  (ignores time weight)
 *   4. Any track in the pool  (full fallback)
 *
 * Within each tier, selection is random so sessions feel varied.
 * Returns the first track in the pool if it is somehow empty (shouldn't
 * happen, but prevents a crash).
 */
export function pickTrack(
  pool: AudioTrack[],
  history: string[],
  timeOfDay: TimeOfDay,
): AudioTrack {
  if (pool.length === 0) {
    throw new Error("[audioRotation] pickTrack called with empty pool");
  }

  const isTimeFit  = (t: AudioTrack) => !t.timeWeight || t.timeWeight.includes(timeOfDay);
  const isFresh    = (t: AudioTrack) => !history.includes(t.url);

  const tier1 = pool.filter((t) => isTimeFit(t) && isFresh(t));
  if (tier1.length > 0) return tier1[Math.floor(Math.random() * tier1.length)];

  const tier2 = pool.filter(isTimeFit);
  if (tier2.length > 0) return tier2[Math.floor(Math.random() * tier2.length)];

  const tier3 = pool.filter(isFresh);
  if (tier3.length > 0) return tier3[Math.floor(Math.random() * tier3.length)];

  return pool[Math.floor(Math.random() * pool.length)];
}
