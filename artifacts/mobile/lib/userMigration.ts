export type MigrationStatus =
  | "skipped_already_migrated"
  | "skipped_no_legacy"
  | "linked_with_profile_copy"
  | "discarded_no_token"
  | "discarded_conflict"
  | "error";

export interface LegacyProfile {
  id?: unknown;
  [key: string]: unknown;
}

export interface LinkResult {
  ok: boolean;
  status: number;
  appUserId?: string;
  error?: string;
}

export interface MigrationDeps {
  getLegacyProfile: () => Promise<LegacyProfile | null>;
  getLegacyOnboarded: () => Promise<boolean>;
  getLegacyToken: (legacyAppUserId: string) => Promise<string | null>;
  getClerkSessionToken: () => Promise<string | null>;
  postLink: (
    legacyToken: string,
    clerkSessionToken: string,
  ) => Promise<LinkResult>;
  saveProfile: (
    clerkUserId: string,
    profile: LegacyProfile,
    onboarded: boolean,
  ) => Promise<void>;
  clearLegacy: () => Promise<void>;
  hasMigrated: (clerkUserId: string) => Promise<boolean>;
  markMigrated: (clerkUserId: string) => Promise<void>;
  saveCanonicalAppUserId?: (
    clerkUserId: string,
    canonicalAppUserId: string,
  ) => Promise<void>;
  archiveLegacyProfile?: (
    clerkUserId: string,
    profile: LegacyProfile,
    onboarded: boolean,
  ) => Promise<void>;
}

export async function runLegacyMigration(
  clerkUserId: string,
  deps: MigrationDeps,
): Promise<MigrationStatus> {
  if (!clerkUserId) return "skipped_no_legacy";

  if (await deps.hasMigrated(clerkUserId)) {
    return "skipped_already_migrated";
  }

  const legacyProfile = await deps.getLegacyProfile();
  if (!legacyProfile) {
    await deps.markMigrated(clerkUserId);
    return "skipped_no_legacy";
  }

  const legacyAppUserId =
    typeof legacyProfile.id === "string" ? legacyProfile.id : null;

  if (!legacyAppUserId) {
    await deps.clearLegacy();
    await deps.markMigrated(clerkUserId);
    return "discarded_no_token";
  }

  const [legacyToken, clerkSession] = await Promise.all([
    deps.getLegacyToken(legacyAppUserId),
    deps.getClerkSessionToken(),
  ]);

  if (!legacyToken) {
    await deps.clearLegacy();
    await deps.markMigrated(clerkUserId);
    return "discarded_no_token";
  }

  if (!clerkSession) return "error";

  const result = await deps.postLink(legacyToken, clerkSession);
  if (result.ok) {
    const onboarded = await deps.getLegacyOnboarded();
    await deps.saveProfile(clerkUserId, legacyProfile, onboarded);
    await deps.clearLegacy();
    await deps.markMigrated(clerkUserId);
    return "linked_with_profile_copy";
  }

  if (result.status === 409) {
    if (deps.archiveLegacyProfile) {
      const onboarded = await deps.getLegacyOnboarded();
      await deps.archiveLegacyProfile(clerkUserId, legacyProfile, onboarded);
    }
    if (result.appUserId && deps.saveCanonicalAppUserId) {
      await deps.saveCanonicalAppUserId(clerkUserId, result.appUserId);
    }
    await deps.clearLegacy();
    await deps.markMigrated(clerkUserId);
    return "discarded_conflict";
  }

  return "error";
}
