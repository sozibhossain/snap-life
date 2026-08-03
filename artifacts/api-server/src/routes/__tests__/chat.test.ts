import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => Promise.resolve(),
      }),
    }),
  },
  boneBuddyChatMessagesTable: {},
  subscribersTable: {},
  systemPromptsTable: {
    id: {},
    key: {},
    content: {},
    isActive: {},
  },
  userTokensTable: {},
}));

import {
  evaluatePremiumEntitlement,
  PREMIUM_ENTITLEMENT_ID,
  renderUserFacts,
  resolveOpenAiApiKey,
  type ChatUserFacts,
  type PremiumSubscriberRow,
} from "../chat";

const NOW = new Date("2026-04-28T12:00:00.000Z").getTime();

function row(overrides: Partial<PremiumSubscriberRow> = {}): PremiumSubscriberRow {
  return {
    entitlementId: PREMIUM_ENTITLEMENT_ID,
    isActive: true,
    isInTrial: false,
    expiresAt: null,
    ...overrides,
  };
}

describe("evaluatePremiumEntitlement", () => {
  it("returns false when there is no row", () => {
    expect(evaluatePremiumEntitlement(undefined, NOW)).toBe(false);
  });

  it("returns false for an inactive row even if entitlement looks Premium", () => {
    expect(
      evaluatePremiumEntitlement(
        row({ entitlementId: PREMIUM_ENTITLEMENT_ID, isActive: false }),
        NOW,
      ),
    ).toBe(false);
  });

  it("returns false for snap_plus only (Plus is not Premium)", () => {
    expect(
      evaluatePremiumEntitlement(
        row({ entitlementId: "snap_plus", isInTrial: false }),
        NOW,
      ),
    ).toBe(false);
  });

  it("returns true for an active snap_premium entitlement", () => {
    expect(
      evaluatePremiumEntitlement(
        row({ entitlementId: PREMIUM_ENTITLEMENT_ID, isInTrial: false }),
        NOW,
      ),
    ).toBe(true);
  });

  it("returns true for a free trial regardless of which entitlement it is on", () => {
    expect(
      evaluatePremiumEntitlement(
        row({ entitlementId: "snap_plus", isInTrial: true }),
        NOW,
      ),
    ).toBe(true);
    expect(
      evaluatePremiumEntitlement(
        row({ entitlementId: null, isInTrial: true }),
        NOW,
      ),
    ).toBe(true);
  });

  it("returns false for an expired row even when isActive lingers true", () => {
    const oneSecondAgo = new Date(NOW - 1_000);
    expect(
      evaluatePremiumEntitlement(
        row({
          entitlementId: PREMIUM_ENTITLEMENT_ID,
          isActive: true,
          expiresAt: oneSecondAgo,
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it("treats a null expiresAt as lifetime / unknown and accepts on isActive alone", () => {
    expect(
      evaluatePremiumEntitlement(
        row({
          entitlementId: PREMIUM_ENTITLEMENT_ID,
          isActive: true,
          expiresAt: null,
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it("accepts a future expiresAt as still-valid", () => {
    const oneHourFromNow = new Date(NOW + 60 * 60 * 1_000);
    expect(
      evaluatePremiumEntitlement(
        row({
          entitlementId: PREMIUM_ENTITLEMENT_ID,
          isActive: true,
          expiresAt: oneHourFromNow,
        }),
        NOW,
      ),
    ).toBe(true);
  });
});

describe("resolveOpenAiApiKey", () => {
  it("prefers the standard OPENAI_API_KEY name", () => {
    expect(
      resolveOpenAiApiKey({
        OPENAI_API_KEY: "standard-key",
        AI_INTEGRATIONS_OPENAI_API_KEY: "legacy-key",
      }),
    ).toBe("standard-key");
  });

  it("falls back to the legacy integration key name", () => {
    expect(
      resolveOpenAiApiKey({
        AI_INTEGRATIONS_OPENAI_API_KEY: "legacy-key",
      }),
    ).toBe("legacy-key");
  });
});

describe("renderUserFacts — nutrition provenance", () => {
  it("returns an empty string for missing facts", () => {
    expect(renderUserFacts(undefined)).toBe("");
  });

  it("includes a 'meal-plan ticks' source label and the ticked slots", () => {
    const facts: ChatUserFacts = {
      firstName: "Alex",
      todayNutrition: {
        calcium: 350,
        source: "meal_plan",
        mealsCompleted: ["breakfast", "lunch"],
        planContribution: { calcium: 350, vitaminD: 5, protein: 18 },
        manualContribution: { calcium: 0, vitaminD: 0, protein: 0 },
      },
    };
    const out = renderUserFacts(facts);
    expect(out).toContain("Today's nutrition source: from meal-plan ticks");
    expect(out).toContain("Meal-plan slots ticked today: breakfast, lunch");
    expect(out).toContain("From meal plan today:");
    expect(out).toContain("350 mg calcium");
    // No manual contribution line when the manual sub-total is all zeros.
    expect(out).not.toContain("Added manually today:");
  });

  it("renders the 'manually entered' source and skips the plan/ticked lines when no plan engagement", () => {
    const facts: ChatUserFacts = {
      todayNutrition: {
        calcium: 600,
        source: "manual",
        mealsCompleted: [],
        planContribution: { calcium: 0, vitaminD: 0, protein: 0 },
        manualContribution: { calcium: 600, vitaminD: 0, protein: 25 },
      },
    };
    const out = renderUserFacts(facts);
    expect(out).toContain("Today's nutrition source: manually entered");
    expect(out).not.toContain("Meal-plan slots ticked today");
    expect(out).not.toContain("From meal plan today:");
    expect(out).toContain("Added manually today:");
    expect(out).toContain("600 mg calcium");
  });

  it("renders both contribution lines for a 'manual+plan' day", () => {
    const facts: ChatUserFacts = {
      todayNutrition: {
        source: "manual+plan",
        mealsCompleted: ["dinner"],
        planContribution: { calcium: 200 },
        manualContribution: { calcium: 150 },
      },
    };
    const out = renderUserFacts(facts);
    expect(out).toContain(
      "Today's nutrition source: mix of meal-plan ticks and manual entries",
    );
    expect(out).toContain("Meal-plan slots ticked today: dinner");
    expect(out).toContain("From meal plan today: 200 mg calcium");
    expect(out).toContain("Added manually today: 150 mg calcium");
  });

  it("includes the past-7-day source split when at least one day was logged", () => {
    const facts: ChatUserFacts = {
      weekNutritionSources: {
        planOnlyDays: 3,
        manualOnlyDays: 1,
        mixedDays: 2,
        totalLoggedDays: 6,
      },
    };
    const out = renderUserFacts(facts);
    expect(out).toContain("Past 7 days nutrition source split:");
    expect(out).toContain("3 plan-only");
    expect(out).toContain("2 mixed");
    expect(out).toContain("1 manual-only");
    expect(out).toContain("of 6 logged days");
  });

  it("omits the weekly split entirely when nothing has been logged", () => {
    const facts: ChatUserFacts = {
      weekNutritionSources: {
        planOnlyDays: 0,
        manualOnlyDays: 0,
        mixedDays: 0,
        totalLoggedDays: 0,
      },
    };
    expect(renderUserFacts(facts)).not.toContain(
      "Past 7 days nutrition source split:",
    );
  });
});
