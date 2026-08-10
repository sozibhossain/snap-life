/**
 * /api/me/* — GDPR self-serve endpoints + tester reset.
 *
 *   GET  /api/me/export  → JSON archive of every per-user row across all
 *                          domain tables. The mobile/admin client can
 *                          surface this as a "Download my data" button.
 *
 *   DELETE /api/me       → soft-deletes the account: redacts PII on the
 *                          users row, sets `deletedAt` (now) +
 *                          `hardDeleteAfter` (now + 30d), drops every
 *                          push token, and revokes the legacy bearer
 *                          token (so the next request is a 410). The
 *                          domain rows are retained for the 30-day
 *                          grace window — a future cron may purge them
 *                          after `hardDeleteAfter`.
 *
 *   POST /api/me/reset   → tester-only. Wipes every per-user domain
 *                          row but keeps the account itself. Lets QA
 *                          re-run onboarding without juggling Clerk
 *                          accounts.
 *
 * Identity is sourced exclusively from the bearer/Clerk session via
 * `requireUser`. There is no user-controlled identifier in any URL or
 * body. Soft-deleted accounts are rejected upstream by `requireUser`,
 * so DELETE is a one-shot.
 */

import { Router, type IRouter } from "express";
import { clerkClient } from "@clerk/express";
import { insertAuditLog } from "../lib/audit";
import {
  db,
  usersTable,
  pendingEmailsTable,
  userProfileTable,
  nutritionLogsTable,
  activityLogsTable,
  mealPlanDaysTable,
  wellbeingEntriesTable,
  gamificationStateTable,
  badgeUnlocksTable,
  assessmentResultsTable,
  supplementStateTable,
  pushTokensTable,
  pushUserStateTable,
  interactionEventsTable,
  userTokensTable,
  subscribersTable,
  subscriptionEventsTable,
  feedbackTable,
  auditEventsTable,
  analyticsConsentTable,
  boneBuddyChatMessagesTable,
  outcomeEntriesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireUser } from "../lib/auth";
import { isValidTimeZone } from "./events";
import { ObjectStorageService } from "../lib/objectStorage";
import { setObjectAclPolicy } from "../lib/objectAcl";

const router: IRouter = Router();

/** ISO 3166-1 alpha-2: two uppercase A-Z letters. */
const ISO_COUNTRY_RE = /^[A-Z]{2}$/;
/** Mirrors the /sync/profile cap. Plenty for a JSON patch body. */
const PROFILE_PATCH_MAX_BYTES = 4 * 1024;
/** A normalized object path looks like `/objects/<id>` or `/objects/uploads/<id>`. */
const OBJECT_PATH_RE = /^\/objects\/[A-Za-z0-9._\-/]+$/;
/** Whitelist of avatar mime types we accept on the avatar route. */
const AVATAR_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);
/** 5 MiB cap on the original upload (pre-storage). */
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

const HARD_DELETE_GRACE_DAYS = 30;

/** Minimal logger surface (matches `req.log`) so the cascade can be invoked
 * from any route without a request handle. */
interface CascadeLogger {
  warn?: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
}

export interface SoftDeleteAccountResult {
  /** false when the appUserId did not match any users row. */
  found: boolean;
  deletedAt: string;
  hardDeleteAfter: string;
  confirmationEmailQueued: boolean;
}

/**
 * Soft-delete the account identified by `appUserId` and run the same
 * GDPR cascade the user-facing `DELETE /me` performs:
 *   - PII redacted on the users row + soft-delete columns set
 *   - push tokens, push state, legacy bearer tokens hard-deleted
 *   - free-text payloads (feedback, interaction events, wellbeing
 *     entries) scrubbed
 *   - audit event recorded in the same DB transaction (mandatory)
 *   - upstream Clerk user erased (best-effort, after commit)
 *   - confirmation email enqueued in `pending_emails` (best-effort,
 *     after commit, when an email address is on file)
 *
 * Used by `DELETE /me` (self-serve, actorAppUserId = "self") and by
 * the admin GDPR endpoint `DELETE /admin/users/:id` (actorAppUserId =
 * the admin's appUserId). The 30-day hard-delete window and free-text
 * scrubbing logic must stay identical between the two paths so the
 * runbook's section 7 is true regardless of who triggered the delete.
 */
export async function softDeleteAccount(
  appUserId: string,
  actorAppUserId: string,
  log?: CascadeLogger,
): Promise<SoftDeleteAccountResult> {
  const now = new Date();
  const hardDeleteAfter = new Date(
    now.getTime() + HARD_DELETE_GRACE_DAYS * 24 * 60 * 60 * 1000,
  );

  // Read identity fields before the transaction — used for Clerk delete
  // and confirmation email after the transaction commits.
  const beforeRows = await db
    .select({
      clerkUserId: usersTable.clerkUserId,
      email: usersTable.email,
      displayName: usersTable.displayName,
    })
    .from(usersTable)
    .where(eq(usersTable.appUserId, appUserId));
  const before = beforeRows[0] ?? null;

  if (!before) {
    return {
      found: false,
      deletedAt: now.toISOString(),
      hardDeleteAfter: hardDeleteAfter.toISOString(),
      confirmationEmailQueued: false,
    };
  }

  // All DB mutations — including the audit row — are committed atomically.
  // If any step fails (including the audit insert) the transaction rolls back
  // and the caller receives an error; no partial state is persisted.
  await db.transaction(async (tx) => {
    await tx
      .update(usersTable)
      .set({
        email: null,
        displayName: null,
        deletedAt: now,
        hardDeleteAfter,
        updatedAt: now,
      })
      .where(eq(usersTable.appUserId, appUserId));

    await tx.delete(pushTokensTable).where(eq(pushTokensTable.appUserId, appUserId));
    await tx
      .delete(pushUserStateTable)
      .where(eq(pushUserStateTable.appUserId, appUserId));
    await tx.delete(userTokensTable).where(eq(userTokensTable.appUserId, appUserId));
    await tx
      .delete(analyticsConsentTable)
      .where(eq(analyticsConsentTable.appUserId, appUserId));
    // Historical builds persisted full Bone Buddy transcripts. New builds
    // no longer do so; erase any legacy rows immediately on account delete.
    await tx
      .delete(boneBuddyChatMessagesTable)
      .where(eq(boneBuddyChatMessagesTable.appUserId, appUserId));

    await tx
      .update(feedbackTable)
      .set({ message: "[redacted]", tags: [] })
      .where(eq(feedbackTable.appUserId, appUserId));
    await tx
      .update(interactionEventsTable)
      .set({ payload: {} })
      .where(eq(interactionEventsTable.appUserId, appUserId));
    await tx
      .update(wellbeingEntriesTable)
      .set({ entry: { kind: "redacted" } })
      .where(eq(wellbeingEntriesTable.appUserId, appUserId));

    // Profile-level PII that lives on `user_profile` is scrubbed in place
    // (the row is retained for the 30d grace window, mirroring the policy
    // we apply to feedback / interaction events / wellbeing). This covers
    // the new profile photo (face image is biometric-adjacent), the
    // free-text identity fields, AND the new locale fields (country +
    // timezone) — per the task spec all three new profile fields are
    // wiped on soft-delete to honor a clean slate.
    await tx
      .update(userProfileTable)
      .set({
        name: null,
        email: null,
        avatar: null,
        gender: null,
        condition: null,
        country: null,
        timezone: null,
        preferences: {},
        updatedAt: now,
      })
      .where(eq(userProfileTable.appUserId, appUserId));

    // Mandatory audit entry — inside the transaction so the record is
    // guaranteed to exist iff the delete succeeded.
    await tx.insert(auditEventsTable).values({
      actorAppUserId,
      targetAppUserId: appUserId,
      action: "account_deleted",
      payload: {
        deletedAt: now.toISOString(),
        hardDeleteAfter: hardDeleteAfter.toISOString(),
      },
    });
  });

  // Post-commit side effects — failures are logged but do not roll back
  // the already-committed soft-delete.
  if (before.clerkUserId) {
    try {
      await clerkClient.users.deleteUser(before.clerkUserId);
    } catch (err) {
      log?.warn?.(
        { err, clerkUserId: before.clerkUserId },
        "softDeleteAccount: Clerk deleteUser failed (will retry on hard-delete)",
      );
    }
  }

  let confirmationEmailQueued = false;
  if (before.email) {
    try {
      await db.insert(pendingEmailsTable).values({
        kind: "account_deletion_confirmation",
        toAddress: before.email,
        payload: {
          appUserId,
          displayName: before.displayName,
          deletedAt: now.toISOString(),
          hardDeleteAfter: hardDeleteAfter.toISOString(),
          gracePeriodDays: HARD_DELETE_GRACE_DAYS,
        },
      });
      confirmationEmailQueued = true;
    } catch (err) {
      log?.warn?.(
        { err, appUserId },
        "softDeleteAccount: failed to enqueue confirmation email (deletion still applied)",
      );
    }
  }

  return {
    found: true,
    deletedAt: now.toISOString(),
    hardDeleteAfter: hardDeleteAfter.toISOString(),
    confirmationEmailQueued,
  };
}

router.get("/me/export", async (req, res): Promise<void> => {
  const u = await requireUser(req, res);
  if (!u) return;

  try {
    const [
      userRow,
      userProfile,
      nutritionLogs,
      activityLogs,
      mealPlanDays,
      wellbeingEntries,
      gamificationState,
      badgeUnlocks,
      assessmentResults,
      supplementState,
      pushTokens,
      pushUserState,
      interactionEvents,
      subscriber,
      subscriptionEvents,
      feedback,
      analyticsConsent,
      legacyBoneBuddyMessages,
      outcomeEntries,
    ] = await Promise.all([
      db.select().from(usersTable).where(eq(usersTable.appUserId, u.appUserId)),
      db
        .select()
        .from(userProfileTable)
        .where(eq(userProfileTable.appUserId, u.appUserId)),
      db
        .select()
        .from(nutritionLogsTable)
        .where(eq(nutritionLogsTable.appUserId, u.appUserId)),
      db
        .select()
        .from(activityLogsTable)
        .where(eq(activityLogsTable.appUserId, u.appUserId)),
      db
        .select()
        .from(mealPlanDaysTable)
        .where(eq(mealPlanDaysTable.appUserId, u.appUserId)),
      db
        .select()
        .from(wellbeingEntriesTable)
        .where(eq(wellbeingEntriesTable.appUserId, u.appUserId)),
      db
        .select()
        .from(gamificationStateTable)
        .where(eq(gamificationStateTable.appUserId, u.appUserId)),
      db
        .select()
        .from(badgeUnlocksTable)
        .where(eq(badgeUnlocksTable.appUserId, u.appUserId)),
      db
        .select()
        .from(assessmentResultsTable)
        .where(eq(assessmentResultsTable.appUserId, u.appUserId)),
      db
        .select()
        .from(supplementStateTable)
        .where(eq(supplementStateTable.appUserId, u.appUserId)),
      db
        .select({
          // push token strings are sensitive; export the metadata only.
          appUserId: pushTokensTable.appUserId,
          platform: pushTokensTable.platform,
          optedIn: pushTokensTable.optedIn,
          lastSentAt: pushTokensTable.lastSentAt,
          createdAt: pushTokensTable.createdAt,
        })
        .from(pushTokensTable)
        .where(eq(pushTokensTable.appUserId, u.appUserId)),
      db
        .select()
        .from(pushUserStateTable)
        .where(eq(pushUserStateTable.appUserId, u.appUserId)),
      db
        .select()
        .from(interactionEventsTable)
        .where(eq(interactionEventsTable.appUserId, u.appUserId)),
      db
        .select()
        .from(subscribersTable)
        .where(eq(subscribersTable.appUserId, u.appUserId)),
      db
        .select()
        .from(subscriptionEventsTable)
        .where(eq(subscriptionEventsTable.appUserId, u.appUserId)),
      db
        .select()
        .from(feedbackTable)
        .where(eq(feedbackTable.appUserId, u.appUserId)),
      db
        .select()
        .from(analyticsConsentTable)
        .where(eq(analyticsConsentTable.appUserId, u.appUserId)),
      db
        .select()
        .from(boneBuddyChatMessagesTable)
        .where(eq(boneBuddyChatMessagesTable.appUserId, u.appUserId)),
      db
        .select()
        .from(outcomeEntriesTable)
        .where(eq(outcomeEntriesTable.appUserId, u.appUserId)),
    ]);

    const archive = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      appUserId: u.appUserId,
      user: userRow[0] ?? null,
      userProfile: userProfile[0] ?? null,
      nutritionLogs,
      activityLogs,
      mealPlanDays,
      wellbeingEntries,
      gamificationState: gamificationState[0] ?? null,
      badgeUnlocks,
      assessmentResults,
      supplementState: supplementState[0] ?? null,
      pushTokens,
      pushUserState: pushUserState[0] ?? null,
      interactionEvents,
      subscriber: subscriber[0] ?? null,
      subscriptionEvents,
      feedback,
      analyticsConsent: analyticsConsent[0] ?? null,
      legacyBoneBuddyMessages,
      outcomeEntries,
    };

    // Use Content-Disposition so a browser fetch downloads the JSON as
    // a file rather than rendering it inline.
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="snap-life-export-${u.appUserId}.json"`,
    );
    res.json(archive);

    // Non-fatal audit entry — log after the response is sent.
    void insertAuditLog({
      targetUserId: u.appUserId,
      action: "user_data_export",
    });
  } catch (err) {
    req.log?.error({ err }, "GET /me/export failed");
    res.status(500).json({ error: "internal" });
  }
});

const CONSENT_VERSION = "community-v1";

router.get("/me/analytics-consent", async (req, res): Promise<void> => {
  const u = await requireUser(req, res);
  if (!u) return;
  try {
    const [row] = await db
      .select()
      .from(analyticsConsentTable)
      .where(eq(analyticsConsentTable.appUserId, u.appUserId))
      .limit(1);
    res.json({
      communityAnalytics: row?.communityAnalytics ?? false,
      researchUse: row?.researchUse ?? false,
      consentVersion: row?.consentVersion ?? CONSENT_VERSION,
      consentedAt: row?.consentedAt?.toISOString() ?? null,
      withdrawnAt: row?.withdrawnAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log?.error({ err }, "GET /me/analytics-consent failed");
    res.status(500).json({ error: "internal" });
  }
});

router.put("/me/analytics-consent", async (req, res): Promise<void> => {
  const u = await requireUser(req, res);
  if (!u) return;
  const body = req.body as
    | { communityAnalytics?: unknown; researchUse?: unknown }
    | undefined;
  if (
    typeof body?.communityAnalytics !== "boolean" ||
    typeof body?.researchUse !== "boolean"
  ) {
    res.status(400).json({ error: "boolean consent values required" });
    return;
  }
  if (!body.communityAnalytics && body.researchUse) {
    res.status(400).json({
      error: "research use requires community analytics consent",
    });
    return;
  }

  const communityAnalytics = body.communityAnalytics;
  // Research is a narrower secondary purpose and cannot remain enabled if
  // the broader community-analytics permission has been withdrawn.
  const researchUse = communityAnalytics && body.researchUse;
  const now = new Date();
  try {
    await db
      .insert(analyticsConsentTable)
      .values({
        appUserId: u.appUserId,
        communityAnalytics,
        researchUse,
        consentVersion: CONSENT_VERSION,
        consentedAt: communityAnalytics ? now : null,
        withdrawnAt: communityAnalytics ? null : now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: analyticsConsentTable.appUserId,
        set: {
          communityAnalytics,
          researchUse,
          consentVersion: CONSENT_VERSION,
          consentedAt: communityAnalytics ? now : null,
          withdrawnAt: communityAnalytics ? null : now,
          updatedAt: now,
        },
      });

    await db.insert(auditEventsTable).values({
      actorAppUserId: "self",
      targetAppUserId: u.appUserId,
      action: "analytics_consent_updated",
      payload: {
        communityAnalytics,
        researchUse,
        consentVersion: CONSENT_VERSION,
      },
    });

    res.json({
      communityAnalytics,
      researchUse,
      consentVersion: CONSENT_VERSION,
      consentedAt: communityAnalytics ? now.toISOString() : null,
      withdrawnAt: communityAnalytics ? null : now.toISOString(),
    });
  } catch (err) {
    req.log?.error({ err }, "PUT /me/analytics-consent failed");
    res.status(500).json({ error: "internal" });
  }
});

/**
 * GET /api/me — server-of-truth view of the authenticated user's
 * profile. Returns the typed columns clients need to render the Edit
 * Profile screen on a fresh device install without round-tripping the
 * full /sync/snapshot payload.
 */
router.get("/me", async (req, res): Promise<void> => {
  const u = await requireUser(req, res);
  if (!u) return;
  try {
    const [rows, subRows] = await Promise.all([
      db
        .select({
          name: userProfileTable.name,
          email: userProfileTable.email,
          avatar: userProfileTable.avatar,
          country: userProfileTable.country,
          timezone: userProfileTable.timezone,
        })
        .from(userProfileTable)
        .where(eq(userProfileTable.appUserId, u.appUserId)),
      db
        .select({
          billingIssueAt: subscribersTable.billingIssueAt,
          gracePeriodEndsAt: subscribersTable.gracePeriodEndsAt,
        })
        .from(subscribersTable)
        .where(eq(subscribersTable.appUserId, u.appUserId)),
    ]);
    const row = rows[0] ?? null;
    const sub = subRows[0] ?? null;
    const now = Date.now();
    // Mirror the lazy-grace logic in /subscription/me so any client that
    // pulls /me (the lighter-weight identity endpoint) gets the same
    // billing-issue banner state without an extra round-trip.
    const billingIssue =
      sub?.billingIssueAt &&
      sub.gracePeriodEndsAt &&
      sub.gracePeriodEndsAt.getTime() > now
        ? {
            since: sub.billingIssueAt.toISOString(),
            gracePeriodEndsAt: sub.gracePeriodEndsAt.toISOString(),
          }
        : null;
    res.json({
      ok: true,
      profile: {
        name: row?.name ?? null,
        email: row?.email ?? null,
        avatarUrl: row?.avatar ?? null,
        country: row?.country ?? null,
        timezone: row?.timezone ?? null,
      },
      billingIssue,
    });
  } catch (err) {
    req.log?.error({ err }, "GET /me failed");
    res.status(500).json({ error: "internal" });
  }
});

/**
 * Merge a partial update into the existing `preferences` jsonb so the
 * /sync/snapshot read path (which returns `profileRow.preferences` as
 * the canonical client-facing profile blob) stays in lock-step with
 * /me/profile and /me/avatar writes. Without this merge, an Edit
 * Profile change would write the typed columns but leave the cross-
 * device snapshot stale until the next /sync/profile push.
 */
async function mergeProfilePreferences(
  appUserId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const rows = await db
    .select({ preferences: userProfileTable.preferences })
    .from(userProfileTable)
    .where(eq(userProfileTable.appUserId, appUserId));
  const existing =
    rows[0]?.preferences && typeof rows[0].preferences === "object"
      ? (rows[0].preferences as Record<string, unknown>)
      : {};
  return { ...existing, ...patch };
}

/**
 * PATCH /api/me/profile — partial update of the validated identity / locale
 * fields on the user_profile row. This is the canonical "edit my profile"
 * write path used by the mobile Edit Profile screen and any future admin
 * tooling. /sync/profile remains the bulk last-write-wins mirror used by
 * the offline queue; this endpoint is the strict, Zod-validated subset
 * (country must be ISO 3166-1 alpha-2, timezone must be a valid IANA
 * zone). Returns the updated row so the client can reconcile without a
 * follow-up GET.
 */
router.patch("/me/profile", async (req, res): Promise<void> => {
  const u = await requireUser(req, res);
  if (!u) return;

  // Body size guard mirrors the sync path. We only accept a tiny JSON
  // patch here so this endpoint is never a vector for fat blobs.
  let serialised: string;
  try {
    serialised = JSON.stringify(req.body ?? null);
  } catch {
    res.status(400).json({ error: "body not serialisable" });
    return;
  }
  if (serialised.length > PROFILE_PATCH_MAX_BYTES) {
    res.status(400).json({ error: "body too large" });
    return;
  }

  const body = req.body as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "body must be a JSON object" });
    return;
  }

  const patch: { country?: string | null; timezone?: string | null } = {};

  if ("country" in body) {
    const v = body.country;
    if (v === null) {
      patch.country = null;
    } else if (typeof v === "string" && ISO_COUNTRY_RE.test(v)) {
      patch.country = v;
    } else {
      res
        .status(400)
        .json({ error: "country must be an ISO 3166-1 alpha-2 code" });
      return;
    }
  }

  if ("timezone" in body) {
    const v = body.timezone;
    if (v === null) {
      patch.timezone = null;
    } else if (typeof v === "string" && isValidTimeZone(v)) {
      patch.timezone = v;
    } else {
      res.status(400).json({ error: "timezone must be a valid IANA zone" });
      return;
    }
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "no updatable fields provided" });
    return;
  }

  const now = new Date();
  try {
    // Mirror the patch into the `preferences` jsonb so /sync/snapshot
    // (which reads from preferences) returns the new locale fields too.
    const mergedPrefs = await mergeProfilePreferences(u.appUserId, patch);
    // Upsert: the row may not exist yet for fresh accounts that haven't
    // completed onboarding; PATCH should still succeed and seed locale.
    await db
      .insert(userProfileTable)
      .values({
        appUserId: u.appUserId,
        country: patch.country ?? null,
        timezone: patch.timezone ?? null,
        preferences: mergedPrefs,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userProfileTable.appUserId,
        set: { ...patch, preferences: mergedPrefs, updatedAt: now },
      });

    const rows = await db
      .select({
        avatar: userProfileTable.avatar,
        country: userProfileTable.country,
        timezone: userProfileTable.timezone,
      })
      .from(userProfileTable)
      .where(eq(userProfileTable.appUserId, u.appUserId));
    const row = rows[0] ?? null;
    res.json({
      ok: true,
      profile: {
        avatarUrl: row?.avatar ?? null,
        country: row?.country ?? null,
        timezone: row?.timezone ?? null,
      },
    });
  } catch (err) {
    req.log?.error({ err }, "PATCH /me/profile failed");
    res.status(500).json({ error: "internal" });
  }
});

/**
 * POST /api/me/avatar — promote a previously-uploaded object (presigned
 * URL → direct GCS PUT, see /api/storage/uploads/request-url) to be the
 * authenticated user's profile photo.
 *
 * The client uploads the image bytes directly to Google Cloud Storage
 * via the presigned URL flow, then POSTs the returned `objectPath` here.
 * We verify the path shape, validate the stored object's content-type
 * and size, then persist the path to `user_profile.avatar`. Rendering
 * goes through `GET /api/storage{objectPath}`, so callers store /
 * display the same opaque path string everywhere.
 */
router.post("/me/avatar", async (req, res): Promise<void> => {
  const u = await requireUser(req, res);
  if (!u) return;

  const body = req.body as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "body must be a JSON object" });
    return;
  }

  const raw = body.objectPath;
  if (typeof raw !== "string" || !OBJECT_PATH_RE.test(raw)) {
    res
      .status(400)
      .json({ error: "objectPath must be a `/objects/...` path string" });
    return;
  }

  let avatarUrl: string;
  try {
    const svc = new ObjectStorageService();
    const file = await svc.getObjectEntityFile(raw);
    // Force a metadata fetch so we can validate the upload's reported
    // content-type and byte size before claiming it as a profile photo.
    const [meta] = await file.getMetadata();
    const contentType = String(meta.contentType ?? "").toLowerCase();
    const size = Number(meta.size ?? 0);
    if (!AVATAR_ALLOWED_MIME.has(contentType)) {
      res
        .status(415)
        .json({ error: "unsupported_media_type", got: contentType });
      return;
    }
    if (!Number.isFinite(size) || size <= 0 || size > AVATAR_MAX_BYTES) {
      res.status(413).json({ error: "payload_too_large", maxBytes: AVATAR_MAX_BYTES });
      return;
    }
    const objectPath = svc.normalizeObjectEntityPath(raw);
    // Tag the object with an owner+public ACL so the read route can
    // serve it (profile photos appear in the community feed and admin
    // dashboard, both of which fetch the URL directly).
    await setObjectAclPolicy(file, {
      owner: u.appUserId,
      visibility: "public",
    });
    // Store the canonical, fully-qualified-relative URL so every
    // surface (mobile RN <Image>, admin <img>, etc.) can render
    // `user.avatar` directly without prepending its own base URL.
    avatarUrl = `/api/storage${objectPath}`;
  } catch (err) {
    req.log?.warn({ err, objectPath: raw }, "/me/avatar — object lookup failed");
    res.status(404).json({ error: "object_not_found" });
    return;
  }

  const now = new Date();
  try {
    const mergedPrefs = await mergeProfilePreferences(u.appUserId, {
      avatar: avatarUrl,
    });
    await db
      .insert(userProfileTable)
      .values({
        appUserId: u.appUserId,
        avatar: avatarUrl,
        preferences: mergedPrefs,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userProfileTable.appUserId,
        set: { avatar: avatarUrl, preferences: mergedPrefs, updatedAt: now },
      });
    res.json({ ok: true, avatarUrl });
  } catch (err) {
    req.log?.error({ err }, "POST /me/avatar persist failed");
    res.status(500).json({ error: "internal" });
  }
});

router.delete("/me", async (req, res): Promise<void> => {
  const u = await requireUser(req, res);
  if (!u) return;

  try {
    const result = await softDeleteAccount(u.appUserId, "self", req.log);
    res.status(200).json({
      ok: true,
      deletedAt: result.deletedAt,
      hardDeleteAfter: result.hardDeleteAfter,
      confirmationEmailQueued: result.confirmationEmailQueued,
    });
    void insertAuditLog({
      targetUserId: u.appUserId,
      action: "user_soft_delete",
      metadata: {
        deletedAt: result.deletedAt,
        hardDeleteAfter: result.hardDeleteAfter,
      },
    });
  } catch (err) {
    req.log?.error({ err }, "DELETE /me failed");
    res.status(500).json({ error: "internal" });
  }
});

router.post("/me/reset", async (req, res): Promise<void> => {
  // Staging-only guardrail. `SNAP_LIFE_ENV` is set to `staging` by the
  // staging deployment config; production deployments never set it,
  // so this endpoint is a 404 there. Combined with the `isTester`
  // check below it gives us defense in depth: an admin in production
  // who somehow flipped `isTester=true` on a real account still cannot
  // wipe its data through this surface.
  if (process.env.SNAP_LIFE_ENV !== "staging") {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const u = await requireUser(req, res);
  if (!u) return;

  if (!u.isTester) {
    res.status(403).json({ error: "tester_only" });
    return;
  }

  try {
    // Wipe every per-user domain row. We deliberately keep the user row
    // (so the tester can re-run onboarding under the same identity) and
    // the subscribers row (RevenueCat is the source of truth there;
    // wiping it locally would just be re-mirrored on the next webhook).
    // The audit event is inserted inside the same transaction so the
    // record exists iff the wipe succeeded — no partial state.
    const userId = u.appUserId;
    const resetAt = new Date().toISOString();
    await db.transaction(async (tx) => {
      await Promise.all([
        tx.delete(userProfileTable).where(eq(userProfileTable.appUserId, userId)),
        tx.delete(nutritionLogsTable).where(eq(nutritionLogsTable.appUserId, userId)),
        tx.delete(activityLogsTable).where(eq(activityLogsTable.appUserId, userId)),
        tx.delete(mealPlanDaysTable).where(eq(mealPlanDaysTable.appUserId, userId)),
        tx
          .delete(wellbeingEntriesTable)
          .where(eq(wellbeingEntriesTable.appUserId, userId)),
        tx
          .delete(gamificationStateTable)
          .where(eq(gamificationStateTable.appUserId, userId)),
        tx.delete(badgeUnlocksTable).where(eq(badgeUnlocksTable.appUserId, userId)),
        tx
          .delete(assessmentResultsTable)
          .where(eq(assessmentResultsTable.appUserId, userId)),
        tx
          .delete(supplementStateTable)
          .where(eq(supplementStateTable.appUserId, userId)),
        tx
          .delete(interactionEventsTable)
          .where(eq(interactionEventsTable.appUserId, userId)),
        tx.delete(pushTokensTable).where(eq(pushTokensTable.appUserId, userId)),
        tx
          .delete(pushUserStateTable)
          .where(eq(pushUserStateTable.appUserId, userId)),
        tx
          .delete(analyticsConsentTable)
          .where(eq(analyticsConsentTable.appUserId, userId)),
        tx
          .delete(boneBuddyChatMessagesTable)
          .where(eq(boneBuddyChatMessagesTable.appUserId, userId)),
        tx
          .delete(outcomeEntriesTable)
          .where(eq(outcomeEntriesTable.appUserId, userId)),
      ]);
      await tx.insert(auditEventsTable).values({
        actorAppUserId: "self",
        targetAppUserId: userId,
        action: "tester_data_reset",
        payload: { resetAt },
      });
    });
    res.json({ ok: true, resetAt });
  } catch (err) {
    req.log?.error({ err }, "POST /me/reset failed");
    res.status(500).json({ error: "internal" });
  }
});

export default router;
