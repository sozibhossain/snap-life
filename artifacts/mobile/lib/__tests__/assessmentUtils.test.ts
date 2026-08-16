import { describe, expect, it } from "vitest";
import {
  calculateBmi,
  cmToFeetInches,
  feetInchesToCm,
  isValidAssessmentDate,
  kgToPounds,
  poundsToKg,
  sortNewestByDate,
} from "../assessmentUtils";

describe("assessment unit helpers", () => {
  it("converts height and weight to canonical metric values", () => {
    expect(feetInchesToCm(5, 6)).toBeCloseTo(167.64, 2);
    expect(poundsToKg(154)).toBeCloseTo(69.85, 2);
    expect(cmToFeetInches(167.64)).toEqual({ feet: 5, inches: 6 });
    expect(kgToPounds(69.853)).toBeCloseTo(154, 1);
  });

  it("calculates and rounds BMI", () => {
    expect(calculateBmi(170, 70)).toBe(24.2);
    expect(calculateBmi(0, 70)).toBeNull();
  });

  it("orders irregular dates newest first and validates calendar dates", () => {
    expect(sortNewestByDate([
      { id: "old", date: "2016-01-04" },
      { id: "new", date: "2026-08-12" },
      { id: "mid", date: "2021-03-19" },
    ]).map((x) => x.id)).toEqual(["new", "mid", "old"]);
    expect(isValidAssessmentDate("2024-02-29")).toBe(true);
    expect(isValidAssessmentDate("2023-02-29")).toBe(false);
  });
});
