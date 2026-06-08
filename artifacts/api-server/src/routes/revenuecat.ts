import { Router, type IRouter } from "express";
import {
  db,
  subscribersTable,
  subscriptionEventsTable,
  pendingEmailsTable,
  usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireUserAuth } from "../lib/auth";
import {
  listCustomerActiveEntitlements,
  listCustomerSubscriptions,
  type RcCustomerEntitlement,
  type RcSubscription,
} from "../lib/revenuecatRest";

const router: IRouter = Router();

/**
 * Entitlements we mirror into `subscribers`. Order matters: when a single
 * event references more than one of our entitlements, the FIRST match in
 * this array wins. `snap_premium` is the higher tier and must come first
 * so an upgrade-in-place from snap_plus → snap_premium correctly stores
 * the premium row (consumers like the chat adaptive-tone gate look for
 * `entitlementId === "snap_premium"`).
 */
const SUPPORTED_ENTITLEMENT_IDS = ["snap_premium", "snap_plus"] as const;
type SupportedEntitlementId = (typeof SUPPORTED_ENTITLEMENT_IDS)[number];

/** Pick the highest-tier entitlement on the event that we care about. */
function resolveEntitlement(eventEntitlements: unknown): SupportedEntitlementId | null {
  if (!Array.isArray(eventEntitlements)) return null;
  for (const tier of SUPPORTED_ENTITLEMENT_IDS) {
    if (eventEntitlements.includes(tier)) return tier;
  }
  return null;
}

const isProd = process.env.NODE_ENV === "production";

if (isProd && !process.env.REVENUECAT_WEBHOOK_SECRET) {
  // Fail-closed at boot in production rather than silently accepting unauthenticated webhooks.
  throw new Error(
    "REVENUECAT_WEBHOOK_SECRET must be set in production for webhook authentication.",
  );
}

function checkSharedSecret(req: { header: (n: string) => string | undefined }): boolean {
  const expected = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!expected) return !isProd; // In dev, allow if no secret configured
  return req.header("authorization") === `Bearer ${expected}`;
}

// Active-state events — entitlement remains active
const ACTIVE_TYPES = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
  "TRIAL_STARTED",
  "TRIAL_CONVERTED",
  "NON_RENEWING_PURCHASE",
  "TEMPORARY_ENTITLEMENT_GRANT",
  "SUBSCRIPTION_EXTENDED",
]);
// Entitlement loss
const INACTIVE_TYPES = new Set([
  "EXPIRATION",
  "SUBSCRIPTION_PAUSED",
  "TRIAL_CANCELLED",
  "REFUND",
  "SUBSCRIBER_ALIAS",
]);
// Payment-failed events. We do NOT flip isActive off here — instead we
// open a grace window during which the user keeps access and we surface
// a banner asking them to update their payment method.
const BILLING_ISSUE_TYPES = new Set(["BILLING_ISSUE"]);

/** Days the user keeps access after a BILLING_ISSUE before isActive flips off. */
function getBillingGraceDays(): number {
  const raw = process.env.BILLING_GRACE_DAYS;
  if (!raw) return 3;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
}
// User cancelled but still has access until expiry
const CANCELLED_TYPES = new Set(["CANCELLATION"]);

function deriveActiveState(eventType: string, expirationMs?: number): boolean | null {
  if (ACTIVE_TYPES.has(eventType)) return true;
  if (INACTIVE_TYPES.has(eventType)) return false;
  if (CANCELLED_TYPES.has(eventType)) {
    return expirationMs ? expirationMs > Date.now() : false;
  }
  return null; // Unknown event — leave state untouched
}

// ---- Shared upsert ----------------------------------------------------

export interface SubscriberUpsertInput {
  appUserId: string;
  entitlementId: SupportedEntitlementId;
  isActive: boolean;
  productId: string | null;
  periodType: string | null;
  store: string | null;
  willRenew: boolean;
  isInTrial: boolean;
  /** Time the user first ever purchased this entitlement (best-effort). */
  originalPurchaseAt: Date | null;
  /** Start of the most recent billing period — used as the monotonicity key. */
  latestPurchaseAt: Date | null;
  expiresAt: Date | null;
  unsubscribeDetectedAt: Date | null;
  cancelledAt: Date | null;
  rawCustomerInfo: unknown;
}

export type UpsertOutcome =
  | { action: "inserted" | "updated" }
  | { action: "skipped-stale"; existingLatestPurchaseAt: Date | null };

/**
 * Pure decision: should an incoming upsert proceed, or be rejected as stale?
 *
 * Two skip cases (defense-in-depth against out-of-order or partial writes):
 *   1. Incoming purchase is strictly older than what's stored.
 *   2. Incoming has no purchase timestamp at all (null), but stored does.
 *      Treating "no timestamp" as strictly weaker prevents a partial sync
 *      (e.g. RevenueCat subscriptions endpoint failed) from clobbering a
 *      complete webhook row with nulls.
 *
 * Exported for unit testing — callers in this file should use
 * `upsertSubscriberMonotonic` which combines this with the actual DB write.
 */
export function isUpsertStale(
  existingLatestPurchaseAt: Date | null,
  incomingLatestPurchaseAt: Date | null,
): boolean {
  if (!existingLatestPurchaseAt) return false;
  if (!incomingLatestPurchaseAt) return true;
  return existingLatestPurchaseAt.getTime() > incomingLatestPurchaseAt.getTime();
}

/**
 * Persist a subscriber row with a monotonicity guard against
 * `latestPurchaseAt`. Out-of-order writes are skipped so a delayed webhook
 * can never regress fresher state written by the sync endpoint (or vice
 * versa).
 *
 * Shared by the webhook handler and the authenticated sync endpoint so both
 * paths converge on the same row shape and ordering rules.
 */
export async function upsertSubscriberMonotonic(
  input: SubscriberUpsertInput,
): Promise<UpsertOutcome> {
  const [existing] = await db
    .select({
      latestPurchaseAt: subscribersTable.latestPurchaseAt,
    })
    .from(subscribersTable)
    .where(eq(subscribersTable.appUserId, input.appUserId))
    .limit(1);

  if (isUpsertStale(existing?.latestPurchaseAt ?? null, input.latestPurchaseAt)) {
    return {
      action: "skipped-stale",
      existingLatestPurchaseAt: existing?.latestPurchaseAt ?? null,
    };
  }

  const values = {
    appUserId: input.appUserId,
    entitlementId: input.entitlementId,
    isActive: input.isActive,
    productId: input.productId,
    periodType: input.periodType,
    store: input.store,
    willRenew: input.willRenew,
    isInTrial: input.isInTrial,
    // Any RC-driven write means the row is no longer a pure server trial:
    // either a real store purchase (trial converted) or a store-side trial
    // that supersedes our 30-day grant. Clearing both fields means
    // `/subscription/me` and admin metrics stop counting this subscriber
    // under "server trial" and the cascade (mid-trial store purchase wins)
    // is enforced in one place.
    trialSource: input.isInTrial ? "store" : null,
    trialEndsAt: null,
    // Any successful RC-driven write means payment is healthy again (or
    // never had an issue). Clear the billing-issue / grace-window state
    // so the dashboard banner disappears on the next /subscription/me
    // poll. The dedicated BILLING_ISSUE branch bypasses this function
    // entirely (direct db.update), so this clear only ever runs on
    // recovery / fresh purchases.
    billingIssueAt: null,
    gracePeriodEndsAt: null,
    originalPurchaseAt: input.originalPurchaseAt,
    latestPurchaseAt: input.latestPurchaseAt,
    expiresAt: input.expiresAt,
    unsubscribeDetectedAt: input.unsubscribeDetectedAt,
    cancelledAt: input.cancelledAt,
    rawCustomerInfo: input.rawCustomerInfo,
    updatedAt: new Date(),
  };

  await db
    .insert(subscribersTable)
    .values(values)
    .onConflictDoUpdate({
      target: subscribersTable.appUserId,
      set: {
        entitlementId: values.entitlementId,
        isActive: values.isActive,
        productId: values.productId,
        periodType: values.periodType,
        store: values.store,
        willRenew: values.willRenew,
        isInTrial: values.isInTrial,
        trialSource: values.trialSource,
        trialEndsAt: values.trialEndsAt,
        billingIssueAt: values.billingIssueAt,
        gracePeriodEndsAt: values.gracePeriodEndsAt,
        latestPurchaseAt: values.latestPurchaseAt,
        expiresAt: values.expiresAt,
        unsubscribeDetectedAt: values.unsubscribeDetectedAt,
        cancelledAt: values.cancelledAt,
        rawCustomerInfo: values.rawCustomerInfo,
        updatedAt: values.updatedAt,
      },
    });

  return { action: existing ? "updated" : "inserted" };
}

/**
 * RevenueCat webhook receiver.
 *
 * Configure in RevenueCat Dashboard -> Integrations -> Webhooks:
 *   URL:    https://<your-domain>/api/revenuecat/webhook
 *   Header: Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>
 *
 * The endpoint is the source-of-truth mirror for entitlement state. All
 * upserts are monotonic against the stored `latestPurchaseAt` so out-of-order
 * webhook deliveries cannot regress newer state.
 */
router.post("/revenuecat/webhook", async (req, res) => {
  if (!checkSharedSecret(req)) {
    req.log?.warn("RevenueCat webhook: invalid Authorization header");
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const event = req.body?.event;
  if (!event || typeof event !== "object" || !event.id || !event.type || !event.app_user_id) {
    res.status(400).json({ error: "invalid event payload" });
    return;
  }

  // Only process events scoped to one of OUR entitlements (or events without
  // entitlement context — those affect the customer record itself).
  const eventEntitlements: string[] | undefined = event.entitlement_ids;
  const resolvedEntitlement = resolveEntitlement(eventEntitlements);
  const hasEntitlementScope =
    Array.isArray(eventEntitlements) && eventEntitlements.length > 0;
  if (hasEntitlementScope && resolvedEntitlement === null) {
    res.json({ ok: true, ignored: "entitlement-scope" });
    return;
  }

  try {
    // Idempotent insert into the event log
    await db
      .insert(subscriptionEventsTable)
      .values({
        eventId: event.id,
        eventType: event.type,
        appUserId: event.app_user_id,
        productId: event.product_id ?? null,
        environment: event.environment ?? null,
        payload: req.body,
      })
      .onConflictDoNothing({ target: subscriptionEventsTable.eventId });

    const expirationMs: number | undefined = event.expiration_at_ms;
    const purchasedMs: number | undefined = event.purchased_at_ms;
    const periodType: string | undefined = event.period_type;
    const store: string | undefined = event.store;
    const productId: string | undefined = event.product_id;
    const cancelReason: string | undefined = event.cancel_reason;

    // ---- BILLING_ISSUE branch ------------------------------------------
    // Payment failed at the store. We deliberately keep `isActive = true`
    // (so the user retains access during the grace window) and set
    // `billingIssueAt` + `gracePeriodEndsAt` so /subscription/me can
    // surface a banner asking the user to update their payment method.
    // We also enqueue a one-shot "billing_issue" email per (appUserId,
    // billingIssueAt) so the user gets pushed off-app even if they don't
    // open the app during the grace window.
    if (BILLING_ISSUE_TYPES.has(event.type)) {
      const now = new Date();
      const gracePeriodEndsAt = new Date(
        now.getTime() + getBillingGraceDays() * 24 * 60 * 60 * 1000,
      );
      const appUserId = event.app_user_id as string;

      const [existing] = await db
        .select({
          billingIssueAt: subscribersTable.billingIssueAt,
          entitlementId: subscribersTable.entitlementId,
          isActive: subscribersTable.isActive,
          expiresAt: subscribersTable.expiresAt,
          latestPurchaseAt: subscribersTable.latestPurchaseAt,
        })
        .from(subscribersTable)
        .where(eq(subscribersTable.appUserId, appUserId))
        .limit(1);

      if (!existing) {
        // No row to mark — we have no entitlement context to fabricate one.
        req.log?.info(
          { eventId: event.id, appUserId },
          "BILLING_ISSUE webhook for unknown subscriber — logged only",
        );
        res.json({ ok: true, action: "skipped-no-subscriber" });
        return;
      }

      // Out-of-order guard: if the subscriber is already terminally
      // inactive (CANCELLATION/EXPIRATION already landed) OR their
      // entitlement window has fully elapsed, a delayed BILLING_ISSUE
      // must NOT reactivate them. Also skip if the BILLING_ISSUE event
      // itself predates the latest known purchase (clearly stale).
      const expirationMs = existing.expiresAt
        ? existing.expiresAt.getTime()
        : null;
      const entitlementElapsed =
        expirationMs !== null && expirationMs <= now.getTime();
      const eventPurchasedMs =
        typeof purchasedMs === "number" ? purchasedMs : null;
      const eventOlderThanLatest =
        eventPurchasedMs !== null &&
        existing.latestPurchaseAt !== null &&
        eventPurchasedMs < existing.latestPurchaseAt.getTime();

      if (!existing.isActive || entitlementElapsed || eventOlderThanLatest) {
        req.log?.info(
          {
            eventId: event.id,
            appUserId,
            isActive: existing.isActive,
            entitlementElapsed,
            eventOlderThanLatest,
          },
          "BILLING_ISSUE skipped — subscriber already inactive / event stale",
        );
        res.json({ ok: true, action: "skipped-stale-or-inactive" });
        return;
      }

      // Dedup: if a grace window was already opened recently for this
      // user (billingIssueAt within the current grace window), treat
      // this as a redelivered / follow-up BILLING_ISSUE for the same
      // incident. Don't restart the window (would extend the user's
      // grace period unfairly) and don't re-enqueue the email.
      const graceMs = getBillingGraceDays() * 24 * 60 * 60 * 1000;
      const priorGraceOpen =
        !!existing.billingIssueAt &&
        now.getTime() - existing.billingIssueAt.getTime() < graceMs;

      if (!priorGraceOpen) {
        // Direct update — bypass upsertSubscriberMonotonic so trialSource /
        // trialEndsAt / latestPurchaseAt are preserved exactly. We only
        // touch the billing-issue columns + updatedAt.
        await db
          .update(subscribersTable)
          .set({
            billingIssueAt: now,
            gracePeriodEndsAt,
            // Keep isActive true through the grace window. Lazy expiry in
            // /subscription/me + admin metrics flips effective access off
            // once gracePeriodEndsAt has passed.
            isActive: true,
            updatedAt: now,
          })
          .where(eq(subscribersTable.appUserId, appUserId));

        // DB-level idempotent enqueue: set externalId to a canonical
        // incident key so concurrent webhook retries that race past the
        // application-level priorGraceOpen check still produce exactly
        // one pending_emails row via the unique partial index.
        // Convention: `billing_issue:<appUserId>:<billingIssueAt ISO>`.
        const emailExternalId = `billing_issue:${appUserId}:${now.toISOString()}`;
        try {
          await db
            .insert(pendingEmailsTable)
            .values({
              kind: "billing_issue",
              // Store appUserId in toAddress — the worker resolves the
              // user's real email address at send time.
              toAddress: appUserId,
              externalId: emailExternalId,
              payload: {
                appUserId,
                entitlementId: existing.entitlementId,
                billingIssueAt: now.toISOString(),
                gracePeriodEndsAt: gracePeriodEndsAt.toISOString(),
              },
            })
            .onConflictDoNothing();
        } catch (err) {
          req.log?.warn(
            { err, appUserId },
            "BILLING_ISSUE: failed to enqueue billing_issue email (state still updated)",
          );
        }
      }

      res.json({
        ok: true,
        action: priorGraceOpen
          ? "billing-issue-already-open"
          : "billing-issue-grace-opened",
      });
      return;
    }

    const isActive = deriveActiveState(event.type, expirationMs);
    if (isActive === null) {
      // Unknown event type — log only, leave subscriber state untouched.
      res.json({ ok: true, action: "logged-only" });
      return;
    }

    const willRenew = !CANCELLED_TYPES.has(event.type) && !INACTIVE_TYPES.has(event.type);
    const cancelledAt = CANCELLED_TYPES.has(event.type) ? new Date() : null;
    const unsubscribeDetected = cancelReason ? new Date() : null;
    const incomingPurchaseAt = purchasedMs ? new Date(purchasedMs) : null;

    // Choose the entitlement to persist:
    //   1. The one the event explicitly references (preferring snap_premium
    //      if the event lists multiple of ours).
    //   2. Otherwise, retain whatever entitlement is already on the row
    //      (customer-scoped events like SUBSCRIBER_ALIAS have no entitlement
    //      list but still legitimately update other fields).
    //   3. Otherwise, we have no basis to create a brand-new row — log and
    //      skip rather than guess (the column is NOT NULL).
    let entitlementToPersist: SupportedEntitlementId | null = resolvedEntitlement;
    if (!entitlementToPersist) {
      const [existing] = await db
        .select({ entitlementId: subscribersTable.entitlementId })
        .from(subscribersTable)
        .where(eq(subscribersTable.appUserId, event.app_user_id as string))
        .limit(1);
      const existingId = existing?.entitlementId;
      if (
        existingId === "snap_premium" ||
        existingId === "snap_plus"
      ) {
        entitlementToPersist = existingId;
      }
    }
    if (!entitlementToPersist) {
      req.log?.info(
        { eventId: event.id, type: event.type },
        "Skipping webhook — no entitlement on event and no existing subscriber row",
      );
      res.json({ ok: true, action: "skipped-no-entitlement" });
      return;
    }

    const outcome = await upsertSubscriberMonotonic({
      appUserId: event.app_user_id as string,
      entitlementId: entitlementToPersist,
      isActive,
      productId: productId ?? null,
      periodType: periodType ?? null,
      store: store ?? null,
      willRenew,
      isInTrial: periodType === "TRIAL" || event.type === "TRIAL_STARTED",
      originalPurchaseAt: incomingPurchaseAt,
      latestPurchaseAt: incomingPurchaseAt,
      expiresAt: expirationMs ? new Date(expirationMs) : null,
      unsubscribeDetectedAt: unsubscribeDetected,
      cancelledAt,
      rawCustomerInfo: event,
    });

    if (outcome.action === "skipped-stale") {
      req.log?.info(
        { eventId: event.id, type: event.type },
        "Skipping out-of-order webhook (older than stored state)",
      );
      res.json({ ok: true, action: "skipped-stale" });
      return;
    }

    // Enqueue transactional emails for key lifecycle events.
    //   INITIAL_PURCHASE / TRIAL_CONVERTED → subscription_confirmation
    //   CANCELLATION                       → subscription_cancelled
    //   INITIAL_PURCHASE / RENEWAL         → payment_receipt
    // Idempotent via externalId = `${emailKind}:${eventId}` — safe on
    // webhook retries and concurrent deliveries.
    const CONFIRMATION_EVENTS = new Set(["INITIAL_PURCHASE", "TRIAL_CONVERTED"]);
    const CANCELLATION_EVENTS = new Set(["CANCELLATION"]);
    const RECEIPT_EVENTS = new Set(["INITIAL_PURCHASE", "RENEWAL"]);
    const needsLifecycleEmail =
      CONFIRMATION_EVENTS.has(event.type) || CANCELLATION_EVENTS.has(event.type);
    const needsReceiptEmail = RECEIPT_EVENTS.has(event.type);
    if (needsLifecycleEmail || needsReceiptEmail) {
      try {
        const [user] = await db
          .select({ email: usersTable.email })
          .from(usersTable)
          .where(eq(usersTable.appUserId, event.app_user_id as string))
          .limit(1);
        if (user?.email) {
          const sharedPayload = {
            appUserId: event.app_user_id,
            eventType: event.type,
            entitlementId: entitlementToPersist,
            productId: productId ?? null,
            eventId: event.id,
          };
          if (needsLifecycleEmail) {
            const emailKind = CONFIRMATION_EVENTS.has(event.type)
              ? "subscription_confirmation"
              : "subscription_cancelled";
            await db
              .insert(pendingEmailsTable)
              .values({
                kind: emailKind,
                toAddress: user.email,
                externalId: `${emailKind}:${event.id as string}`,
                payload: sharedPayload,
              })
              .onConflictDoNothing();
          }
          if (needsReceiptEmail) {
            await db
              .insert(pendingEmailsTable)
              .values({
                kind: "payment_receipt",
                toAddress: user.email,
                externalId: `payment_receipt:${event.id as string}`,
                payload: sharedPayload,
              })
              .onConflictDoNothing();
          }
        }
      } catch (err) {
        req.log?.warn(
          { err, appUserId: event.app_user_id, eventType: event.type },
          "Failed to enqueue subscription lifecycle email (state still updated)",
        );
      }
    }

    res.json({ ok: true, action: outcome.action });
  } catch (err) {
    req.log?.error({ err }, "revenuecat webhook handling failed");
    res.status(500).json({ error: "internal" });
  }
});

/**
 * Server-to-server entitlement read. Requires the shared secret so external
 * callers cannot enumerate users (avoids IDOR). The mobile client should NOT
 * call this — it queries RevenueCat directly via the SDK for source-of-truth.
 */
router.get("/revenuecat/entitlement/:appUserId", async (req, res) => {
  if (!checkSharedSecret(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const appUserId = req.params.appUserId;
  if (!appUserId) {
    res.status(400).json({ error: "appUserId required" });
    return;
  }

  const [row] = await db
    .select()
    .from(subscribersTable)
    .where(eq(subscribersTable.appUserId, appUserId))
    .limit(1);

  const now = Date.now();
  const isActive =
    !!row &&
    row.isActive &&
    (!row.expiresAt || row.expiresAt.getTime() > now);

  res.json({
    appUserId,
    entitlement: row?.entitlementId ?? null,
    isActive,
    isInTrial: row?.isInTrial ?? false,
    willRenew: row?.willRenew ?? false,
    productId: row?.productId ?? null,
    expiresAt: row?.expiresAt ?? null,
    cancelledAt: row?.cancelledAt ?? null,
    store: row?.store ?? null,
  });
});

// ---- Sync endpoint ----------------------------------------------------

/**
 * Map RevenueCat v2 store identifier to the uppercase form the v1 webhook
 * persists. Keeps `subscribers.store` consistent regardless of which path
 * wrote the row last.
 */
function normalizeStore(s: RcSubscription["store"] | undefined): string | null {
  if (!s) return null;
  return s.toUpperCase();
}

/**
 * For each of OUR entitlements that's currently active (per RevenueCat),
 * pick the subscription that grants it and is currently providing access.
 * Returned in highest-tier-first order.
 */
function pickGrantingSubscription(
  entitlementId: string,
  subscriptions: RcSubscription[],
): RcSubscription | null {
  const matching = subscriptions.filter(
    (s) =>
      s.gives_access &&
      s.entitlements?.items?.some((e) => e.id === entitlementId),
  );
  if (matching.length === 0) return null;
  // Prefer the most recently started — handles re-purchase / re-subscribe.
  matching.sort(
    (a, b) => b.current_period_starts_at - a.current_period_starts_at,
  );
  return matching[0] ?? null;
}

/**
 * Authenticated, idempotent purchase-sync endpoint.
 *
 * Mobile calls this immediately after a successful RevenueCat purchase so
 * Premium unlocks without waiting on the webhook. The endpoint:
 *   1. Authenticates via the per-user bearer token (`requireUserAuth`).
 *   2. Asks RevenueCat for the customer's current active entitlements +
 *      subscriptions (RevenueCat is the source of truth).
 *   3. Picks the highest-tier OF OUR entitlements (snap_premium > snap_plus).
 *   4. Upserts the same `subscribers` row shape the webhook writes, using
 *      the same monotonicity guard.
 *
 * Safe to call repeatedly — the monotonicity guard prevents regression and
 * the upsert is idempotent. If the user has no active premium-tier
 * entitlement, returns `{ ok: true, entitlement: null }` without writing.
 */
router.post("/revenuecat/sync", async (req, res) => {
  const appUserId = await requireUserAuth(req, res);
  if (!appUserId) return;

  let activeEntitlements: RcCustomerEntitlement[];
  try {
    activeEntitlements = await listCustomerActiveEntitlements(appUserId);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      // RevenueCat has never seen this customer — nothing to sync.
      res.json({ ok: true, entitlement: null });
      return;
    }
    req.log?.error({ err, appUserId }, "revenuecat sync: active_entitlements lookup failed");
    res.status(502).json({ error: "revenuecat upstream error" });
    return;
  }

  // Pick the highest-tier supported entitlement that's currently active.
  let resolved: { entitlementId: SupportedEntitlementId; expiresAt: number | null } | null = null;
  for (const tier of SUPPORTED_ENTITLEMENT_IDS) {
    const match = activeEntitlements.find((e) => e.entitlement_id === tier);
    if (match) {
      resolved = { entitlementId: tier, expiresAt: match.expires_at };
      break;
    }
  }

  if (!resolved) {
    // No active premium-tier entitlement — nothing to upsert. We deliberately
    // do NOT write `isActive: false` here: the webhook handles entitlement
    // loss with full event context (cancelled vs expired vs refunded), and
    // overwriting it from a sync call would lose that nuance. Repeated
    // sync calls in this state are still idempotent (no-op).
    res.json({ ok: true, entitlement: null });
    return;
  }

  // Best-effort enrichment from the subscription list. If this fails we
  // still upsert with the entitlement we already know is active (so Premium
  // unlocks even if the secondary fetch fails).
  let subscription: RcSubscription | null = null;
  let subscriptionFetchFailed = false;
  try {
    const subs = await listCustomerSubscriptions(appUserId);
    subscription = pickGrantingSubscription(resolved.entitlementId, subs);
  } catch (err) {
    subscriptionFetchFailed = true;
    req.log?.warn(
      { err, appUserId },
      "revenuecat sync: subscriptions lookup failed — proceeding with entitlement-only upsert",
    );
  }

  // Pull the existing row so we can MERGE subscription enrichment over it.
  // This guarantees we never write weaker data than what's already stored:
  //   - If subscriptions fetch succeeded, the merge is a no-op (we use new
  //     values everywhere).
  //   - If subscriptions fetch failed (or returned no granting sub), we fall
  //     back to the existing row's metadata so the upsert never clobbers a
  //     richer webhook row with nulls.
  // Combined with `upsertSubscriberMonotonic`'s null-as-stale guard, this
  // makes repeated sync calls safe even under partial RevenueCat outages.
  const [existingRow] = await db
    .select()
    .from(subscribersTable)
    .where(eq(subscribersTable.appUserId, appUserId))
    .limit(1);

  // From-subscription if we have it, else preserve existing, else sensible
  // default. Only the "we definitely know this now" fields (entitlementId,
  // isActive, expiresAt) bypass the merge — the active_entitlements call is
  // authoritative for those.
  const subscriptionIsInTrial = subscription?.status === "trialing";
  const productId = subscription?.product_id ?? existingRow?.productId ?? null;
  const periodType = subscription
    ? subscriptionIsInTrial
      ? "TRIAL"
      : "NORMAL"
    : existingRow?.periodType ?? null;
  const store = subscription
    ? normalizeStore(subscription.store)
    : existingRow?.store ?? null;
  const willRenew = subscription
    ? subscription.auto_renewal_status === "will_renew" ||
      subscription.auto_renewal_status === "has_already_renewed"
    : existingRow?.willRenew ?? false;
  const isInTrial = subscription
    ? subscriptionIsInTrial
    : existingRow?.isInTrial ?? false;
  const originalPurchaseAt = subscription?.starts_at
    ? new Date(subscription.starts_at)
    : existingRow?.originalPurchaseAt ?? null;
  const latestPurchaseAt = subscription?.current_period_starts_at
    ? new Date(subscription.current_period_starts_at)
    : existingRow?.latestPurchaseAt ?? null;
  const unsubscribeDetectedAt = subscription
    ? subscription.auto_renewal_status === "will_not_renew"
      ? new Date()
      : null
    : existingRow?.unsubscribeDetectedAt ?? null;
  // The sync path does not learn the cancellation timestamp from RC
  // (`auto_renewal_status === will_not_renew` tells us the user cancelled
  // but not when). Preserve any cancelledAt the webhook may have written so
  // we don't accidentally clear it.
  const cancelledAt = existingRow?.cancelledAt ?? null;
  // Authoritative from active_entitlements; fall back to subscription /
  // existing only if active_entitlements didn't report an expiry.
  const expiresAt = resolved.expiresAt
    ? new Date(resolved.expiresAt)
    : subscription?.current_period_ends_at
    ? new Date(subscription.current_period_ends_at)
    : existingRow?.expiresAt ?? null;

  try {
    const outcome = await upsertSubscriberMonotonic({
      appUserId,
      entitlementId: resolved.entitlementId,
      isActive: true,
      productId,
      periodType,
      store,
      willRenew,
      isInTrial,
      originalPurchaseAt,
      latestPurchaseAt,
      expiresAt,
      unsubscribeDetectedAt,
      cancelledAt,
      rawCustomerInfo: {
        source: "sync",
        active_entitlements: activeEntitlements,
        subscription,
        subscriptionFetchFailed,
      },
    });

    res.json({
      ok: true,
      action: outcome.action,
      entitlement: {
        id: resolved.entitlementId,
        isActive: true,
        isInTrial,
        willRenew,
        expiresAt: expiresAt?.toISOString() ?? null,
        productId,
        store,
      },
    });
  } catch (err) {
    req.log?.error({ err, appUserId }, "revenuecat sync: upsert failed");
    res.status(500).json({ error: "internal" });
  }
});

export default router;
