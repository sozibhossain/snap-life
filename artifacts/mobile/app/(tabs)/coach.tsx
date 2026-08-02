import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { fetch } from "expo/fetch";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { markCoachOpenedToday } from "@/lib/coachBadge";
import { logInteractionEvent } from "@/lib/events";
import { useSubscription } from "@/lib/revenuecat";
import { useSpeechVoice } from "@/lib/useSpeechVoice";
import { authHeader } from "@/lib/userToken";
import { getApiBaseUrl } from "@/lib/serverIdentity";
import { summariseWeekSources, todayLocalISO } from "@/lib/weeklySnap";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useHealth } from "@/context/HealthContext";
import { useNutrition } from "@/context/NutritionContext";
import { MOOD_LABELS, useWellbeing } from "@/context/WellbeingContext";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

/**
 * Structured user-context payload sent to the API. Mirrors the
 * `ChatUserFacts` shape on the server (see api-server/src/routes/chat.ts).
 * Anything that's not yet known is omitted rather than sent as null.
 */
interface UserContextPayload {
  name?: string;
  firstName?: string;
  age?: number;
  gender?: string;
  condition?: "osteoporosis" | "osteopenia" | "at_risk" | "healthy";
  fractureRisk?: "low" | "moderate" | "high";
  latestTScore?: number | null;
  nutritionTargets?: {
    calcium?: number;
    vitaminD?: number;
    protein?: number;
    magnesium?: number;
  };
  todayNutrition?: {
    calcium?: number;
    vitaminD?: number;
    protein?: number;
    calories?: number;
    /** Provenance of today's totals — lets the Coach distinguish a user
     *  actively engaging with the meal plan from one entering totals by
     *  hand. Mirrors `NutritionLog.source` from HealthContext. */
    source?: "manual" | "meal_plan" | "manual+plan";
    /** Plan slots the user has ticked off as eaten today. */
    mealsCompleted?: Array<"breakfast" | "lunch" | "dinner" | "snack">;
    /** Sub-total of today's nutrients credited to meal-plan ticks. */
    planContribution?: {
      calcium?: number;
      vitaminD?: number;
      protein?: number;
      magnesium?: number;
      calories?: number;
    };
    /** Sub-total of today's nutrients added by hand on Log Nutrition. */
    manualContribution?: {
      calcium?: number;
      vitaminD?: number;
      protein?: number;
      magnesium?: number;
      calories?: number;
    };
  } | null;
  /** Past-7-day plan-vs-manual breakdown so the Coach can answer
   *  weekly questions with awareness of plan engagement. */
  weekNutritionSources?: {
    planOnlyDays: number;
    manualOnlyDays: number;
    mixedDays: number;
    totalLoggedDays: number;
  };
  supplementsSuggested?: Array<{ name: string; hint?: string }>;
  dietary?: { vegetarian?: boolean; dairyFree?: boolean };
  wellbeing?: {
    currentStreak?: number;
    todayCount?: number;
    weekCount?: number;
    todayScore?: number;
    recentSessions?: Array<{
      kind: "breathing" | "meditation";
      sessionName: string;
      mood: string;
      hour?: string;
      completedAtIso?: string;
    }>;
  };
  appUsageDays?: number;
  todayLocalDate?: string;
  /** Latest FRAX calculator result. */
  frax?: {
    majorFractureRisk: number;
    hipFractureRisk: number;
    date: string;
  } | null;
  /** Activity in the last 7 days — steps + active minutes per day. */
  recentActivity?: Array<{
    date: string;
    steps: number;
    activeMinutes: number;
  }>;
  /** Fracture risk % and BMI from the most recent DEXA report. */
  dexaFractureRisk?: {
    majorFractureRisk?: number;
    hipFractureRisk?: number;
    bmi?: number;
    /** ISO date of the scan — DEXA scans are infrequent (every 1–2 years in many countries). */
    date?: string;
  } | null;
}

export default function CoachScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const {
    getLatestDexaScore,
    getFracturRisk,
    todayNutrition,
    todayPlanTotals,
    todayManualTotals,
    nutritionLogs,
    fraxResults,
    activityLogs,
    dexaScans,
  } = useHealth();
  const { targets, supplements, preferences } = useNutrition();
  const {
    currentStreak,
    todayCount,
    weekCount,
    todayScore,
    entries: wellbeingEntries,
  } = useWellbeing();
  const { hasPremiumOrTrial } = useSubscription();
  const listRef = useRef<FlatList>(null);
  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  const firstName = useMemo(
    () => (user?.name ?? "").trim().split(/\s+/)[0] || "",
    [user?.name],
  );

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  /** True once we've finished trying to load chat history from storage. */
  const [isHydrated, setIsHydrated] = useState(false);
  /** Tracks whether we've already attempted the AI welcome for this session. */
  const [welcomeAttempted, setWelcomeAttempted] = useState(false);

  // ─── Bone Buddy voice — distinct from wellness sessions. ──────────────────
  // "buddy" persona: Karen / Emma / Aria family, slightly faster + warmer
  // pitch than the calm wellness narrator — clearly different character but
  // equally premium. speakingId tracks which message is currently playing so
  // the speaker icon shows the active state on the right bubble.
  const { speak: speakBuddy, stop: stopBuddy } = useSpeechVoice("buddy");
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  function speakMessage(msg: Message) {
    // Stop any currently playing message first.
    stopBuddy();
    if (speakingId === msg.id) {
      // Tapping the active speaker stops it.
      setSpeakingId(null);
      return;
    }
    setSpeakingId(msg.id);
    // Strip markdown-style asterisks/underscores so the TTS doesn't read them.
    const clean = msg.content
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/__/g, "")
      .replace(/_/g, "")
      .trim();
    speakBuddy(clean, {
      onDone: () => setSpeakingId(null),
      onStopped: () => setSpeakingId(null),
      onError: () => setSpeakingId(null),
    });
  }

  // Stop any active playback when navigating away from the tab.
  useEffect(() => {
    return () => {
      stopBuddy();
    };
  }, []);

  const historyKey = `snap_chat_history:${user?.id ?? "guest"}`;
  const prefillKey = (uid: string, iso: string) =>
    `snap_coach_prefill_date:${uid}:${iso}`;
  /** Latest hydrated messages — needed inside the focus effect without
   * adding `messages` to its dep list (which would re-fire on every send). */
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // On focus (re-entry to the Coach tab): clear the badge for today,
  // fire-and-forget the proactive daily nudge, AND — once per (user,
  // local date) — append a fresh in-chat daily check-in if the user
  // already has chat history but hasn't received today's check-in yet.
  // useFocusEffect re-runs on every focus, so this works correctly
  // across day-rollover even if the tab stays mounted. Server-side
  // 24h gate inside sendBoneBuddyPush is the second line of defence.
  const dailyNudgeFiredKeyRef = useRef<string | null>(null);
  const dailyPrefillKeyRef = useRef<string | null>(null);
  const weeklyCheckInFiredKeyRef = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      const uid = user?.id;
      if (!uid) return;
      const today = todayLocalISO();
      void markCoachOpenedToday(uid);
      logInteractionEvent({
        appUserId: uid,
        kind: "bone_buddy_opened",
        payload: { surface: "coach_tab" },
      });

      const dayKey = `${uid}:${today}`;

      // 1) Push nudge — once per (user, day) per app session.
      if (dailyNudgeFiredKeyRef.current !== dayKey) {
        dailyNudgeFiredKeyRef.current = dayKey;
        void (async () => {
          try {
            const base = getApiBase();
            if (!base) return;
            const auth = await authHeader(uid);
            if (!auth.Authorization) return;
            await fetch(`${base}/api/push/daily-nudge`, {
              method: "POST",
              headers: { "Content-Type": "application/json", ...auth },
              body: JSON.stringify({ firstName, todayLocalDate: today }),
            });
          } catch {
            // best-effort
          }
        })();
      }

      // 2) Weekly check-in — once every 7 days when history exists.
      // Fires before the daily prefill check so they don't both run.
      void (async () => {
        try {
          if (!isHydrated) return;
          if (messagesRef.current.length === 0) return;
          const weeklyKey = `snap_weekly_checkin:${uid}`;
          const lastStr = await AsyncStorage.getItem(weeklyKey);
          const daysSinceLast = lastStr
            ? Math.floor((Date.now() - new Date(lastStr).getTime()) / 86_400_000)
            : 999;
          if (daysSinceLast < 7) return;
          // Mark both weekly and daily so only one check-in fires today.
          await AsyncStorage.setItem(weeklyKey, new Date().toISOString());
          await AsyncStorage.setItem(prefillKey(uid, today), "done");
          dailyPrefillKeyRef.current = dayKey;
          weeklyCheckInFiredKeyRef.current = dayKey;
          await generateWeeklyCheckIn();
        } catch {
          // best-effort
        }
      })();

      // 3) In-chat daily check-in pre-fill. The empty-history kickoff
      // is handled by `welcomeAttempted` further down — this branch
      // only matters when the user already has prior messages and we
      // want a fresh, contextual line at the top of today's session.
      //
      // IMPORTANT: do NOT set the in-memory ref upfront. If hydration
      // hasn't completed yet, `messagesRef.current` looks empty and we
      // must early-return WITHOUT marking today as done — otherwise a
      // single race between focus + hydration could skip the prefill
      // for the entire day. The ref is set only AFTER all preconditions
      // pass and the work is kicked off.
      void (async () => {
        try {
          if (dailyPrefillKeyRef.current === dayKey) return;
          // Wait for history hydration so we can correctly detect
          // "user already has prior messages today". On focus before
          // hydration, bail and let a later focus retry.
          if (!isHydrated) return;
          // Idempotency across app re-launches.
          const stored = await AsyncStorage.getItem(prefillKey(uid, today));
          if (stored === "done") {
            dailyPrefillKeyRef.current = dayKey;
            return;
          }
          // Skip if there's nothing to append onto — the empty-chat
          // kickoff effect will own that case.
          if (messagesRef.current.length === 0) return;
          // Skip if the latest assistant message is already from today.
          const todayPrefix = today;
          const lastAssistant = [...messagesRef.current]
            .reverse()
            .find((m) => m.role === "assistant");
          if (
            lastAssistant?.timestamp?.startsWith(todayPrefix) &&
            messagesRef.current.some(
              (m) =>
                m.role === "assistant" && m.timestamp?.startsWith(todayPrefix),
            )
          ) {
            dailyPrefillKeyRef.current = dayKey;
            await AsyncStorage.setItem(prefillKey(uid, today), "done");
            return;
          }
          // All preconditions passed — claim the ref + storage marker
          // before kicking off so concurrent focuses don't double-fire.
          dailyPrefillKeyRef.current = dayKey;
          await AsyncStorage.setItem(prefillKey(uid, today), "done");
          await generateDailyCheckIn();
        } catch {
          // best-effort — UX nicety, not load-bearing
        }
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, firstName, isHydrated]),
  );

  /**
   * Mid-stream safety. The kickoff fetch is async + streamed; if the user
   * signs in/out, navigates away, or hot-reloads while it's in flight, we
   * need to (a) abort the network request and (b) refuse to apply its
   * results to a now-stale chat. The ref captures the historyKey at the
   * moment the request started; on completion we re-check both the abort
   * signal and that the historyKey is still the same before touching state
   * or persisting.
   *
   * Also acts as an at-most-one-in-flight guard so React StrictMode's
   * double-invoked effects can't fire two parallel kickoffs.
   */
  const welcomeAbortRef = useRef<AbortController | null>(null);
  const welcomeForKeyRef = useRef<string | null>(null);

  // Cancel any in-flight kickoff when the user/account (and therefore
  // historyKey) changes, or when the screen unmounts. We also clear the
  // local sending/streaming UI state here — without this, the aborted
  // request's `finally` branch (which is intentionally gated on
  // isStillCurrent()) would leave `isSending=true` for the *new* user and
  // block them from ever kicking off their own welcome.
  useEffect(() => {
    return () => {
      if (welcomeAbortRef.current) {
        welcomeAbortRef.current.abort();
        welcomeAbortRef.current = null;
        welcomeForKeyRef.current = null;
        setIsSending(false);
        setStreamingContent("");
      }
    };
  }, [historyKey]);

  /**
   * Templated fallback greeting used when the AI welcome generation fails
   * (e.g. transient upstream error). Kept short and warm, doesn't pretend
   * to know anything specific about the user.
   */
  const fallbackWelcome: string = firstName
    ? `Hi ${firstName}. I'm Bone Buddy, here whenever you'd like a chat. How have you been feeling lately?`
    : `Hi there. I'm Bone Buddy, here whenever you'd like a chat. How have you been feeling lately?`;

  // Stale-load guard: if the user signs in/out quickly the previous async
  // history read could complete after the new key has rendered and would
  // overwrite the wrong account's chat. We use an `active` flag so only
  // the most recent read can call setMessages.
  useEffect(() => {
    let active = true;
    setIsHydrated(false);
    setWelcomeAttempted(false);
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(historyKey);
        if (!active) return;
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setMessages(parsed);
            setIsHydrated(true);
            return;
          }
        }
        setMessages([]);
        setIsHydrated(true);
      } catch (e) {
        if (active) {
          setMessages([]);
          setIsHydrated(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [historyKey]);

  async function saveHistory(msgs: Message[]) {
    try {
      await AsyncStorage.setItem(historyKey, JSON.stringify(msgs.slice(-50)));
    } catch (e) {}
  }

  function getApiBase() {
    return getApiBaseUrl();
  }

  function getBoneBuddyUrl(): string | null {
    const base = getApiBaseUrl();
    if (!base && Platform.OS !== "web") return null;
    return `${base}/api/chat/bone-buddy`;
  }

  function getBoneBuddyUrlOrThrow(): string {
    const url = getBoneBuddyUrl();
    if (!url) throw new Error("missing api base");
    return url;
  }

  /**
   * Local-time YYYY-MM-DD. Avoids the ISO/UTC trap around midnight where
   * `toISOString().split("T")[0]` reports tomorrow's date for a UK user.
   */
  function localISODate(): string {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  /**
   * Number of whole days between the user's joinedAt date and today.
   * Returns undefined if joinedAt is malformed.
   */
  function daysSince(joinedAt?: string): number | undefined {
    if (!joinedAt) return undefined;
    const t = Date.parse(joinedAt);
    if (Number.isNaN(t)) return undefined;
    return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
  }

  /**
   * Build the structured user-context payload for the API. Everything is
   * optional and we leave fields off when we don't have them — the server
   * only renders facts it actually has, which keeps the prompt tight and
   * stops the model from hallucinating defaults.
   */
  function buildUserContext(): UserContextPayload {
    const tScore = getLatestDexaScore();
    const recentSessions = wellbeingEntries.slice(0, 6).map((e) => {
      const d = new Date(e.completedAt);
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return {
        kind: e.kind,
        sessionName: e.sessionName,
        mood: MOOD_LABELS[e.mood] ?? e.mood,
        hour: `${hh}:${mm}`,
        completedAtIso: new Date(e.completedAt).toISOString(),
      };
    });
    // Plan slots ticked today, ordered breakfast → snack so the prompt
    // reads naturally. Only the truthy entries are sent — an unticked
    // false value isn't useful context.
    const SLOT_ORDER = ["breakfast", "lunch", "dinner", "snack"] as const;
    const ticked = todayNutrition
      ? SLOT_ORDER.filter((k) => !!todayNutrition.mealsCompleted?.[k])
      : [];
    return {
      name: user?.name,
      firstName: firstName || undefined,
      age: user?.age,
      gender: user?.gender,
      condition: user?.condition,
      fractureRisk: tScore != null ? getFracturRisk() : undefined,
      latestTScore: tScore,
      nutritionTargets: targets
        ? {
            calcium: targets.calcium,
            vitaminD: targets.vitaminD,
            protein: targets.protein,
            magnesium: targets.magnesium,
          }
        : undefined,
      todayNutrition: todayNutrition
        ? {
            calcium: todayNutrition.calcium,
            vitaminD: todayNutrition.vitaminD,
            protein: todayNutrition.protein,
            calories: todayNutrition.calories,
            source: todayNutrition.source,
            mealsCompleted: ticked.length > 0 ? [...ticked] : undefined,
            planContribution: {
              calcium: todayPlanTotals.calcium,
              vitaminD: todayPlanTotals.vitaminD,
              protein: todayPlanTotals.protein,
              magnesium: todayPlanTotals.magnesium,
              calories: todayPlanTotals.calories,
            },
            manualContribution: {
              calcium: todayManualTotals.calcium,
              vitaminD: todayManualTotals.vitaminD,
              protein: todayManualTotals.protein,
              magnesium: todayManualTotals.magnesium,
              calories: todayManualTotals.calories,
            },
          }
        : null,
      weekNutritionSources: summariseWeekSources(nutritionLogs),
      supplementsSuggested: supplements?.slice(0, 3).map((s) => ({
        name: s.name,
        hint: s.hint,
      })),
      dietary: preferences
        ? {
            vegetarian: preferences.vegetarian,
            dairyFree: preferences.dairyFree,
          }
        : undefined,
      wellbeing: {
        currentStreak,
        todayCount,
        weekCount,
        todayScore,
        recentSessions,
      },
      appUsageDays: daysSince(user?.joinedAt),
      todayLocalDate: localISODate(),
      // FRAX — most recent calculator result
      frax: fraxResults[0]
        ? {
            majorFractureRisk: fraxResults[0].majorFractureRisk,
            hipFractureRisk: fraxResults[0].hipFractureRisk,
            date: fraxResults[0].date,
          }
        : null,
      // Activity — last 7 days (skip days with no steps)
      recentActivity: (() => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 7);
        return activityLogs
          .filter((a) => new Date(a.date) >= cutoff && (a.steps > 0 || a.activeMinutes > 0))
          .slice(0, 7)
          .map((a) => ({ date: a.date, steps: a.steps, activeMinutes: a.activeMinutes }));
      })(),
      // DEXA fracture risk % and BMI from latest scan (include date —
      // scans are infrequent, every 1–2 years in most countries)
      dexaFractureRisk: dexaScans[0]
        ? {
            majorFractureRisk: dexaScans[0].majorFractureRisk,
            hipFractureRisk: dexaScans[0].hipFractureRisk,
            bmi: dexaScans[0].bmi,
            date: dexaScans[0].date,
          }
        : null,
    };
  }

  /**
   * Short, conversational reply chips. These are user replies / topic picks
   * that pick up Bone Buddy's opening question — they intentionally do NOT
   * echo the user's own facts back at them (that felt off-putting). Most
   * are evergreen; one slot adapts to the user's most relevant topic for
   * today (e.g. nutrition if they're behind on calcium).
   */
  const quickReplies: string[] = useMemo(() => {
    const out: string[] = [];
    out.push("Tell me how I'm doing this week");

    if (
      todayNutrition?.calcium != null &&
      targets?.calcium &&
      todayNutrition.calcium < targets.calcium * 0.7
    ) {
      out.push("Help me with today's nutrition");
    } else if (currentStreak === 0) {
      out.push("Help me start a small daily habit");
    } else {
      out.push("Suggest one small thing for today");
    }

    out.push("Which specialist should I speak to?");
    out.push("Something's been on my mind");
    return out;
  }, [todayNutrition?.calcium, targets?.calcium, currentStreak]);

  /**
   * Ask the model to open the conversation. Streams the greeting into
   * the messages list so it reads like a real, fresh check-in. If the
   * upstream call fails, we drop in a short templated greeting and don't
   * persist it — that way the next visit will try the AI version again.
   *
   * Race-safe:
   *  - At most one in-flight kickoff (welcomeForKeyRef gate).
   *  - Cancellable mid-stream via AbortController.
   *  - Every post-await write is gated on (a) the request not being
   *    aborted and (b) the historyKey still matching the one the request
   *    started for, so an in-flight kickoff for user A can never write
   *    into user B's chat.
   */
  async function generateWelcome() {
    // In-flight guard: refuse to start a second kickoff if one is already
    // running for this same key (StrictMode dev double-invoke protection).
    if (welcomeForKeyRef.current === historyKey) return;

    const startedForKey = historyKey;
    const controller = new AbortController();
    welcomeAbortRef.current = controller;
    welcomeForKeyRef.current = startedForKey;

    const isStillCurrent = () =>
      !controller.signal.aborted && welcomeForKeyRef.current === startedForKey;

    setIsSending(true);
    setStreamingContent("");
    try {
      // Auth header is best-effort — server treats this route as soft
      // auth and only uses the token to look up the user for adaptive
      // tone. Chat itself works without it.
      const auth = user?.id ? await authHeader(user.id) : { Authorization: "" };
      const response = await fetch(getBoneBuddyUrlOrThrow(), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({
          messages: [],
          userContext: buildUserContext(),
          kickoff: true,
          isPremium: hasPremiumOrTrial,
        }),
        signal: controller.signal,
      });

      if (!isStillCurrent()) return;
      if (!response.ok) throw new Error(`welcome ${response.status}`);

      let fullContent = "";
      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          if (!isStillCurrent()) {
            try { await reader.cancel(); } catch (e) {}
            return;
          }
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") break;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta?.content ?? "";
                fullContent += delta;
                if (isStillCurrent()) setStreamingContent(fullContent);
              } catch (e) {}
            }
          }
        }
      }

      if (!isStillCurrent()) return;
      if (!fullContent.trim()) throw new Error("empty welcome");

      const welcome: Message = {
        id: "welcome",
        role: "assistant",
        content: fullContent.trim(),
        timestamp: new Date().toISOString(),
      };
      setMessages([welcome]);
      saveHistory([welcome]);
    } catch (err) {
      // Aborts are expected (user navigated / signed out mid-stream); don't
      // overwrite the now-current chat with a fallback.
      if ((err as { name?: string })?.name === "AbortError") return;
      if (!isStillCurrent()) return;
      const fallback: Message = {
        id: "welcome",
        role: "assistant",
        content: fallbackWelcome,
        timestamp: new Date().toISOString(),
      };
      // Don't persist the fallback — we'd rather retry the real AI welcome
      // next time the user opens the chat.
      setMessages([fallback]);
    } finally {
      // Only release UI state + the in-flight gate if this request is the
      // one currently active for this key. A stale request finishing later
      // must NOT clear isSending for a newer in-flight request.
      if (isStillCurrent()) {
        setIsSending(false);
        setStreamingContent("");
        welcomeAbortRef.current = null;
        welcomeForKeyRef.current = null;
      }
    }
  }

  // After history hydrates, if there's nothing to show, ask Bone Buddy to
  // greet first. Only triggers once per (user, fresh-chat) cycle — guarded
  // by `welcomeAttempted` so it can't loop or re-fire mid-stream.
  useEffect(() => {
    if (!isHydrated) return;
    if (welcomeAttempted) return;
    if (messages.length > 0) return;
    if (isSending) return;
    setWelcomeAttempted(true);
    generateWelcome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated, welcomeAttempted, messages.length, isSending]);

  /**
   * Daily check-in pre-fill — used when the user already has chat
   * history but hasn't yet received today's proactive opener. Streams
   * a single short, contextual line + open question via the same
   * chat-backend kickoff path, then APPENDS it to the persisted history
   * (rather than replacing). Race-safe re-using the same in-flight gate
   * shape as `generateWelcome`.
   */
  async function generateDailyCheckIn() {
    if (welcomeForKeyRef.current === historyKey) return;
    const startedForKey = historyKey;
    const controller = new AbortController();
    welcomeAbortRef.current = controller;
    welcomeForKeyRef.current = startedForKey;
    const isStillCurrent = () =>
      !controller.signal.aborted && welcomeForKeyRef.current === startedForKey;

    setIsSending(true);
    setStreamingContent("");
    try {
      const auth = user?.id ? await authHeader(user.id) : { Authorization: "" };
      const response = await fetch(getBoneBuddyUrlOrThrow(), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({
          messages: [],
          userContext: buildUserContext(),
          kickoff: true,
          isPremium: hasPremiumOrTrial,
        }),
        signal: controller.signal,
      });

      if (!isStillCurrent()) return;
      if (!response.ok) throw new Error(`daily check-in ${response.status}`);

      let fullContent = "";
      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          if (!isStillCurrent()) {
            try { await reader.cancel(); } catch (e) {}
            return;
          }
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") break;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta?.content ?? "";
                fullContent += delta;
                if (isStillCurrent()) setStreamingContent(fullContent);
              } catch (e) {}
            }
          }
        }
      }

      if (!isStillCurrent()) return;
      if (!fullContent.trim()) return;

      const dailyMsg: Message = {
        id: `daily-${Date.now()}`,
        role: "assistant",
        content: fullContent.trim(),
        timestamp: new Date().toISOString(),
      };
      // Append (do not replace) and persist.
      const next = [...messagesRef.current, dailyMsg];
      setMessages(next);
      saveHistory(next);
    } catch (err) {
      // Aborts and errors are silently ignored — the prefill is a
      // nice-to-have, not load-bearing. The push nudge already gave
      // them a touchpoint for today.
      if ((err as { name?: string })?.name === "AbortError") return;
    } finally {
      if (isStillCurrent()) {
        setIsSending(false);
        setStreamingContent("");
        welcomeAbortRef.current = null;
        welcomeForKeyRef.current = null;
      }
    }
  }

  /**
   * Weekly check-in — structured prompt covering feeling, energy, and
   * consistency. Same streaming pattern as generateDailyCheckIn but sends
   * weeklyCheckIn:true so the server uses the dedicated kickoff instruction.
   */
  async function generateWeeklyCheckIn() {
    if (welcomeForKeyRef.current === historyKey) return;
    const startedForKey = historyKey;
    const controller = new AbortController();
    welcomeAbortRef.current = controller;
    welcomeForKeyRef.current = startedForKey;
    const isStillCurrent = () =>
      !controller.signal.aborted && welcomeForKeyRef.current === startedForKey;

    setIsSending(true);
    setStreamingContent("");
    try {
      const auth = user?.id ? await authHeader(user.id) : { Authorization: "" };
      const response = await fetch(getBoneBuddyUrlOrThrow(), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({
          messages: [],
          userContext: buildUserContext(),
          kickoff: true,
          weeklyCheckIn: true,
          isPremium: hasPremiumOrTrial,
        }),
        signal: controller.signal,
      });

      if (!isStillCurrent()) return;
      if (!response.ok) throw new Error(`weekly check-in ${response.status}`);

      let fullContent = "";
      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          if (!isStillCurrent()) {
            try { await reader.cancel(); } catch (e) {}
            return;
          }
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n")) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") break;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta?.content ?? "";
                fullContent += delta;
                if (isStillCurrent()) setStreamingContent(fullContent);
              } catch (e) {}
            }
          }
        }
      }

      if (!isStillCurrent() || !fullContent.trim()) return;

      const weeklyMsg: Message = {
        id: `weekly-${Date.now()}`,
        role: "assistant",
        content: fullContent.trim(),
        timestamp: new Date().toISOString(),
      };
      const next = [...messagesRef.current, weeklyMsg];
      setMessages(next);
      saveHistory(next);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
    } finally {
      if (isStillCurrent()) {
        setIsSending(false);
        setStreamingContent("");
        welcomeAbortRef.current = null;
        welcomeForKeyRef.current = null;
      }
    }
  }

  async function sendMessage(text?: string) {
    const msgText = (text ?? input).trim();
    if (!msgText || isSending) return;
    setInput("");

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: msgText,
      timestamp: new Date().toISOString(),
    };

    // Engaging with the most recent assistant message — by tapping a
    // quick-reply chip or by typing a follow-up — counts as a
    // rec_completed for that suggestion. Debounced via a Set so a back-
    // and-forth on the same assistant turn doesn't double-emit.
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.id !== "streaming");
    if (
      hasPremiumOrTrial &&
      user?.id &&
      lastAssistant &&
      !assistantCompletedRef.current.has(lastAssistant.id)
    ) {
      assistantCompletedRef.current.add(lastAssistant.id);
      logInteractionEvent({
        appUserId: user.id,
        kind: "rec_completed",
        payload: {
          surface: "bone_buddy",
          recId: lastAssistant.id,
          recKind: "bone_buddy_suggestion",
        },
      });
    }

    const currentMessages = [...messages, userMsg];
    setMessages(currentMessages);
    if (user?.id) {
      logInteractionEvent({
        appUserId: user.id,
        kind: "bone_buddy_message_sent",
        payload: {
          surface: "coach_tab",
          source: text ? "quick_reply" : "composer",
          length: msgText.length,
        },
      });
    }
    setIsSending(true);
    setStreamingContent("...");

    try {
      const auth = user?.id ? await authHeader(user.id) : { Authorization: "" };
      const response = await fetch(getBoneBuddyUrlOrThrow(), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({
          messages: currentMessages.slice(-10).map((m) => ({
            role: m.role,
            content: m.content,
          })),
          userContext: buildUserContext(),
          isPremium: hasPremiumOrTrial,
        }),
      });

      // If the server returned a non-2xx (e.g. upstream 5xx), don't try to
      // parse the body as an SSE stream — surface the friendly fallback.
      if (!response.ok) {
        throw new Error(`bone-buddy ${response.status}`);
      }

      let fullContent = "";
      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        setStreamingContent("");
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") break;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta?.content ?? "";
                fullContent += delta;
                setStreamingContent(fullContent);
              } catch (e) {}
            }
          }
        }
      } else {
        const data = (await response.json()) as { message?: string };
        fullContent =
          data.message ?? "I'm unable to respond right now. Please try again.";
      }

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content:
          fullContent || "I'm here whenever you want to chat — how are you feeling today?",
        timestamp: new Date().toISOString(),
      };

      const updated = [...currentMessages, assistantMsg];
      setMessages(updated);
      saveHistory(updated);
    } catch (err) {
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content:
          "I'm having a bit of trouble reaching you right now. Give it another try in a moment, and in the meantime — how have you been feeling today?",
        timestamp: new Date().toISOString(),
      };
      const updated = [...currentMessages, errorMsg];
      setMessages(updated);
      saveHistory(updated);
    } finally {
      setIsSending(false);
      setStreamingContent("");
    }
  }

  function clearHistory() {
    // Stop any active read-aloud so it doesn't continue after the chat wipe.
    stopBuddy();
    setSpeakingId(null);
    // Wipe local + persisted history and let the kickoff effect re-fire so
    // Bone Buddy greets fresh. Any assistant messages the user is walking
    // away from without a reply count as rec_dismissed so the engagement
    // profile sees the explicit rejection signal. Debounced per-id so a
    // double-tap on the refresh button can't double-log.
    if (hasPremiumOrTrial && user?.id) {
      for (const m of messages) {
        if (m.role !== "assistant") continue;
        if (m.id === "streaming") continue;
        if (assistantCompletedRef.current.has(m.id)) continue;
        if (assistantDismissedRef.current.has(m.id)) continue;
        assistantDismissedRef.current.add(m.id);
        logInteractionEvent({
          appUserId: user.id,
          kind: "rec_dismissed",
          payload: {
            surface: "bone_buddy",
            recId: m.id,
            recKind: "bone_buddy_suggestion",
          },
        });
      }
    }
    setMessages([]);
    setWelcomeAttempted(false);
    AsyncStorage.removeItem(historyKey).catch(() => {});
  }

  const displayMessages =
    isSending && streamingContent
      ? [
          ...messages,
          {
            id: "streaming",
            role: "assistant" as const,
            content: streamingContent,
            timestamp: new Date().toISOString(),
          },
        ]
      : messages;

  // rec_shown for each Bone Buddy reply the user actually sees. Debounced
  // by message id so re-renders (typing, scroll) don't re-emit. The
  // mid-stream "streaming" placeholder is excluded — we wait until the
  // assistant message has settled with a stable id. Only fires for
  // Premium / trial users since that's the only audience the adaptive
  // engagement loop benefits.
  const assistantShownRef = useRef<Set<string>>(new Set());
  // Per-message-id debounce sets for the lifecycle events on Bone Buddy
  // suggestions. Both rec_completed (user replied to it) and
  // rec_dismissed (user wiped history without replying) must each fire
  // at most once per message so the engagement profile isn't skewed by
  // re-renders or repeated taps.
  const assistantCompletedRef = useRef<Set<string>>(new Set());
  const assistantDismissedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!hasPremiumOrTrial) return;
    const uid = user?.id;
    if (!uid) return;
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      if (m.id === "streaming") continue;
      if (assistantShownRef.current.has(m.id)) continue;
      assistantShownRef.current.add(m.id);
      logInteractionEvent({
        appUserId: uid,
        kind: "rec_shown",
        payload: {
          surface: "bone_buddy",
          recId: m.id,
          recKind: "bone_buddy_suggestion",
        },
      });
    }
  }, [messages, hasPremiumOrTrial, user?.id]);

  const bottomPad = Platform.OS === "web" ? 34 + 84 : insets.bottom + 84;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={colors.gradients.insight}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.header,
          { paddingTop: topPadding + 10 },
          colors.shadows.sm,
        ]}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarEmoji}>🦴</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.headerTitle}>
            Bone Buddy
          </Text>
          <Text style={styles.headerSubtitle}>
            {firstName ? `Here for you, ${firstName}` : "Your bone-health companion"}
          </Text>
        </View>
        <Pressable onPress={clearHistory} style={styles.clearBtn} hitSlop={8}>
          <Feather name="refresh-cw" size={16} color="rgba(255,255,255,0.85)" />
        </Pressable>
      </LinearGradient>

      <FlatList
        ref={listRef}
        data={displayMessages}
        keyExtractor={(item) => item.id}
        inverted
        style={{ flex: 1 }}
        contentContainerStyle={[styles.listContent, { paddingBottom: 16 }]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          messages.length <= 1 ? (
            <View style={styles.quickQuestions}>
              {quickReplies.map((q) => (
                <Pressable
                  key={q}
                  style={[
                    styles.quickQuestion,
                    {
                      backgroundColor: colors.primary + "14",
                      borderColor: colors.primary + "30",
                    },
                  ]}
                  onPress={() => sendMessage(q)}
                >
                  <Text style={[styles.quickQuestionText, { color: colors.primary }]}>
                    {q}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          if (item.role === "user") {
            return (
              <View
                style={[
                  styles.messageBubble,
                  styles.userBubble,
                  colors.shadows.sm,
                ]}
              >
                <LinearGradient
                  colors={colors.gradients.primary}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.userBubbleInner}
                >
                  <Text style={[styles.messageText, { color: "#fff" }]}>
                    {item.content}
                  </Text>
                  <Text
                    style={[
                      styles.messageTime,
                      { color: "rgba(255,255,255,0.65)" },
                    ]}
                  >
                    {new Date(item.timestamp).toLocaleTimeString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                      ...(user?.timezone ? { timeZone: user.timezone } : {}),
                    })}
                  </Text>
                </LinearGradient>
              </View>
            );
          }
          // Don't show speaker on the live-streaming placeholder ("...").
          const isStreaming = item.id === "streaming";
          const isPlaying = speakingId === item.id;
          return (
            <View
              style={[
                styles.messageBubble,
                styles.assistantBubble,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
                colors.shadows.sm,
              ]}
            >
              <Text style={[styles.messageText, { color: colors.foreground }]}>
                {item.content}
              </Text>
              <View style={styles.assistantMeta}>
                <Text
                  style={[styles.messageTime, { color: colors.mutedForeground }]}
                >
                  {new Date(item.timestamp).toLocaleTimeString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                    ...(user?.timezone ? { timeZone: user.timezone } : {}),
                  })}
                </Text>
                {!isStreaming && (
                  <Pressable
                    onPress={() => speakMessage(item)}
                    hitSlop={8}
                    style={[
                      styles.speakerBtn,
                      isPlaying && {
                        backgroundColor: colors.primary + "18",
                        borderColor: colors.primary + "40",
                      },
                    ]}
                    accessibilityLabel={isPlaying ? "Stop reading" : "Read aloud"}
                  >
                    <Feather
                      name={isPlaying ? "volume-2" : "volume-1"}
                      size={13}
                      color={isPlaying ? colors.primary : colors.mutedForeground}
                    />
                  </Pressable>
                )}
              </View>
            </View>
          );
        }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <View
          style={{
            backgroundColor: colors.background,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            paddingBottom: bottomPad,
          }}
        >
          <View
            style={[
              styles.inputContainer,
              {
                backgroundColor: colors.background,
                borderTopWidth: 0,
              },
            ]}
          >
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.card,
                  color: colors.foreground,
                  borderColor: colors.border,
                },
              ]}
              placeholder={
                firstName
                  ? `Tell Bone Buddy what's on your mind, ${firstName}…`
                  : "Tell Bone Buddy what's on your mind…"
              }
              placeholderTextColor={colors.mutedForeground}
              value={input}
              onChangeText={setInput}
              multiline
              maxLength={500}
              returnKeyType="default"
            />
            <Pressable
              style={[
                styles.sendBtn,
                {
                  backgroundColor: input.trim() ? colors.primary : colors.muted,
                },
              ]}
              onPress={() => sendMessage()}
              disabled={!input.trim() || isSending}
            >
              <Feather
                name="send"
                size={18}
                color={input.trim() ? "#fff" : colors.mutedForeground}
              />
            </Pressable>
          </View>
          <Text
            style={{
              color: colors.mutedForeground,
              fontSize: 11,
              textAlign: "center",
              paddingTop: 2,
              paddingBottom: 6,
              paddingHorizontal: 16,
              fontFamily: "Inter_400Regular",
            }}
          >
            Bone Buddy is a wellness companion, not a medical advisor.{" "}
            <Text
              style={{ color: colors.primary, fontFamily: "Inter_600SemiBold" }}
              onPress={() => router.push("/settings/disclaimer" as never)}
            >
              View disclaimer
            </Text>
          </Text>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  avatarEmoji: { fontSize: 20 },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: -0.2 },
  headerSubtitle: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.78)",
    marginTop: 2,
  },
  clearBtn: { padding: 8 },
  listContent: { paddingHorizontal: 16, paddingTop: 16, flexDirection: "column-reverse" },
  quickQuestions: { gap: 8, marginBottom: 16 },
  quickQuestion: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  quickQuestionText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  messageBubble: {
    maxWidth: "82%",
    borderRadius: 18,
    marginBottom: 10,
  },
  userBubble: {
    alignSelf: "flex-end",
    borderBottomRightRadius: 6,
    overflow: "hidden",
  },
  userBubbleInner: {
    padding: 12,
    borderRadius: 18,
    borderBottomRightRadius: 6,
  },
  assistantBubble: {
    alignSelf: "flex-start",
    borderBottomLeftRadius: 6,
    borderWidth: 1,
    padding: 12,
  },
  messageText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  assistantMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  messageTime: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
  },
  speakerBtn: {
    padding: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
    marginLeft: 8,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    maxHeight: 100,
    minHeight: 44,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
});
