import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { datePreset } from "../audit";

// ---------------------------------------------------------------------------
// Mocks — must be declared before the component import is evaluated
// ---------------------------------------------------------------------------

// Track the last URL the component tried to navigate to.
// The component calls navigate("?key=val", { replace: true }) to update params.
// mockNavigate captures the full query string so tests can inspect it.
let capturedSearch = "";
const mockNavigate = vi.fn((to: string) => {
  capturedSearch = to.startsWith("?") ? to.slice(1) : to;
});

vi.mock("wouter", () => ({
  useSearch: () => capturedSearch,
  useLocation: () => ["", mockNavigate],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: null, isLoading: false, error: null }),
  QueryClient: class {},
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@clerk/react", () => ({
  useClerk: () => ({ signOut: vi.fn() }),
  useUser: () => ({ user: null }),
  useAuth: () => ({ getToken: async () => "test-token" }),
}));

// Stub AdminLayout as a transparent wrapper so the page renders without
// Clerk / sidebar overhead.
vi.mock("@/components/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/PollingIndicator", () => ({
  PollingIndicator: () => null,
}));

// ---------------------------------------------------------------------------
// Unit tests — pure datePreset logic
// ---------------------------------------------------------------------------

describe("datePreset()", () => {
  const FIXED = new Date("2026-05-14T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns today as `to` for both presets", () => {
    expect(datePreset(7).to).toBe("2026-05-14");
    expect(datePreset(30).to).toBe("2026-05-14");
  });

  it("sets `from` to today minus 6 days for the 7-day preset", () => {
    expect(datePreset(7).from).toBe("2026-05-08");
  });

  it("sets `from` to today minus 29 days for the 30-day preset", () => {
    expect(datePreset(30).from).toBe("2026-04-15");
  });
});

// ---------------------------------------------------------------------------
// Component integration tests — button click → URL param and input behaviour
// ---------------------------------------------------------------------------

// Lazily imported AFTER all mocks are registered.
const { default: AuditLog } = await import("../audit");

describe("AuditLog quick-range preset buttons", () => {
  const FIXED = new Date("2026-05-14T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED);
    capturedSearch = "";
    mockNavigate.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders both preset buttons", () => {
    render(<AuditLog />);
    expect(screen.getByRole("button", { name: /last 7 days/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /last 30 days/i })).toBeInTheDocument();
  });

  describe('"Last 7 days" button', () => {
    it("calls navigate once with from=today-6 and to=today", () => {
      render(<AuditLog />);
      fireEvent.click(screen.getByRole("button", { name: /last 7 days/i }));

      expect(mockNavigate).toHaveBeenCalledOnce();
      expect(mockNavigate).toHaveBeenCalledWith(
        "?from=2026-05-08&to=2026-05-14",
        { replace: true },
      );
    });

    it("sets from=today-6 and to=today in the resulting URL params", () => {
      render(<AuditLog />);
      fireEvent.click(screen.getByRole("button", { name: /last 7 days/i }));

      const params = new URLSearchParams(capturedSearch);
      expect(params.get("from")).toBe("2026-05-08");
      expect(params.get("to")).toBe("2026-05-14");
    });

    it("omits the offset param to reset pagination to page 1", () => {
      // The component removes `offset` from the URL (rather than setting it to
      // "0") when resetting pagination. A missing offset is treated as 0 by the
      // URLSearchParams parse, which resolves to page 1.
      capturedSearch = "offset=50";
      render(<AuditLog />);
      fireEvent.click(screen.getByRole("button", { name: /last 7 days/i }));

      const params = new URLSearchParams(capturedSearch);
      expect(params.has("offset")).toBe(false);
    });

    it("reflects the computed dates in the From/To date inputs after clicking", () => {
      const { rerender } = render(<AuditLog />);
      fireEvent.click(screen.getByRole("button", { name: /last 7 days/i }));
      // capturedSearch is now updated by mockNavigate; re-render to apply it.
      rerender(<AuditLog />);

      const fromInput = screen.getByLabelText(/^from$/i) as HTMLInputElement;
      const toInput = screen.getByLabelText(/^to$/i) as HTMLInputElement;
      expect(fromInput.value).toBe("2026-05-08");
      expect(toInput.value).toBe("2026-05-14");
    });
  });

  describe('"Last 30 days" button', () => {
    it("calls navigate once with from=today-29 and to=today", () => {
      render(<AuditLog />);
      fireEvent.click(screen.getByRole("button", { name: /last 30 days/i }));

      expect(mockNavigate).toHaveBeenCalledOnce();
      expect(mockNavigate).toHaveBeenCalledWith(
        "?from=2026-04-15&to=2026-05-14",
        { replace: true },
      );
    });

    it("sets from=today-29 and to=today in the resulting URL params", () => {
      render(<AuditLog />);
      fireEvent.click(screen.getByRole("button", { name: /last 30 days/i }));

      const params = new URLSearchParams(capturedSearch);
      expect(params.get("from")).toBe("2026-04-15");
      expect(params.get("to")).toBe("2026-05-14");
    });

    it("omits the offset param to reset pagination to page 1", () => {
      capturedSearch = "offset=100";
      render(<AuditLog />);
      fireEvent.click(screen.getByRole("button", { name: /last 30 days/i }));

      const params = new URLSearchParams(capturedSearch);
      expect(params.has("offset")).toBe(false);
    });

    it("reflects the computed dates in the From/To date inputs after clicking", () => {
      const { rerender } = render(<AuditLog />);
      fireEvent.click(screen.getByRole("button", { name: /last 30 days/i }));
      rerender(<AuditLog />);

      const fromInput = screen.getByLabelText(/^from$/i) as HTMLInputElement;
      const toInput = screen.getByLabelText(/^to$/i) as HTMLInputElement;
      expect(fromInput.value).toBe("2026-04-15");
      expect(toInput.value).toBe("2026-05-14");
    });
  });

  it("preserves existing non-date filters when a preset is clicked", () => {
    capturedSearch = "action=account_deleted";
    render(<AuditLog />);
    fireEvent.click(screen.getByRole("button", { name: /last 7 days/i }));

    const params = new URLSearchParams(capturedSearch);
    expect(params.get("action")).toBe("account_deleted");
    expect(params.get("from")).toBe("2026-05-08");
    expect(params.get("to")).toBe("2026-05-14");
  });
});
