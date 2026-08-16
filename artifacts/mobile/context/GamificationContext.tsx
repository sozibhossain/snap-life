import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useHealth } from "@/context/HealthContext";
import { useWellbeing } from "@/context/WellbeingContext";
import { enqueueSync, SyncPaths } from "@/lib/syncClient";
import { deriveAchievementProgress, deriveChallengeProgress } from "@/lib/gamificationProgress";

/** Per-user, per-week claim key for the Weekly SNAP Shot bonus. */
function weeklyBonusKey(userId: string | null | undefined, isoYearWeek: string): string {
  return `snap_weekly_snap_xp:${userId ?? "anon"}:${isoYearWeek}`;
}

/**
 * Single-flight registry for in-flight weekly-bonus awards. AsyncStorage
 * has no atomic compare-and-set, so two simultaneous taps could both
 * observe an empty key and both award XP. We dedupe by (userId+isoWeek)
 * here so concurrent callers share the same Promise resolution.
 *
 * Module-level (rather than ref-bound) intentionally so the dedupe
 * spans navigations between Provider remounts on hot reload.
 */
const weeklyBonusInflight = new Map<string, Promise<boolean>>();

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: "health" | "activity" | "social" | "streak" | "nutrition" | "calm" | "meal";
  xpReward: number;
  earned: boolean;
  earnedAt?: string;
  progress?: number;
  target?: number;
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  type: "daily" | "weekly";
  xpReward: number;
  progress: number;
  target: number;
  completed: boolean;
  expiresAt: string;
  /** Day/week identity used to prevent XP replay when recurring challenges reset. */
  cycleKey?: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  avatar?: string;
  xp: number;
  level: number;
  isCurrentUser?: boolean;
}

export interface Reward {
  id: string;
  title: string;
  description: string;
  cost: number;
  category: "discount" | "digital" | "physical" | "consultation";
  available: boolean;
  redeemed?: boolean;
}

interface GamificationContextType {
  achievements: Achievement[];
  challenges: Challenge[];
  leaderboard: LeaderboardEntry[];
  rewards: Reward[];
  addXP: (amount: number) => Promise<void>;
  /**
   * Award a one-off bonus that's idempotent within an ISO-week. Returns
   * `true` if XP was granted, `false` if the bonus was already claimed.
   * Used by the Weekly SNAP Shot screen.
   */
  awardWeeklyBonus: (isoYearWeek: string, amount: number) => Promise<boolean>;
  /** True iff this user has already claimed the current week's bonus. */
  isWeeklyBonusClaimed: (isoYearWeek: string) => Promise<boolean>;
  completChallenge: (id: string) => Promise<void>;
  redeemReward: (id: string, cost: number) => Promise<boolean>;
  /** Re-read all historical sources and reconcile visible progress/XP. */
  refreshProgress: () => Promise<void>;
}

const GamificationContext = createContext<GamificationContextType | null>(null);

/**
 * Achievement catalog. Every entry starts as un-earned with progress 0 so a
 * brand-new user sees an honest "0 / target" state — no inherited progress
 * from another account.
 */
const ACHIEVEMENT_CATALOG: Achievement[] = [
  { id: "a1", title: "First Scan", description: "Log your first DEXA scan", icon: "award", category: "health", xpReward: 100, earned: false, progress: 0, target: 1 },
  { id: "a2", title: "7-Day Streak", description: "Log activity 7 days in a row", icon: "zap", category: "streak", xpReward: 200, earned: false, progress: 0, target: 7 },
  { id: "a3", title: "Calcium Champion", description: "Meet your calcium goal for 30 days", icon: "shield", category: "nutrition", xpReward: 350, earned: false, progress: 0, target: 30 },
  { id: "a4", title: "Step Master", description: "Walk 10,000 steps in a day", icon: "trending-up", category: "activity", xpReward: 150, earned: false, progress: 0, target: 10000 },
  { id: "a5", title: "Bone Buddy Pro", description: "Have 50 conversations with Bone Buddy", icon: "message-circle", category: "health", xpReward: 300, earned: false, progress: 0, target: 50 },
  { id: "a6", title: "Community Pillar", description: "Help 10 community members", icon: "users", category: "social", xpReward: 250, earned: false, progress: 0, target: 10 },
  { id: "a7", title: "Calcium Quest", description: "Meet your 1200mg calcium goal for 7 consecutive days", icon: "shield", category: "nutrition", xpReward: 300, earned: false, progress: 0, target: 7 },
  { id: "a8", title: "Mindful Minutes", description: "Complete 10 meditation or breathing sessions", icon: "wind", category: "calm", xpReward: 200, earned: false, progress: 0, target: 10 },
  { id: "a9", title: "Meal Planner", description: "Follow your AI meal plan for 5 days", icon: "book-open", category: "meal", xpReward: 250, earned: false, progress: 0, target: 5 },
  { id: "a10", title: "Breathing Master", description: "Try all 4 breathing techniques in Breathing Studio", icon: "wind", category: "calm", xpReward: 150, earned: false, progress: 0, target: 4 },
  { id: "a11", title: "7-Day Calm Streak", description: "Complete a breathing or meditation session every day for a week", icon: "zap", category: "streak", xpReward: 350, earned: false, progress: 0, target: 7 },
];

/**
 * Challenge catalog. All progress starts at 0; daily challenges expire at
 * end-of-today and weekly ones at end-of-week so the timers are accurate
 * regardless of when the user signs up.
 */
function endOfTodayIso(): string {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}
function endOfWeekIso(): string {
  const date = new Date();
  const day = date.getDay() || 7;
  date.setDate(date.getDate() + (7 - day));
  date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

function localDateISO(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mondayCycle(dateISO: string): string {
  const date = new Date(`${dateISO}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function xpClaimKey(userId: string | null, kind: "achievement" | "challenge", id: string, cycle = "once"): string {
  return `snap_xp_claim:${userId ?? "anon"}:${kind}:${id}:${cycle}`;
}

const CHALLENGE_CATALOG: Challenge[] = [
  { id: "c1", title: "Morning Mover", description: "Log 30 active minutes today", type: "daily", xpReward: 50, progress: 0, target: 30, completed: false, expiresAt: endOfTodayIso() },
  { id: "c2", title: "Calcium Boost", description: "Log 1200mg calcium today", type: "daily", xpReward: 40, progress: 0, target: 1200, completed: false, expiresAt: endOfTodayIso() },
  { id: "c3", title: "Week Warrior", description: "Walk 50,000 steps this week", type: "weekly", xpReward: 200, progress: 0, target: 50000, completed: false, expiresAt: endOfWeekIso() },
  { id: "c4", title: "Supplement Routine", description: "Take all scheduled supplements today", type: "daily", xpReward: 30, progress: 0, target: 1, completed: false, expiresAt: endOfTodayIso() },
  { id: "c5", title: "Calcium Quest", description: "Log 1200mg calcium for 3 days this week", type: "weekly", xpReward: 120, progress: 0, target: 3, completed: false, expiresAt: endOfWeekIso() },
  { id: "c6", title: "Mindful Minutes", description: "Complete a breathing or meditation session today", type: "daily", xpReward: 35, progress: 0, target: 1, completed: false, expiresAt: endOfTodayIso() },
  { id: "c7", title: "SNAP Shot Scholar", description: "Read 3 SNAP Shot tips today", type: "daily", xpReward: 20, progress: 0, target: 3, completed: false, expiresAt: endOfTodayIso() },
];

const MOCK_LEADERBOARD: LeaderboardEntry[] = [];

// Reward catalog — all start un-redeemed.
const REWARD_CATALOG: Reward[] = [
  { id: "r1", title: "10% Off Supplement Bundle", description: "Save on your monthly supplement subscription", cost: 500, category: "discount", available: true, redeemed: false },
  { id: "r2", title: "Virtual Physio Consultation", description: "30-min online session with a physiotherapist", cost: 1500, category: "consultation", available: true, redeemed: false },
  { id: "r3", title: "SNAP Life Premium Badge", description: "Exclusive digital badge for your profile", cost: 200, category: "digital", available: true, redeemed: false },
  { id: "r4", title: "Bone Health Recipe Book", description: "Digital cookbook with 100 bone-healthy recipes", cost: 800, category: "digital", available: true, redeemed: false },
];

export function GamificationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, updateUser } = useAuth();
  const { dexaScans, activityLogs, nutritionLogs, supplements } = useHealth();
  const { entries: wellbeingEntries, isReady: wellbeingReady } = useWellbeing();
  const userId = user?.id ?? null;
  // Storage is scoped per-user so a fresh signup on a shared device cannot
  // inherit the previous user's progress.
  const storageKey = `snap_gamification:${userId ?? "anon"}`;

  const [achievements, setAchievements] =
    useState<Achievement[]>(ACHIEVEMENT_CATALOG);
  const [challenges, setChallenges] = useState<Challenge[]>(CHALLENGE_CATALOG);
  const [rewards, setRewards] = useState<Reward[]>(REWARD_CATALOG);
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  const reconcilingRef = useRef(false);

  // Reload (or reset to catalog defaults) whenever the active account changes.
  useEffect(() => {
    let cancelled = false;
    setHydratedFor(null);
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(storageKey);
        if (cancelled) return;
        if (stored) {
          const data = JSON.parse(stored);
          const storedAchievements = Array.isArray(data.achievements) ? data.achievements as Achievement[] : [];
          setAchievements(ACHIEVEMENT_CATALOG.map((catalogItem) => ({
            ...catalogItem,
            ...storedAchievements.find((item) => item.id === catalogItem.id),
          })));
          const storedChallenges = Array.isArray(data.challenges) ? data.challenges as Challenge[] : [];
          setChallenges(CHALLENGE_CATALOG.map((catalogItem) => ({
            ...catalogItem,
            ...storedChallenges.find((item) => item.id === catalogItem.id),
          })));
          setRewards(data.rewards ?? REWARD_CATALOG);
        } else {
          setAchievements(ACHIEVEMENT_CATALOG);
          setChallenges(CHALLENGE_CATALOG);
          setRewards(REWARD_CATALOG);
        }
        setHydratedFor(userId ?? "anon");
      } catch {
        if (cancelled) return;
        setAchievements(ACHIEVEMENT_CATALOG);
        setChallenges(CHALLENGE_CATALOG);
        setRewards(REWARD_CATALOG);
        setHydratedFor(userId ?? "anon");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  // Build a leaderboard that always slots the live user in by XP rank, rather
  // than relying on a hard-coded "Sarah M. — current user" placeholder.
  const leaderboard: LeaderboardEntry[] = React.useMemo(() => {
    const others = MOCK_LEADERBOARD.filter((e) => !e.isCurrentUser).map((e) => ({
      ...e,
      isCurrentUser: false,
    }));
    const me: LeaderboardEntry = {
      rank: 0,
      userId: user?.id ?? "me",
      name: user?.name ?? "You",
      xp: user?.totalPoints ?? 0,
      level: user?.level ?? 1,
      isCurrentUser: true,
    };
    const combined = [...others, me]
      .sort((a, b) => b.xp - a.xp)
      .map((e, i) => ({ ...e, rank: i + 1 }));
    return combined;
  }, [user?.id, user?.name, user?.totalPoints, user?.level]);

  async function save(a: Achievement[], c: Challenge[], r: Reward[]) {
    const state = { achievements: a, challenges: c, rewards: r };
    await AsyncStorage.setItem(storageKey, JSON.stringify(state));
    // Singleton-per-user state — server overwrites with last-write-wins.
    enqueueSync({
      appUserId: userId,
      domain: "gamification",
      modifier: null,
      method: "PUT",
      path: SyncPaths.gamification(),
      body: { state, updatedAtMs: Date.now() },
    });
  }

  /**
   * Persist XP onto the active user. We delegate to AuthContext.updateUser
   * so the dashboard XP bar, total points and (cascading) level all stay
   * in sync from a single mutation. Levels follow the 500-XP-per-level
   * rule the rest of the app already assumes.
   */
  const addXP = useCallback(
    async (amount: number) => {
      if (!user || amount <= 0) return;
      let xp = (user.xp ?? 0) + amount;
      let level = user.level ?? 1;
      let xpToNext = user.xpToNextLevel ?? 500;
      // Roll over levels if the bonus pushed us past one or more thresholds.
      while (xp >= xpToNext) {
        xp -= xpToNext;
        level += 1;
        xpToNext = 500;
      }
      const totalPoints = (user.totalPoints ?? 0) + amount;
      await updateUser({ xp, level, xpToNextLevel: xpToNext, totalPoints });
    },
    [user, updateUser],
  );

  async function refreshProgress(): Promise<void> {
    if (hydratedFor !== (userId ?? "anon") || !wellbeingReady || reconcilingRef.current) return;
    reconcilingRef.current = true;
    try {
      let boneBuddyUserMessages = 0;
      let snapShotTipsReadToday = 0;
      const today = localDateISO();
      try {
        const raw = await AsyncStorage.getItem(`snap_chat_history:${userId ?? "guest"}`);
        const messages = raw ? JSON.parse(raw) as Array<{ role?: string }> : [];
        boneBuddyUserMessages = Array.isArray(messages)
          ? messages.filter((message) => message?.role === "user").length
          : 0;
      } catch {
        boneBuddyUserMessages = 0;
      }
      try {
        const raw = await AsyncStorage.getItem(`snap_tip_reads:${userId ?? "anon"}:${today}`);
        const tipIds = raw ? JSON.parse(raw) as string[] : [];
        snapShotTipsReadToday = Array.isArray(tipIds) ? new Set(tipIds).size : 0;
      } catch {
        snapShotTipsReadToday = 0;
      }

      const scheduledSupplements = supplements.filter((item) => item.category === "supplement");
      const facts = {
        today,
        dexaCount: dexaScans.length,
        activity: activityLogs,
        nutrition: nutritionLogs,
        boneBuddyUserMessages,
        supplementsCompleteToday: scheduledSupplements.length > 0 && scheduledSupplements.every((item) => item.taken) ? 1 : 0,
        snapShotTipsReadToday,
        wellbeing: wellbeingEntries.map((entry) => ({
          date: localDateISO(entry.completedAt),
          kind: entry.kind,
          sessionName: entry.sessionName,
        })),
      };
      const achievementProgress = deriveAchievementProgress(facts);
      const challengeProgress = deriveChallengeProgress(facts);
      const earnedAt = new Date().toISOString();
      const newlyEarned: Achievement[] = [];
      const nextAchievements = achievements.map((achievement) => {
        const derived = achievementProgress[achievement.id];
        if (derived == null) return achievement;
        const earned = achievement.earned || derived >= (achievement.target ?? Number.POSITIVE_INFINITY);
        const next = {
          ...achievement,
          progress: earned ? Math.max(derived, achievement.target ?? 0) : derived,
          earned,
          earnedAt: achievement.earnedAt ?? (earned ? earnedAt : undefined),
        };
        if (earned && !achievement.earned) newlyEarned.push(next);
        return next;
      });

      const newlyCompleted: Array<{ challenge: Challenge; cycle: string }> = [];
      const nextChallenges = challenges.map((challenge) => {
        const derived = challengeProgress[challenge.id];
        if (derived == null) return challenge;
        const cycle = challenge.type === "daily" ? today : mondayCycle(today);
        const completed = derived >= challenge.target;
        const next = {
          ...challenge,
          progress: derived,
          completed,
          cycleKey: cycle,
          expiresAt: challenge.type === "daily" ? endOfTodayIso() : endOfWeekIso(),
        };
        if (completed && (challenge.cycleKey !== cycle || !challenge.completed)) {
          newlyCompleted.push({ challenge: next, cycle });
        }
        return next;
      });

      setAchievements(nextAchievements);
      setChallenges(nextChallenges);
      await save(nextAchievements, nextChallenges, rewards);

      let xpToAward = 0;
      for (const achievement of newlyEarned) {
        const key = xpClaimKey(userId, "achievement", achievement.id);
        if (!(await AsyncStorage.getItem(key))) {
          await AsyncStorage.setItem(key, earnedAt);
          xpToAward += achievement.xpReward;
        }
      }
      for (const item of newlyCompleted) {
        const key = xpClaimKey(userId, "challenge", item.challenge.id, item.cycle);
        if (!(await AsyncStorage.getItem(key))) {
          await AsyncStorage.setItem(key, earnedAt);
          xpToAward += item.challenge.xpReward;
        }
      }
      if (xpToAward > 0) await addXP(xpToAward);
    } finally {
      reconcilingRef.current = false;
    }
  }

  useEffect(() => {
    void refreshProgress();
    // Reconcile only when a source domain changes; gamification state updates
    // are intentionally not dependencies so the effect cannot self-loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydratedFor, wellbeingReady, dexaScans, activityLogs, nutritionLogs, supplements, wellbeingEntries]);

  const isWeeklyBonusClaimed = useCallback(
    async (isoYearWeek: string) => {
      if (!isoYearWeek) return false;
      try {
        const v = await AsyncStorage.getItem(weeklyBonusKey(userId, isoYearWeek));
        return !!v;
      } catch {
        return false;
      }
    },
    [userId],
  );

  /**
   * Idempotent weekly bonus. Strategy:
   *   1. Coalesce concurrent calls per `userId+isoYearWeek` so a fast
   *      double-tap (or two screens calling at once) shares one promise.
   *   2. Re-check the persisted claim marker BEFORE writing it so even
   *      across a crashed-and-restarted run we don't re-credit.
   *   3. Write the claim marker BEFORE awarding XP so the worst-case
   *      crash leaves the user without a duplicate award (we'd rather
   *      miss one bonus than double it).
   * Returns `true` only when this call actually granted the XP.
   */
  const awardWeeklyBonus = useCallback(
    async (isoYearWeek: string, amount: number): Promise<boolean> => {
      if (!user || !isoYearWeek || amount <= 0) return false;
      const key = weeklyBonusKey(userId, isoYearWeek);

      const existingFlight = weeklyBonusInflight.get(key);
      if (existingFlight) return existingFlight;

      const flight = (async (): Promise<boolean> => {
        try {
          const existing = await AsyncStorage.getItem(key);
          if (existing) return false;
          await AsyncStorage.setItem(key, new Date().toISOString());
        } catch {
          // If we can't write the claim marker we'd risk replay — bail
          // out rather than silently award unbounded times.
          return false;
        }
        await addXP(amount);
        return true;
      })();

      weeklyBonusInflight.set(key, flight);
      try {
        return await flight;
      } finally {
        weeklyBonusInflight.delete(key);
      }
    },
    [user, userId, addXP],
  );

  async function completChallenge(id: string) {
    const updated = challenges.map((c) =>
      c.id === id ? { ...c, completed: true } : c
    );
    setChallenges(updated);
    await save(achievements, updated, rewards);
  }

  async function redeemReward(id: string, cost: number): Promise<boolean> {
    const reward = rewards.find((r) => r.id === id);
    if (!reward || reward.redeemed) return false;
    const updated = rewards.map((r) =>
      r.id === id ? { ...r, redeemed: true } : r
    );
    setRewards(updated);
    await save(achievements, challenges, updated);
    return true;
  }

  return (
    <GamificationContext.Provider
      value={{
        achievements,
        challenges,
        leaderboard,
        rewards,
        addXP,
        awardWeeklyBonus,
        isWeeklyBonusClaimed,
        completChallenge,
        redeemReward,
        refreshProgress,
      }}
    >
      {children}
    </GamificationContext.Provider>
  );
}

export function useGamification() {
  const ctx = useContext(GamificationContext);
  if (!ctx)
    throw new Error("useGamification must be used within GamificationProvider");
  return ctx;
}
