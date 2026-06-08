import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useAudioPlayer } from "expo-audio";
import * as Speech from "expo-speech";
import { useSpeechVoice } from "@/lib/useSpeechVoice";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { MEDITATION_POOLS } from "@/lib/wellbeingAudio";
import { getTimeOfDay, getTrackHistory, pickTrack, recordTrackPlay } from "@/lib/audioRotation";
import { MOOD_LABELS, Mood, useWellbeing } from "@/context/WellbeingContext";
import { PostSessionPromptCard } from "@/components/PostSessionPrompt";
import { PremiumGate } from "@/components/PremiumGate";
import { useSubscription } from "@/lib/revenuecat";

interface ScriptLine {
  /** Seconds at which to start speaking. */
  at: number;
  text: string;
}

interface Meditation {
  id:
    | "stress_relief"
    | "sleep_support"
    | "focus_clarity"
    | "confidence"
    | "calm_regulation"
    | "sadness_support"
    | "happiness_lift"
    | "resilience"
    | "body_gratitude";
  title: string;
  duration: number; // seconds
  short: string;
  description: string;
  gradientFrom: string;
  gradientTo: string;
  accent: string;
  icon: keyof typeof Feather.glyphMap;
  /** Slow, well-paced narration. Each line is read at its `at` time. */
  script: ScriptLine[];
}

const MEDITATIONS: Meditation[] = [
  {
    id: "stress_relief",
    title: "Stress Relief",
    duration: 5 * 60,
    short: "5 min · Release tension",
    description: "Loosen the grip of a tense day. Soft awareness, slow breath, gentle release.",
    gradientFrom: "#0c4a6e",
    gradientTo: "#0ea5e9",
    accent: "#7dd3fc",
    icon: "wind",
    script: [
      { at: 2,   text: "Welcome... find a comfortable position, and let your shoulders soften." },
      { at: 18,  text: "Close your eyes if that feels right... and take a slow, full breath in." },
      { at: 35,  text: "And a long, easy breath out... let the day fall away with it." },
      { at: 60,  text: "Notice the weight of your body... wherever it's held, let it rest." },
      { at: 95,  text: "Bring your attention to your jaw... let it loosen. Let your tongue drop softly from the roof of your mouth." },
      { at: 130, text: "Soften your forehead... release the tension behind your eyes." },
      { at: 165, text: "Drop your awareness to your chest... feel it rise, and fall. Rise... and fall." },
      { at: 200, text: "Each breath... is an invitation to let go of something. Nothing to hold. Nothing to fix." },
      { at: 238, text: "If a thought arrives... notice it, without judgment. Then let it drift past... like a cloud." },
      { at: 272, text: "Beneath the noise of the day... there is a stillness. It was always here." },
      { at: 280, text: "Take one more slow breath in… and a long, easy release." },
      { at: 295, text: "When you're ready, gently open your eyes. Carry this quiet with you." },
    ],
  },
  {
    id: "sleep_support",
    title: "Sleep Support",
    duration: 7 * 60,
    short: "7 min · Drift into rest",
    description: "Wind down body and mind. A slow descent into deep, restorative sleep.",
    gradientFrom: "#0D2530",
    gradientTo: "#1C3A4A",
    accent: "#3ABBD4",
    icon: "moon",
    script: [
      { at: 2,   text: "Settle into bed... let yourself be fully supported." },
      { at: 22,  text: "Take a soft breath in… and let it out with a quiet sigh. Again." },
      { at: 48,  text: "Begin at your feet... notice them. Let them grow warm... and heavy." },
      { at: 88,  text: "Let that heaviness travel up through your legs... slow... still." },
      { at: 128, text: "Your hips... your lower back. Feel them sink a little deeper into the bed." },
      { at: 168, text: "Your belly softens with every breath... your chest opens, and slows." },
      { at: 210, text: "Your arms grow heavy now... your hands rest, completely still." },
      { at: 250, text: "Your shoulders melt away from your ears... your neck releases its last hold." },
      { at: 292, text: "Your face softens... your jaw... your forehead... your eyes." },
      { at: 332, text: "Your breath is barely there now... quiet... slow... easy." },
      { at: 375, text: "There is nothing left to do... nowhere to be... only this." },
      { at: 410, text: "Let sleep come to meet you here." },
    ],
  },
  {
    id: "focus_clarity",
    title: "Focus & Clarity",
    duration: 6 * 60,
    short: "6 min · Sharpen the mind",
    description: "A grounded reset to clear mental fog and bring you back to centre.",
    gradientFrom: "#064e3b",
    gradientTo: "#10b981",
    accent: "#a7f3d0",
    icon: "target",
    script: [
      { at: 2,   text: "Sit upright, but at ease... feet on the floor, hands resting in your lap." },
      { at: 20,  text: "Take a clean breath in through the nose... and a long, steady breath out." },
      { at: 42,  text: "Choose a single point for your attention — perhaps the soft movement of breath at your nostrils." },
      { at: 80,  text: "When the mind wanders... simply notice, and return. There is no failure here — only the practice of returning." },
      { at: 125, text: "A thought arrives... you notice it. You let it pass... like a cloud crossing a clear sky." },
      { at: 168, text: "Another thought... another cloud. The sky itself never moves." },
      { at: 212, text: "Now... gently widen your awareness. Notice sounds without naming them. Let them come and go." },
      { at: 258, text: "Feel the weight of the body, the temperature of the air, the rhythm of your breath." },
      { at: 305, text: "Take three deliberate breaths — each one a little fuller. In… and fully out." },
      { at: 348, text: "When you open your eyes, carry this clarity with you... present. Alert. Settled." },
    ],
  },
  {
    id: "confidence",
    title: "Confidence & Mindset",
    duration: 6 * 60,
    short: "6 min · Stand in your strength",
    description: "Reconnect to your sense of capability. A reminder of what you carry within.",
    gradientFrom: "#7c2d12",
    gradientTo: "#f97316",
    accent: "#fed7aa",
    icon: "sun",
    script: [
      { at: 2,   text: "Sit tall... feel the line of your spine, lifting you gently from within." },
      { at: 22,  text: "Take a slow breath in — let your chest open wide. And a full breath out." },
      { at: 45,  text: "Place a hand over your heart... feel it beating. Steady. Strong. Yours." },
      { at: 82,  text: "This body has carried you through every hard day, and every good one... it is still here, with you." },
      { at: 125, text: "Bring to mind one moment... when you felt truly capable. When something in you simply knew — I can do this." },
      { at: 170, text: "Let that feeling rise in your chest... let it spread — through your shoulders, your arms, your hands." },
      { at: 212, text: "You are allowed to take up space. You are allowed to be seen, as you are, right now." },
      { at: 252, text: "Repeat softly, in the privacy of your own mind... I am steady. I am ready. I am enough." },
      { at: 295, text: "One more full, strong breath... breathe in everything that is true about you." },
      { at: 325, text: "Carry this. It was always yours." },
    ],
  },
  {
    id: "calm_regulation",
    title: "Calm & Regulation",
    duration: 6 * 60,
    short: "6 min · Settle the nervous system",
    description: "When you feel activated, overwhelmed, or wound tight. A gentle return to your baseline.",
    gradientFrom: "#083344",
    gradientTo: "#0e7490",
    accent: "#a5f3fc",
    icon: "anchor",
    script: [
      { at: 2,   text: "You're here... whatever brought you — you've done the right thing. Just arrive." },
      { at: 22,  text: "Let your body be still... loosen your grip — on the chair, on the floor, on the day." },
      { at: 48,  text: "Take a slow breath in through the nose for four counts… and out through the mouth for six. Again." },
      { at: 88,  text: "Feel the exhale... that long out-breath is your nervous system finding its signal to slow down." },
      { at: 128, text: "Place one hand on your chest, one on your belly... feel both rise. Both fall. You are safe here." },
      { at: 170, text: "If there's tightness anywhere — jaw, throat, chest — breathe toward it. Don't force it open. Just breathe near it." },
      { at: 212, text: "Notice any sounds around you... let them be. They don't need your attention — only your breath does." },
      { at: 252, text: "Your nervous system is listening to you right now... every slow breath tells it — the danger has passed. We can rest." },
      { at: 295, text: "Take one more deliberate breath in… hold it gently… and a long, complete release." },
      { at: 332, text: "You are regulated. You are grounded. You are okay." },
      { at: 348, text: "Gently open your eyes when you're ready. You can return here whenever you need." },
    ],
  },
  {
    id: "sadness_support",
    title: "Sadness & Worry",
    duration: 6 * 60,
    short: "6 min · Hold what's heavy",
    description: "For the days when something aches. A compassionate space to sit with what you feel.",
    gradientFrom: "#1e1b4b",
    gradientTo: "#4f46e5",
    accent: "#c7d2fe",
    icon: "heart",
    script: [
      { at: 2,   text: "You're allowed to feel what you feel... whatever is here, it's welcome." },
      { at: 22,  text: "Find a comfortable position... and let your body be held. You don't have to hold yourself together right now." },
      { at: 50,  text: "Take a gentle breath in… and a slow breath out. There's no rush. Nowhere to be." },
      { at: 85,  text: "If there's sadness... let it be there. Worry. Heaviness. You don't have to fix it, or explain it." },
      { at: 128, text: "Place a hand on your heart... this is a gesture of kindness toward yourself. You deserve that kindness." },
      { at: 170, text: "Notice where the feeling lives in the body... your throat, your chest, behind the eyes. Just notice." },
      { at: 212, text: "You are not too much. You are not broken. This is what it feels like to be human, and to care." },
      { at: 252, text: "Breathe softly... around whatever is here. You don't have to carry it alone. Let the breath help hold it." },
      { at: 295, text: "This feeling is real. And it will also shift — not because you force it to, but because feelings always move." },
      { at: 332, text: "Take one more gentle breath in… and let it go slowly." },
      { at: 348, text: "You are still here. That takes courage. Be gentle with yourself today." },
    ],
  },
  {
    id: "happiness_lift",
    title: "Happiness & Joy",
    duration: 5 * 60,
    short: "5 min · Cultivate what's good",
    description: "An invitation to notice, feel, and let in the warmth that's already around you.",
    gradientFrom: "#713f12",
    gradientTo: "#d97706",
    accent: "#fde68a",
    icon: "star",
    script: [
      { at: 2,   text: "Welcome... sit comfortably, and let yourself smile — even just a little. It's enough." },
      { at: 22,  text: "Take a bright, full breath in... and a warm, easy breath out. Notice how that feels." },
      { at: 48,  text: "Think of one small thing that's good right now... a warmth, a colour, a person, a moment. Let it be small." },
      { at: 85,  text: "Let that small good thing sit in your chest for a moment... notice if it grows even slightly warmer." },
      { at: 122, text: "Joy doesn't always arrive as fireworks... sometimes it's this — quiet, steady, and yours." },
      { at: 162, text: "Bring to mind someone whose face makes you feel lighter... hold them gently in your thoughts." },
      { at: 200, text: "Notice the aliveness in your body — the breath, the heartbeat, the simple fact of being here." },
      { at: 242, text: "You are allowed to feel good. Fully. Without guilt. Joy is not borrowed — it belongs to you." },
      { at: 278, text: "Take one more deep, generous breath in — and let it fill you. Really let it in." },
      { at: 295, text: "Open your eyes when you're ready. Carry a little of this with you into the day." },
    ],
  },
  {
    id: "resilience",
    title: "Resilience & Strength",
    duration: 6 * 60,
    short: "6 min · Find your footing",
    description: "For the hard days. A reminder that you have come through difficulty before — and you will again.",
    gradientFrom: "#3b0764",
    gradientTo: "#7e22ce",
    accent: "#e9d5ff",
    icon: "shield",
    script: [
      { at: 2,   text: "You showed up... on a hard day, that is not a small thing." },
      { at: 22,  text: "Find a comfortable position... let your spine support you — feel it holding you upright." },
      { at: 48,  text: "Take a slow breath in... and a long breath out. With each exhale, let something soften." },
      { at: 85,  text: "Think of one difficult thing you have already been through... you made it to this side of it." },
      { at: 128, text: "That wasn't luck. That was you — your tenacity, your adaptability, your will to keep going." },
      { at: 170, text: "Whatever you are facing now, the same strength that carried you before is still here." },
      { at: 212, text: "Breathe into that strength... not defiance — just a quiet knowing. I have done hard things. I can do this." },
      { at: 252, text: "Rest a moment in that knowing... let it settle in your chest like something solid." },
      { at: 295, text: "Take a full, strong breath in... and let it out slowly — releasing what you don't need to carry today." },
      { at: 332, text: "You are more resilient than you know. Open your eyes when you're ready." },
    ],
  },
  {
    id: "body_gratitude",
    title: "Body Gratitude",
    duration: 5 * 60,
    short: "5 min · Appreciate what's here",
    description: "A gentle practice of noticing and thanking the body — exactly as it is, today.",
    gradientFrom: "#14290f",
    gradientTo: "#15803d",
    accent: "#86efac",
    icon: "feather",
    script: [
      { at: 2,   text: "Settle in. Let the body just… be. No goals. No fixing. Just presence." },
      { at: 22,  text: "Take a slow breath in... and notice your lungs filling. They've done this, quietly, your whole life." },
      { at: 48,  text: "Bring your attention to your heart... feel it beating. It hasn't missed a single beat for you." },
      { at: 85,  text: "Think of your feet — everywhere they have taken you. The ground they have covered." },
      { at: 122, text: "Your hands — everything they have made, held, and offered. What a thing they have done." },
      { at: 162, text: "Even the parts that ache... or feel less certain — they are still trying for you. Still working." },
      { at: 200, text: "Silently, offer your body a moment of thanks. Not for being perfect — simply for being yours." },
      { at: 240, text: "Take one last, appreciative breath in — right down to the belly. And let it go." },
      { at: 278, text: "Carry this gentleness with you. Your body deserves your kindness, every day." },
    ],
  },
];

/**
 * Music level steps. Voice plays at volume 1.0, so even the loudest step
 * keeps the bed at 30% of the voice — voice always dominates per the
 * meditation audio spec.
 */
const MUSIC_LEVELS = [0.10, 0.18, 0.25, 0.30] as const;
/** Multiplier applied to the bed while the narrator is speaking. */
const VOICE_DUCK_MULTIPLIER = 0.55;
const FADE_STEPS = 12;
const FADE_MS = 1500;
/** Fraction of the session occupied by the soft opening / closing phases. */
const ENVELOPE_OPENING = 0.15;
const ENVELOPE_CLOSING = 0.15;
/** Opening phase rises from this fraction of the user-set level → 100%. */
const ENVELOPE_OPENING_FLOOR = 0.5;

/**
 * Three-phase volume envelope so the music's perceived shape stretches with
 * the session length: a soft "arrival" rise, a stable middle bed, and a
 * gentle taper to silence at the end. Returns the multiplier applied to
 * `base`. Pure for testability.
 */
function envelopeFor(elapsed: number, duration: number, base: number): number {
  if (duration <= 0 || base <= 0) return 0;
  const p = Math.max(0, Math.min(1, elapsed / duration));
  if (p < ENVELOPE_OPENING) {
    const t = p / ENVELOPE_OPENING;
    return base * (ENVELOPE_OPENING_FLOOR + (1 - ENVELOPE_OPENING_FLOOR) * t);
  }
  if (p > 1 - ENVELOPE_CLOSING) {
    const t = (p - (1 - ENVELOPE_CLOSING)) / ENVELOPE_CLOSING;
    return base * Math.max(0, 1 - t);
  }
  return base;
}

type Stage = "list" | "active" | "reflect";

export default function MeditationScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { logSession, currentStreak, todayCount, weekCount } = useWellbeing();
  const { hasPremiumOrTrial } = useSubscription();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [stage, setStage] = useState<Stage>("list");
  const [active, setActive] = useState<Meditation | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [musicOn, setMusicOn] = useState(true);
  const [voiceOn, setVoiceOn] = useState(true);
  const [volumeStep, setVolumeStep] = useState(2);
  /**
   * True while the female narrator is mid-utterance. Used to duck the music
   * bed so the voice always sits clearly on top.
   */
  const [voiceActive, setVoiceActive] = useState(false);

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * The deferred hard-stop scheduled at the end of a fade-out. Tracked so a
   * quickly-restarted session can cancel it before it fires inside the
   * *next* session and pulls the volume to 0 mid-meditation.
   */
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bounded retry that ensures music actually starts even if the first
   * play() call races the player's load step. */
  const playRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const spokenIdsRef = useRef<Set<number>>(new Set());
  const orbAnim = useRef(new Animated.Value(0)).current;

  function clearStopTimeout() {
    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
  }
  function clearPlayRetry() {
    if (playRetryRef.current) {
      clearInterval(playRetryRef.current);
      playRetryRef.current = null;
    }
  }

  // `activeTrackUrl` is resolved once per session start by the rotation engine
  // — history-aware and time-of-day weighted — then held stable for the full
  // session so the player never reinitialises mid-meditation.
  const [activeTrackUrl, setActiveTrackUrl] = useState<string | null>(null);
  const musicSource = useMemo(() => {
    if (!activeTrackUrl) return null;
    return { uri: activeTrackUrl };
  }, [activeTrackUrl]);

  // expo-audio's hook always needs to be called the same way; pass undefined when no source.
  const player = useAudioPlayer(musicSource ?? undefined);

  useEffect(() => {
    if (!player || !active) return;
    try {
      player.loop = true;
      player.volume = 0;
    } catch {
      // ignore early-stage errors
    }
  }, [player, active]);

  /**
   * Absolute base level the user has chosen (0 if music is off / unavailable).
   * Doesn't yet include the envelope or voice ducking.
   */
  const baseVolume = useMemo(() => {
    if (!musicOn || !musicSource) return 0;
    return MUSIC_LEVELS[volumeStep];
  }, [musicOn, musicSource, volumeStep]);

  /**
   * The volume the player *should* be at right now: base × three-phase
   * envelope × voice-ducking multiplier. Recomputed on every tick.
   */
  const desiredVolume = useMemo(() => {
    if (!active) return 0;
    const env = envelopeFor(elapsed, active.duration, baseVolume);
    return env * (voiceActive ? VOICE_DUCK_MULTIPLIER : 1);
  }, [active, elapsed, baseVolume, voiceActive]);

  const fadeTo = (to: number, onDone?: () => void) => {
    if (!player || !musicSource) {
      onDone?.();
      return;
    }
    if (fadeRef.current) clearInterval(fadeRef.current);
    let from = 0;
    try {
      from = player.volume ?? 0;
    } catch {
      from = 0;
    }
    let step = 0;
    const stepMs = FADE_MS / FADE_STEPS;
    fadeRef.current = setInterval(() => {
      step += 1;
      const v = from + (to - from) * (step / FADE_STEPS);
      try {
        player.volume = Math.max(0, Math.min(1, v));
      } catch {
        // ignore
      }
      if (step >= FADE_STEPS) {
        if (fadeRef.current) clearInterval(fadeRef.current);
        fadeRef.current = null;
        onDone?.();
      }
    }, stepMs);
  };

  // Apply per-tick / per-event volume changes directly, so the envelope and
  // voice-ducking feel responsive instead of being smeared over a 1.5s
  // crossfade. The dedicated fadeTo() is used only for play-start, end and
  // abort transitions where a smooth ramp is what we want.
  useEffect(() => {
    if (stage !== "active" || !active || !musicSource || !player || !isPlaying) return;
    if (fadeRef.current) return;
    try {
      player.volume = Math.max(0, Math.min(1, desiredVolume));
    } catch {
      // ignore — player not ready yet
    }
  }, [desiredVolume, stage, active, musicSource, player, isPlaying]);

  // Pulsing orb animation.
  useEffect(() => {
    if (stage !== "active") {
      orbAnim.stopAnimation();
      orbAnim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(orbAnim, {
          toValue: 1,
          duration: 5000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(orbAnim, {
          toValue: 0,
          duration: 5000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [stage, orbAnim]);

  // ─── Voice — wellness persona (female en-GB, calm/measured). ───────────
  // useSpeechVoice handles voice selection, quality prioritisation, and
  // persona-appropriate defaults. Narration rate is slightly slower than
  // the persona default — meditation narration benefits from a touch more
  // space between phrases to feel genuinely guided rather than read aloud.
  const { speak: speakWellness } = useSpeechVoice("wellness");

  function speakLine(text: string) {
    if (!voiceOn) return;
    // Rate 0.47 on iOS sits in the "professional audiobook narrator" zone:
    // unhurried enough to feel guided, natural enough not to sound robotic.
    // Sentence-final punctuation gives the engine its own pause points.
    // onStart/onDone drive voiceActive so the music bed ducks while speaking.
    // Rate 0.43 iOS / 0.76 Android — premium-audiobook territory. This is
    // meaningfully slower than a normal speaking pace without drifting into
    // the uncanny valley of overly-stretched TTS. Android's rate scale is
    // wider than iOS so 0.76 ≈ the same perceived speed as 0.43 on iOS.
    speakWellness(text, {
      rate: Platform.OS === "ios" ? 0.43 : 0.76,
      onStart: () => setVoiceActive(true),
      onDone: () => setVoiceActive(false),
      onStopped: () => setVoiceActive(false),
      onError: () => setVoiceActive(false),
    });
  }

  async function startSession(med: Meditation) {
    // A previous session may have scheduled a deferred hard-stop or play
    // retry — cancel both so they can't fire inside this new session and
    // either silence the bed or fight against play().
    clearStopTimeout();
    clearPlayRetry();

    // Pick a rotated track — avoid recently played, weight by time of day.
    const pool = MEDITATION_POOLS[med.id] ?? MEDITATION_POOLS.stress_relief;
    const history = await getTrackHistory(med.id);
    const track = pickTrack(pool, history, getTimeOfDay());
    recordTrackPlay(med.id, track.url).catch(() => {});
    setActiveTrackUrl(track.url);

    setActive(med);
    setStage("active");
    setElapsed(0);
    setIsPlaying(true);
    spokenIdsRef.current = new Set();
  }

  function play() {
    if (!active) return;
    setIsPlaying(true);
  }

  function pause() {
    setIsPlaying(false);
  }

  function restart() {
    if (!active) return;
    Speech.stop();
    // Restart is the ONLY action that re-arms scripted lines.
    spokenIdsRef.current = new Set();
    setElapsed(0);
    setIsPlaying(true);
  }

  function skip(seconds: number) {
    if (!active) return;
    Speech.stop();
    setElapsed((s) => {
      const next = Math.max(0, Math.min(active.duration, s + seconds));
      // Forward-skip: mark any lines we leapfrogged past as already spoken
      // so they don't all queue up at the new position.
      // Backward-skip: keep the existing spoken set untouched so previously
      // spoken lines never replay (lines play exactly once per session).
      if (seconds > 0) {
        active.script.forEach((line, idx) => {
          if (line.at <= next) spokenIdsRef.current.add(idx);
        });
      }
      return next;
    });
  }

  function hardStopAudio() {
    if (fadeRef.current) clearInterval(fadeRef.current);
    fadeRef.current = null;
    try {
      if (player) player.volume = 0;
    } catch {
      // ignore
    }
    try {
      player?.pause();
    } catch {
      // ignore
    }
  }

  function abortSession() {
    Speech.stop();
    setVoiceActive(false);
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    clearPlayRetry();
    fadeTo(0);
    clearStopTimeout();
    stopTimeoutRef.current = setTimeout(hardStopAudio, FADE_MS + 50);
    setIsPlaying(false);
    setStage("list");
    setActive(null);
    spokenIdsRef.current = new Set();
  }

  function finishSession() {
    Speech.stop();
    setVoiceActive(false);
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    clearPlayRetry();
    fadeTo(0);
    // Guarantee a hard stop even if the active-session effect cleanup
    // pre-empts the in-flight fade interval before it completes. The
    // timeout is tracked so a quick restart can cancel it.
    clearStopTimeout();
    stopTimeoutRef.current = setTimeout(hardStopAudio, FADE_MS + 50);
    setIsPlaying(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setStage("reflect");
  }

  // Final teardown when the screen leaves the stack — covers every code path
  // (back button, navigation away, error boundary).
  useEffect(() => {
    return () => {
      Speech.stop();
      if (tickRef.current) clearInterval(tickRef.current);
      if (fadeRef.current) clearInterval(fadeRef.current);
      clearStopTimeout();
      clearPlayRetry();
      try {
        player?.pause();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drive elapsed counter + scripted narration + finishing.
  useEffect(() => {
    if (stage !== "active" || !active || !isPlaying) {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      return;
    }

    // Start music on play. The fade target is the *current* envelope value,
    // so a session resumed mid-way doesn't snap up to the middle-phase level
    // — it eases back in from where the bed should be at this moment.
    //
    // The first play() can race the player's underlying load step on remote
    // URLs and silently no-op. To guarantee music actually starts (no
    // silent sessions), we re-attempt up to ~10 times every 250 ms until
    // the player reports it's playing, then stop retrying. This is bounded
    // and self-cleaning.
    if (musicSource && player) {
      const env = envelopeFor(elapsed, active.duration, baseVolume);
      const target = env * (voiceActive ? VOICE_DUCK_MULTIPLIER : 1);
      try {
        player.play();
      } catch {
        // ignore — retry loop below will pick it up
      }
      fadeTo(target);

      clearPlayRetry();
      let attempts = 0;
      playRetryRef.current = setInterval(() => {
        attempts += 1;
        let playing = false;
        try {
          playing = Boolean((player as { playing?: boolean }).playing);
        } catch {
          playing = false;
        }
        if (playing || attempts >= 10) {
          clearPlayRetry();
          return;
        }
        try {
          player.play();
        } catch {
          // keep trying
        }
      }, 250);
    }

    // Speak any line at current `elapsed` immediately.
    active.script.forEach((line, idx) => {
      if (line.at <= elapsed && !spokenIdsRef.current.has(idx)) {
        spokenIdsRef.current.add(idx);
        speakLine(line.text);
      }
    });

    tickRef.current = setInterval(() => {
      setElapsed((s) => {
        const next = s + 1;
        if (active) {
          active.script.forEach((line, idx) => {
            if (line.at === next && !spokenIdsRef.current.has(idx)) {
              spokenIdsRef.current.add(idx);
              speakLine(line.text);
            }
          });
          if (next >= active.duration) {
            // Defer to avoid setState-in-setState race.
            setTimeout(() => finishSession(), 0);
          }
        }
        return next;
      });
    }, 1000);

    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, active, isPlaying]);

  // When pausing, pause music + speech.
  useEffect(() => {
    if (stage !== "active") return;
    if (!isPlaying) {
      Speech.stop();
      setVoiceActive(false);
      // Cancel any in-flight play-retry so it doesn't immediately resume
      // playback after the user just hit pause.
      clearPlayRetry();
      try {
        player?.pause();
      } catch {
        // ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, stage]);

  // Toggle voice mid-session: stop any current utterance and clear the
  // ducking flag (otherwise the bed would stay quiet forever).
  useEffect(() => {
    if (!voiceOn) {
      Speech.stop();
      setVoiceActive(false);
    }
  }, [voiceOn]);

  async function handleMoodLogged(mood: Mood) {
    if (!active) return;
    await logSession({
      kind: "meditation",
      sessionId: active.id,
      sessionName: active.title,
      mood,
      durationSec: elapsed,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }

  const orbScale = orbAnim.interpolate({ inputRange: [0, 1], outputRange: [180, 240] });
  const orbOpacity = orbAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.85] });

  // ─────── ACTIVE PLAYBACK ───────
  if (stage === "active" && active) {
    const progress = active.duration > 0 ? elapsed / active.duration : 0;
    return (
      <View style={[styles.sessionContainer, { backgroundColor: active.gradientFrom }]}>
        <View style={[styles.gradientOverlay, { backgroundColor: active.gradientTo, opacity: 0.45 }]} />

        <View style={[styles.sessionTopBar, { paddingTop: topPad + 12 }]}>
          <Pressable onPress={abortSession} hitSlop={12} style={styles.iconBtn}>
            <Feather name="x" size={22} color="rgba(255,255,255,0.85)" />
          </Pressable>
          <View style={styles.audioControls}>
            <Pressable
              onPress={() => setVoiceOn((v) => !v)}
              hitSlop={10}
              style={styles.iconBtn}
              accessibilityLabel={voiceOn ? "Mute voice" : "Unmute voice"}
            >
              <Feather
                name={voiceOn ? "mic" : "mic-off"}
                size={18}
                color="rgba(255,255,255,0.85)"
              />
            </Pressable>
            <Pressable
              onPress={() => setMusicOn((v) => !v)}
              hitSlop={10}
              style={styles.iconBtn}
              accessibilityLabel={musicOn ? "Mute background music" : "Unmute background music"}
            >
              <Feather
                name={musicOn ? "volume-2" : "volume-x"}
                size={18}
                color="rgba(255,255,255,0.85)"
              />
            </Pressable>
            <View style={styles.volumeDots}>
              {[0, 1, 2, 3].map((step) => (
                <Pressable
                  key={step}
                  onPress={() => {
                    setVolumeStep(step);
                    if (!musicOn) setMusicOn(true);
                  }}
                  hitSlop={6}
                  style={[
                    styles.volumeDot,
                    {
                      backgroundColor:
                        musicOn && step <= volumeStep
                          ? "rgba(255,255,255,0.9)"
                          : "rgba(255,255,255,0.25)",
                    },
                  ]}
                />
              ))}
            </View>
          </View>
        </View>

        <View style={styles.sessionContent}>
          <View style={styles.sessionLabels}>
            <Text style={styles.sessionTitle}>{active.title}</Text>
            <Text style={styles.sessionDuration}>{Math.round(active.duration / 60)} min meditation</Text>
          </View>

          <View style={styles.orbWrap}>
            <Animated.View
              style={[
                styles.orb,
                {
                  width: orbScale,
                  height: orbScale,
                  borderRadius: 200,
                  backgroundColor: active.accent + "33",
                  borderColor: active.accent,
                  opacity: orbOpacity,
                },
              ]}
            />
            <View style={styles.orbInner}>
              <Feather name={active.icon} size={32} color={active.accent} />
            </View>
          </View>

          <Text style={styles.tipText}>
            {voiceOn
              ? "Let the voice carry you. Breathe naturally."
              : "Voice off — sit with the music."}
          </Text>
        </View>

        <View style={[styles.controlsBlock, { paddingBottom: bottomPad + 12 }]}>
          <View style={styles.progressRow}>
            <Text style={styles.timeText}>{formatTime(elapsed)}</Text>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${progress * 100}%`, backgroundColor: active.accent },
                ]}
              />
            </View>
            <Text style={styles.timeText}>{formatTime(active.duration)}</Text>
          </View>

          <View style={styles.transportRow}>
            <Pressable onPress={restart} hitSlop={12} style={styles.transportBtn}>
              <Feather name="rotate-ccw" size={20} color="rgba(255,255,255,0.85)" />
            </Pressable>
            <Pressable onPress={() => skip(-10)} hitSlop={12} style={styles.transportBtn}>
              <View style={styles.skipWrap}>
                <Feather name="rewind" size={22} color="rgba(255,255,255,0.85)" />
                <Text style={styles.skipText}>10</Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => (isPlaying ? pause() : play())}
              hitSlop={12}
              style={[styles.playBtn, { backgroundColor: active.accent }]}
            >
              <Feather
                name={isPlaying ? "pause" : "play"}
                size={28}
                color="#0f172a"
                style={isPlaying ? undefined : { marginLeft: 3 }}
              />
            </Pressable>
            <Pressable onPress={() => skip(10)} hitSlop={12} style={styles.transportBtn}>
              <View style={styles.skipWrap}>
                <Feather name="fast-forward" size={22} color="rgba(255,255,255,0.85)" />
                <Text style={styles.skipText}>10</Text>
              </View>
            </Pressable>
            <Pressable onPress={finishSession} hitSlop={12} style={styles.transportBtn}>
              <Feather name="check" size={22} color="rgba(255,255,255,0.85)" />
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // ─────── REFLECTION ───────
  if (stage === "reflect" && active) {
    return (
      <ReflectionScreen
        sessionName={active.title}
        accent={active.accent}
        backgroundFrom={active.gradientFrom}
        backgroundTo={active.gradientTo}
        topPad={topPad}
        bottomPad={bottomPad}
        streak={currentStreak}
        todayCount={todayCount + 1}
        onMoodLogged={handleMoodLogged}
        onClose={() => {
          setActive(null);
          setStage("list");
          setElapsed(0);
        }}
      />
    );
  }

  // ─────── LIST ───────
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Meditation</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 20 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.heroBanner, { backgroundColor: colors.navy }]}>
          <View style={styles.heroTopRow}>
            <View style={[styles.heroIcon, { backgroundColor: "rgba(58,187,212,0.2)" }]}>
              <Feather name="moon" size={26} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>Guided Meditation</Text>
              <Text style={styles.heroSubtitle}>
                Lower stress. Calm the mind. Strengthen the link between body and mood.
              </Text>
            </View>
          </View>

          <View style={styles.heroStatsRow}>
            <View style={styles.heroStat}>
              <Feather name="zap" size={13} color={colors.accent} />
              <Text style={styles.heroStatText}>
                {currentStreak === 0 ? "Start your streak" : `Day ${currentStreak} in a row`}
              </Text>
            </View>
            <View style={styles.heroStat}>
              <Feather name="calendar" size={13} color={colors.primary} />
              <Text style={styles.heroStatText}>{weekCount} this week</Text>
            </View>
          </View>
        </View>

        {hasPremiumOrTrial ? (
          MEDITATIONS.map((med) => (
            <Pressable
              key={med.id}
              style={[styles.sessionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => startSession(med)}
            >
              <View style={[styles.cardOrb, { backgroundColor: med.gradientFrom }]}>
                <View style={[styles.cardOrbInner, { backgroundColor: med.gradientTo }]}>
                  <Feather name={med.icon} size={20} color="#fff" />
                </View>
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={[styles.cardName, { color: colors.foreground }]}>{med.title}</Text>
                <Text style={[styles.cardTagline, { color: colors.mutedForeground }]}>{med.short}</Text>
                <Text style={[styles.cardDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
                  {med.description}
                </Text>
              </View>
              <View style={[styles.playBubble, { backgroundColor: med.gradientTo }]}>
                <Feather name="play" size={14} color="#fff" />
              </View>
            </Pressable>
          ))
        ) : (
          <PremiumGate
            feature="Meditation Library"
            description="Guided meditations with voice narration and soothing music are available on SNAP Premium."
          />
        )}

        <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
          Voice guidance uses your device's built-in speech engine. Background music slots are reserved
          for licensed audio in lib/wellbeingAudio.ts.
        </Text>
      </ScrollView>
    </View>
  );
}

// ───────────── Reflection (shared shape with Breathing Studio) ─────────────

const MOOD_OPTIONS: { mood: Mood; icon: keyof typeof Feather.glyphMap }[] = [
  { mood: "calm", icon: "moon" },
  { mood: "energised", icon: "sun" },
  { mood: "less_stressed", icon: "heart" },
  { mood: "focused", icon: "target" },
  { mood: "still_tense", icon: "alert-circle" },
];

function ReflectionScreen({
  sessionName,
  accent,
  backgroundFrom,
  backgroundTo,
  topPad,
  bottomPad,
  streak,
  todayCount,
  onMoodLogged,
  onClose,
}: {
  sessionName: string;
  accent: string;
  backgroundFrom: string;
  backgroundTo: string;
  topPad: number;
  bottomPad: number;
  streak: number;
  todayCount: number;
  onMoodLogged: (mood: Mood) => Promise<void> | void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Mood | null>(null);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [fade]);

  async function pickMood(mood: Mood) {
    if (selected) return;
    setSelected(mood);
    await onMoodLogged(mood);
  }

  const projectedStreak = todayCount > 0 && streak === 0 ? 1 : Math.max(streak, 1);

  return (
    <View style={[styles.sessionContainer, { backgroundColor: backgroundFrom }]}>
      <View style={[styles.gradientOverlay, { backgroundColor: backgroundTo, opacity: 0.4 }]} />
      <Animated.View
        style={[
          styles.reflectionContent,
          { paddingTop: topPad + 24, paddingBottom: bottomPad + 24, opacity: fade },
        ]}
      >
        <View style={styles.reflectionHeader}>
          <View style={[styles.checkIcon, { backgroundColor: accent + "33", borderColor: accent }]}>
            <Feather name="check" size={28} color={accent} />
          </View>
          <Text style={styles.reflectionTitle}>Well done.</Text>
          <Text style={styles.reflectionSub}>Take a moment to notice how you feel.</Text>
        </View>

        <View style={styles.moodBlock}>
          <Text style={styles.moodPrompt}>How do you feel now?</Text>
          <View style={styles.moodGrid}>
            {MOOD_OPTIONS.map(({ mood, icon }) => {
              const isSelected = selected === mood;
              return (
                <Pressable
                  key={mood}
                  onPress={() => pickMood(mood)}
                  disabled={!!selected && !isSelected}
                  style={[
                    styles.moodChip,
                    {
                      backgroundColor: isSelected ? accent + "33" : "rgba(255,255,255,0.07)",
                      borderColor: isSelected ? accent : "rgba(255,255,255,0.18)",
                      opacity: selected && !isSelected ? 0.4 : 1,
                    },
                  ]}
                >
                  <Feather
                    name={icon}
                    size={16}
                    color={isSelected ? accent : "rgba(255,255,255,0.85)"}
                  />
                  <Text
                    style={[
                      styles.moodChipText,
                      { color: isSelected ? accent : "rgba(255,255,255,0.92)" },
                    ]}
                  >
                    {MOOD_LABELS[mood]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {selected && (
          <View style={styles.habitBlock}>
            <Text style={styles.habitMessage}>
              You're building a daily habit for a stronger body and calmer mind.
            </Text>
            <View
              style={[styles.streakPill, { backgroundColor: accent + "22", borderColor: accent }]}
            >
              <Feather name="zap" size={14} color={accent} />
              <Text style={[styles.streakPillText, { color: accent }]}>
                Day {projectedStreak} in a row
              </Text>
            </View>
          </View>
        )}

        {selected && <PostSessionPromptCard accent={accent} />}

        <View style={styles.reflectionActions}>
          <Pressable
            disabled={!selected}
            style={[
              styles.primaryBtn,
              {
                backgroundColor: selected ? accent : "rgba(255,255,255,0.12)",
                opacity: selected ? 1 : 0.6,
              },
            ]}
            onPress={onClose}
          >
            <Text
              style={[
                styles.primaryBtnText,
                { color: selected ? "#0f172a" : "rgba(255,255,255,0.7)" },
              ]}
            >
              Done
            </Text>
          </Pressable>
          <Text style={styles.reflectionFootnote}>
            {selected
              ? `${sessionName} session logged`
              : "Tap a mood above to log this session"}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  content: { padding: 16, gap: 14 },

  heroBanner: { borderRadius: 18, padding: 18, gap: 14 },
  heroTopRow: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  heroIcon: {
    width: 50,
    height: 50,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: { color: "#fff", fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 4 },
  heroSubtitle: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
  },
  heroStatsRow: { flexDirection: "row", gap: 14 },
  heroStat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  heroStatText: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },

  sessionCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  cardOrb: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  cardOrbInner: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  cardName: { fontSize: 16, fontFamily: "Inter_700Bold" },
  cardTagline: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  cardDesc: { fontSize: 12, lineHeight: 17, marginTop: 6, fontFamily: "Inter_400Regular" },
  playBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  footnote: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    paddingHorizontal: 16,
    marginTop: 6,
    fontFamily: "Inter_400Regular",
  },

  // Active player
  sessionContainer: { flex: 1 },
  gradientOverlay: { ...StyleSheet.absoluteFillObject },
  sessionTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  iconBtn: { padding: 8 },
  audioControls: { flexDirection: "row", alignItems: "center", gap: 8 },
  volumeDots: { flexDirection: "row", gap: 5, marginLeft: 4 },
  volumeDot: { width: 8, height: 8, borderRadius: 4 },

  sessionContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 32,
    paddingHorizontal: 24,
  },
  sessionLabels: { alignItems: "center", gap: 6 },
  sessionTitle: { color: "#fff", fontSize: 24, fontFamily: "Inter_700Bold" },
  sessionDuration: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  orbWrap: { width: 260, height: 260, alignItems: "center", justifyContent: "center" },
  orb: { position: "absolute", borderWidth: 2 },
  orbInner: { alignItems: "center", justifyContent: "center" },
  tipText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    paddingHorizontal: 24,
    fontFamily: "Inter_400Regular",
  },

  controlsBlock: { paddingHorizontal: 24, gap: 18 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  timeText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    minWidth: 36,
    textAlign: "center",
  },
  progressBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.18)",
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 2 },
  transportRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
  },
  transportBtn: { padding: 10 },
  skipWrap: { alignItems: "center" },
  skipText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    marginTop: -2,
  },
  playBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },

  // Reflection
  reflectionContent: { flex: 1, paddingHorizontal: 28, justifyContent: "space-between" },
  reflectionHeader: { alignItems: "center", gap: 12, marginTop: 24 },
  checkIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  reflectionTitle: { color: "#fff", fontSize: 26, fontFamily: "Inter_700Bold" },
  reflectionSub: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 16,
    fontFamily: "Inter_400Regular",
  },
  moodBlock: { gap: 14 },
  moodPrompt: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  moodGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center" },
  moodChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
  },
  moodChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  habitBlock: { alignItems: "center", gap: 12 },
  habitMessage: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    fontFamily: "Inter_500Medium",
    paddingHorizontal: 8,
  },
  streakPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  streakPillText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  reflectionActions: { gap: 10, alignItems: "center" },
  primaryBtn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
    minWidth: 200,
    alignItems: "center",
  },
  primaryBtnText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  reflectionFootnote: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
});
