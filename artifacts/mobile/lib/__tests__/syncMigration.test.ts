import { describe, it, expect, vi } from "vitest";
import {
  runSyncMigration,
  syncMigrationKey,
  legacyKeysFor,
  type MigrationDeps,
} from "../syncMigration";
import type { EnqueueArgs } from "../syncClient";

function makeDeps(
  store: Record<string, string>,
  marker: { migrated: boolean },
  enqueued: EnqueueArgs[],
): MigrationDeps {
  return {
    readKey: vi.fn(async (k: string) => store[k] ?? null),
    hasMigrated: vi.fn(async () => marker.migrated),
    markMigrated: vi.fn(async () => {
      marker.migrated = true;
    }),
    enqueue: vi.fn((a: EnqueueArgs) => {
      enqueued.push(a);
    }),
  };
}

describe("syncMigrationKey + legacyKeysFor", () => {
  it("scopes the marker per appUserId", () => {
    expect(syncMigrationKey("u-1")).toBe("@snaplife/syncMigrated/v1:u-1");
  });

  it("scopes per-user keys (incl. wellbeing) and exposes the legacy global wellbeing key as a fallback", () => {
    const k = legacyKeysFor("app-1", "clerk-1");
    expect(k.profile).toBe("@snaplife/profile/v1:clerk-1");
    expect(k.nutrition).toBe("snap_nutrition:app-1");
    expect(k.wellbeing).toBe("@snaplife/wellbeing/v1:app-1");
    expect(k.wellbeingLegacy).toBe("@snaplife/wellbeing/v1");
  });

  it("returns null profile key when clerkUserId is null", () => {
    expect(legacyKeysFor("app-1", null).profile).toBeNull();
  });
});

describe("runSyncMigration", () => {
  it("no-ops with `skipped_already_migrated` when the marker is set", async () => {
    const enqueued: EnqueueArgs[] = [];
    const deps = makeDeps({}, { migrated: true }, enqueued);
    const status = await runSyncMigration({
      appUserId: "app-1",
      clerkUserId: "clerk-1",
      deps,
    });
    expect(status).toBe("skipped_already_migrated");
    expect(enqueued).toHaveLength(0);
    expect(deps.markMigrated).not.toHaveBeenCalled();
  });

  it("returns `skipped_no_data` and STILL marks migrated when the device is empty", async () => {
    const enqueued: EnqueueArgs[] = [];
    const marker = { migrated: false };
    const deps = makeDeps({}, marker, enqueued);
    const status = await runSyncMigration({
      appUserId: "app-1",
      clerkUserId: "clerk-1",
      deps,
    });
    expect(status).toBe("skipped_no_data");
    expect(enqueued).toHaveLength(0);
    expect(marker.migrated).toBe(true);
  });

  it("enqueues every domain present in storage", async () => {
    const enqueued: EnqueueArgs[] = [];
    const store: Record<string, string> = {
      "@snaplife/profile/v1:clerk-1": JSON.stringify({ name: "Pat", age: 60 }),
      "snap_nutrition:app-1": JSON.stringify([
        { id: "n1", date: "2026-05-01", calcium: 800 },
        { id: "n2", date: "2026-05-02", calcium: 900 },
      ]),
      "snap_activity:app-1": JSON.stringify([
        { id: "a1", date: "2026-05-02", steps: 5000 },
      ]),
      "snap_supplements:app-1": JSON.stringify([
        { id: "s1", name: "Calcium", taken: true },
      ]),
      "snap_dexa:app-1": JSON.stringify([
        { id: "d1", date: "2026-05-01", site: "lumbar_spine", tScore: -1.2 },
      ]),
      "snap_nutrition_state:app-1": JSON.stringify({
        plan: { date: "2026-05-02" },
        preferences: { vegetarian: true },
        favourites: [],
      }),
      "snap_gamification:app-1": JSON.stringify({
        achievements: [{ id: "a1", earned: true }],
      }),
      "@snaplife/wellbeing/v1": JSON.stringify([
        { id: "w1", completedAt: 100, mood: "calm" },
        { id: "w2", completedAt: 200, mood: "focused" },
      ]),
    };
    const marker = { migrated: false };
    const deps = makeDeps(store, marker, enqueued);
    const status = await runSyncMigration({
      appUserId: "app-1",
      clerkUserId: "clerk-1",
      deps,
    });
    expect(status).toBe("migrated");
    expect(marker.migrated).toBe(true);

    const byDomain = new Map<string, EnqueueArgs[]>();
    for (const e of enqueued) {
      const list = byDomain.get(e.domain) ?? [];
      list.push(e);
      byDomain.set(e.domain, list);
    }
    expect(byDomain.get("profile")).toHaveLength(1);
    expect(byDomain.get("nutrition")).toHaveLength(2);
    expect(byDomain.get("activity")).toHaveLength(1);
    expect(byDomain.get("meal-plan")).toHaveLength(1);
    expect(byDomain.get("supplements")).toHaveLength(1);
    expect(byDomain.get("gamification")).toHaveLength(1);
    expect(byDomain.get("assessment")).toHaveLength(1);
    expect(byDomain.get("wellbeing")).toHaveLength(2);

    const supp = byDomain.get("supplements")![0];
    expect(supp.method).toBe("PUT");
    expect(supp.path).toBe("/sync/supplements");
    // Server expects `{ state: { supplements: [...] } }` — we wrap.
    expect((supp.body as { state: { supplements: unknown[] } }).state.supplements)
      .toHaveLength(1);

    const dexa = byDomain.get("assessment")![0];
    expect(dexa.method).toBe("POST");
    expect((dexa.body as { kind: string }).kind).toBe("dexa");

    const well = byDomain.get("wellbeing")![0];
    expect(well.method).toBe("POST");
    expect((well.body as { completedAtMs: number }).completedAtMs).toBe(100);
  });

  it("scopes every enqueue under the supplied appUserId", async () => {
    const enqueued: EnqueueArgs[] = [];
    const store: Record<string, string> = {
      "snap_nutrition:app-1": JSON.stringify([{ id: "n1", date: "2026-05-01" }]),
    };
    const marker = { migrated: false };
    const deps = makeDeps(store, marker, enqueued);
    await runSyncMigration({ appUserId: "app-1", clerkUserId: null, deps });
    for (const e of enqueued) {
      expect(e.appUserId).toBe("app-1");
    }
  });

  it("skips entries missing required fields (no id / no date)", async () => {
    const enqueued: EnqueueArgs[] = [];
    const store: Record<string, string> = {
      "snap_nutrition:app-1": JSON.stringify([
        { id: "n1" }, // no date
        { id: "n2", date: "2026-05-02" },
      ]),
      "@snaplife/wellbeing/v1": JSON.stringify([
        { completedAt: 100 }, // no id
        { id: "w2", completedAt: 200 },
      ]),
    };
    const marker = { migrated: false };
    const deps = makeDeps(store, marker, enqueued);
    await runSyncMigration({ appUserId: "app-1", clerkUserId: null, deps });
    expect(
      enqueued.filter((e) => e.domain === "nutrition"),
    ).toHaveLength(1);
    expect(
      enqueued.filter((e) => e.domain === "wellbeing"),
    ).toHaveLength(1);
  });

  it("survives unparseable JSON payloads (treated as missing)", async () => {
    const enqueued: EnqueueArgs[] = [];
    const store: Record<string, string> = {
      "snap_nutrition:app-1": "{not json",
    };
    const marker = { migrated: false };
    const deps = makeDeps(store, marker, enqueued);
    const status = await runSyncMigration({
      appUserId: "app-1",
      clerkUserId: null,
      deps,
    });
    expect(status).toBe("skipped_no_data");
    expect(enqueued).toHaveLength(0);
    expect(marker.migrated).toBe(true);
  });
});
