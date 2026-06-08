import { describe, it, expect, vi } from "vitest";
import {
  runLegacyMigration,
  type MigrationDeps,
  type LegacyProfile,
  type LinkResult,
} from "../userMigration";

function makeDeps(overrides: Partial<MigrationDeps> = {}): MigrationDeps {
  return {
    getLegacyProfile: vi.fn().mockResolvedValue(null),
    getLegacyOnboarded: vi.fn().mockResolvedValue(false),
    getLegacyToken: vi.fn().mockResolvedValue(null),
    getClerkSessionToken: vi.fn().mockResolvedValue("clerk-jwt"),
    postLink: vi.fn().mockResolvedValue({ ok: true, status: 200 } as LinkResult),
    saveProfile: vi.fn().mockResolvedValue(undefined),
    clearLegacy: vi.fn().mockResolvedValue(undefined),
    hasMigrated: vi.fn().mockResolvedValue(false),
    markMigrated: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const sampleProfile: LegacyProfile = {
  id: "legacy-123",
  name: "Pat",
  email: "pat@example.com",
  level: 7,
  xp: 240,
};

describe("runLegacyMigration", () => {
  it("returns skipped_already_migrated when the flag is set and touches nothing else", async () => {
    const deps = makeDeps({ hasMigrated: vi.fn().mockResolvedValue(true) });
    const status = await runLegacyMigration("clerk-1", deps);
    expect(status).toBe("skipped_already_migrated");
    expect(deps.getLegacyProfile).not.toHaveBeenCalled();
    expect(deps.postLink).not.toHaveBeenCalled();
    expect(deps.saveProfile).not.toHaveBeenCalled();
    expect(deps.clearLegacy).not.toHaveBeenCalled();
    expect(deps.markMigrated).not.toHaveBeenCalled();
  });

  it("marks migrated and skips when the device has no legacy profile", async () => {
    const deps = makeDeps({ getLegacyProfile: vi.fn().mockResolvedValue(null) });
    const status = await runLegacyMigration("clerk-1", deps);
    expect(status).toBe("skipped_no_legacy");
    expect(deps.markMigrated).toHaveBeenCalledWith("clerk-1");
    expect(deps.postLink).not.toHaveBeenCalled();
    expect(deps.saveProfile).not.toHaveBeenCalled();
    expect(deps.clearLegacy).not.toHaveBeenCalled();
  });

  it("links and copies the profile when token + clerk session are available", async () => {
    const deps = makeDeps({
      getLegacyProfile: vi.fn().mockResolvedValue(sampleProfile),
      getLegacyOnboarded: vi.fn().mockResolvedValue(true),
      getLegacyToken: vi.fn().mockResolvedValue("legacy-bearer"),
      getClerkSessionToken: vi.fn().mockResolvedValue("clerk-jwt"),
      postLink: vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, appUserId: "legacy-123" }),
    });
    const status = await runLegacyMigration("clerk-1", deps);
    expect(status).toBe("linked_with_profile_copy");
    expect(deps.getLegacyToken).toHaveBeenCalledWith("legacy-123");
    expect(deps.postLink).toHaveBeenCalledWith("legacy-bearer", "clerk-jwt");
    expect(deps.saveProfile).toHaveBeenCalledWith("clerk-1", sampleProfile, true);
    expect(deps.clearLegacy).toHaveBeenCalledTimes(1);
    expect(deps.markMigrated).toHaveBeenCalledWith("clerk-1");
  });

  it("discards the local profile when no legacy token is present (anti-leak)", async () => {
    const deps = makeDeps({
      getLegacyProfile: vi.fn().mockResolvedValue(sampleProfile),
      getLegacyOnboarded: vi.fn().mockResolvedValue(false),
      getLegacyToken: vi.fn().mockResolvedValue(null),
    });
    const status = await runLegacyMigration("clerk-1", deps);
    expect(status).toBe("discarded_no_token");
    expect(deps.postLink).not.toHaveBeenCalled();
    expect(deps.saveProfile).not.toHaveBeenCalled();
    expect(deps.clearLegacy).toHaveBeenCalledTimes(1);
    expect(deps.markMigrated).toHaveBeenCalledWith("clerk-1");
  });

  it("treats 409 from /auth/link as a conflict, clears legacy keys, and does not copy the local profile", async () => {
    const deps = makeDeps({
      getLegacyProfile: vi.fn().mockResolvedValue(sampleProfile),
      getLegacyToken: vi.fn().mockResolvedValue("legacy-bearer"),
      postLink: vi
        .fn()
        .mockResolvedValue({ ok: false, status: 409, error: "clerk_user_already_linked" }),
    });
    const status = await runLegacyMigration("clerk-1", deps);
    expect(status).toBe("discarded_conflict");
    expect(deps.saveProfile).not.toHaveBeenCalled();
    expect(deps.clearLegacy).toHaveBeenCalledTimes(1);
    expect(deps.markMigrated).toHaveBeenCalledWith("clerk-1");
  });

  it("on 409 reconciles the canonical appUserId from the server and archives the local profile", async () => {
    const saveCanonicalAppUserId = vi.fn(async () => {});
    const archiveLegacyProfile = vi.fn(async () => {});
    const deps = makeDeps({
      getLegacyProfile: vi.fn().mockResolvedValue(sampleProfile),
      getLegacyOnboarded: vi.fn().mockResolvedValue(true),
      getLegacyToken: vi.fn().mockResolvedValue("legacy-bearer"),
      postLink: vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        error: "clerk_user_already_linked",
        appUserId: "canonical-from-other-device",
      }),
      saveCanonicalAppUserId,
      archiveLegacyProfile,
    });
    const status = await runLegacyMigration("clerk-1", deps);
    expect(status).toBe("discarded_conflict");
    expect(saveCanonicalAppUserId).toHaveBeenCalledWith(
      "clerk-1",
      "canonical-from-other-device",
    );
    expect(archiveLegacyProfile).toHaveBeenCalledWith(
      "clerk-1",
      sampleProfile,
      true,
    );
    expect(deps.saveProfile).not.toHaveBeenCalled();
    expect(deps.clearLegacy).toHaveBeenCalledTimes(1);
    expect(deps.markMigrated).toHaveBeenCalledWith("clerk-1");
  });

  it("returns error and leaves legacy data + migration flag alone on transient failures so it retries next launch", async () => {
    const deps = makeDeps({
      getLegacyProfile: vi.fn().mockResolvedValue(sampleProfile),
      getLegacyToken: vi.fn().mockResolvedValue("legacy-bearer"),
      postLink: vi.fn().mockResolvedValue({ ok: false, status: 500, error: "internal" }),
    });
    const status = await runLegacyMigration("clerk-1", deps);
    expect(status).toBe("error");
    expect(deps.saveProfile).not.toHaveBeenCalled();
    expect(deps.clearLegacy).not.toHaveBeenCalled();
    expect(deps.markMigrated).not.toHaveBeenCalled();
  });

  it("returns error when the Clerk session token isn't available so legacy data can be recovered later", async () => {
    const deps = makeDeps({
      getLegacyProfile: vi.fn().mockResolvedValue(sampleProfile),
      getLegacyToken: vi.fn().mockResolvedValue("legacy-bearer"),
      getClerkSessionToken: vi.fn().mockResolvedValue(null),
    });
    const status = await runLegacyMigration("clerk-1", deps);
    expect(status).toBe("error");
    expect(deps.postLink).not.toHaveBeenCalled();
    expect(deps.saveProfile).not.toHaveBeenCalled();
    expect(deps.clearLegacy).not.toHaveBeenCalled();
    expect(deps.markMigrated).not.toHaveBeenCalled();
  });

  it("discards a legacy profile that lacks a string id (cannot prove ownership)", async () => {
    const deps = makeDeps({
      getLegacyProfile: vi.fn().mockResolvedValue({ name: "Anon" } as LegacyProfile),
      getLegacyToken: vi.fn().mockResolvedValue("should-not-be-called"),
    });
    const status = await runLegacyMigration("clerk-1", deps);
    expect(status).toBe("discarded_no_token");
    expect(deps.getLegacyToken).not.toHaveBeenCalled();
    expect(deps.postLink).not.toHaveBeenCalled();
    expect(deps.saveProfile).not.toHaveBeenCalled();
    expect(deps.clearLegacy).toHaveBeenCalledTimes(1);
    expect(deps.markMigrated).toHaveBeenCalledWith("clerk-1");
  });

  it("returns skipped_no_legacy and does no work when given an empty clerkUserId", async () => {
    const deps = makeDeps();
    const status = await runLegacyMigration("", deps);
    expect(status).toBe("skipped_no_legacy");
    expect(deps.hasMigrated).not.toHaveBeenCalled();
    expect(deps.markMigrated).not.toHaveBeenCalled();
  });

  it("preserves the legacy appUserId across a transient failure + retry sequence", async () => {
    let clerkSessionAvailable = false;
    const legacyStore: Record<string, string | null> = {
      profile: JSON.stringify(sampleProfile),
      onboarded: "true",
      migrated: null,
    };
    const postLink = vi.fn(async () => {
      if (!clerkSessionAvailable) throw new Error("should not be called");
      return { ok: true, status: 200, appUserId: "legacy-123" } as LinkResult;
    });
    const upsertClerkUser = vi.fn();
    const deps: MigrationDeps = {
      getLegacyProfile: vi.fn(async () =>
        legacyStore.profile ? (JSON.parse(legacyStore.profile) as LegacyProfile) : null,
      ),
      getLegacyOnboarded: vi.fn(async () => legacyStore.onboarded === "true"),
      getLegacyToken: vi.fn(async () => "legacy-bearer"),
      getClerkSessionToken: vi.fn(async () => (clerkSessionAvailable ? "clerk-jwt" : null)),
      postLink,
      saveProfile: vi.fn(async () => {}),
      clearLegacy: vi.fn(async () => {
        legacyStore.profile = null;
        legacyStore.onboarded = null;
      }),
      hasMigrated: vi.fn(async () => legacyStore.migrated === "true"),
      markMigrated: vi.fn(async () => {
        legacyStore.migrated = "true";
      }),
    };

    const first = await runLegacyMigration("clerk-1", deps);
    expect(first).toBe("error");
    expect(postLink).not.toHaveBeenCalled();
    if (first === "error") {
      expect(upsertClerkUser).not.toHaveBeenCalled();
    }
    expect(legacyStore.profile).not.toBeNull();
    expect(legacyStore.migrated).toBeNull();

    clerkSessionAvailable = true;
    const second = await runLegacyMigration("clerk-1", deps);
    expect(second).toBe("linked_with_profile_copy");
    expect(postLink).toHaveBeenCalledWith("legacy-bearer", "clerk-jwt");
    expect(legacyStore.profile).toBeNull();
    expect(legacyStore.migrated).toBe("true");
  });
});
