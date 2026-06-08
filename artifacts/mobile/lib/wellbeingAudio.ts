/**
 * Audio source map for the Breathing Studio and Meditation features.
 *
 * Each mood has a POOL of exactly 3 tracks. The rotation engine
 * (`audioRotation.ts`) picks from the pool each session, avoiding recently
 * played tracks and (for meditations) weighting by time of day.
 *
 * BREATHING POOLS — no timeWeight restrictions
 *   Every track in a breathing pool is available at any time of day so the
 *   rotation engine always has all 3 to choose from. This prevents the
 *   "3 min and 12 min use the same track" bug that occurred when timeWeight
 *   filtering narrowed a morning pool down to a single eligible track.
 *
 *   calm    → Serene View · Dreams Feel Real · Rest Now
 *   focus   → Smooth Jazz · Soft Background · Morning Ambient
 *   energy  → I Do! · Slow Walk · Peaceful Stream
 *   sleep   → Night Sky · Still Moon · Calming Pulse
 *   stress  → Slow Walk · Soft Background · Serene View  (stress shares; user-facing N/A to uniqueness complaint)
 *
 *   The 4 primary categories (calm / focus / energy / sleep) use 12 fully
 *   distinct tracks with zero cross-category overlap.
 *
 * MEDITATION POOLS — timeWeight retained for richer context-aware selection
 *   stress_relief  → Slow Walk (any) · Soft Background (morn/aft) · Dreams Feel Real (eve)
 *   sleep_support  → Rest Now (any)  · Dreams Feel Real (eve) · Still Moon (aft/eve)
 *   focus_clarity  → Smooth Jazz (morn/aft) · Morning Ambient (any) · Serene View (aft/eve)
 *   confidence     → I Do! (morn/aft) · Serene View (any) · Peaceful Stream (eve)
 *
 * TRACK SOURCES
 *   All tracks are royalty-free from Mixkit (https://mixkit.co/free-stock-music/).
 *   Mixkit's free music license permits background use in apps where music is
 *   not the sole/primary purpose. Keep attribution in the in-app credits screen.
 */

export type TimeOfDay = "morning" | "afternoon" | "evening";

export interface AudioTrack {
  /** Direct streamable mp3 URL. */
  url: string;
  /** Human-readable track title for in-app credits. */
  title: string;
  /** Track artist for in-app credits. */
  artist: string;
  /** Short description of the sound identity. */
  vibe: string;
  /** Source / licensor. */
  source: "Mixkit";
  /**
   * Optional time-of-day preference. Tracks without this field are
   * considered neutral — suitable at any time of day.
   * Omitted from all breathing pools (all-day availability by design).
   */
  timeWeight?: TimeOfDay[];
}

// ─── Shared track catalogue ─────────────────────────────────────────────────
// Each entry is defined once and spread into pools below.

const T = {
  // ── Original 7 (confirmed Mixkit IDs) ─────────────────────────────────────
  sereneView: {
    url:    "https://assets.mixkit.co/music/443/443.mp3",
    title:  "Serene View",
    artist: "Arulo",
    vibe:   "Soft chilled lounge — Ibiza sunset after a long day",
    source: "Mixkit",
  },
  dreamsFeelReal: {
    url:    "https://assets.mixkit.co/music/553/553.mp3",
    title:  "Dreams Feel Real",
    artist: "Eugenio Mininni",
    vibe:   "Dreamy ambient cloud — slow, weightless, hypnotic",
    source: "Mixkit",
  },
  restNow: {
    url:    "https://assets.mixkit.co/music/584/584.mp3",
    title:  "Rest Now",
    artist: "Eugenio Mininni",
    vibe:   "Deep ambient pads — night-time calm after sunset",
    source: "Mixkit",
  },
  smoothJazz: {
    url:    "https://assets.mixkit.co/music/640/640.mp3",
    title:  "Smooth Jazz",
    artist: "Francisco Alvear",
    vibe:   "Minimal acid jazz — calm studio space, sharp presence",
    source: "Mixkit",
  },
  softBackground: {
    url:    "https://assets.mixkit.co/music/488/488.mp3",
    title:  "Soft Background Music",
    artist: "Scott Holmes",
    vibe:   "Gentle ambient wash — light, open, safe",
    source: "Mixkit",
  },
  iDo: {
    url:    "https://assets.mixkit.co/music/1001/1001.mp3",
    title:  "I Do!",
    artist: "Michael Ramir C.",
    vibe:   "Confident uplifting house — sunrise activation",
    source: "Mixkit",
  },
  slowWalk: {
    url:    "https://assets.mixkit.co/music/1009/1009.mp3",
    title:  "Slow Walk",
    artist: "Michael Ramir C.",
    vibe:   "Slow funky chill — luxury wellness lounge exhale",
    source: "Mixkit",
  },
  // ── New tracks added for full category isolation ───────────────────────────
  morningAmbient: {
    url:    "https://assets.mixkit.co/music/494/494.mp3",
    title:  "Morning Ambient",
    artist: "Mixkit",
    vibe:   "Bright open ambient — clear head, focused presence",
    source: "Mixkit",
  },
  peacefulStream: {
    url:    "https://assets.mixkit.co/music/496/496.mp3",
    title:  "Peaceful Stream",
    artist: "Mixkit",
    vibe:   "Flowing ambient — movement, progress, quiet energy",
    source: "Mixkit",
  },
  // ── Calm category — daytime-bright, airy (not sleep-adjacent) ─────────────
  sunriseAmbient: {
    url:    "https://assets.mixkit.co/music/470/470.mp3",
    title:  "Sunrise Ambient",
    artist: "Mixkit",
    vibe:   "Open airy ambient — fresh morning, quiet optimism",
    source: "Mixkit",
  },
  breathingSpace: {
    url:    "https://assets.mixkit.co/music/480/480.mp3",
    title:  "Breathing Space",
    artist: "Mixkit",
    vibe:   "Spacious soft ambient — room to breathe, tension released",
    source: "Mixkit",
  },
  // ── Energy category — upbeat, motivating ──────────────────────────────────
  activeMoment: {
    url:    "https://assets.mixkit.co/music/1015/1015.mp3",
    title:  "Active Moment",
    artist: "Mixkit",
    vibe:   "Upbeat rhythmic — momentum, drive, ready to move",
    source: "Mixkit",
  },
  positiveFlow: {
    url:    "https://assets.mixkit.co/music/1017/1017.mp3",
    title:  "Positive Flow",
    artist: "Mixkit",
    vibe:   "Bright groovy — confident, forward, energised",
    source: "Mixkit",
  },
  calmingPulse: {
    url:    "https://assets.mixkit.co/music/502/502.mp3",
    title:  "Calming Pulse",
    artist: "Mixkit",
    vibe:   "Slow gentle pulse — steady breath, quiet mind",
    source: "Mixkit",
  },
  nightSky: {
    url:    "https://assets.mixkit.co/music/534/534.mp3",
    title:  "Night Sky",
    artist: "Mixkit",
    vibe:   "Deep open ambient — stillness, stars, drift toward sleep",
    source: "Mixkit",
  },
  stillMoon: {
    url:    "https://assets.mixkit.co/music/550/550.mp3",
    title:  "Still Moon",
    artist: "Mixkit",
    vibe:   "Soft lunar ambient — weightless, drifting, hypnotic rest",
    source: "Mixkit",
  },
} satisfies Record<string, Omit<AudioTrack, "timeWeight">>;

// ─── Breathing Studio pools ─────────────────────────────────────────────────
//
// DESIGN CONTRACT
//   • Every category owns exactly 3 unique tracks.
//   • No track appears in more than one pool (all 5 × 3 = 15 tracks distinct).
//   • No timeWeight — all 3 tracks are available at every time of day so
//     the rotation engine can always cycle properly across durations.
//
//   calm   : sereneView     · sunriseAmbient  · breathingSpace
//   stress : slowWalk       · dreamsFeelReal  · restNow
//   focus  : smoothJazz     · softBackground  · morningAmbient   ← unchanged (confirmed good)
//   energy : iDo            · activeMoment    · positiveFlow
//   sleep  : nightSky       · stillMoon       · calmingPulse      ← unchanged (confirmed good)
//
// Change rationale (v3):
//   calm   — dreamsFeelReal/restNow were too sleep-adjacent for a daytime calm
//            session; replaced with two genuinely airy, morning-friendly tracks.
//   stress — now gets dreamsFeelReal + restNow (deeply grounding/releasing —
//            perfect for active stress relief) plus slowWalk (moved from energy).
//   energy — slowWalk moved to stress; replaced with two dedicated upbeat tracks.

export const BREATHING_POOLS: Record<string, AudioTrack[]> = {
  calm: [
    { ...T.sereneView },        // gentle chilled lounge — soft daytime ease
    { ...T.sunriseAmbient },    // open airy ambient — fresh, quiet optimism
    { ...T.breathingSpace },    // spacious soft — room to breathe, tension drops
  ],
  stress: [
    { ...T.slowWalk },          // slow funky chill — reassuring rhythm
    { ...T.dreamsFeelReal },    // dreamy cloud — slow exhale, let it go
    { ...T.restNow },           // deep ambient pads — grounding, safe landing
  ],
  focus: [
    { ...T.smoothJazz },        // minimal acid jazz — sharp, clear presence
    { ...T.softBackground },    // gentle wash — open, uncluttered mind
    { ...T.morningAmbient },    // bright ambient — focused, ready
  ],
  energy: [
    { ...T.iDo },               // uplifting house — sunrise activation
    { ...T.activeMoment },      // upbeat rhythmic — momentum, drive
    { ...T.positiveFlow },      // bright groovy — confident, energised
  ],
  sleep: [
    { ...T.nightSky },          // deep open ambient — drift toward sleep
    { ...T.stillMoon },         // soft lunar — weightless, hypnotic rest
    { ...T.calmingPulse },      // slow gentle pulse — quiet mind, heavy limbs
  ],
};

// ─── Meditation pools ───────────────────────────────────────────────────────
//
// Meditations retain timeWeight for richer time-of-day context.
// Updated to replace cross-pool duplicates where possible.

export const MEDITATION_POOLS: Record<string, AudioTrack[]> = {
  stress_relief: [
    { ...T.slowWalk },                                                      // any
    { ...T.softBackground,   timeWeight: ["morning", "afternoon"] },
    { ...T.dreamsFeelReal,   timeWeight: ["evening"] },
  ],
  sleep_support: [
    { ...T.restNow },                                                       // any
    { ...T.dreamsFeelReal,   timeWeight: ["evening"] },
    { ...T.stillMoon,        timeWeight: ["afternoon", "evening"] },
  ],
  focus_clarity: [
    { ...T.smoothJazz,       timeWeight: ["morning", "afternoon"] },
    { ...T.morningAmbient },                                                // any
    { ...T.sereneView,       timeWeight: ["afternoon", "evening"] },
  ],
  confidence: [
    { ...T.iDo,              timeWeight: ["morning", "afternoon"] },
    { ...T.sereneView },                                                    // any
    { ...T.peacefulStream,   timeWeight: ["evening"] },
  ],
  // ── New emotional-support sessions ──────────────────────────────────────────
  //   calm_regulation  — grounding tracks; breathing-space vibe, not sleep-adjacent
  //   sadness_support  — softest, most enveloping tracks; safe and held
  //   happiness_lift   — warm and lightly uplifting; brighter morning energy
  calm_regulation: [
    { ...T.breathingSpace },                                                // any — spacious, releases tension
    { ...T.softBackground,   timeWeight: ["morning", "afternoon"] },       // gentle wash — open, safe
    { ...T.restNow,          timeWeight: ["evening"] },                    // deep grounding pads — landing
  ],
  sadness_support: [
    { ...T.dreamsFeelReal },                                                // any — weightless, held
    { ...T.stillMoon,        timeWeight: ["afternoon", "evening"] },       // soft lunar — drifting, compassionate
    { ...T.calmingPulse,     timeWeight: ["morning"] },                    // slow pulse — steady, you're okay
  ],
  happiness_lift: [
    { ...T.peacefulStream },                                                // any — flowing, forward energy
    { ...T.morningAmbient,   timeWeight: ["morning", "afternoon"] },       // bright open — clear head, light
    { ...T.iDo,              timeWeight: ["morning"] },                    // uplifting house — sunrise warmth
  ],
  //   resilience     — grounding but not heavy; strength without hardness
  //   body_gratitude — warm, airy, appreciative; not sleep-adjacent
  resilience: [
    { ...T.sereneView },                                                    // any — steady, unhurried presence
    { ...T.softBackground,   timeWeight: ["morning", "afternoon"] },       // open wash — safe to breathe
    { ...T.peacefulStream,   timeWeight: ["evening"] },                    // flowing — quiet forward movement
  ],
  body_gratitude: [
    { ...T.breathingSpace },                                                // any — room to breathe, release
    { ...T.morningAmbient,   timeWeight: ["morning"] },                    // bright ambient — fresh, alive
    { ...T.sunriseAmbient,   timeWeight: ["morning", "afternoon"] },       // open airy — quiet optimism
  ],
};

// ─── Duplicate check (development aid) ──────────────────────────────────────
//
// Run `pnpm ts-node -e "import('./lib/wellbeingAudio').then(m => m.auditBreathingPools())"` to verify.

export function auditBreathingPools(): void {
  const primary = ["calm", "focus", "energy", "sleep"] as const;
  const urlToCategories = new Map<string, string[]>();
  for (const key of primary) {
    for (const track of BREATHING_POOLS[key]) {
      const list = urlToCategories.get(track.url) ?? [];
      list.push(key);
      urlToCategories.set(track.url, list);
    }
  }
  let clean = true;
  for (const [url, cats] of urlToCategories) {
    if (cats.length > 1) {
      console.warn(`DUPLICATE across ${cats.join(" + ")}: ${url}`);
      clean = false;
    }
  }
  if (clean) console.log("✓ All 12 primary breathing tracks are unique — no cross-category duplicates.");
}

// ─── Legacy single-track exports (kept for backward compat) ─────────────────

/** @deprecated Use `BREATHING_POOLS` + rotation engine for track selection. */
export const BREATHING_AUDIO = {
  calm:   T.sereneView,
  stress: T.slowWalk,
  focus:  T.smoothJazz,
  energy: T.iDo,
  sleep:  T.restNow,
} as const;

/** @deprecated Use `MEDITATION_POOLS` + rotation engine for track selection. */
export const MEDITATION_AUDIO = {
  stress_relief: T.slowWalk,
  sleep_support: T.restNow,
  focus_clarity: T.smoothJazz,
  confidence:    T.sereneView,
} as const;

/** @deprecated Use `MEDITATION_POOLS` + rotation engine for track selection. */
export const MEDITATION_MUSIC: Record<keyof typeof MEDITATION_AUDIO, string> = {
  stress_relief: MEDITATION_AUDIO.stress_relief.url,
  sleep_support: MEDITATION_AUDIO.sleep_support.url,
  focus_clarity: MEDITATION_AUDIO.focus_clarity.url,
  confidence:    MEDITATION_AUDIO.confidence.url,
};

export type { AudioTrack as BreathingAudio, AudioTrack as MeditationAudio };
