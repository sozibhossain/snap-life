import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: async () => "test-token" }),
}));

vi.mock("@/components/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("recharts", () => {
  const Container = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Container,
    BarChart: Container,
    CartesianGrid: Container,
    Tooltip: Container,
    XAxis: Container,
    YAxis: Container,
    Bar: Container,
  };
});

import CommunityInsights from "../community-insights";

const baseResponse = {
  generatedAt: "2026-08-11T10:00:00.000Z",
  privacy: {
    minCohortSize: 10,
    consentedParticipants: 12,
    suppressed: false,
    consentVersion: "community-v1",
    purpose: "community",
    researchUseRequired: false,
  },
  overview: {
    totalRegisteredUsers: 20,
    dailyActiveConsentedUsers: 10,
    weeklyActiveConsentedUsers: 12,
    monthlyActiveConsentedUsers: 12,
    newRegistrations7d: 3,
    newRegistrations30d: 8,
    averageYearsSinceDiagnosis: 4.2,
    age: [{ label: "55–64", count: 12, suppressed: false }],
    gender: [],
    condition: [],
    country: [],
    goals: [],
  },
  boneHealth: {},
  nutrition: {},
  medicationAndSupplements: {},
  exercise: {},
  learningAndWellness: {},
  outcomes: {},
  impact: {},
  productActivity: {},
  community: {},
  prevention: { cohorts: [] },
  behaviourChange: {},
  wellbeingSupportNeeds7d: [{ kind: "meditation", mood: "stressed", count: 10 }],
  topLearningPathways30d: [{ pathway: "Nutrition", count: 11 }],
  topBoneBuddyTopics30d: [{ topic: "bone_health", count: 12 }],
  coachingDemand30d: [{ sessionId: "consultation", count: 10 }],
  expertDemand30d: [{ consultantId: "maria", count: 10 }],
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CommunityInsights />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const research = String(input).includes("purpose=research");
    return new Response(
      JSON.stringify({
        ...baseResponse,
        privacy: {
          ...baseResponse.privacy,
          purpose: research ? "research" : "community",
          researchUseRequired: research,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }));
  Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:test"), configurable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

describe("Community Insights", () => {
  it("renders overview metrics, charts and every demand dataset", async () => {
    renderPage();
    expect(await screen.findByText("20")).toBeInTheDocument();
    expect(screen.getByText("Learning pathways (30 days)")).toBeInTheDocument();
    expect(screen.getByText("Bone Buddy topics (30 days)")).toBeInTheDocument();
    expect(screen.getByText("Wellbeing support needs (7 days)")).toBeInTheDocument();
    expect(screen.getByText("Coaching demand (30 days)")).toBeInTheDocument();
    expect(screen.getByText("Expert demand (30 days)")).toBeInTheDocument();
    expect(screen.getByText("bone_health")).toBeInTheDocument();
  });

  it("uses the research-consent endpoint for research exports", async () => {
    const user = userEvent.setup();
    renderPage();
    const button = await screen.findByRole("button", { name: "Export research CSV" });
    await user.click(button);
    await vi.waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/admin/metrics/community-insights?purpose=research",
        expect.any(Object),
      ),
    );
    expect(URL.createObjectURL).toHaveBeenCalled();
  });
});
