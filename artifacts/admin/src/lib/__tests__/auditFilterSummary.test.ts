import { describe, it, expect } from "vitest";
import { buildFilterSummary, ACTION_LABELS } from "../auditFilterSummary";

describe("buildFilterSummary", () => {
  describe("no filters active", () => {
    it("returns null when all filters are undefined", () => {
      expect(buildFilterSummary({})).toBeNull();
    });

    it("returns null when all filters are empty strings (falsy)", () => {
      expect(
        buildFilterSummary({
          actionFilter: "",
          actorFilter: "",
          targetFilter: "",
          fromFilter: "",
          toFilter: "",
        }),
      ).toBeNull();
    });
  });

  describe("single filter", () => {
    it("includes a known action label", () => {
      const result = buildFilterSummary({
        actionFilter: "account_deleted",
      });
      expect(result).toBe("Action: Account deleted");
    });

    it("falls back to the raw value for an unknown action", () => {
      const result = buildFilterSummary({
        actionFilter: "some_future_action",
      });
      expect(result).toBe("Action: some_future_action");
    });

    it("includes actor only", () => {
      const result = buildFilterSummary({ actorFilter: "user_abc123" });
      expect(result).toBe("Actor: user_abc123");
    });

    it("includes target only", () => {
      const result = buildFilterSummary({ targetFilter: "user_xyz789" });
      expect(result).toBe("Target: user_xyz789");
    });
  });

  describe("date range segment", () => {
    it("shows both from and to when both are set", () => {
      const result = buildFilterSummary({
        fromFilter: "2025-01-01",
        toFilter: "2025-01-31",
      });
      expect(result).toBe("Date: 2025-01-01 → 2025-01-31");
    });

    it("uses ellipsis placeholder for missing from date (to-only)", () => {
      const result = buildFilterSummary({ toFilter: "2025-06-30" });
      expect(result).toBe("Date: … → 2025-06-30");
    });

    it("uses ellipsis placeholder for missing to date (from-only)", () => {
      const result = buildFilterSummary({ fromFilter: "2025-03-01" });
      expect(result).toBe("Date: 2025-03-01 → …");
    });
  });

  describe("multiple filters combined", () => {
    it("joins action and actor with · separator", () => {
      const result = buildFilterSummary({
        actionFilter: "test_account_provisioned",
        actorFilter: "admin_007",
      });
      expect(result).toBe(
        "Action: Test account provisioned · Actor: admin_007",
      );
    });

    it("joins actor and date range", () => {
      const result = buildFilterSummary({
        actorFilter: "admin_007",
        fromFilter: "2025-01-01",
        toFilter: "2025-01-31",
      });
      expect(result).toBe(
        "Actor: admin_007 · Date: 2025-01-01 → 2025-01-31",
      );
    });

    it("joins action, actor, and target", () => {
      const result = buildFilterSummary({
        actionFilter: "tester_data_reset",
        actorFilter: "admin_007",
        targetFilter: "user_abc",
      });
      expect(result).toBe(
        "Action: Tester data reset · Actor: admin_007 · Target: user_abc",
      );
    });

    it("joins all five filters", () => {
      const result = buildFilterSummary({
        actionFilter: "account_deleted",
        actorFilter: "admin_007",
        targetFilter: "user_abc",
        fromFilter: "2025-01-01",
        toFilter: "2025-01-31",
      });
      expect(result).toBe(
        "Action: Account deleted · Actor: admin_007 · Target: user_abc · Date: 2025-01-01 → 2025-01-31",
      );
    });

    it("handles action + date range without actor or target", () => {
      const result = buildFilterSummary({
        actionFilter: "sign_in_token_generated",
        fromFilter: "2025-05-01",
        toFilter: "2025-05-14",
      });
      expect(result).toBe(
        "Action: Sign-in token generated · Date: 2025-05-01 → 2025-05-14",
      );
    });
  });

  describe("segment ordering", () => {
    it("always emits action before actor before target before date", () => {
      const result = buildFilterSummary({
        toFilter: "2025-12-31",
        targetFilter: "user_t",
        actorFilter: "user_a",
        actionFilter: "account_deleted",
        fromFilter: "2025-01-01",
      });
      expect(result).toBe(
        "Action: Account deleted · Actor: user_a · Target: user_t · Date: 2025-01-01 → 2025-12-31",
      );
    });
  });

  describe("ACTION_LABELS coverage", () => {
    it("has a label for every known action option", () => {
      const knownActions = [
        "test_account_provisioned",
        "account_deleted",
        "tester_data_reset",
        "sign_in_token_generated",
      ];
      for (const action of knownActions) {
        expect(ACTION_LABELS[action]).toBeDefined();
        expect(typeof ACTION_LABELS[action]).toBe("string");
      }
    });
  });
});
