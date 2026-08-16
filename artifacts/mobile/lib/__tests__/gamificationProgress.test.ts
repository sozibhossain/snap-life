import { describe, expect, it } from "vitest";
import { deriveAchievementProgress, deriveChallengeProgress, longestDateStreak } from "../gamificationProgress";

describe("gamification progress reconciliation", () => {
  it("counts consecutive unique dates without depending on array order", () => {
    expect(longestDateStreak(["2026-08-03", "2026-08-01", "2026-08-02", "2026-08-02", "2026-08-06"])).toBe(3);
  });

  it("derives achievement progress from historical user data", () => {
    const progress = deriveAchievementProgress({
      today: "2026-08-15",
      dexaCount: 2,
      activity: [
        { date: "2026-08-13", steps: 8000, activeMinutes: 30 },
        { date: "2026-08-14", steps: 10000, activeMinutes: 40 },
        { date: "2026-08-15", steps: 12000, activeMinutes: 50 },
      ],
      nutrition: [
        { date: "2026-08-14", calcium: 1250, source: "meal_plan" },
        { date: "2026-08-15", calcium: 1300, source: "manual+plan" },
      ],
      boneBuddyUserMessages: 12,
      supplementsCompleteToday: 1,
      snapShotTipsReadToday: 3,
      wellbeing: [
        { date: "2026-08-14", kind: "breathing", sessionName: "Box breathing" },
        { date: "2026-08-15", kind: "meditation", sessionName: "Calm" },
      ],
    });
    expect(progress).toMatchObject({ a1: 2, a2: 3, a3: 2, a4: 12000, a5: 12, a7: 2, a8: 2, a9: 2, a10: 1, a11: 2 });
  });

  it("updates daily and seven-day challenge values", () => {
    const progress = deriveChallengeProgress({
      today: "2026-08-15",
      dexaCount: 0,
      activity: [{ date: "2026-08-15", steps: 9000, activeMinutes: 35 }],
      nutrition: [{ date: "2026-08-15", calcium: 1250 }],
      boneBuddyUserMessages: 0,
      supplementsCompleteToday: 1,
      snapShotTipsReadToday: 3,
      wellbeing: [{ date: "2026-08-15", kind: "breathing" }],
    });
    expect(progress).toMatchObject({ c1: 35, c2: 1250, c3: 9000, c4: 1, c5: 1, c6: 1, c7: 3 });
  });
});
