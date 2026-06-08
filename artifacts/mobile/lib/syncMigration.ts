/**
 * One-time migration: walk every domain's AsyncStorage key on the
 * device and post its contents up to the server, then mark the user
 * as migrated so we never run again. Idempotent on the per-user
 * marker — if the marker is already set we no-op.
 *
 * The walker is intentionally additive: it enqueues sync writes via
 * `enqueueSync` (rather than POSTing directly) so the same offline
 * queue / backoff / retry path handles a flaky network during the
 * migration. The very next `flushQueue` pass drains the writes.
 *
 * Pure (testable) — every external dep (AsyncStorage, queueing) is
 * passed in via the `MigrationDeps` interface.
 */

import { SyncPaths, type EnqueueArgs } from "./syncClient";

export type SyncMigrationStatus =
  | "skipped_already_migrated"
  | "skipped_no_data"
  | "migrated";

export interface MigrationDeps {
  /** Returns the JSON string at `key`, or null if missing / errored. */
  readKey: (key: string) => Promise<string | null>;
  /** Mark this device + appUserId as migrated. */
  markMigrated: (appUserId: string) => Promise<void>;
  /** True if `appUserId` has already been migrated on this device. */
  hasMigrated: (appUserId: string) => Promise<boolean>;
  /**
   * Schedule a single sync write through the offline queue. The
   * production `enqueueSync` returns `Promise<void>` resolved once
   * the queue has been persisted; the walker awaits this so the
   * migration marker is only set after every item is durably queued.
   * Tests are free to return `void` (the walker tolerates both).
   */
  enqueue: (args: EnqueueArgs) => Promise<void> | void;
}

const MIGRATION_KEY_PREFIX = "@snaplife/syncMigrated/v1:";
export function syncMigrationKey(appUserId: string): string {
  return `${MIGRATION_KEY_PREFIX}${appUserId}`;
}

/**
 * The full set of AsyncStorage keys the walker reads. Centralised so
 * the test suite can assert we never grow this list silently.
 */
export interface LegacyKeys {
  profile: string | null;
  nutrition: string;
  activity: string;
  supplements: string;
  dexa: string;
  nutritionState: string;
  gamification: string;
  /** Preferred (per-user scoped) wellbeing key. */
  wellbeing: string;
  /**
   * Legacy global wellbeing key. Pre-sync builds wrote every user's
   * sessions here; the walker reads it as a fallback so we don't
   * lose data on existing devices, but every fresh write goes to the
   * scoped key.
   */
  wellbeingLegacy: string;
}
export function legacyKeysFor(
  appUserId: string,
  clerkUserId: string | null,
): LegacyKeys {
  return {
    profile: clerkUserId ? `@snaplife/profile/v1:${clerkUserId}` : null,
    nutrition: `snap_nutrition:${appUserId}`,
    activity: `snap_activity:${appUserId}`,
    supplements: `snap_supplements:${appUserId}`,
    dexa: `snap_dexa:${appUserId}`,
    nutritionState: `snap_nutrition_state:${appUserId}`,
    gamification: `snap_gamification:${appUserId}`,
    wellbeing: `@snaplife/wellbeing/v1:${appUserId}`,
    wellbeingLegacy: "@snaplife/wellbeing/v1",
  };
}

function tryParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

interface DayShape {
  id?: string;
  date: string;
}

interface DexaShape {
  id?: string;
  date?: string;
}

interface WellbeingShape {
  id: string;
  completedAt: number;
}

/**
 * Walk every legacy key for `appUserId`, enqueue the contents into
 * the sync queue, and stamp the migration marker.
 */
export async function runSyncMigration(args: {
  appUserId: string;
  clerkUserId: string | null;
  deps: MigrationDeps;
}): Promise<SyncMigrationStatus> {
  const { appUserId, clerkUserId, deps } = args;

  if (await deps.hasMigrated(appUserId)) {
    return "skipped_already_migrated";
  }

  const k = legacyKeysFor(appUserId, clerkUserId);
  let enqueued = 0;
  // `deps.enqueue` returns a Promise<void> in production (resolves once
  // the item is persisted to the offline queue). We `await` every
  // enqueue here so the migration marker is only stamped once every
  // legacy row is durably queued — otherwise a crash mid-walk could
  // strand items AND skip them on the next launch.
  const enqueue = async (a: EnqueueArgs) => {
    const r = deps.enqueue(a);
    if (r && typeof (r as Promise<void>).then === "function") {
      await r;
    }
    enqueued += 1;
  };

  // --- Profile (under clerk id) ---
  if (k.profile) {
    const profile = tryParse<Record<string, unknown>>(
      await deps.readKey(k.profile),
    );
    if (profile) {
      await enqueue({
        appUserId,
        domain: "profile",
        modifier: null,
        method: "PUT",
        path: SyncPaths.profile(),
        body: { profile, updatedAtMs: Date.now() },
      });
    }
  }

  // --- Nutrition: array of per-day logs ---
  const nutrition = tryParse<DayShape[]>(await deps.readKey(k.nutrition));
  if (Array.isArray(nutrition)) {
    for (const log of nutrition) {
      if (!log?.date) continue;
      await enqueue({
        appUserId,
        domain: "nutrition",
        modifier: log.date,
        method: "PUT",
        path: SyncPaths.nutritionDay(log.date),
        body: { data: log, updatedAtMs: Date.now() },
      });
    }
  }

  // --- Activity: array of per-day logs ---
  const activity = tryParse<DayShape[]>(await deps.readKey(k.activity));
  if (Array.isArray(activity)) {
    for (const log of activity) {
      if (!log?.date) continue;
      await enqueue({
        appUserId,
        domain: "activity",
        modifier: log.date,
        method: "PUT",
        path: SyncPaths.activityDay(log.date),
        body: { data: log, updatedAtMs: Date.now() },
      });
    }
  }

  // --- Meal plan: client persists a single state blob with `plan.date` ---
  const mealPlanState = tryParse<{ plan?: { date?: string } }>(
    await deps.readKey(k.nutritionState),
  );
  const mealPlanDay = mealPlanState?.plan?.date;
  if (mealPlanDay) {
    await enqueue({
      appUserId,
      domain: "meal-plan",
      modifier: mealPlanDay,
      method: "PUT",
      path: SyncPaths.mealPlanDay(mealPlanDay),
      body: { data: mealPlanState, updatedAtMs: Date.now() },
    });
  }

  // --- Supplements: a bare list — wrap in `{ supplements }` for the server ---
  const supplements = tryParse<unknown[]>(await deps.readKey(k.supplements));
  if (Array.isArray(supplements)) {
    await enqueue({
      appUserId,
      domain: "supplements",
      modifier: null,
      method: "PUT",
      path: SyncPaths.supplements(),
      body: {
        state: { supplements },
        updatedAtMs: Date.now(),
      },
    });
  }

  // --- Gamification: blob ---
  const gamification = tryParse<Record<string, unknown>>(
    await deps.readKey(k.gamification),
  );
  if (gamification) {
    await enqueue({
      appUserId,
      domain: "gamification",
      modifier: null,
      method: "PUT",
      path: SyncPaths.gamification(),
      body: { state: gamification, updatedAtMs: Date.now() },
    });
  }

  // --- DEXA scans → assessment append-only ---
  const dexa = tryParse<DexaShape[]>(await deps.readKey(k.dexa));
  if (Array.isArray(dexa)) {
    for (const scan of dexa) {
      if (!scan?.id) continue;
      await enqueue({
        appUserId,
        domain: "assessment",
        modifier: scan.id,
        method: "POST",
        path: SyncPaths.assessment(),
        body: {
          resultId: scan.id,
          kind: "dexa",
          payload: scan,
          takenAtMs: scan.date
            ? new Date(scan.date).getTime() || Date.now()
            : Date.now(),
        },
      });
    }
  }

  // --- Wellbeing entries: prefer the per-user scoped key, fall back to
  // the legacy global key for pre-sync devices that never moved their
  // entries into the scoped namespace.
  let wellbeing = tryParse<WellbeingShape[]>(await deps.readKey(k.wellbeing));
  if (!Array.isArray(wellbeing) || wellbeing.length === 0) {
    wellbeing = tryParse<WellbeingShape[]>(
      await deps.readKey(k.wellbeingLegacy),
    );
  }
  if (Array.isArray(wellbeing)) {
    for (const entry of wellbeing) {
      if (!entry?.id) continue;
      await enqueue({
        appUserId,
        domain: "wellbeing",
        modifier: entry.id,
        method: "POST",
        path: SyncPaths.wellbeing(),
        body: {
          entryId: entry.id,
          entry,
          completedAtMs: entry.completedAt ?? Date.now(),
        },
      });
    }
  }

  // Always mark migrated — even if there was nothing to send. A blank
  // device just doesn't enqueue anything, but we don't want to walk
  // again on the next sign-in.
  await deps.markMigrated(appUserId);
  return enqueued > 0 ? "migrated" : "skipped_no_data";
}
