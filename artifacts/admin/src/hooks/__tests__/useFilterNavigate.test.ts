import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFilterNavigate } from "../useFilterNavigate";

const mockNavigate = vi.fn();
let mockPathname = "/admin/audit";

vi.mock("wouter", () => ({
  useLocation: () => [mockPathname, mockNavigate],
}));

beforeEach(() => {
  mockNavigate.mockClear();
  // Reset URL to a clean state before each test so offset-reset logic
  // starts from a known baseline.
  window.history.pushState({}, "", "/admin/audit");
});

describe("useFilterNavigate", () => {
  describe("URLSearchParams input", () => {
    it("navigates to pathname?qs when params are non-empty", () => {
      const { result } = renderHook(() => useFilterNavigate());
      const params = new URLSearchParams({ actor: "user_abc" });

      act(() => {
        result.current(params);
      });

      expect(mockNavigate).toHaveBeenCalledWith(
        `${mockPathname}?${params.toString()}`,
        { replace: true },
      );
    });

    it("navigates to just pathname when params are empty", () => {
      const { result } = renderHook(() => useFilterNavigate());

      act(() => {
        result.current(new URLSearchParams());
      });

      expect(mockNavigate).toHaveBeenCalledWith(mockPathname, {
        replace: true,
      });
    });
  });

  describe("plain string input", () => {
    it("navigates to pathname?qs when string is non-empty and has no leading ?", () => {
      const { result } = renderHook(() => useFilterNavigate());

      act(() => {
        result.current("page=2&actor=user_abc");
      });

      expect(mockNavigate).toHaveBeenCalledWith(
        `${mockPathname}?page=2&actor=user_abc`,
        { replace: true },
      );
    });

    it("strips a leading ? from the string before building the URL", () => {
      const { result } = renderHook(() => useFilterNavigate());

      act(() => {
        result.current("?page=2");
      });

      expect(mockNavigate).toHaveBeenCalledWith(`${mockPathname}?page=2`, {
        replace: true,
      });
    });

    it("navigates to just pathname when string is empty", () => {
      const { result } = renderHook(() => useFilterNavigate());

      act(() => {
        result.current("");
      });

      expect(mockNavigate).toHaveBeenCalledWith(mockPathname, {
        replace: true,
      });
    });

    it("navigates to just pathname when string is only a ?", () => {
      const { result } = renderHook(() => useFilterNavigate());

      act(() => {
        result.current("?");
      });

      expect(mockNavigate).toHaveBeenCalledWith(mockPathname, {
        replace: true,
      });
    });
  });

  describe("replace option", () => {
    it("defaults to replace: true", () => {
      const { result } = renderHook(() => useFilterNavigate());

      act(() => {
        result.current(new URLSearchParams({ x: "1" }));
      });

      expect(mockNavigate).toHaveBeenCalledWith(expect.any(String), {
        replace: true,
      });
    });

    it("respects replace: false (push navigation)", () => {
      const { result } = renderHook(() => useFilterNavigate());

      act(() => {
        result.current(new URLSearchParams({ x: "1" }), { replace: false });
      });

      expect(mockNavigate).toHaveBeenCalledWith(expect.any(String), {
        replace: false,
      });
    });

    it("respects replace: true when explicitly passed", () => {
      const { result } = renderHook(() => useFilterNavigate());

      act(() => {
        result.current("page=3", { replace: true });
      });

      expect(mockNavigate).toHaveBeenCalledWith(`${mockPathname}?page=3`, {
        replace: true,
      });
    });
  });

  describe("pathname preservation", () => {
    it("always prepends the current pathname, never navigates to a bare query string", () => {
      const { result } = renderHook(() => useFilterNavigate());
      const params = new URLSearchParams({ filter: "active" });

      act(() => {
        result.current(params);
      });

      const [url] = mockNavigate.mock.calls[0];
      expect(url).toMatch(new RegExp(`^${mockPathname}`));
    });
  });

  describe("dynamic pathname", () => {
    afterEach(() => {
      mockPathname = "/admin/audit";
    });

    it("uses whatever pathname useLocation returns, not just /admin/audit", () => {
      mockPathname = "/admin/users";
      const { result } = renderHook(() => useFilterNavigate());
      const params = new URLSearchParams({ role: "admin" });

      act(() => {
        result.current(params);
      });

      expect(mockNavigate).toHaveBeenCalledWith(
        `/admin/users?${params.toString()}`,
        { replace: true },
      );
    });

    it("preserves a pathname containing special characters verbatim", () => {
      mockPathname = "/admin/reports/bone+density/2024-01";
      const { result } = renderHook(() => useFilterNavigate());

      act(() => {
        result.current(new URLSearchParams({ page: "1" }));
      });

      expect(mockNavigate).toHaveBeenCalledWith(
        "/admin/reports/bone+density/2024-01?page=1",
        { replace: true },
      );
    });
  });

  describe("offset reset on filter change", () => {
    it("strips offset from the URL when a non-offset filter changes", () => {
      // Simulate being on page 2 with an existing actor filter.
      window.history.pushState(
        {},
        "",
        "/admin/audit?actor=user_abc&offset=20",
      );
      const { result } = renderHook(() => useFilterNavigate());

      // Navigate with a new action filter but no explicit offset.
      const next = new URLSearchParams({
        actor: "user_abc",
        action: "login",
      });

      act(() => {
        result.current(next);
      });

      const [url] = mockNavigate.mock.calls[0];
      expect(url).not.toContain("offset");
    });

    it("strips offset when switching the actor filter value", () => {
      window.history.pushState(
        {},
        "",
        "/admin/audit?actor=user_abc&offset=40",
      );
      const { result } = renderHook(() => useFilterNavigate());

      const next = new URLSearchParams({ actor: "user_xyz" });

      act(() => {
        result.current(next);
      });

      const [url] = mockNavigate.mock.calls[0];
      expect(url).not.toContain("offset");
    });

    it("strips offset when clearing a filter (removing a key that was set)", () => {
      window.history.pushState(
        {},
        "",
        "/admin/audit?actor=user_abc&offset=20",
      );
      const { result } = renderHook(() => useFilterNavigate());

      // Actor filter cleared — pass params without actor.
      const next = new URLSearchParams();

      act(() => {
        result.current(next);
      });

      const [url] = mockNavigate.mock.calls[0];
      expect(url).not.toContain("offset");
    });

    it("preserves offset when only offset itself changes (pagination)", () => {
      window.history.pushState(
        {},
        "",
        "/admin/audit?actor=user_abc&offset=0",
      );
      const { result } = renderHook(() => useFilterNavigate());

      // Advance to next page — only offset changes.
      const next = new URLSearchParams({ actor: "user_abc", offset: "20" });

      act(() => {
        result.current(next);
      });

      const [url] = mockNavigate.mock.calls[0];
      expect(url).toContain("offset=20");
    });

    it("preserves offset when nothing changes at all", () => {
      window.history.pushState(
        {},
        "",
        "/admin/audit?actor=user_abc&offset=20",
      );
      const { result } = renderHook(() => useFilterNavigate());

      // Re-navigate with identical params.
      const next = new URLSearchParams({ actor: "user_abc", offset: "20" });

      act(() => {
        result.current(next);
      });

      const [url] = mockNavigate.mock.calls[0];
      expect(url).toContain("offset=20");
    });

    it("does not add offset when there is no existing offset and a filter changes", () => {
      // No offset in current URL.
      window.history.pushState({}, "", "/admin/audit?actor=user_abc");
      const { result } = renderHook(() => useFilterNavigate());

      const next = new URLSearchParams({ actor: "user_xyz" });

      act(() => {
        result.current(next);
      });

      const [url] = mockNavigate.mock.calls[0];
      expect(url).not.toContain("offset");
      expect(url).toContain("actor=user_xyz");
    });

    it("strips offset when filter changes are passed as a plain string", () => {
      window.history.pushState(
        {},
        "",
        "/admin/audit?actor=user_abc&offset=20",
      );
      const { result } = renderHook(() => useFilterNavigate());

      act(() => {
        result.current("actor=user_abc&action=login");
      });

      const [url] = mockNavigate.mock.calls[0];
      expect(url).not.toContain("offset");
      expect(url).toContain("action=login");
    });
  });
});
