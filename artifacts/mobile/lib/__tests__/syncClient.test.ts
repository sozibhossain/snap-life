import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory AsyncStorage mock — every test starts from a clean store.
const memStore = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => memStore.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      memStore.set(k, v);
    },
    removeItem: async (k: string) => {
      memStore.delete(k);
    },
    multiRemove: async (ks: string[]) => {
      for (const k of ks) memStore.delete(k);
    },
  },
}));

import type { SyncSnapshot } from "../syncClient";

const { applySnapshotToAsyncStorage, pullSnapshot } =
  await import("../syncClient");

beforeEach(() => {
  memStore.clear();
});

describe("applySnapshotToAsyncStorage", () => {
  it("writes profile under the clerk id when one is provided", async () => {
    const snapshot: SyncSnapshot = {
      appUserId: "app-1",
      profile: { profile: { name: "Pat", age: 60 }, updatedAtMs: 100 },
      nutrition: [],
      activity: [],
      mealPlan: [],
      wellbeing: [],
      gamification: null,
      supplements: null,
      assessments: [],
    };
    await applySnapshotToAsyncStorage({
      snapshot,
      appUserId: "app-1",
      clerkUserId: "user_clerk1",
    });
    expect(JSON.parse(memStore.get("@snaplife/profile/v1:user_clerk1")!)).toEqual({
      name: "Pat",
      age: 60,
    });
  });

  it("does NOT write the profile when clerkUserId is null", async () => {
    const snapshot: SyncSnapshot = {
      appUserId: "app-1",
      profile: { profile: { name: "Pat" } },
      nutrition: [],
      activity: [],
      mealPlan: [],
      wellbeing: [],
      gamification: null,
      supplements: null,
      assessments: [],
    };
    await applySnapshotToAsyncStorage({
      snapshot,
      appUserId: "app-1",
      clerkUserId: null,
    });
    // No profile key at all — we don't know which clerk namespace to
    // write under.
    for (const k of memStore.keys()) {
      expect(k.startsWith("@snaplife/profile/v1:")).toBe(false);
    }
  });

  it("writes per-day nutrition + activity sorted newest-first", async () => {
    const snapshot: SyncSnapshot = {
      appUserId: "app-1",
      profile: null,
      nutrition: [
        { day: "2026-04-30", data: { id: "n1", date: "2026-04-30" } },
        { day: "2026-05-02", data: { id: "n3", date: "2026-05-02" } },
        { day: "2026-05-01", data: { id: "n2", date: "2026-05-01" } },
      ],
      activity: [
        { day: "2026-05-01", data: { id: "a1", steps: 5000 } },
        { day: "2026-05-02", data: { id: "a2", steps: 9000 } },
      ],
      mealPlan: [],
      wellbeing: [],
      gamification: null,
      supplements: null,
      assessments: [],
    };
    await applySnapshotToAsyncStorage({
      snapshot,
      appUserId: "app-1",
      clerkUserId: "user_x",
    });
    const nutrition = JSON.parse(memStore.get("snap_nutrition:app-1")!);
    expect(nutrition.map((n: { date: string }) => n.date)).toEqual([
      "2026-05-02",
      "2026-05-01",
      "2026-04-30",
    ]);
    const activity = JSON.parse(memStore.get("snap_activity:app-1")!);
    expect(activity.map((a: { id: string }) => a.id)).toEqual(["a2", "a1"]);
  });

  it("writes the most recent meal plan day to snap_nutrition_state", async () => {
    const snapshot: SyncSnapshot = {
      appUserId: "app-1",
      profile: null,
      nutrition: [],
      activity: [],
      mealPlan: [
        { day: "2026-05-01", data: { plan: { date: "2026-05-01" }, preferences: {} } },
        { day: "2026-05-02", data: { plan: { date: "2026-05-02" }, preferences: { vegetarian: true } } },
      ],
      wellbeing: [],
      gamification: null,
      supplements: null,
      assessments: [],
    };
    await applySnapshotToAsyncStorage({
      snapshot,
      appUserId: "app-1",
      clerkUserId: "user_x",
    });
    const state = JSON.parse(memStore.get("snap_nutrition_state:app-1")!);
    expect(state.preferences).toEqual({ vegetarian: true });
    expect(state.plan.date).toBe("2026-05-02");
  });

  it("unwraps supplements.state.supplements when present", async () => {
    const snapshot: SyncSnapshot = {
      appUserId: "app-1",
      profile: null,
      nutrition: [],
      activity: [],
      mealPlan: [],
      wellbeing: [],
      gamification: null,
      supplements: {
        state: {
          supplements: [{ id: "s1", name: "Calcium", taken: true }],
        },
      },
      assessments: [],
    };
    await applySnapshotToAsyncStorage({
      snapshot,
      appUserId: "app-1",
      clerkUserId: "user_x",
    });
    expect(JSON.parse(memStore.get("snap_supplements:app-1")!)).toEqual([
      { id: "s1", name: "Calcium", taken: true },
    ]);
  });

  it("writes gamification state verbatim", async () => {
    const snapshot: SyncSnapshot = {
      appUserId: "app-1",
      profile: null,
      nutrition: [],
      activity: [],
      mealPlan: [],
      wellbeing: [],
      gamification: {
        state: {
          achievements: [{ id: "a1", earned: true }],
          challenges: [],
          rewards: [],
        },
      },
      supplements: null,
      assessments: [],
    };
    await applySnapshotToAsyncStorage({
      snapshot,
      appUserId: "app-1",
      clerkUserId: "user_x",
    });
    expect(JSON.parse(memStore.get("snap_gamification:app-1")!).achievements[0])
      .toEqual({ id: "a1", earned: true });
  });

  it("sorts wellbeing entries newest-first into the per-user scoped key", async () => {
    const snapshot: SyncSnapshot = {
      appUserId: "app-1",
      profile: null,
      nutrition: [],
      activity: [],
      mealPlan: [],
      wellbeing: [
        { entryId: "w1", entry: { id: "w1", completedAt: 100 }, completedAtMs: 100 },
        { entryId: "w3", entry: { id: "w3", completedAt: 300 }, completedAtMs: 300 },
        { entryId: "w2", entry: { id: "w2", completedAt: 200 }, completedAtMs: 200 },
      ],
      gamification: null,
      supplements: null,
      assessments: [],
    };
    await applySnapshotToAsyncStorage({
      snapshot,
      appUserId: "app-1",
      clerkUserId: "user_x",
    });
    const entries = JSON.parse(memStore.get("@snaplife/wellbeing/v1:app-1")!);
    expect(entries.map((e: { id: string }) => e.id)).toEqual(["w3", "w2", "w1"]);
    // The legacy global key must NOT be written — that was the
    // shared-device leak the scoping fix is here to prevent.
    expect(memStore.get("@snaplife/wellbeing/v1")).toBeUndefined();
  });

  it("separates DEXA and FRAX assessments into their scoped stores", async () => {
    const snapshot: SyncSnapshot = {
      appUserId: "app-1",
      profile: null,
      nutrition: [],
      activity: [],
      mealPlan: [],
      wellbeing: [],
      gamification: null,
      supplements: null,
      assessments: [
        { resultId: "d1", kind: "dexa", payload: { id: "d1", site: "lumbar_spine", tScore: -1.2 }, takenAtMs: 100 },
        { resultId: "f1", kind: "frax", payload: { id: "f1", majorRisk: 12, hipRisk: 4 }, takenAtMs: 50 },
        { resultId: "d2", kind: "dexa", payload: { id: "d2", site: "total_hip", tScore: -2.0 }, takenAtMs: 200 },
      ],
    };
    await applySnapshotToAsyncStorage({
      snapshot,
      appUserId: "app-1",
      clerkUserId: "user_x",
    });
    const dexa = JSON.parse(memStore.get("snap_dexa:app-1")!);
    expect(dexa.map((d: { id: string }) => d.id)).toEqual(["d2", "d1"]);
    const frax = JSON.parse(memStore.get("snap_frax:app-1")!);
    expect(frax).toEqual([{ id: "f1", majorRisk: 12, hipRisk: 4 }]);
  });

  it("clears stale local DEXA and FRAX records when the server has none", async () => {
    memStore.set("snap_dexa:app-1", JSON.stringify([{ id: "old-dexa" }]));
    memStore.set("snap_frax:app-1", JSON.stringify([{ id: "old-frax" }]));
    const snapshot: SyncSnapshot = {
      appUserId: "app-1",
      profile: null,
      nutrition: [],
      activity: [],
      mealPlan: [],
      wellbeing: [],
      gamification: null,
      supplements: null,
      assessments: [],
    };
    await applySnapshotToAsyncStorage({
      snapshot,
      appUserId: "app-1",
      clerkUserId: "user_x",
    });
    expect(JSON.parse(memStore.get("snap_dexa:app-1")!)).toEqual([]);
    expect(JSON.parse(memStore.get("snap_frax:app-1")!)).toEqual([]);
  });
});

describe("pullSnapshot", () => {
  it("returns null when no auth header is available", async () => {
    const result = await pullSnapshot({
      apiBaseUrl: "https://x.example",
      getAuthHeader: async () => null,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    expect(result).toBeNull();
  });

  it("returns null when the network call fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const result = await pullSnapshot({
      apiBaseUrl: "https://x.example",
      getAuthHeader: async () => "Bearer x",
      fetchImpl,
    });
    expect(result).toBeNull();
  });

  it("returns the parsed snapshot on a 200", async () => {
    const snap: SyncSnapshot = {
      appUserId: "app-1",
      profile: null,
      nutrition: [],
      activity: [],
      mealPlan: [],
      wellbeing: [],
      gamification: null,
      supplements: null,
      assessments: [],
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => snap,
    })) as unknown as typeof fetch;
    const result = await pullSnapshot({
      apiBaseUrl: "https://x.example",
      getAuthHeader: async () => "Bearer x",
      fetchImpl,
    });
    expect(result).toEqual(snap);
  });

  it("returns null when the body lacks appUserId (defensive)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ profile: null }),
    })) as unknown as typeof fetch;
    const result = await pullSnapshot({
      apiBaseUrl: "https://x.example",
      getAuthHeader: async () => "Bearer x",
      fetchImpl,
    });
    expect(result).toBeNull();
  });
});
