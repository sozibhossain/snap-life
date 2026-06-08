import { describe, expect, it } from "vitest";

import {
  prioritiseSmartFood,
  shortNutrients,
  type SmartFoodSuggestion,
} from "../smartFood";
import { EMPTY_BEHAVIOURAL_STATS, type BehaviouralStats } from "../behaviouralStats";

function s(
  id: string,
  nutrients: SmartFoodSuggestion["nutrients"],
): SmartFoodSuggestion {
  return {
    id,
    title: id,
    why: "",
    vegetarian: true,
    dairyFree: true,
    glutenFree: true,
    nutrients,
  };
}

function behavioural(
  overrides: Partial<BehaviouralStats["nutrition"]> = {},
): BehaviouralStats {
  return {
    ...EMPTY_BEHAVIOURAL_STATS,
    nutrition: {
      ...EMPTY_BEHAVIOURAL_STATS.nutrition,
      ...overrides,
    },
  };
}

describe("shortNutrients", () => {
  it("returns an empty set when no behavioural stats are passed", () => {
    expect(shortNutrients(null).size).toBe(0);
    expect(shortNutrients(undefined).size).toBe(0);
  });

  it("returns an empty set when nothing has been logged this week", () => {
    // No logged days → we don't know what's short — be conservative.
    const out = shortNutrients(
      behavioural({
        loggedDays7d: 0,
        avgCalciumMg7d: 0,
        avgVitaminDUg7d: 0,
        avgProteinG7d: 0,
      }),
    );
    expect(out.size).toBe(0);
  });

  it("flags calcium when the 7-day mean is under 80% of the target", () => {
    const out = shortNutrients(
      behavioural({
        loggedDays7d: 5,
        avgCalciumMg7d: 800, // 800 / 1200 = 67%
        avgVitaminDUg7d: 12,
        avgProteinG7d: 70,
        calciumTargetMg: 1200,
      }),
    );
    expect(out.has("calcium")).toBe(true);
    expect(out.has("vitaminD")).toBe(false);
    expect(out.has("protein")).toBe(false);
  });

  it("does NOT flag calcium when the user is hitting the 80% threshold", () => {
    const out = shortNutrients(
      behavioural({
        loggedDays7d: 5,
        avgCalciumMg7d: 1000, // 1000 / 1200 = 83%
        avgVitaminDUg7d: 12,
        avgProteinG7d: 70,
      }),
    );
    expect(out.has("calcium")).toBe(false);
  });

  it("uses the user's preferred calcium target when present", () => {
    // 1300 mg / 1500 = 87% → not short with personal target.
    // 1300 mg / 1200 = 108% → not short with default either.
    const out = shortNutrients(
      behavioural({
        loggedDays7d: 5,
        avgCalciumMg7d: 1300,
        calciumTargetMg: 1500,
        avgVitaminDUg7d: 12,
        avgProteinG7d: 70,
      }),
    );
    expect(out.has("calcium")).toBe(false);
  });

  it("flags vitamin D and protein independently", () => {
    const out = shortNutrients(
      behavioural({
        loggedDays7d: 5,
        avgCalciumMg7d: 1500,
        avgVitaminDUg7d: 5, // < 0.8 * 10
        avgProteinG7d: 30, // < 0.8 * 50
      }),
    );
    expect(out.has("vitaminD")).toBe(true);
    expect(out.has("protein")).toBe(true);
    expect(out.has("calcium")).toBe(false);
  });

  it("falls back to the 1200 default when the stored target is non-positive", () => {
    const out = shortNutrients(
      behavioural({
        loggedDays7d: 5,
        avgCalciumMg7d: 800, // 800 / 1200 = 67% with the default
        calciumTargetMg: 0,
        avgVitaminDUg7d: 12,
        avgProteinG7d: 70,
      }),
    );
    expect(out.has("calcium")).toBe(true);
  });
});

describe("prioritiseSmartFood", () => {
  // A small, deterministic list ordered: A is calcium, B is vitD,
  // C covers calcium AND vitD, D is protein only.
  const list: SmartFoodSuggestion[] = [
    s("A_calcium", ["calcium"]),
    s("B_vitD", ["vitaminD"]),
    s("C_calcium_vitD", ["calcium", "vitaminD"]),
    s("D_protein", ["protein"]),
  ];

  it("returns the input unchanged when no behavioural data is provided", () => {
    expect(prioritiseSmartFood(list, null).map((x) => x.id)).toEqual(
      list.map((x) => x.id),
    );
    expect(prioritiseSmartFood(list, undefined).map((x) => x.id)).toEqual(
      list.map((x) => x.id),
    );
  });

  it("returns the input unchanged when nothing is short", () => {
    const out = prioritiseSmartFood(
      list,
      behavioural({
        loggedDays7d: 5,
        avgCalciumMg7d: 1500,
        avgVitaminDUg7d: 12,
        avgProteinG7d: 70,
      }),
    );
    expect(out.map((x) => x.id)).toEqual(list.map((x) => x.id));
  });

  it("surfaces items covering the most short nutrients first", () => {
    // Calcium AND vitamin D are short → C (covers 2) leads, then A & B
    // (cover 1 each) keep their original relative order, then D last.
    const out = prioritiseSmartFood(
      list,
      behavioural({
        loggedDays7d: 5,
        avgCalciumMg7d: 600,
        avgVitaminDUg7d: 5,
        avgProteinG7d: 70,
      }),
    );
    expect(out.map((x) => x.id)).toEqual([
      "C_calcium_vitD",
      "A_calcium",
      "B_vitD",
      "D_protein",
    ]);
  });

  it("preserves curated order within a coverage tier (stable sort)", () => {
    // Only protein is short → only D covers it. A, B, C keep their
    // original order behind D.
    const out = prioritiseSmartFood(
      list,
      behavioural({
        loggedDays7d: 5,
        avgCalciumMg7d: 1500,
        avgVitaminDUg7d: 12,
        avgProteinG7d: 20,
      }),
    );
    expect(out.map((x) => x.id)).toEqual([
      "D_protein",
      "A_calcium",
      "B_vitD",
      "C_calcium_vitD",
    ]);
  });

  it("returns a new array — never mutates the input", () => {
    const before = list.map((x) => x.id);
    const out = prioritiseSmartFood(
      list,
      behavioural({
        loggedDays7d: 5,
        avgCalciumMg7d: 600,
        avgVitaminDUg7d: 5,
        avgProteinG7d: 70,
      }),
    );
    expect(out).not.toBe(list);
    // Input order untouched.
    expect(list.map((x) => x.id)).toEqual(before);
  });
});
