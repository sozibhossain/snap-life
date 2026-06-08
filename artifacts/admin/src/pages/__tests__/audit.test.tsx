import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("wouter", () => ({
  useSearch: vi.fn(),
  useLocation: vi.fn(),
}));

vi.mock("@clerk/react", () => ({
  useClerk: () => ({ signOut: vi.fn() }),
  useUser: () => ({ user: null }),
  useAuth: () => ({ getToken: async () => "test-token" }),
}));

vi.mock("@/components/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import { useSearch, useLocation } from "wouter";
import AuditLog from "../audit";

const mockUseSearch = useSearch as ReturnType<typeof vi.fn>;
const mockUseLocation = useLocation as ReturnType<typeof vi.fn>;

function buildQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderAuditLog(search = "") {
  let currentSearch = search;
  const navigateMock = vi.fn((url: string) => {
    currentSearch = url.startsWith("?") ? url.slice(1) : "";
  });

  mockUseSearch.mockImplementation(() => currentSearch);
  mockUseLocation.mockReturnValue(["/admin/audit", navigateMock]);

  const queryClient = buildQueryClient();

  const { rerender } = render(
    <QueryClientProvider client={queryClient}>
      <AuditLog />
    </QueryClientProvider>,
  );

  function rerenderWithSearch(nextSearch: string) {
    currentSearch = nextSearch;
    mockUseSearch.mockImplementation(() => currentSearch);
    rerender(
      <QueryClientProvider client={queryClient}>
        <AuditLog />
      </QueryClientProvider>,
    );
  }

  return { navigateMock, rerenderWithSearch };
}

// Returns the dismissible action pill <span> by locating its clear button,
// then walking up to the enclosing span. This is robust against any other
// element on the page that happens to render the same label text.
function getActionPill() {
  return screen
    .getByRole("button", { name: "Clear action filter" })
    .closest("span");
}

function queryActionPill() {
  return screen
    .queryByRole("button", { name: "Clear action filter" })
    ?.closest("span") ?? null;
}

describe("AuditLog action-type filter pill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("pill visibility based on URL state", () => {
    it("does not show an action pill when no action filter is set", () => {
      renderAuditLog("");
      expect(queryActionPill()).toBeNull();
    });

    it("shows the pill with the correct label for account_deleted", () => {
      renderAuditLog("action=account_deleted");
      expect(getActionPill()).toHaveTextContent("Action: Account deleted");
    });

    it("shows the pill with the correct label for test_account_provisioned", () => {
      renderAuditLog("action=test_account_provisioned");
      expect(getActionPill()).toHaveTextContent(
        "Action: Test account provisioned",
      );
    });

    it("shows the pill with the correct label for tester_data_reset", () => {
      renderAuditLog("action=tester_data_reset");
      expect(getActionPill()).toHaveTextContent("Action: Tester data reset");
    });

    it("shows the pill with the correct label for sign_in_token_generated", () => {
      renderAuditLog("action=sign_in_token_generated");
      expect(getActionPill()).toHaveTextContent(
        "Action: Sign-in token generated",
      );
    });

    it("falls back to the raw action value for an unknown action type", () => {
      renderAuditLog("action=some_unknown_action");
      expect(getActionPill()).toHaveTextContent("Action: some_unknown_action");
    });
  });

  describe("selecting an action from the dropdown", () => {
    it("shows the pill after the user picks an option from the dropdown", async () => {
      const user = userEvent.setup();
      const { navigateMock, rerenderWithSearch } = renderAuditLog("");

      const trigger = screen.getByRole("combobox");
      await user.click(trigger);

      const option = await screen.findByRole("option", {
        name: "Account deleted",
      });
      await user.click(option);

      expect(navigateMock).toHaveBeenCalledOnce();
      const calledUrl: string = navigateMock.mock.calls[0][0];
      expect(calledUrl).toContain("action=account_deleted");

      rerenderWithSearch("action=account_deleted");

      expect(getActionPill()).toHaveTextContent("Action: Account deleted");
    });

    it("updates the pill label when a different option is chosen", async () => {
      const user = userEvent.setup();
      const { rerenderWithSearch } = renderAuditLog("action=account_deleted");

      expect(getActionPill()).toHaveTextContent("Action: Account deleted");

      const trigger = screen.getByRole("combobox");
      await user.click(trigger);

      const option = await screen.findByRole("option", {
        name: "Tester data reset",
      });
      await user.click(option);

      rerenderWithSearch("action=tester_data_reset");

      expect(getActionPill()).toHaveTextContent("Action: Tester data reset");
      expect(queryActionPill()).not.toHaveTextContent("Account deleted");
    });
  });

  describe("dismissing the action pill", () => {
    it("removes the pill from the UI when the × button is clicked", async () => {
      const user = userEvent.setup();
      const { rerenderWithSearch } = renderAuditLog("action=account_deleted");

      expect(getActionPill()).toBeInTheDocument();

      const clearButton = screen.getByRole("button", {
        name: "Clear action filter",
      });
      await user.click(clearButton);

      rerenderWithSearch("");

      expect(queryActionPill()).toBeNull();
    });

    it("clears the action query param when × is clicked", async () => {
      const user = userEvent.setup();
      const { navigateMock } = renderAuditLog("action=account_deleted");

      await user.click(
        screen.getByRole("button", { name: "Clear action filter" }),
      );

      expect(navigateMock).toHaveBeenCalledOnce();
      const calledWith: string = navigateMock.mock.calls[0][0];
      expect(calledWith).not.toContain("action=");
    });

    it("preserves other active filters when the action pill is dismissed", async () => {
      const user = userEvent.setup();
      const { navigateMock, rerenderWithSearch } = renderAuditLog(
        "action=account_deleted&actorAppUserId=user_abc123",
      );

      await user.click(
        screen.getByRole("button", { name: "Clear action filter" }),
      );

      const calledWith: string = navigateMock.mock.calls[0][0];
      expect(calledWith).not.toContain("action=");
      expect(calledWith).toContain("actorAppUserId=user_abc123");

      rerenderWithSearch("actorAppUserId=user_abc123");

      expect(queryActionPill()).toBeNull();
      // The actor pill's dismiss button is still present (actor filter remains)
      expect(
        screen.getByRole("button", { name: "Clear actor filter" }),
      ).toBeInTheDocument();
    });
  });
});

// ─── Actor filter pill ────────────────────────────────────────────────────────

function getActorPill() {
  return screen
    .getByRole("button", { name: "Clear actor filter" })
    .closest("span");
}

function queryActorPill() {
  return (
    screen
      .queryByRole("button", { name: "Clear actor filter" })
      ?.closest("span") ?? null
  );
}

describe("AuditLog actor filter pill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("pill visibility", () => {
    it("does not show an actor pill when no actor filter is set", () => {
      renderAuditLog("");
      expect(queryActorPill()).toBeNull();
    });

    it("shows the actor pill with the correct value when actorAppUserId is in the URL", () => {
      renderAuditLog("actorAppUserId=user_abc123");
      expect(getActorPill()).toHaveTextContent("Actor: user_abc123");
    });
  });

  describe("typing an actor ID into the input", () => {
    it("shows the actor pill after typing an ID and URL updates", () => {
      const { navigateMock, rerenderWithSearch } = renderAuditLog("");

      const input = screen.getByRole("textbox", { name: /actor/i });
      fireEvent.change(input, { target: { value: "user_abc123" } });

      expect(navigateMock).toHaveBeenCalledOnce();
      const calledUrl: string = navigateMock.mock.calls[0][0];
      expect(calledUrl).toContain("actorAppUserId=user_abc123");

      rerenderWithSearch("actorAppUserId=user_abc123");

      expect(getActorPill()).toHaveTextContent("Actor: user_abc123");
    });
  });

  describe("dismissing the actor pill", () => {
    it("removes the actor pill when the × button is clicked", async () => {
      const user = userEvent.setup();
      const { rerenderWithSearch } = renderAuditLog(
        "actorAppUserId=user_abc123",
      );

      expect(getActorPill()).toBeInTheDocument();

      await user.click(
        screen.getByRole("button", { name: "Clear actor filter" }),
      );

      rerenderWithSearch("");

      expect(queryActorPill()).toBeNull();
    });

    it("clears the actorAppUserId query param when × is clicked", async () => {
      const user = userEvent.setup();
      const { navigateMock } = renderAuditLog("actorAppUserId=user_abc123");

      await user.click(
        screen.getByRole("button", { name: "Clear actor filter" }),
      );

      expect(navigateMock).toHaveBeenCalledOnce();
      const calledWith: string = navigateMock.mock.calls[0][0];
      expect(calledWith).not.toContain("actorAppUserId=");
    });

    it("preserves other active filters when the actor pill is dismissed", async () => {
      const user = userEvent.setup();
      const { navigateMock, rerenderWithSearch } = renderAuditLog(
        "actorAppUserId=user_abc123&action=account_deleted",
      );

      await user.click(
        screen.getByRole("button", { name: "Clear actor filter" }),
      );

      const calledWith: string = navigateMock.mock.calls[0][0];
      expect(calledWith).not.toContain("actorAppUserId=");
      expect(calledWith).toContain("action=account_deleted");

      rerenderWithSearch("action=account_deleted");

      expect(queryActorPill()).toBeNull();
      expect(getActionPill()).toBeInTheDocument();
    });
  });
});

// ─── Target filter pill ───────────────────────────────────────────────────────

function getTargetPill() {
  return screen
    .getByRole("button", { name: "Clear target filter" })
    .closest("span");
}

function queryTargetPill() {
  return (
    screen
      .queryByRole("button", { name: "Clear target filter" })
      ?.closest("span") ?? null
  );
}

describe("AuditLog target filter pill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("pill visibility", () => {
    it("does not show a target pill when no target filter is set", () => {
      renderAuditLog("");
      expect(queryTargetPill()).toBeNull();
    });

    it("shows the target pill with the correct value when targetAppUserId is in the URL", () => {
      renderAuditLog("targetAppUserId=user_xyz789");
      expect(getTargetPill()).toHaveTextContent("Target: user_xyz789");
    });
  });

  describe("typing a target ID into the input", () => {
    it("shows the target pill after typing an ID and URL updates", () => {
      const { navigateMock, rerenderWithSearch } = renderAuditLog("");

      const input = screen.getByRole("textbox", { name: /target/i });
      fireEvent.change(input, { target: { value: "user_xyz789" } });

      expect(navigateMock).toHaveBeenCalledOnce();
      const calledUrl: string = navigateMock.mock.calls[0][0];
      expect(calledUrl).toContain("targetAppUserId=user_xyz789");

      rerenderWithSearch("targetAppUserId=user_xyz789");

      expect(getTargetPill()).toHaveTextContent("Target: user_xyz789");
    });
  });

  describe("dismissing the target pill", () => {
    it("removes the target pill when the × button is clicked", async () => {
      const user = userEvent.setup();
      const { rerenderWithSearch } = renderAuditLog(
        "targetAppUserId=user_xyz789",
      );

      expect(getTargetPill()).toBeInTheDocument();

      await user.click(
        screen.getByRole("button", { name: "Clear target filter" }),
      );

      rerenderWithSearch("");

      expect(queryTargetPill()).toBeNull();
    });

    it("clears the targetAppUserId query param when × is clicked", async () => {
      const user = userEvent.setup();
      const { navigateMock } = renderAuditLog("targetAppUserId=user_xyz789");

      await user.click(
        screen.getByRole("button", { name: "Clear target filter" }),
      );

      expect(navigateMock).toHaveBeenCalledOnce();
      const calledWith: string = navigateMock.mock.calls[0][0];
      expect(calledWith).not.toContain("targetAppUserId=");
    });

    it("preserves other active filters when the target pill is dismissed", async () => {
      const user = userEvent.setup();
      const { navigateMock, rerenderWithSearch } = renderAuditLog(
        "targetAppUserId=user_xyz789&actorAppUserId=user_abc123",
      );

      await user.click(
        screen.getByRole("button", { name: "Clear target filter" }),
      );

      const calledWith: string = navigateMock.mock.calls[0][0];
      expect(calledWith).not.toContain("targetAppUserId=");
      expect(calledWith).toContain("actorAppUserId=user_abc123");

      rerenderWithSearch("actorAppUserId=user_abc123");

      expect(queryTargetPill()).toBeNull();
      expect(getActorPill()).toBeInTheDocument();
    });
  });
});

// ─── In-table actor/target pills (full dynamic labels including the user ID) ──
//
// The "Filtered by:" strip inside the Events card renders actor and target
// dismiss buttons whose aria-label includes the active user ID, e.g.
// "Clear actor filter: user_abc123".  The helpers above match by partial name;
// these tests pin the full label to give explicit coverage of the dynamic form.

describe("AuditLog in-table actor pill (full dynamic label)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a dismiss button whose label includes the actor ID", () => {
    renderAuditLog("actorAppUserId=user_abc123");
    expect(
      screen.getByRole("button", { name: "Clear actor filter: user_abc123" }),
    ).toBeInTheDocument();
  });

  it("shows the actor ID in the pill text", () => {
    renderAuditLog("actorAppUserId=user_abc123");
    expect(
      screen.getByRole("button", { name: "Clear actor filter: user_abc123" }),
    ).toHaveTextContent("Actor: user_abc123");
  });

  it("clicking the dismiss button clears the actorAppUserId param", async () => {
    const user = userEvent.setup();
    const { navigateMock } = renderAuditLog("actorAppUserId=user_abc123");

    await user.click(
      screen.getByRole("button", { name: "Clear actor filter: user_abc123" }),
    );

    expect(navigateMock).toHaveBeenCalledOnce();
    const calledWith: string = navigateMock.mock.calls[0][0];
    expect(calledWith).not.toContain("actorAppUserId=");
  });

  it("pill disappears after the filter is cleared", async () => {
    const user = userEvent.setup();
    const { rerenderWithSearch } = renderAuditLog("actorAppUserId=user_abc123");

    await user.click(
      screen.getByRole("button", { name: "Clear actor filter: user_abc123" }),
    );

    rerenderWithSearch("");

    expect(
      screen.queryByRole("button", { name: "Clear actor filter: user_abc123" }),
    ).toBeNull();
  });

  it("preserves other active filters when the actor pill is dismissed", async () => {
    const user = userEvent.setup();
    const { navigateMock } = renderAuditLog(
      "actorAppUserId=user_abc123&action=account_deleted",
    );

    await user.click(
      screen.getByRole("button", { name: "Clear actor filter: user_abc123" }),
    );

    const calledWith: string = navigateMock.mock.calls[0][0];
    expect(calledWith).not.toContain("actorAppUserId=");
    expect(calledWith).toContain("action=account_deleted");
  });
});

describe("AuditLog in-table target pill (full dynamic label)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a dismiss button whose label includes the target ID", () => {
    renderAuditLog("targetAppUserId=user_xyz789");
    expect(
      screen.getByRole("button", { name: "Clear target filter: user_xyz789" }),
    ).toBeInTheDocument();
  });

  it("shows the target ID in the pill text", () => {
    renderAuditLog("targetAppUserId=user_xyz789");
    expect(
      screen.getByRole("button", { name: "Clear target filter: user_xyz789" }),
    ).toHaveTextContent("Target: user_xyz789");
  });

  it("clicking the dismiss button clears the targetAppUserId param", async () => {
    const user = userEvent.setup();
    const { navigateMock } = renderAuditLog("targetAppUserId=user_xyz789");

    await user.click(
      screen.getByRole("button", { name: "Clear target filter: user_xyz789" }),
    );

    expect(navigateMock).toHaveBeenCalledOnce();
    const calledWith: string = navigateMock.mock.calls[0][0];
    expect(calledWith).not.toContain("targetAppUserId=");
  });

  it("pill disappears after the filter is cleared", async () => {
    const user = userEvent.setup();
    const { rerenderWithSearch } = renderAuditLog("targetAppUserId=user_xyz789");

    await user.click(
      screen.getByRole("button", { name: "Clear target filter: user_xyz789" }),
    );

    rerenderWithSearch("");

    expect(
      screen.queryByRole("button", { name: "Clear target filter: user_xyz789" }),
    ).toBeNull();
  });

  it("preserves other active filters when the target pill is dismissed", async () => {
    const user = userEvent.setup();
    const { navigateMock } = renderAuditLog(
      "targetAppUserId=user_xyz789&actorAppUserId=user_abc123",
    );

    await user.click(
      screen.getByRole("button", { name: "Clear target filter: user_xyz789" }),
    );

    const calledWith: string = navigateMock.mock.calls[0][0];
    expect(calledWith).not.toContain("targetAppUserId=");
    expect(calledWith).toContain("actorAppUserId=user_abc123");
  });
});
