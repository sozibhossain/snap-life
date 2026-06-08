/**
 * useSpeechVoice — Shared TTS voice selection + speak helper.
 *
 * Two personas expose distinct but equally premium voices:
 *
 *  "wellness" — calm, measured female narrator (Breathing Studio, Meditations).
 *    Voice family: Serena · Kate · Moira · Fiona · Tessa.
 *    Cadence: deliberate, unhurried — designed for guided sessions.
 *    Rate: iOS 0.46 / Android 0.80 (single-word cues use a custom override).
 *    Pitch: 1.03 (warm but not artificially bright).
 *
 *  "buddy" — warm, conversational female voice (Bone Buddy chat read-aloud).
 *    Voice family: Karen · Emma · Aria · Libby · Sonia · Amy.
 *    Cadence: present, friendly — like a knowledgeable friend talking to you.
 *    Rate: iOS 0.54 / Android 0.94 (more conversational, not rushed).
 *    Pitch: 1.07 (slightly warmer / brighter — clearly distinct from wellness).
 *
 * Voice selection runs once on mount via getAvailableVoicesAsync().
 * Priority order for each persona:
 *   1. Persona-preferred name + quality (Enhanced / Premium / Neural / WaveNet)
 *   2. Persona-preferred name (any quality)
 *   3. Any enhanced/neural female en-GB voice
 *   4. Any female en-GB voice
 *   5. Any enhanced female English voice (fallback to any locale)
 *   6. Any female English voice
 *   7. OS default
 *
 * The resolved identifier is stored in a ref so it's available synchronously
 * inside speak() without triggering re-renders.
 */

import * as Speech from "expo-speech";
import { Platform } from "react-native";
import { useEffect, useRef } from "react";

export type VoicePersona = "wellness" | "buddy";

// ─── Name hint pools ─────────────────────────────────────────────────────────

/** Names that strongly suggest a female voice across Apple, Google, and MS TTS. */
const FEMALE_HINTS =
  /(female|woman|serena|kate|karen|moira|fiona|tessa|samantha|allison|ava|susan|joanna|sara|emma|olivia|nora|amy|jenny|aria|libby|sonia|amber|cora|elsa|lily|victoria|alice|zoe|charlotte|phoebe|grace|jessica|helena|freya|hazel|ivy|luna|nova|rose|ruth|helen|claire|sarah|anna|anne|mary|eleanor|elaine|claire|diana|sophie|natasha|rachel)/i;

/** Token hints for premium / neural quality voices. */
const QUALITY_HINTS =
  /(enhanced|premium|natural|neural|wavenet|network|hd|high[\s-]?quality)/i;

/**
 * Name hints that best match the WELLNESS persona voice family.
 * Voices in this group tend to sound calm, neutral, and measured —
 * ideal for guided breathing and meditation narration.
 */
const WELLNESS_PREFER =
  /(serena|kate|moira|fiona|tessa|victoria|helena|freya|claire|eleanor)/i;

/**
 * Name hints that best match the BUDDY persona voice family.
 * Voices in this group tend to sound warmer and more conversational.
 */
const BUDDY_PREFER =
  /(karen|emma|aria|libby|sonia|amy|jenny|amber|ava|olivia|allison|zoe|sophie|rose|nova)/i;

// ─── Voice selection ──────────────────────────────────────────────────────────

function id(v: Speech.Voice): string {
  return `${v.name ?? ""} ${v.identifier ?? ""} ${v.quality ?? ""}`;
}

function pickVoice(
  voices: Speech.Voice[],
  persona: VoicePersona
): string | undefined {
  const preferred = persona === "wellness" ? WELLNESS_PREFER : BUDDY_PREFER;
  const fallback  = persona === "wellness" ? BUDDY_PREFER    : WELLNESS_PREFER;

  // Build pools: en-GB first, then any English locale.
  const enGb  = voices.filter((v) => /^en[-_]GB/i.test(v.language ?? ""));
  const enAny = voices.filter((v) => /^en[-_]/i.test(v.language ?? ""));
  const pool  = enGb.length ? enGb : enAny;

  return (
    // 1. Persona-preferred name + quality-enhanced female
    pool.find(
      (v) =>
        preferred.test(id(v)) &&
        QUALITY_HINTS.test(id(v)) &&
        FEMALE_HINTS.test(id(v))
    )?.identifier ??
    // 2. Persona-preferred name, female (any quality)
    pool.find(
      (v) => preferred.test(id(v)) && FEMALE_HINTS.test(id(v))
    )?.identifier ??
    // 3. Any quality-enhanced female in the pool
    pool.find(
      (v) => QUALITY_HINTS.test(id(v)) && FEMALE_HINTS.test(id(v))
    )?.identifier ??
    // 4. Any female in the pool
    pool.find((v) => FEMALE_HINTS.test(id(v)))?.identifier ??
    // 5. Fallback-persona enhanced female (cross-locale acceptable)
    enAny.find(
      (v) =>
        fallback.test(id(v)) &&
        QUALITY_HINTS.test(id(v)) &&
        FEMALE_HINTS.test(id(v))
    )?.identifier ??
    // 6. Any enhanced female in any English locale
    enAny.find(
      (v) => QUALITY_HINTS.test(id(v)) && FEMALE_HINTS.test(id(v))
    )?.identifier ??
    // 7. Any female in any English locale
    enAny.find((v) => FEMALE_HINTS.test(id(v)))?.identifier ??
    // 8. OS default (pool[0] is already en-GB biased)
    pool[0]?.identifier
  );
}

// ─── Per-persona speech defaults ─────────────────────────────────────────────

interface SpeechDefaults {
  rate: number;
  pitch: number;
  volume: number;
}

function personaDefaults(persona: VoicePersona): SpeechDefaults {
  if (persona === "wellness") {
    // Calm, deliberate — slowed to premium-audiobook / Calm-app territory.
    // iOS 0.42 sits in the "professional wellness narrator" zone: unhurried
    // without sounding sluggish.  Android needs a higher raw value to land
    // at roughly the same perceived speed due to its different rate scale.
    // Pitch 1.02 adds the barest warmth over the neutral 1.0 without
    // pushing the voice toward the artificially bright "assistant" tone.
    return {
      rate: Platform.OS === "ios" ? 0.42 : 0.74,
      pitch: 1.02,
      volume: 1.0,
    };
  }
  // Buddy: warmer, slightly faster — conversational without rushing.
  return {
    rate: Platform.OS === "ios" ? 0.54 : 0.94,
    pitch: 1.07,
    volume: 1.0,
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface UseSpeechVoiceReturn {
  /** Resolved voice identifier (populated async after mount). */
  voiceRef: React.MutableRefObject<string | undefined>;
  /**
   * Speak `text` using the persona's voice and defaults.
   * Pass `options` to override individual Speech parameters (e.g. rate).
   */
  speak: (text: string, options?: Partial<Speech.SpeechOptions>) => void;
  /** Stop any currently playing speech. */
  stop: () => void;
}

export function useSpeechVoice(persona: VoicePersona): UseSpeechVoiceReturn {
  const voiceRef = useRef<string | undefined>(undefined);
  const defaults = personaDefaults(persona);

  useEffect(() => {
    let cancelled = false;
    Speech.getAvailableVoicesAsync()
      .then((voices) => {
        if (cancelled || !voices?.length) return;
        voiceRef.current = pickVoice(voices, persona);
      })
      .catch(() => {
        // Best-effort — OS default voice used if async call fails.
      });
    return () => {
      cancelled = true;
    };
  }, [persona]);

  function speak(text: string, options?: Partial<Speech.SpeechOptions>) {
    Speech.stop();
    Speech.speak(text.trim(), {
      language: "en-GB",
      voice: voiceRef.current,
      ...defaults,
      ...options,
    });
  }

  function stop() {
    Speech.stop().catch(() => {});
  }

  return { voiceRef, speak, stop };
}
