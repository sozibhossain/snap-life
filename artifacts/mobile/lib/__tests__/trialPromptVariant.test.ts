import { describe, expect, it } from "vitest";
import { computeTrialPromptVariant } from "../trialPromptVariant";

describe("computeTrialPromptVariant — 30-day server trial cascade", () => {
  it("returns null when not on a trial", () => {
    expect(computeTrialPromptVariant(false, 14)).toBeNull();
    expect(computeTrialPromptVariant(false, 26)).toBeNull();
  });

  it("returns null when dayOfTrial is unknown", () => {
    expect(computeTrialPromptVariant(true, null)).toBeNull();
  });

  it("renders midTrialEncouragement on Day 14 (mid-trial wins over payment overlap)", () => {
    expect(computeTrialPromptVariant(true, 14)).toBe("midTrialEncouragement");
  });

  it("renders payment for Days 15..21 (post-encouragement, pre-end window)", () => {
    for (let day = 15; day <= 21; day++) {
      expect(computeTrialPromptVariant(true, day)).toBe("payment");
    }
  });

  it("renders endOfTrial for Days 25..28", () => {
    for (let day = 25; day <= 28; day++) {
      expect(computeTrialPromptVariant(true, day)).toBe("endOfTrial");
    }
  });

  it("returns null for days outside any window (e.g., 1..13, 22..24, 29..30)", () => {
    for (const day of [1, 5, 13, 22, 23, 24, 29, 30]) {
      expect(computeTrialPromptVariant(true, day)).toBeNull();
    }
  });
});
