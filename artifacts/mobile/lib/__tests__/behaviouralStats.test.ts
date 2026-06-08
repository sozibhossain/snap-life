import { describe, expect, it } from "vitest";

import { EMPTY_BEHAVIOURAL_STATS } from "../behaviouralStats";

// Lightweight cross-package contract: the exact key set of
// EMPTY_BEHAVIOURAL_STATS must mirror
// artifacts/api-server/src/lib/engagementProfile.ts. If you add or remove
// a field on either side without updating the other, the matching test
// on the opposite side will fail in lockstep, surfacing the drift before
// it reaches a user-facing surface (Bone Buddy prompt, Today's Focus
// bias, Smart Food re-rank, Weekly SNAP overrides).

describe("BehaviouralStats shape contract (mobile ↔ server)", () => {
  it("EMPTY_BEHAVIOURAL_STATS has the canonical four-domain key set", () => {
    expect(Object.keys(EMPTY_BEHAVIOURAL_STATS).sort()).toEqual([
      "activity",
      "gamification",
      "nutrition",
      "wellbeing",
    ]);
  });

  it("nutrition has the canonical fields", () => {
    expect(Object.keys(EMPTY_BEHAVIOURAL_STATS.nutrition).sort()).toEqual([
      "avgCalciumMg7d",
      "avgProteinG7d",
      "avgVitaminDUg7d",
      "calciumDaysOnTarget7d",
      "calciumTargetMg",
      "lastLoggedDay",
      "loggedDays7d",
    ]);
  });

  it("wellbeing has the canonical fields", () => {
    expect(Object.keys(EMPTY_BEHAVIOURAL_STATS.wellbeing).sort()).toEqual([
      "currentStreak",
      "lastSessionAtMs",
      "longestStreak",
      "moodTrend",
      "moodValence7d",
      "moodValencePrev7d",
      "sessions7d",
      "sessionsPrev7d",
    ]);
  });

  it("activity has the canonical fields", () => {
    expect(Object.keys(EMPTY_BEHAVIOURAL_STATS.activity).sort()).toEqual([
      "activeDays7d",
      "activeMinutes7d",
    ]);
  });

  it("gamification has the canonical fields", () => {
    expect(Object.keys(EMPTY_BEHAVIOURAL_STATS.gamification).sort()).toEqual([
      "level",
      "streakDays",
      "totalPoints",
      "xp",
    ]);
  });
});
