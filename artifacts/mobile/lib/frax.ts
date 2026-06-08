/**
 * Pure FRAX calculation utilities — no React, no side-effects.
 *
 * Simplified FRAX estimate — clinically informed but NOT a validated
 * diagnostic tool. Always displayed with a disclaimer in the UI.
 *
 * Sources:
 *  - Kanis JA et al. (2008) FRAX® and the assessment of fracture probability.
 *  - WHO FRAX® UK reference outputs used to calibrate age-band baselines and
 *    T-score gradient factors.
 */

export interface FraxInputs {
  age: number;
  sex: "female" | "male";
  weight: number;
  height: number;
  previousFracture: boolean;
  parentHipFracture: boolean;
  smoking: boolean;
  alcohol: boolean;
  glucocorticoids: boolean;
  rheumatoidArthritis: boolean;
  secondaryOsteoporosis: boolean;
  /** Femoral-neck T-score (optional). undefined or NaN = not used. */
  tScore?: number;
}

/**
 * UK FRAX reference baselines for females with average BMI and no risk
 * factors, interpolated linearly between published 5-year age bands.
 * [age, 10-year probability %]
 */
const FEMALE_MAJOR_REF: [number, number][] = [
  [40, 2.0], [45, 3.0], [50, 4.5], [55, 6.5], [60, 8.5],
  [65, 10.0], [70, 13.5], [75, 18.5], [80, 25.0], [85, 33.0], [90, 41.0],
];
const FEMALE_HIP_REF: [number, number][] = [
  [40, 0.1], [45, 0.2], [50, 0.5], [55, 0.9], [60, 1.6],
  [65, 2.8], [70, 5.0], [75, 9.5], [80, 15.0], [85, 22.0], [90, 29.0],
];

function lerpRef(table: [number, number][], age: number): number {
  const first = table[0]!;
  const last = table[table.length - 1]!;
  if (age <= first[0]) return first[1];
  if (age >= last[0]) return last[1];
  for (let i = 0; i < table.length - 1; i++) {
    const [a0, v0] = table[i]!;
    const [a1, v1] = table[i + 1]!;
    if (age >= a0 && age <= a1) {
      return v0 + (v1 - v0) * ((age - a0) / (a1 - a0));
    }
  }
  return first[1];
}

/**
 * Returns the worst (lowest) T-score from any site in a set of values.
 * The lowest T-score drives fracture risk per clinical convention.
 */
export function worstTScore(scores: (number | null | undefined)[]): number | null {
  const valid = scores.filter((v): v is number => v != null && !isNaN(v));
  return valid.length > 0 ? Math.min(...valid) : null;
}

/**
 * Compute 10-year fracture probability estimates.
 *
 * Returns `{ major, hip }` — both rounded to 1 decimal and capped at 99%.
 * The result is always valid (never NaN); invalid tScore input is silently
 * ignored and the estimate falls back to the BMD-free model.
 */
export function calcFrax(inputs: FraxInputs): { major: number; hip: number } {
  const {
    age, sex, weight, height,
    previousFracture, parentHipFracture, smoking, alcohol,
    glucocorticoids, rheumatoidArthritis, secondaryOsteoporosis,
    tScore,
  } = inputs;

  const bmi = weight / Math.pow(height / 100, 2);

  // Age-based baseline — linearly interpolated from the UK FRAX female
  // reference table. This gives calibrated absolute probabilities matched
  // to published FRAX UK outputs across the 40-90 year range.
  let major = lerpRef(FEMALE_MAJOR_REF, age);
  let hip   = lerpRef(FEMALE_HIP_REF, age);

  // Sex adjustment: UK males carry ~32% lower major risk and ~50% lower
  // hip risk than females at the same age and BMI.
  if (sex === "male") { major *= 0.68; hip *= 0.50; }

  // T-score adjustment (femoral neck — strongest single predictor).
  // Gradient per SD below zero: 1.27 for major, 1.60 for hip.
  // Guard against NaN that propagates from partial user text input (e.g. "-").
  if (tScore !== undefined && !isNaN(tScore)) {
    const sd = Math.max(0, -tScore);
    if (sd > 0) {
      major *= Math.pow(1.27, sd);
      hip   *= Math.pow(1.60, sd);
    }
  }

  // Low BMI raises risk: each BMI unit below 20 adds ~4% to absolute risk.
  if (bmi < 20) {
    const f = 1 + (20 - bmi) * 0.04;
    major *= f;
    hip   *= f;
  }

  // Clinical risk factor multipliers (relative risks from FRAX meta-analyses)
  if (previousFracture)      { major *= 1.85; hip *= 1.60; }
  if (parentHipFracture)     { major *= 1.30; hip *= 1.50; }
  if (smoking)               { major *= 1.20; hip *= 1.30; }
  if (alcohol)               { major *= 1.15; hip *= 1.10; }
  if (glucocorticoids)       { major *= 1.65; hip *= 1.45; }
  if (rheumatoidArthritis)   { major *= 1.30; hip *= 1.20; }
  if (secondaryOsteoporosis) { major *= 1.20; hip *= 1.20; }

  return {
    major: Math.round(Math.min(99, major) * 10) / 10,
    hip:   Math.round(Math.min(99, hip)   * 10) / 10,
  };
}
