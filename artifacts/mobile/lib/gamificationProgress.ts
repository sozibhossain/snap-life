interface ActivityFact {
  date: string;
  steps: number;
  activeMinutes: number;
}

interface NutritionFact {
  date: string;
  calcium: number;
  source?: "manual" | "meal_plan" | "manual+plan";
}

interface WellbeingFact {
  date: string;
  kind: "breathing" | "meditation";
  sessionName?: string;
}

export interface ProgressFacts {
  today: string;
  dexaCount: number;
  activity: ActivityFact[];
  nutrition: NutritionFact[];
  boneBuddyUserMessages: number;
  wellbeing: WellbeingFact[];
  supplementsCompleteToday: number;
  snapShotTipsReadToday: number;
}

function uniqueSortedDates(dates: string[]): string[] {
  return [...new Set(dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
}

export function longestDateStreak(dates: string[]): number {
  const sorted = uniqueSortedDates(dates);
  let longest = 0;
  let current = 0;
  let previousDay: number | null = null;
  for (const date of sorted) {
    const day = Date.parse(`${date}T00:00:00Z`) / 86_400_000;
    current = previousDay != null && day - previousDay === 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previousDay = day;
  }
  return longest;
}

export function deriveAchievementProgress(facts: ProgressFacts): Record<string, number> {
  const calciumDates = facts.nutrition.filter((log) => log.calcium >= 1200).map((log) => log.date);
  const planDates = facts.nutrition
    .filter((log) => log.source === "meal_plan" || log.source === "manual+plan")
    .map((log) => log.date);
  const breathingTechniques = new Set(
    facts.wellbeing
      .filter((entry) => entry.kind === "breathing" && entry.sessionName)
      .map((entry) => entry.sessionName!.trim().toLowerCase()),
  );
  return {
    a1: facts.dexaCount,
    a2: longestDateStreak(facts.activity.map((log) => log.date)),
    a3: new Set(calciumDates).size,
    a4: Math.max(0, ...facts.activity.map((log) => log.steps)),
    a5: facts.boneBuddyUserMessages,
    a7: longestDateStreak(calciumDates),
    a8: facts.wellbeing.length,
    a9: new Set(planDates).size,
    a10: breathingTechniques.size,
    a11: longestDateStreak(facts.wellbeing.map((entry) => entry.date)),
  };
}

export function deriveChallengeProgress(facts: ProgressFacts): Record<string, number> {
  const todayActivity = facts.activity.find((log) => log.date === facts.today);
  const todayNutrition = facts.nutrition.find((log) => log.date === facts.today);
  const cutoff = Date.parse(`${facts.today}T00:00:00Z`) - 6 * 86_400_000;
  const inLastSevenDays = (date: string) => {
    const timestamp = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  };
  return {
    c1: todayActivity?.activeMinutes ?? 0,
    c2: todayNutrition?.calcium ?? 0,
    c3: facts.activity.filter((log) => inLastSevenDays(log.date)).reduce((sum, log) => sum + log.steps, 0),
    c4: facts.supplementsCompleteToday,
    c5: new Set(facts.nutrition.filter((log) => log.calcium >= 1200 && inLastSevenDays(log.date)).map((log) => log.date)).size,
    c6: facts.wellbeing.filter((entry) => entry.date === facts.today).length,
    c7: facts.snapShotTipsReadToday,
  };
}
