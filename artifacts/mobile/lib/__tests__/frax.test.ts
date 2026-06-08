/**
 * Unit tests for calcFrax — verifies that the simplified FRAX estimate
 * stays within ±4 percentage points of published UK FRAX reference values
 * and that edge-case inputs (NaN tScore, age extremes) are handled safely.
 *
 * Reference: WHO FRAX® UK tool outputs for a 65 kg / 165 cm subject.
 */
import { describe, test, expect } from "vitest";
import { calcFrax } from "../frax";

const BASE_FEMALE = {
  sex: "female" as const,
  weight: 65,
  height: 165,
  previousFracture: false,
  parentHipFracture: false,
  smoking: false,
  alcohol: false,
  glucocorticoids: false,
  rheumatoidArthritis: false,
  secondaryOsteoporosis: false,
};
const BASE_MALE = { ...BASE_FEMALE, sex: "male" as const };

// ── Baseline (no risk factors, no BMD) ──────────────────────────────────────

describe("calcFrax — baseline (no RF, no BMD)", () => {
  const FEMALE_REFS: [number, number, number][] = [
    // [age, expectedMajor, expectedHip] — UK FRAX reference outputs
    [50, 4.5, 0.5],
    [60, 8.5, 1.6],
    [65, 10.0, 2.8],
    [70, 13.5, 5.0],
    [75, 18.5, 9.5],
    [80, 25.0, 15.0],
  ];

  test.each(FEMALE_REFS)(
    "female age %d: major ≈%d%%, hip ≈%d%%",
    (age, refMajor, refHip) => {
      const r = calcFrax({ ...BASE_FEMALE, age });
      expect(r.major).toBeGreaterThanOrEqual(refMajor - 4);
      expect(r.major).toBeLessThanOrEqual(refMajor + 4);
      expect(r.hip).toBeGreaterThanOrEqual(refHip - 3);
      expect(r.hip).toBeLessThanOrEqual(refHip + 3);
    },
  );

  test("male 65y: lower than female baseline for both outcomes", () => {
    const f = calcFrax({ ...BASE_FEMALE, age: 65 });
    const m = calcFrax({ ...BASE_MALE, age: 65 });
    expect(m.major).toBeLessThan(f.major);
    expect(m.hip).toBeLessThan(f.hip);
  });

  test("male 65y major in expected range (6–10%)", () => {
    const r = calcFrax({ ...BASE_MALE, age: 65 });
    expect(r.major).toBeGreaterThanOrEqual(6);
    expect(r.major).toBeLessThanOrEqual(10);
  });
});

// ── T-score adjustment ───────────────────────────────────────────────────────

describe("calcFrax — T-score adjustment (65F)", () => {
  const T_REFS: [number | undefined, number, number][] = [
    // [tScore, refMajor, refHip] — UK FRAX at 65F / 65 kg / 165 cm
    [undefined, 10,  2.8],
    [-1.0,      13,  4.5],
    [-2.0,      17,  7.0],
    [-2.5,      20,  9.0],
    [-3.0,      24, 12.0],
  ];

  test.each(T_REFS)(
    "T-score %s: major ≈%d%%, hip ≈%d%%",
    (t, refMajor, refHip) => {
      const r = calcFrax({ ...BASE_FEMALE, age: 65, tScore: t });
      expect(r.major).toBeGreaterThanOrEqual(refMajor - 4);
      expect(r.major).toBeLessThanOrEqual(refMajor + 4);
      expect(r.hip).toBeGreaterThanOrEqual(refHip - 3);
      expect(r.hip).toBeLessThanOrEqual(refHip + 3);
    },
  );

  test("positive T-score has no effect (no adjustment above zero)", () => {
    const noT  = calcFrax({ ...BASE_FEMALE, age: 65 });
    const posT = calcFrax({ ...BASE_FEMALE, age: 65, tScore: 1.5 });
    expect(posT.major).toBe(noT.major);
    expect(posT.hip).toBe(noT.hip);
  });

  test("T-score = 0 has no effect", () => {
    const noT   = calcFrax({ ...BASE_FEMALE, age: 65 });
    const zeroT = calcFrax({ ...BASE_FEMALE, age: 65, tScore: 0 });
    expect(zeroT.major).toBe(noT.major);
    expect(zeroT.hip).toBe(noT.hip);
  });

  test("lower T-score → higher risk (monotone)", () => {
    const r0 = calcFrax({ ...BASE_FEMALE, age: 65, tScore: -1.0 });
    const r1 = calcFrax({ ...BASE_FEMALE, age: 65, tScore: -2.0 });
    const r2 = calcFrax({ ...BASE_FEMALE, age: 65, tScore: -3.0 });
    expect(r1.major).toBeGreaterThan(r0.major);
    expect(r2.major).toBeGreaterThan(r1.major);
    expect(r1.hip).toBeGreaterThan(r0.hip);
    expect(r2.hip).toBeGreaterThan(r1.hip);
  });
});

// ── NaN / edge-case safety ───────────────────────────────────────────────────

describe("calcFrax — NaN / edge-case safety", () => {
  test("tScore=NaN is ignored — result is a finite number (not NaN)", () => {
    const r = calcFrax({ ...BASE_FEMALE, age: 65, tScore: NaN });
    expect(Number.isFinite(r.major)).toBe(true);
    expect(Number.isFinite(r.hip)).toBe(true);
  });

  test("tScore=NaN falls back to BMD-free estimate", () => {
    const noT = calcFrax({ ...BASE_FEMALE, age: 65 });
    const nan = calcFrax({ ...BASE_FEMALE, age: 65, tScore: NaN });
    expect(nan.major).toBe(noT.major);
    expect(nan.hip).toBe(noT.hip);
  });

  test("result never exceeds 99 even in extreme-risk scenarios", () => {
    const r = calcFrax({
      age: 85, sex: "female", weight: 40, height: 155,
      previousFracture: true, parentHipFracture: true,
      smoking: true, alcohol: true, glucocorticoids: true,
      rheumatoidArthritis: true, secondaryOsteoporosis: true,
      tScore: -4.0,
    });
    expect(r.major).toBeLessThanOrEqual(99);
    expect(r.hip).toBeLessThanOrEqual(99);
  });

  test("age 18 returns a small but finite positive number", () => {
    const r = calcFrax({ ...BASE_FEMALE, age: 18 });
    expect(r.major).toBeGreaterThan(0);
    expect(r.major).toBeLessThan(5);
    expect(Number.isFinite(r.major)).toBe(true);
  });

  test("age 90 stays at reference ceiling without overflow", () => {
    const r = calcFrax({ ...BASE_FEMALE, age: 90 });
    expect(r.major).toBeGreaterThan(30);
    expect(r.major).toBeLessThanOrEqual(99);
  });
});

// ── Risk factors ─────────────────────────────────────────────────────────────

describe("calcFrax — risk factors raise risk", () => {
  const base65F = { ...BASE_FEMALE, age: 65 };

  test("previous fracture raises both outcomes", () => {
    const noRF = calcFrax(base65F);
    const rf   = calcFrax({ ...base65F, previousFracture: true });
    expect(rf.major).toBeGreaterThan(noRF.major);
    expect(rf.hip).toBeGreaterThan(noRF.hip);
  });

  test("glucocorticoids raise both outcomes", () => {
    const noRF = calcFrax(base65F);
    const rf   = calcFrax({ ...base65F, glucocorticoids: true });
    expect(rf.major).toBeGreaterThan(noRF.major);
    expect(rf.hip).toBeGreaterThan(noRF.hip);
  });

  test("all risk factors combined > any single factor", () => {
    const single = calcFrax({ ...base65F, previousFracture: true });
    const all    = calcFrax({
      ...base65F,
      previousFracture: true, parentHipFracture: true,
      smoking: true, alcohol: true, glucocorticoids: true,
      rheumatoidArthritis: true, secondaryOsteoporosis: true,
    });
    expect(all.major).toBeGreaterThan(single.major);
    expect(all.hip).toBeGreaterThan(single.hip);
  });
});
