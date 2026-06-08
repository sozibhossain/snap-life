import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ─── Mock heavy dependencies before importing the component ──────────────────

let mockSearchStr = "";
const mockNavigate = vi.fn();

vi.mock("wouter", () => ({
  useSearch: () => mockSearchStr,
  useLocation: () => ["/audit", mockNavigate],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: false, error: null }),
  useIsFetching: () => 0,
  QueryClient: class {
    getDefaultOptions() { return {}; }
    setDefaultOptions() {}
  },
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@clerk/react", () => ({
  useClerk: () => ({ signOut: vi.fn() }),
  useUser: () => ({ user: null }),
  useAuth: () => ({ getToken: async () => "test-token" }),
}));

// ─── Import component after mocks are in place ────────────────────────────────

import AuditLog from "../audit";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderAudit(searchStr = "") {
  mockSearchStr = searchStr;
  mockNavigate.mockClear();
  return render(<AuditLog />);
}

/**
 * Parse the first argument passed to mockNavigate and return the URLSearchParams
 * from whatever navigate was called with. The component calls:
 *   navigate(qs ? `${pathname}?${qs}` : pathname, { replace: true })
 * so arg may be "/audit?params" or just "/audit".
 */
function lastNavigatedParams(): URLSearchParams {
  expect(mockNavigate).toHaveBeenCalled();
  const arg: string = mockNavigate.mock.calls[mockNavigate.mock.calls.length - 1][0];
  const qmark = arg.indexOf("?");
  return new URLSearchParams(qmark === -1 ? "" : arg.slice(qmark + 1));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Events-card filter summary chips", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Visibility ──────────────────────────────────────────────────────────────

  describe("chip visibility", () => {
    it("renders no chips when no filters are active", () => {
      renderAudit("");
      expect(screen.queryByRole("button", { name: /^clear action filter:/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /^clear actor filter:/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /^clear target filter:/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /^clear date filter:/i })).toBeNull();
    });

    it("renders the Action chip when an action filter is active", () => {
      renderAudit("action=account_deleted");
      expect(
        screen.getByRole("button", { name: /clear action filter: account deleted/i }),
      ).toBeInTheDocument();
    });

    it("renders the Actor chip when an actorAppUserId filter is active", () => {
      renderAudit("actorAppUserId=user_abc123");
      expect(
        screen.getByRole("button", { name: /clear actor filter: user_abc123/i }),
      ).toBeInTheDocument();
    });

    it("renders the Target chip when a targetAppUserId filter is active", () => {
      renderAudit("targetAppUserId=user_xyz789");
      expect(
        screen.getByRole("button", { name: /clear target filter: user_xyz789/i }),
      ).toBeInTheDocument();
    });

    it("renders the Date chip when a from date is active", () => {
      renderAudit("from=2025-01-01");
      expect(
        screen.getByRole("button", { name: /clear date filter:/i }),
      ).toBeInTheDocument();
    });

    it("renders the Date chip when a to date is active", () => {
      renderAudit("to=2025-12-31");
      expect(
        screen.getByRole("button", { name: /clear date filter:/i }),
      ).toBeInTheDocument();
    });

    it("renders the Date chip when both from and to dates are active", () => {
      renderAudit("from=2025-01-01&to=2025-12-31");
      expect(
        screen.getByRole("button", { name: /clear date filter: 2025-01-01 to 2025-12-31/i }),
      ).toBeInTheDocument();
    });

    it("renders all four chips when all filter types are active", () => {
      renderAudit(
        "action=account_deleted&actorAppUserId=actor1&targetAppUserId=target1&from=2025-01-01&to=2025-12-31",
      );
      expect(screen.getByRole("button", { name: /clear action filter:/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /clear actor filter:/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /clear target filter:/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /clear date filter:/i })).toBeInTheDocument();
    });
  });

  // ── Clearing individual chips ────────────────────────────────────────────────

  describe("clicking a chip clears only that filter", () => {
    it("clicking the Action chip removes the action param and resets offset to 0", async () => {
      renderAudit("action=account_deleted&offset=50");
      await userEvent.click(
        screen.getByRole("button", { name: /clear action filter:/i }),
      );
      const params = lastNavigatedParams();
      expect(params.has("action")).toBe(false);
      expect(params.has("offset")).toBe(false);
    });

    it("clicking the Actor chip removes the actorAppUserId param and resets offset to 0", async () => {
      renderAudit("actorAppUserId=user_abc&offset=50");
      await userEvent.click(
        screen.getByRole("button", { name: /clear actor filter:/i }),
      );
      const params = lastNavigatedParams();
      expect(params.has("actorAppUserId")).toBe(false);
      expect(params.has("offset")).toBe(false);
    });

    it("clicking the Target chip removes the targetAppUserId param and resets offset to 0", async () => {
      renderAudit("targetAppUserId=user_xyz&offset=50");
      await userEvent.click(
        screen.getByRole("button", { name: /clear target filter:/i }),
      );
      const params = lastNavigatedParams();
      expect(params.has("targetAppUserId")).toBe(false);
      expect(params.has("offset")).toBe(false);
    });

    it("clicking the Date chip removes both from and to params and resets offset to 0", async () => {
      renderAudit("from=2025-01-01&to=2025-12-31&offset=50");
      await userEvent.click(
        screen.getByRole("button", { name: /clear date filter:/i }),
      );
      const params = lastNavigatedParams();
      expect(params.has("from")).toBe(false);
      expect(params.has("to")).toBe(false);
      expect(params.has("offset")).toBe(false);
    });
  });

  // ── Other active filters are preserved when one chip is cleared ──────────────

  describe("other active filters are unaffected when one chip is cleared", () => {
    it("clearing the Action chip preserves actor, target and date filters", async () => {
      renderAudit(
        "action=account_deleted&actorAppUserId=actor1&targetAppUserId=target1&from=2025-01-01&to=2025-12-31",
      );
      await userEvent.click(
        screen.getByRole("button", { name: /clear action filter:/i }),
      );
      const params = lastNavigatedParams();
      expect(params.has("action")).toBe(false);
      expect(params.get("actorAppUserId")).toBe("actor1");
      expect(params.get("targetAppUserId")).toBe("target1");
      expect(params.get("from")).toBe("2025-01-01");
      expect(params.get("to")).toBe("2025-12-31");
    });

    it("clearing the Actor chip preserves action, target and date filters", async () => {
      renderAudit(
        "action=tester_data_reset&actorAppUserId=actor1&targetAppUserId=target1&from=2025-03-01&to=2025-03-31",
      );
      await userEvent.click(
        screen.getByRole("button", { name: /clear actor filter:/i }),
      );
      const params = lastNavigatedParams();
      expect(params.has("actorAppUserId")).toBe(false);
      expect(params.get("action")).toBe("tester_data_reset");
      expect(params.get("targetAppUserId")).toBe("target1");
      expect(params.get("from")).toBe("2025-03-01");
      expect(params.get("to")).toBe("2025-03-31");
    });

    it("clearing the Target chip preserves action, actor and date filters", async () => {
      renderAudit(
        "action=test_account_provisioned&actorAppUserId=actor1&targetAppUserId=target1&from=2025-06-01&to=2025-06-30",
      );
      await userEvent.click(
        screen.getByRole("button", { name: /clear target filter:/i }),
      );
      const params = lastNavigatedParams();
      expect(params.has("targetAppUserId")).toBe(false);
      expect(params.get("action")).toBe("test_account_provisioned");
      expect(params.get("actorAppUserId")).toBe("actor1");
      expect(params.get("from")).toBe("2025-06-01");
      expect(params.get("to")).toBe("2025-06-30");
    });

    it("clearing the Date chip preserves action, actor and target filters", async () => {
      renderAudit(
        "action=account_deleted&actorAppUserId=actor1&targetAppUserId=target1&from=2025-01-01&to=2025-12-31",
      );
      await userEvent.click(
        screen.getByRole("button", { name: /clear date filter:/i }),
      );
      const params = lastNavigatedParams();
      expect(params.has("from")).toBe(false);
      expect(params.has("to")).toBe(false);
      expect(params.get("action")).toBe("account_deleted");
      expect(params.get("actorAppUserId")).toBe("actor1");
      expect(params.get("targetAppUserId")).toBe("target1");
    });
  });
});
