import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useAudioPlayer } from "expo-audio";
import * as Speech from "expo-speech";
import { useSpeechVoice } from "@/lib/useSpeechVoice";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
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
import { BREATHING_POOLS } from "@/lib/wellbeingAudio";
import { getTimeOfDay, getTrackHistory, pickTrack, recordTrackPlay } from "@/lib/audioRotation";
import { Mood, useWellbeing } from "@/context/WellbeingContext";
import { PostSessionPromptCard } from "@/components/PostSessionPrompt";
import { useSubscription } from "@/lib/revenuecat";

// ─────────────────────── Types ───────────────────────

type StateId = "calm" | "stress" | "focus" | "energy" | "sleep";
type DurationId = "reset" | "reconnect" | "deep";

interface Phase {
  label: "Inhale" | "Hold" | "Exhale";
  duration: number;
}

interface BreathingState {
  id: StateId;
  name: string;
  goal: string;
  description: string;
  effect: string;
  phases: Phase[];
  /** Key into BREATHING_POOLS for track rotation. */
  musicKey: string;
  gradientFrom: string;
  gradientTo: string;
  accent: string;
  icon: keyof typeof Feather.glyphMap;
}

interface DurationOption {
  id: DurationId;
  name: string;
  tagline: string;
  /** Target session length in seconds. Cycles are derived from this. */
  seconds: number;
}

// ─────────────────────── Spec data ───────────────────────

const STATES: BreathingState[] = [
  {
    id: "calm",
    name: "Calm",
    goal: "Nervous system reset",
    description: "Long, gentle exhale to release tension and lower cortisol.",
    effect: "Letting go, slowing down",
    phases: [
      { label: "Inhale", duration: 4 },
      { label: "Exhale", duration: 7 },
    ],
    musicKey: "calm",
    gradientFrom: "#0e3b4a",
    gradientTo: "#0f766e",
    accent: "#6ee7b7",
    icon: "moon",
  },
  {
    id: "stress",
    name: "Stress Relief",
    goal: "Active stress relief",
    description: "Slightly deeper breath with extended exhale to move you from overwhelmed to in control.",
    effect: "Reassuring, steady",
    phases: [
      { label: "Inhale", duration: 4 },
      { label: "Exhale", duration: 6 },
    ],
    musicKey: "stress",
    gradientFrom: "#3a2820",
    gradientTo: "#a8896f",
    accent: "#fde68a",
    icon: "heart",
  },
  {
    id: "focus",
    name: "Focus",
    goal: "Clarity & balance",
    description: "Box breathing — equal in, hold, out, hold. Used by athletes for sharp clarity.",
    effect: "Clear, sharp, present",
    phases: [
      { label: "Inhale", duration: 4 },
      { label: "Hold", duration: 4 },
      { label: "Exhale", duration: 4 },
      { label: "Hold", duration: 4 },
    ],
    musicKey: "focus",
    gradientFrom: "#1e3a8a",
    gradientTo: "#3b82f6",
    accent: "#bfdbfe",
    icon: "target",
  },
  {
    id: "energy",
    name: "Energy",
    goal: "Uplift & activation",
    description: "Brisk, balanced rhythm to wake the body and brighten the mind.",
    effect: "Awake, motivated, ready",
    phases: [
      { label: "Inhale", duration: 3 },
      { label: "Exhale", duration: 3 },
    ],
    musicKey: "energy",
    gradientFrom: "#7c4a17",
    gradientTo: "#f59e0b",
    accent: "#fde68a",
    icon: "sun",
  },
  {
    id: "sleep",
    name: "Sleep",
    goal: "Deep relaxation",
    description: "Very slow exhale prepares the body to drift into rest.",
    effect: "Heavy, relaxed, drifting",
    phases: [
      { label: "Inhale", duration: 4 },
      { label: "Exhale", duration: 8 },
    ],
    musicKey: "sleep",
    gradientFrom: "#1e1b4b",
    gradientTo: "#4c1d95",
    accent: "#c4b5fd",
    icon: "cloud",
  },
];

// States accessible to SNAP Plus subscribers (Basic breathing).
// Focus, Energy, and Sleep require SNAP Premium (Full Breathing Studio).
const PLUS_ACCESSIBLE_STATES = new Set<StateId>(["calm", "stress"]);

// 3 duration options per state.
//   RESET     — 2.5 min   ("quick emotional shift")
//   RECONNECT — 6   min   ("mindfulness + body awareness")
//   DEEP      — 12  min   ("nervous-system regulation, deeper impact")
const DURATIONS: DurationOption[] = [
  { id: "reset", name: "Reset", tagline: "Quick emotional shift", seconds: 150 },
  { id: "reconnect", name: "Reconnect", tagline: "Mindfulness + body awareness", seconds: 360 },
  { id: "deep", name: "Deep", tagline: "Nervous-system regulation", seconds: 720 },
];

const MAX_VOLUME = 0.55;
const FADE_STEPS = 12;
const FADE_MS = 1500;

type Stage = "list" | "duration" | "active" | "reflect";

// ─────────────────────── Screen ───────────────────────

export default function BreathingStudioScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { logSession, currentStreak, todayCount } = useWellbeing();
  const { hasPremiumOrTrial, hasPlusOrAbove } = useSubscription();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [stage, setStage] = useState<Stage>("list");
  const [pendingState, setPendingState] = useState<BreathingState | null>(null);
  const [activeState, setActiveState] = useState<BreathingState | null>(null);
  const [activeCycles, setActiveCycles] = useState(0);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [cyclesLeft, setCyclesLeft] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);

  // User preferences (persist for the screen lifetime). The interval-driven
  // `tick()` runs inside a stale closure so we mirror voice/haptic into refs
  // that always reflect the latest setting — without that, toggling mid-
  // session would have no effect on the next phase transition.
  const [soundOn, setSoundOn] = useState(true);
  const [volumeStep, setVolumeStep] = useState(2); // 0..3 (low default)
  const [voiceOn, setVoiceOn] = useState(false);
  const [hapticOn, setHapticOn] = useState(true);
  const voiceOnRef = useRef(voiceOn);
  const hapticOnRef = useRef(hapticOn);
  useEffect(() => {
    voiceOnRef.current = voiceOn;
    if (!voiceOn) Speech.stop().catch(() => {});
  }, [voiceOn]);
  useEffect(() => {
    hapticOnRef.current = hapticOn;
  }, [hapticOn]);

  const circleAnim = useRef(new Animated.Value(0)).current;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const triedTrackUrlsRef = useRef<Set<string>>(new Set());
  const stateRef = useRef({ phaseIdx: 0, timeLeft: 0 });
  const orbTargetRef = useRef(0);

  function clearPlayRetry() {
    if (playRetryRef.current) {
      clearInterval(playRetryRef.current);
      playRetryRef.current = null;
    }
  }

  // ─── Voice — wellness persona (female en-GB, calm/measured). ───────────
  // useSpeechVoice handles voice selection, quality prioritisation, and
  // persona-appropriate defaults. We pass a rate override here because
  // single-word cues ("Inhale", "Hold", "Exhale") benefit from a touch more
  // space between words than the default narration rate.
  const { speak: speakWellness } = useSpeechVoice("wellness");

  // Soft spoken equivalents for each phase label.
  // The on-screen text stays "Inhale / Hold / Exhale" for visual clarity;
  // the spoken version uses warmer, more natural phrasing so the voice
  // doesn't sound like a robotic command prompt mid-session.
  const PHASE_SPOKEN: Record<Phase["label"], string> = {
    Inhale: "Breathe in",
    Hold:   "And hold...",
    Exhale: "Breathe out",
  };

  function speakPhase(label: Phase["label"]) {
    // Read from the ref so toggling mid-session takes effect immediately.
    if (!voiceOnRef.current) return;
    // Rate 0.38 iOS / 0.68 Android — deliberately slow so there's genuine
    // space between the cue and the user's breath movement. Slower than
    // narration rate because a single short phrase needs more surrounding
    // silence to feel guided rather than barked.
    speakWellness(PHASE_SPOKEN[label], {
      rate: Platform.OS === "ios" ? 0.38 : 0.68,
    });
  }

  // ─── Audio player wired via rotation engine. ───
  // `activeTrack` is resolved once per session start (async, history-aware)
  // and stays stable for the whole session so the player never reinitialises mid-session.
  // Storing the full AudioTrack (not just URL) so credits display stays accurate.
  const [activeTrack, setActiveTrack] = useState<import("@/lib/wellbeingAudio").AudioTrack | null>(null);
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const audioSource = useMemo(
    () => (activeTrack ? { uri: activeTrack.url } : null),
    [activeTrack],
  );
  const player = useAudioPlayer(audioSource ?? undefined);

  useEffect(() => {
    if (!player || !activeState) return;
    try {
      player.loop = true;
      player.volume = 0;
    } catch {
      // expo-audio may throw before the asset is ready; safe to ignore.
    }
  }, [player, activeState]);

  const targetVolume = useMemo(() => {
    if (!soundOn || !audioSource) return 0;
    return [0.15, 0.3, 0.45, MAX_VOLUME][volumeStep];
  }, [soundOn, audioSource, volumeStep]);

  const fadeTo = (to: number, onDone?: () => void) => {
    if (!player || !audioSource) {
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
        // ignore — player may have been released
      }
      if (step >= FADE_STEPS) {
        if (fadeRef.current) clearInterval(fadeRef.current);
        fadeRef.current = null;
        onDone?.();
      }
    }, stepMs);
  };

  useEffect(() => {
    if (stage !== "active" || !player || !audioSource) return;
    fadeTo(targetVolume);
  }, [targetVolume, stage, audioSource, player]);

  // ─── Session lifecycle ───

  function chooseState(s: BreathingState) {
    setPendingState(s);
    setStage("duration");
  }

  async function startSession(s: BreathingState, duration: DurationOption) {
    const cycleSec = s.phases.reduce((acc, p) => acc + p.duration, 0);
    // Round to the nearest whole cycle so the on-screen progress feels honest.
    const cycles = Math.max(1, Math.round(duration.seconds / cycleSec));

    // Pick a rotated track — avoid recently played, weight by time of day.
    const pool = BREATHING_POOLS[s.musicKey] ?? BREATHING_POOLS.calm;
    const history = await getTrackHistory(s.musicKey);
    const track = pickTrack(pool, history, getTimeOfDay());
    recordTrackPlay(s.musicKey, track.url).catch(() => {});
    triedTrackUrlsRef.current = new Set([track.url]);
    setAudioUnavailable(false);
    setActiveTrack(track);

    setActiveState(s);
    setActiveCycles(cycles);
    setStage("active");
    setElapsedSec(0);
    setPhaseIdx(0);
    setCountdown(s.phases[0].duration);
    setCyclesLeft(cycles);
    stateRef.current = { phaseIdx: 0, timeLeft: s.phases[0].duration };
    animateForPhase(s, 0);
    // Speak / pulse the very first inhale immediately so the user feels the
    // session start (the interval below only fires on subsequent transitions).
    speakPhase(s.phases[0].label);
    if (hapticOnRef.current && s.phases[0].label !== "Hold") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }

  // Audio + interval lifecycle for the active session.
  useEffect(() => {
    if (stage !== "active" || !activeState || !player || !audioSource) return;

    try {
      player.volume = 0;
      player.play();
    } catch (err) {
      console.warn("[Breathing] audio play failed", err);
    }
    fadeTo(targetVolume);

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
      if (playing) {
        clearPlayRetry();
        return;
      }
      if (attempts >= 20) {
        clearPlayRetry();
        const pool = BREATHING_POOLS[activeState.musicKey] ?? BREATHING_POOLS.calm;
        const fallback = pool.find((track) => !triedTrackUrlsRef.current.has(track.url));
        if (fallback) {
          triedTrackUrlsRef.current.add(fallback.url);
          recordTrackPlay(activeState.musicKey, fallback.url).catch(() => {});
          setActiveTrack(fallback);
        } else {
          setAudioUnavailable(true);
        }
        return;
      }
      try {
        player.play();
      } catch {
        // keep trying while the remote source finishes loading
      }
    }, 250);

    intervalRef.current = setInterval(() => tick(activeState), 1000);
    elapsedRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (elapsedRef.current) clearInterval(elapsedRef.current);
      if (fadeRef.current) clearInterval(fadeRef.current);
      clearPlayRetry();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, activeState, player, audioSource]);

  function tick(session: BreathingState) {
    stateRef.current.timeLeft -= 1;
    if (stateRef.current.timeLeft <= 0) {
      const nextIdx = (stateRef.current.phaseIdx + 1) % session.phases.length;
      // Detect end-of-session BEFORE we start a new phase so we don't speak
      // / haptic / animate into the reflection screen.
      const completing =
        nextIdx === 0 && stateRef.current.phaseIdx === session.phases.length - 1
          ? // Read latest cyclesLeft synchronously via the functional setter
            // and short-circuit the rest of tick() if this was the last cycle.
            (() => {
              let isLast = false;
              setCyclesLeft((prev) => {
                if (prev <= 1) {
                  isLast = true;
                  return 0;
                }
                return prev - 1;
              });
              return isLast;
            })()
          : false;
      if (completing) {
        finishSession();
        return;
      }
      stateRef.current.phaseIdx = nextIdx;
      stateRef.current.timeLeft = session.phases[nextIdx].duration;
      setPhaseIdx(nextIdx);
      setCountdown(session.phases[nextIdx].duration);
      animateForPhase(session, nextIdx);
      const nextLabel = session.phases[nextIdx].label;
      // Gentle haptic at inhale / exhale starts (not on holds — they should
      // feel still). Gated by user toggle (read from ref so toggles apply
      // immediately, not just at next render).
      if (hapticOnRef.current && nextLabel !== "Hold") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      speakPhase(nextLabel);
    } else {
      setCountdown(stateRef.current.timeLeft);
    }
  }

  function animateForPhase(session: BreathingState, idx: number) {
    const label = session.phases[idx].label;
    const toValue =
      label === "Inhale" ? 1 : label === "Exhale" ? 0 : orbTargetRef.current;
    orbTargetRef.current = toValue;
    Animated.timing(circleAnim, {
      toValue,
      duration: session.phases[idx].duration * 1000,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    }).start();
  }

  function hardStopAudio() {
    clearPlayRetry();
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

  function finishSession() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    intervalRef.current = null;
    elapsedRef.current = null;
    clearPlayRetry();
    fadeTo(0);
    setTimeout(hardStopAudio, FADE_MS + 50);
    Speech.stop().catch(() => {});
    if (hapticOnRef.current) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    setStage("reflect");
  }

  function abortSession() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    intervalRef.current = null;
    elapsedRef.current = null;
    clearPlayRetry();
    fadeTo(0);
    setTimeout(() => {
      hardStopAudio();
      circleAnim.setValue(0);
    }, FADE_MS + 50);
    Speech.stop().catch(() => {});
    setActiveState(null);
    setStage("list");
  }

  // Final teardown when the screen leaves the navigation stack.
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (elapsedRef.current) clearInterval(elapsedRef.current);
      if (fadeRef.current) clearInterval(fadeRef.current);
      clearPlayRetry();
      try {
        player?.pause();
      } catch {
        // ignore
      }
      Speech.stop().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleMoodLogged(mood: Mood) {
    if (!activeState) return;
    await logSession({
      kind: "breathing",
      sessionId: activeState.id,
      sessionName: activeState.name,
      mood,
      durationSec: elapsedSec,
    });
    if (hapticOnRef.current) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  }

  const circleSize = circleAnim.interpolate({ inputRange: [0, 1], outputRange: [120, 240] });
  const circleOpacity = circleAnim.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] });

  // ─────── ACTIVE SESSION ───────
  if (stage === "active" && activeState) {
    const phase = activeState.phases[phaseIdx];
    const totalCycles = activeCycles;
    const cycleProgress = totalCycles - cyclesLeft + 1;

    return (
      <View style={[styles.sessionContainer, { backgroundColor: activeState.gradientFrom }]}>
        <View
          style={[
            styles.gradientOverlay,
            { backgroundColor: activeState.gradientTo, opacity: 0.55 },
          ]}
        />

        <View style={[styles.sessionTopBar, { paddingTop: topPad + 12 }]}>
          <Pressable onPress={abortSession} hitSlop={12} style={styles.iconBtn}>
            <Feather name="x" size={22} color="rgba(255,255,255,0.85)" />
          </Pressable>

          <View style={styles.audioControls}>
            {/* Voice prompt toggle */}
            <Pressable
              onPress={() => setVoiceOn((v) => !v)}
              hitSlop={10}
              style={styles.iconBtn}
              accessibilityLabel={voiceOn ? "Turn voice prompts off" : "Turn voice prompts on"}
            >
              <Feather
                name={voiceOn ? "mic" : "mic-off"}
                size={18}
                color="rgba(255,255,255,0.85)"
              />
            </Pressable>

            {/* Haptic toggle (mobile only — web has no Haptics support anyway) */}
            {Platform.OS !== "web" && (
              <Pressable
                onPress={() => setHapticOn((v) => !v)}
                hitSlop={10}
                style={styles.iconBtn}
                accessibilityLabel={hapticOn ? "Turn vibration off" : "Turn vibration on"}
              >
                <Feather
                  name={hapticOn ? "smartphone" : "x-circle"}
                  size={18}
                  color="rgba(255,255,255,0.85)"
                />
              </Pressable>
            )}

            {/* Sound toggle + volume dots */}
            <Pressable
              onPress={() => setSoundOn((v) => !v)}
              hitSlop={10}
              style={styles.iconBtn}
              accessibilityLabel={soundOn ? "Mute background sound" : "Unmute background sound"}
            >
              <Feather
                name={soundOn ? "volume-2" : "volume-x"}
                size={20}
                color="rgba(255,255,255,0.85)"
              />
            </Pressable>
            <View style={styles.volumeDots}>
              {[0, 1, 2, 3].map((step) => (
                <Pressable
                  key={step}
                  onPress={() => {
                    setVolumeStep(step);
                    if (!soundOn) setSoundOn(true);
                  }}
                  hitSlop={8}
                  style={[
                    styles.volumeDot,
                    {
                      backgroundColor:
                        soundOn && step <= volumeStep
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
            <Text style={styles.sessionName}>{activeState.name}</Text>
            <Text style={styles.sessionMeta}>
              Cycle {cycleProgress} of {totalCycles}  ·  {formatTime(elapsedSec)}
            </Text>
          </View>

          <View style={styles.circleWrap}>
            <Animated.View
              style={[
                styles.outerOrb,
                {
                  width: circleSize,
                  height: circleSize,
                  borderRadius: 200,
                  backgroundColor: activeState.accent + "33",
                  borderColor: activeState.accent,
                  opacity: circleOpacity,
                },
              ]}
            />
            <View style={styles.orbCenter}>
              <Text style={styles.phaseText}>{phase.label}</Text>
              <Text style={styles.countdownText}>{countdown}</Text>
            </View>
          </View>

          <View style={styles.phaseDots}>
            {activeState.phases.map((p, i) => (
              <View
                key={i}
                style={[
                  styles.phaseDot,
                  {
                    backgroundColor:
                      i === phaseIdx ? activeState.accent : "rgba(255,255,255,0.22)",
                    width: i === phaseIdx ? 22 : 8,
                  },
                ]}
              />
            ))}
          </View>

          <Text style={styles.sessionTip}>{activeState.effect}</Text>

          <View style={styles.nowPlaying}>
            <Feather
              name={soundOn ? "music" : "volume-x"}
              size={11}
              color={
                soundOn ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.35)"
              }
            />
            <Text
              style={[
                styles.nowPlayingText,
                {
                  color: soundOn
                    ? "rgba(255,255,255,0.7)"
                    : "rgba(255,255,255,0.35)",
                },
              ]}
              numberOfLines={1}
            >
              {soundOn ? "Now playing · " : "Muted · "}
              <Text style={styles.nowPlayingTitle}>
                {activeTrack?.title ?? ""}
              </Text>
              {"  by  "}
              {activeTrack?.artist ?? ""}
            </Text>
          </View>
          {audioUnavailable && soundOn && (
            <Text style={styles.sessionTip}>
              Background music could not load. Voice and breathing guidance will continue.
            </Text>
          )}
        </View>

        <Pressable style={styles.endBtn} onPress={abortSession}>
          <Text style={styles.endBtnText}>End early</Text>
        </Pressable>
      </View>
    );
  }

  // ─────── REFLECTION ───────
  if (stage === "reflect" && activeState) {
    return (
      <ReflectionScreen
        sessionName={activeState.name}
        accent={activeState.accent}
        backgroundFrom={activeState.gradientFrom}
        backgroundTo={activeState.gradientTo}
        topPad={topPad}
        bottomPad={bottomPad}
        streak={currentStreak}
        todayCount={todayCount + 1 /* about to be logged */}
        onMoodLogged={handleMoodLogged}
        onClose={() => {
          setActiveState(null);
          setStage("list");
          circleAnim.setValue(0);
        }}
      />
    );
  }

  // ─────── LIST ───────
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 8, borderBottomColor: colors.border },
        ]}
      >
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Breathing Studio
        </Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 20 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.heroBanner, { backgroundColor: colors.navy }]}>
          <View style={styles.heroTopRow}>
            <View
              style={[styles.heroIcon, { backgroundColor: "rgba(58,187,212,0.2)" }]}
            >
              <Feather name="wind" size={26} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>Choose how you want to feel</Text>
              <Text style={styles.heroSubtitle}>
                Each session uses breath, sound and rhythm to actively shift
                your state — calm, focused, energised or ready to sleep.
              </Text>
            </View>
          </View>

          <View style={styles.heroStatsRow}>
            <View style={styles.heroStat}>
              <Feather name="zap" size={13} color={colors.accent} />
              <Text style={styles.heroStatText}>
                {currentStreak === 0
                  ? "Start your streak"
                  : `Day ${currentStreak} in a row`}
              </Text>
            </View>
            <View style={styles.heroStat}>
              <Feather name="check-circle" size={13} color={colors.primary} />
              <Text style={styles.heroStatText}>{todayCount} today</Text>
            </View>
          </View>
        </View>

        {STATES.map((s) => {
          const isPremiumOnly = !PLUS_ACCESSIBLE_STATES.has(s.id);
          const isLocked = isPremiumOnly && hasPlusOrAbove && !hasPremiumOrTrial;
          return (
            <Pressable
              key={s.id}
              style={[
                styles.sessionCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              onPress={() => {
                if (isPremiumOnly && !hasPremiumOrTrial) {
                  Alert.alert(
                    "Premium feature",
                    `${s.name} breathing is available on SNAP Premium. Upgrade to unlock the full Breathing Studio.`,
                    [
                      { text: "See plans", onPress: () => router.push("/subscription" as any) },
                      { text: "Cancel", style: "cancel" },
                    ],
                  );
                  return;
                }
                chooseState(s);
              }}
            >
              <View style={[styles.cardOrb, { backgroundColor: s.gradientFrom }]}>
                <View style={[styles.cardOrbInner, { backgroundColor: s.gradientTo }]}>
                  <Feather name={s.icon} size={20} color="#fff" />
                </View>
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={[styles.cardName, { color: isLocked ? colors.mutedForeground : colors.foreground }]}>
                  {s.name}
                </Text>
                <Text style={[styles.cardTagline, { color: colors.mutedForeground }]}>
                  {s.goal}
                </Text>
                <Text
                  style={[styles.cardDesc, { color: colors.mutedForeground }]}
                  numberOfLines={2}
                >
                  {s.description}
                </Text>
                <View style={styles.cardMeta}>
                  <View style={styles.cardMetaItem}>
                    <Feather name="wind" size={11} color={colors.mutedForeground} />
                    <Text style={[styles.cardMetaText, { color: colors.mutedForeground }]}>
                      {breathLabel(s.phases)}
                    </Text>
                  </View>
                  <View style={styles.cardMetaItem}>
                    <Feather name="clock" size={11} color={colors.mutedForeground} />
                    <Text style={[styles.cardMetaText, { color: colors.mutedForeground }]}>
                      3 lengths
                    </Text>
                  </View>
                  {isLocked && (
                    <View style={[styles.cardMetaItem, { marginLeft: 4 }]}>
                      <Feather name="lock" size={11} color={colors.accent} />
                      <Text style={[styles.cardMetaText, { color: colors.accent }]}>
                        Premium
                      </Text>
                    </View>
                  )}
                </View>
              </View>
              <View style={[styles.playBubble, { backgroundColor: isLocked ? colors.mutedForeground + "44" : s.gradientTo }]}>
                <Feather name={isLocked ? "lock" : "chevron-right"} size={16} color="#fff" />
              </View>
            </Pressable>
          );
        })}

        <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
          Background music streams from a public source. Tap the speaker icon
          during a session to mute or adjust volume.
        </Text>
      </ScrollView>

      {/* Duration picker overlay */}
      {stage === "duration" && pendingState && (
        <DurationSheet
          state={pendingState}
          bottomPad={bottomPad}
          voiceOn={voiceOn}
          hapticOn={hapticOn}
          soundOn={soundOn}
          onToggleVoice={() => setVoiceOn((v) => !v)}
          onToggleHaptic={() => setHapticOn((v) => !v)}
          onToggleSound={() => setSoundOn((v) => !v)}
          onCancel={() => {
            setPendingState(null);
            setStage("list");
          }}
          onPick={(dur) => {
            startSession(pendingState, dur);
            setPendingState(null);
          }}
        />
      )}
    </View>
  );
}

// ───────────────────────── Duration sheet ─────────────────────────

function DurationSheet({
  state,
  bottomPad,
  voiceOn,
  hapticOn,
  soundOn,
  onToggleVoice,
  onToggleHaptic,
  onToggleSound,
  onCancel,
  onPick,
}: {
  state: BreathingState;
  bottomPad: number;
  voiceOn: boolean;
  hapticOn: boolean;
  soundOn: boolean;
  onToggleVoice: () => void;
  onToggleHaptic: () => void;
  onToggleSound: () => void;
  onCancel: () => void;
  onPick: (d: DurationOption) => void;
}) {
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [fade]);

  return (
    <Animated.View
      style={[
        styles.sheetBackdrop,
        { opacity: fade },
      ]}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: state.gradientFrom,
            paddingBottom: bottomPad + 16,
            transform: [
              {
                translateY: fade.interpolate({
                  inputRange: [0, 1],
                  outputRange: [40, 0],
                }),
              },
            ],
          },
        ]}
      >
        <View
          style={[
            styles.sheetGradient,
            { backgroundColor: state.gradientTo, opacity: 0.4 },
          ]}
        />
        <View style={styles.sheetHandle} />

        <View style={styles.sheetHeader}>
          <View style={[styles.sheetIcon, { borderColor: state.accent }]}>
            <Feather name={state.icon} size={20} color={state.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sheetTitle}>{state.name}</Text>
            <Text style={styles.sheetSubtitle}>{state.goal}</Text>
          </View>
          <Pressable hitSlop={12} onPress={onCancel}>
            <Feather name="x" size={20} color="rgba(255,255,255,0.8)" />
          </Pressable>
        </View>

        <Text style={styles.sheetPrompt}>How long do you have?</Text>

        {DURATIONS.map((d) => (
          <Pressable
            key={d.id}
            style={[
              styles.durationRow,
              { borderColor: state.accent + "55" },
            ]}
            onPress={() => onPick(d)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.durationName}>
                {d.name} · {Math.round(d.seconds / 60)} min
              </Text>
              <Text style={styles.durationTag}>{d.tagline}</Text>
            </View>
            <View
              style={[styles.durationGo, { backgroundColor: state.accent }]}
            >
              <Feather name="play" size={14} color="#0f172a" />
            </View>
          </Pressable>
        ))}

        <View style={styles.sheetToggleRow}>
          <SheetToggle
            label="Voice prompts"
            icon={voiceOn ? "mic" : "mic-off"}
            on={voiceOn}
            accent={state.accent}
            onPress={onToggleVoice}
          />
          {Platform.OS !== "web" && (
            <SheetToggle
              label="Vibration"
              icon={hapticOn ? "smartphone" : "x-circle"}
              on={hapticOn}
              accent={state.accent}
              onPress={onToggleHaptic}
            />
          )}
          <SheetToggle
            label="Sound"
            icon={soundOn ? "volume-2" : "volume-x"}
            on={soundOn}
            accent={state.accent}
            onPress={onToggleSound}
          />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

function SheetToggle({
  label,
  icon,
  on,
  accent,
  onPress,
}: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  on: boolean;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.toggleChip,
        {
          backgroundColor: on ? accent + "22" : "rgba(255,255,255,0.06)",
          borderColor: on ? accent : "rgba(255,255,255,0.18)",
        },
      ]}
    >
      <Feather name={icon} size={13} color={on ? accent : "rgba(255,255,255,0.7)"} />
      <Text
        style={[
          styles.toggleChipText,
          { color: on ? accent : "rgba(255,255,255,0.78)" },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ───────────────────────── Reflection screen ─────────────────────────

// Mood options for the SNAP signature. The label shown to the user follows
// the brief (Calm / Clear / Relaxed / Energised / Still tense). The
// underlying value reuses the existing `Mood` enum so logged data stays
// compatible with everything that already consumes `WellbeingEntry.mood`.
const MOOD_OPTIONS: {
  label: string;
  mood: Mood;
  icon: keyof typeof Feather.glyphMap;
}[] = [
  { label: "Calm", mood: "calm", icon: "moon" },
  { label: "Clear", mood: "focused", icon: "target" },
  { label: "Relaxed", mood: "less_stressed", icon: "heart" },
  { label: "Energised", mood: "energised", icon: "sun" },
  { label: "Still tense", mood: "still_tense", icon: "alert-circle" },
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

  // Streak after this session is logged.
  const projectedStreak = todayCount > 0 && streak === 0 ? 1 : Math.max(streak, 1);

  return (
    <View style={[styles.sessionContainer, { backgroundColor: backgroundFrom }]}>
      <View
        style={[styles.gradientOverlay, { backgroundColor: backgroundTo, opacity: 0.4 }]}
      />
      <Animated.View
        style={[
          styles.reflectionContent,
          { paddingTop: topPad + 24, paddingBottom: bottomPad + 24, opacity: fade },
        ]}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, gap: 24 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.reflectionHeader}>
            <View style={[styles.checkIcon, { backgroundColor: accent + "33", borderColor: accent }]}>
              <Feather name="check" size={28} color={accent} />
            </View>
            <Text style={styles.reflectionTitle}>Pause.</Text>
            <Text style={styles.reflectionSub}>Notice how you feel.</Text>
          </View>

          <View style={styles.moodBlock}>
            <Text style={styles.moodPrompt}>How do you feel now?</Text>
            <View style={styles.moodGrid}>
              {MOOD_OPTIONS.map(({ label, mood, icon }) => {
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
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {selected && (
            <View style={styles.habitBlock}>
              <Text style={styles.habitMessage}>
                Small daily moments build a stronger body and calmer mind.
              </Text>
              <View
                style={[
                  styles.streakPill,
                  { backgroundColor: accent + "22", borderColor: accent },
                ]}
              >
                <Feather name="zap" size={14} color={accent} />
                <Text style={[styles.streakPillText, { color: accent }]}>
                  Day {projectedStreak} in a row
                </Text>
              </View>
            </View>
          )}

          {selected && <PostSessionPromptCard accent={accent} />}
        </ScrollView>

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

// ───────────────────────── Helpers ─────────────────────────

function breathLabel(phases: Phase[]): string {
  return phases.map((p) => `${p.duration}s ${p.label.toLowerCase()}`).join(" · ");
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
  cardMeta: { flexDirection: "row", gap: 12, marginTop: 8, flexWrap: "wrap" },
  cardMetaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  cardMetaText: { fontSize: 11, fontFamily: "Inter_500Medium" },
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

  // Active session
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
  audioControls: { flexDirection: "row", alignItems: "center", gap: 6 },
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
  sessionName: { color: "#fff", fontSize: 24, fontFamily: "Inter_700Bold" },
  sessionMeta: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  circleWrap: { width: 260, height: 260, alignItems: "center", justifyContent: "center" },
  outerOrb: { position: "absolute", borderWidth: 2 },
  orbCenter: { alignItems: "center" },
  phaseText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 18,
    fontFamily: "Inter_500Medium",
    marginBottom: 4,
  },
  countdownText: { color: "#fff", fontSize: 64, fontFamily: "Inter_700Bold" },
  phaseDots: { flexDirection: "row", gap: 8 },
  phaseDot: { height: 8, borderRadius: 4 },
  sessionTip: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    paddingHorizontal: 24,
    fontFamily: "Inter_400Regular",
  },
  nowPlaying: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.07)",
    maxWidth: "90%",
  },
  nowPlayingText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    flexShrink: 1,
  },
  nowPlayingTitle: { fontFamily: "Inter_600SemiBold" },
  endBtn: {
    margin: 24,
    padding: 14,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  endBtnText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },

  // Duration sheet
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2,6,23,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    paddingHorizontal: 18,
    paddingTop: 14,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: "hidden",
    gap: 12,
  },
  sheetGradient: { ...StyleSheet.absoluteFillObject },
  sheetHandle: {
    alignSelf: "center",
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.3)",
    marginBottom: 6,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sheetIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
  sheetTitle: { color: "#fff", fontSize: 18, fontFamily: "Inter_700Bold" },
  sheetSubtitle: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
  },
  sheetPrompt: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    marginTop: 6,
    marginBottom: 2,
  },
  durationRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  durationName: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
  durationTag: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  durationGo: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  sheetToggleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 6,
  },
  toggleChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  toggleChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  // Reflection
  reflectionContent: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: "space-between",
  },
  reflectionHeader: { alignItems: "center", gap: 10, marginTop: 8 },
  checkIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  reflectionTitle: { color: "#fff", fontSize: 30, fontFamily: "Inter_700Bold" },
  reflectionSub: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 16,
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
  moodGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "center",
  },
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
    color: "rgba(255,255,255,0.9)",
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
  reflectionActions: { gap: 10, alignItems: "center", marginTop: 12 },
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
