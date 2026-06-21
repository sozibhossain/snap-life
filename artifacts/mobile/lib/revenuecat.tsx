import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import React, { createContext, useContext, useEffect } from "react";
import { Platform } from "react-native";
import Purchases, {
  type CustomerInfo,
  type PurchasesEntitlementInfo,
  type PurchasesOffering,
  type PurchasesOfferings,
  type PurchasesPackage,
} from "react-native-purchases";
import { authHeader } from "./userToken";
import { getApiBaseUrl } from "./serverIdentity";

const REVENUECAT_TEST_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY;
const REVENUECAT_IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
const REVENUECAT_ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;

// Two entitlements gate features in SNAP Life:
//   snap_plus    -> SNAP Plus  (£4.99/mo, 1-month free trial via RC IAP offer)
//   snap_premium -> SNAP Premium (£9.99/mo, 1-month free trial via RC IAP offer)
// Either active entitlement => "premium-equivalent" full access. No active
// entitlement => the user is on the free post-trial tier.
// Annual plans removed — monthly only.
export const PLUS_ENTITLEMENT_IDENTIFIER = "snap_plus";
export const PREMIUM_ENTITLEMENT_IDENTIFIER = "snap_premium";

// Standard RevenueCat package identifiers used by our offering.
//   monthly  -> SNAP Plus Monthly    (£4.99/mo, 1-month free trial intro offer)
//   premium  -> SNAP Premium Monthly (£9.99/mo, 1-month free trial intro offer)
// Annual packages have been removed from the offering in RevenueCat and the
// App Store / Play Console. The intro offer (free month) is configured as an
// introductory price in App Store Connect / Google Play — payment details are
// required upfront; first charge occurs after 30 days unless cancelled.
export const SNAP_PLUS_PACKAGE_IDS = {
  monthly: "$rc_monthly",
  premium: "premium",
} as const;

export type SubscriptionTier = "free" | "trial" | "plus" | "premium";

export const TIER_LABELS: Record<SubscriptionTier, string> = {
  free: "Free",
  trial: "Free Trial",
  plus: "Plus",
  premium: "Premium",
};

// Trial length used for fall-back rendering when /subscription/me hasn't
// resolved yet. The server is the source of truth (see `trialLengthDays`
// in the response payload) so this constant just keeps the badge from
// flashing "Day X of NaN" on a cold start.
const TRIAL_LENGTH_DAYS = 30;

// Server cascade variants the dashboard renders. Names match the spec
// in the task brief — keep them stable, the TrialPromptCard reads them
// directly to choose copy/colour. The cascade itself lives in
// `./trialPromptVariant.ts` so it can be unit-tested without dragging
// in the React Native runtime.
import {
  computeTrialPromptVariant,
  type TrialPromptVariant,
} from "./trialPromptVariant";
export {
  computeTrialPromptVariant,
  type TrialPromptVariant,
} from "./trialPromptVariant";

/**
 * Shape returned by GET /api/subscription/me. Mirrors the OpenAPI
 * `UserSubscription` schema. We re-declare it here (rather than importing
 * the codegen type) so the mobile bundle doesn't have to pull in the
 * server schema package — react-native bundlers handle that less cleanly.
 */
interface ServerSubscription {
  tier: SubscriptionTier;
  isOnTrial: boolean;
  trialSource: "server" | "store" | null;
  trialDayOf: number | null;
  trialDaysRemaining: number | null;
  trialLengthDays: number;
  trialEndsAt: string | null;
  /**
   * ISO timestamp of a server trial that ended in the last 7 days WITHOUT
   * the user converting. Drives the one-time TrialEndedBanner. `null`
   * whenever there's no recent expired trial OR the user is on a paid
   * plan (the server already enforces both).
   */
  trialEndedAt: string | null;
  /**
   * Open billing-issue grace window, or null when payment is healthy.
   * The mobile dashboard surfaces a banner while this is set, asking the
   * user to update their payment method via the native subscription
   * management deep link.
   */
  billingIssue: {
    since: string;
    gracePeriodEndsAt: string;
  } | null;
}

/**
 * Tell our server to re-fetch the user's RevenueCat customer info and mirror
 * it into the `subscribers` table. Used to unlock Premium features instantly
 * after a successful purchase, without waiting for the RevenueCat → server
 * webhook (which can take seconds and is also subject to retries / Sandbox
 * delays). Idempotent and safe to call repeatedly — the server applies a
 * monotonicity guard against `latestPurchaseAt`.
 *
 * Fire-and-forget: the caller never awaits a meaningful result and any
 * failure is swallowed so the purchase UX stays snappy. The webhook remains
 * the source of truth and will eventually catch up.
 */
async function syncSubscriptionWithServer(
  appUserId: string | null | undefined,
): Promise<void> {
  if (!appUserId) return;
  if (Platform.OS === "web") return;
  const base = getApiBaseUrl();
  if (!base) return;
  try {
    const auth = await authHeader(appUserId);
    if (!auth.Authorization) return;
    await fetch(`${base}/api/revenuecat/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: "{}",
    });
  } catch {
    // Intentionally swallow — the webhook is still the source of truth.
  }
}

/**
 * Fetch the resolved subscription/trial state from our API. Returns `null`
 * if the request can't go through (no auth, no base URL, or a transport
 * error) so the rest of the hook can fall back to RevenueCat-only logic.
 */
async function fetchServerSubscription(
  appUserId: string | null,
): Promise<ServerSubscription | null> {
  if (!appUserId) return null;
  const base = getApiBaseUrl();
  // Web has no native RC SDK and no authHeader either — but the route
  // still works if we have a session. Try anyway; bail on no auth.
  try {
    const auth = await authHeader(appUserId);
    if (!auth.Authorization) return null;
    const url = base
      ? `${base}/api/subscription/me`
      : `/api/subscription/me`;
    const r = await fetch(url, {
      method: "GET",
      headers: { ...auth },
    });
    if (!r.ok) return null;
    const json = (await r.json()) as ServerSubscription;
    return json;
  } catch {
    return null;
  }
}

function getRevenueCatApiKey(): string | undefined {
  if (__DEV__ || Platform.OS === "web" || Constants.executionEnvironment === "storeClient") {
    return REVENUECAT_TEST_API_KEY;
  }
  if (Platform.OS === "ios") return REVENUECAT_IOS_API_KEY;
  if (Platform.OS === "android") return REVENUECAT_ANDROID_API_KEY;
  return REVENUECAT_TEST_API_KEY;
}

let initialized = false;

export function initializeRevenueCat() {
  if (initialized) return;
  const apiKey = getRevenueCatApiKey();
  if (!apiKey) {
    throw new Error(
      "RevenueCat API key not configured. Set EXPO_PUBLIC_REVENUECAT_TEST_API_KEY (and IOS/ANDROID for native builds).",
    );
  }
  if (__DEV__) {
    Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
  }
  Purchases.configure({ apiKey });
  initialized = true;
}

type IdentifyListener = (appUserId: string | null) => void;
const identifyListeners = new Set<IdentifyListener>();
let lastIdentifiedAppUserId: string | null = null;
function notifyIdentified(appUserId: string | null) {
  lastIdentifiedAppUserId = appUserId;
  for (const cb of identifyListeners) {
    try {
      cb(appUserId);
    } catch {
      /* ignore */
    }
  }
}

/** Convenience helper: log a user in / out so RevenueCat ties purchases to the right person. */
export async function identifyRevenueCatUser(appUserId: string | null) {
  if (!initialized) {
    notifyIdentified(appUserId);
    return;
  }
  try {
    if (appUserId) {
      await Purchases.logIn(appUserId);
    } else {
      await Purchases.logOut();
    }
  } catch {
    // Fail silently — anonymous IDs still work for purchases.
  } finally {
    notifyIdentified(appUserId);
  }
}

/** Active "highest-value" entitlement, prefering Premium over Plus. */
function pickActiveEntitlement(info?: CustomerInfo): PurchasesEntitlementInfo | undefined {
  const active = info?.entitlements?.active;
  if (!active) return undefined;
  return active[PREMIUM_ENTITLEMENT_IDENTIFIER] ?? active[PLUS_ENTITLEMENT_IDENTIFIER];
}

function isInStoreTrial(ent?: PurchasesEntitlementInfo): boolean {
  if (!ent) return false;
  // RevenueCat marks trial periods explicitly. Check both fields because the
  // string casing differs across SDK versions.
  const period = (ent.periodType as unknown as string) ?? "";
  return period === "TRIAL" || period === "trial" || period === "intro";
}

/**
 * In development (`__DEV__`) every subscription gate is bypassed so the
 * full app is reviewable without a real RevenueCat entitlement. This flag
 * has no effect in production builds.
 */
const DEV_UNLOCK_ALL = __DEV__;

const DEV_SUBSCRIPTION: SubscriptionContextValue = {
  isSubscribed: true,
  entitlement: undefined,
  customerInfo: undefined,
  offering: null,
  tier: "premium",
  tierLabel: "Premium",
  hasPremiumOrTrial: true,
  hasPlusOrAbove: true,
  isOnTrial: false,
  trialSource: null,
  trialDayOf: null,
  trialDayLabel: null,
  trialDaysRemaining: null,
  trialLengthDays: 30,
  trialEndsAt: null,
  trialEndedAt: null,
  billingIssue: null,
  trialPromptVariant: null,
  shouldShowMidTrialEncouragement: false,
  shouldShowPaymentPrompt: false,
  shouldShowEndOfTrialPrompt: false,
  isLoading: false,
  error: null,
  purchase: async () => { throw new Error("Purchases disabled in dev"); },
  isPurchasing: false,
  purchaseError: null,
  restore: async () => { throw new Error("Restore disabled in dev"); },
  isRestoring: false,
  refresh: () => {},
} as unknown as SubscriptionContextValue;

function useSubscriptionContext() {
  const queryClient = useQueryClient();

  const customerInfoQuery = useQuery<CustomerInfo>({
    queryKey: ["revenuecat", "customer-info"],
    queryFn: () => Purchases.getCustomerInfo(),
    staleTime: 60 * 1000,
    enabled: initialized,
  });

  const offeringsQuery = useQuery<PurchasesOfferings>({
    queryKey: ["revenuecat", "offerings"],
    queryFn: () => Purchases.getOfferings(),
    staleTime: 5 * 60 * 1000,
    enabled: initialized,
  });

  // Track the currently-identified user so the server-state query has a
  // stable cache key. We listen on identify events because RC's
  // `getAppUserID()` requires `initialized = true` and we want this to
  // work in environments (e.g. Jest, web) where RC isn't configured.
  const [appUserId, setAppUserId] = React.useState<string | null>(
    lastIdentifiedAppUserId,
  );
  useEffect(() => {
    const cb = (id: string | null) => setAppUserId(id);
    identifyListeners.add(cb);
    // If an identify already happened before we mounted, sync immediately.
    if (lastIdentifiedAppUserId !== appUserId) {
      setAppUserId(lastIdentifiedAppUserId);
    }
    return () => {
      identifyListeners.delete(cb);
    };
    // appUserId omitted on purpose — initial sync only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const serverSubscriptionQuery = useQuery<ServerSubscription | null>({
    queryKey: ["server", "subscription", appUserId],
    queryFn: () => fetchServerSubscription(appUserId),
    // Trial day-of advances at most once per day; refetch hourly so Day-X
    // labels stay current without spamming the server. Background refetch
    // on focus picks up purchases that completed via App Store sheet.
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: true,
    enabled: !!appUserId,
  });

  const purchaseMutation = useMutation({
    mutationFn: async (pkg: PurchasesPackage) => {
      const result = await Purchases.purchasePackage(pkg);
      return result.customerInfo;
    },
    onSuccess: (info) => {
      queryClient.setQueryData(["revenuecat", "customer-info"], info);
      // Mirror the new entitlement into our `subscribers` table immediately
      // so server-side gates (chat adaptive tone, Premium-only features)
      // unlock without waiting for the webhook. Fire-and-forget; the
      // monotonicity guard makes repeated calls safe.
      const userId =
        info?.originalAppUserId && !info.originalAppUserId.startsWith("$RCAnonymousID:")
          ? info.originalAppUserId
          : null;
      void syncSubscriptionWithServer(userId);
      // The server-managed trial flips to "store" / "paid" after the
      // purchase, so re-fetch /subscription/me too.
      queryClient.invalidateQueries({ queryKey: ["server", "subscription"] });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async () => Purchases.restorePurchases(),
    onSuccess: (info) => {
      queryClient.setQueryData(["revenuecat", "customer-info"], info);
      const userId =
        info?.originalAppUserId && !info.originalAppUserId.startsWith("$RCAnonymousID:")
          ? info.originalAppUserId
          : null;
      void syncSubscriptionWithServer(userId);
      queryClient.invalidateQueries({ queryKey: ["server", "subscription"] });
    },
  });

  // After every login/logout, the cached CustomerInfo belongs to the previous
  // identity — invalidate so we re-fetch with the new app_user_id.
  useEffect(() => {
    const cb = () => {
      queryClient.invalidateQueries({ queryKey: ["revenuecat", "customer-info"] });
      queryClient.invalidateQueries({ queryKey: ["revenuecat", "offerings"] });
      queryClient.invalidateQueries({ queryKey: ["server", "subscription"] });
    };
    identifyListeners.add(cb);
    return () => {
      identifyListeners.delete(cb);
    };
  }, [queryClient]);

  // Re-fetch CustomerInfo on every native update (renewals, cancels, etc.)
  useEffect(() => {
    if (!initialized) return;
    const listener = (info: CustomerInfo) => {
      queryClient.setQueryData(["revenuecat", "customer-info"], info);
      queryClient.invalidateQueries({ queryKey: ["server", "subscription"] });
    };
    Purchases.addCustomerInfoUpdateListener(listener);
    return () => {
      const remove = (Purchases as unknown as {
        removeCustomerInfoUpdateListener?: (l: (info: CustomerInfo) => void) => void;
      }).removeCustomerInfoUpdateListener;
      remove?.(listener);
    };
  }, [queryClient]);

  const customerInfo = customerInfoQuery.data;
  const offering: PurchasesOffering | null = offeringsQuery.data?.current ?? null;
  const serverSub = serverSubscriptionQuery.data ?? null;

  const entitlement = pickActiveEntitlement(customerInfo);
  // RevenueCat-driven flags. These are `true` only when the user holds a
  // real store-side entitlement — they don't see the server-managed trial
  // because it lives only in our database.
  const rcHasPremium = !!customerInfo?.entitlements?.active?.[PREMIUM_ENTITLEMENT_IDENTIFIER];
  const rcHasPlus = !!customerInfo?.entitlements?.active?.[PLUS_ENTITLEMENT_IDENTIFIER];
  const activeEntitlements = Object.values(customerInfo?.entitlements?.active ?? {});
  const rcInTrial = activeEntitlements.some((e) => isInStoreTrial(e));

  // Server cascade rules:
  //   1. Real store purchase wins (server response will already be plus/premium).
  //   2. Server trial supplies Premium-equivalent access until trialEndsAt.
  //   3. RC entitlement still wins for everything we can't see server-side
  //      (e.g. user purchased moments ago and webhook hasn't landed).
  // We OR the two sources so the UI never under-reports Premium access.
  const serverInTrial = !!serverSub?.isOnTrial;
  const serverTier = serverSub?.tier ?? null;

  const hasPremium =
    rcHasPremium || serverTier === "premium" || (serverInTrial && serverSub?.trialSource === "server");
  const hasPlus = rcHasPlus || serverTier === "plus";
  const inTrial = rcInTrial || serverInTrial;
  const isSubscribed = hasPremium || hasPlus || inTrial;

  // Tier resolution preserves plan identity so UI can correctly differentiate
  // a paid Plus subscriber from a paid Premium subscriber:
  //   In trial              -> "trial"
  //   snap_premium active   -> "premium"
  //   snap_plus active      -> "plus"
  //   No active entitlement -> "free"
  // The server response already encodes the right cascade for the trial
  // case, so prefer it when present and fall back to RC-derived state.
  const tier: SubscriptionTier = inTrial
    ? "trial"
    : serverTier && serverTier !== "trial"
    ? serverTier
    : rcHasPremium
    ? "premium"
    : rcHasPlus
    ? "plus"
    : "free";

  // Trial length & day-of. The server is authoritative for both because
  // store-side trials are pure intro pricing (no `Day X of N` displayed
  // there); fall back to RC's `expirationDate` only if the server hasn't
  // resolved yet, so we never block the badge on a cold network.
  const trialLengthDays = serverSub?.trialLengthDays ?? TRIAL_LENGTH_DAYS;
  let dayOfTrial: number | null = serverSub?.trialDayOf ?? null;
  let daysRemaining: number | null = serverSub?.trialDaysRemaining ?? null;

  if (dayOfTrial === null && rcInTrial && entitlement?.expirationDate) {
    // RC store trial: derive day-of from expirationDate. Length defaults
    // to 30 (matches our headline trial). Clamp defensively.
    const ms = new Date(entitlement.expirationDate).getTime() - Date.now();
    const remaining = Math.max(
      0,
      Math.min(trialLengthDays, Math.ceil(ms / 86_400_000)),
    );
    daysRemaining = remaining;
    dayOfTrial = Math.max(
      1,
      Math.min(trialLengthDays, trialLengthDays - remaining + 1),
    );
  }

  const trialDayLabel =
    dayOfTrial !== null ? `Day ${dayOfTrial} of ${trialLengthDays}` : null;

  // ----- TrialPromptCard cascade (see computeTrialPromptVariant below) -----
  const trialPromptVariant: TrialPromptVariant | null =
    computeTrialPromptVariant(inTrial, dayOfTrial);

  return {
    /** True if any premium entitlement is currently active (incl. trial). */
    isSubscribed,
    /** Active store entitlement object, if any (period type, expiration, etc.) */
    entitlement,
    /** Full RevenueCat CustomerInfo object */
    customerInfo,
    /** The current offering — source of truth for prices & packages. */
    offering,
    /** Resolved user tier: free / trial / plus / premium. */
    tier,
    tierLabel: TIER_LABELS[tier],
    /** True if the user has Premium-tier access (paid Premium OR on trial). */
    hasPremiumOrTrial: hasPremium || inTrial,
    /** True if the user has Plus-or-better access (paid Plus, Premium, or trial). */
    hasPlusOrAbove: hasPlus || hasPremium || inTrial,
    /** True if currently inside any trial (server or store). */
    isOnTrial: inTrial,
    /** Origin of the trial: "server" / "store" / null. */
    trialSource: serverSub?.trialSource ?? (rcInTrial ? "store" : null),
    /** Day-of-trial as a number (1..trialLengthDays), or null if not in trial. */
    trialDayOf: dayOfTrial,
    /** "Day 14 of 30" or null if not in trial. */
    trialDayLabel,
    /** 0..trialLengthDays or null if not in trial. */
    trialDaysRemaining: daysRemaining,
    /** Total trial length in days (for badge formatting). */
    trialLengthDays,
    /** ISO trialEndsAt (server-managed only) — used for dismissal cycle keying. */
    trialEndsAt: serverSub?.trialEndsAt ?? entitlement?.expirationDate ?? null,
    /**
     * ISO timestamp of a recently-ended server trial (within last 7 days,
     * user not yet on a paid plan). Used by TrialEndedBanner; `null`
     * otherwise.
     */
    trialEndedAt: serverSub?.trialEndedAt ?? null,
    /**
     * Open billing-issue grace window from /subscription/me, or null. The
     * server keeps `isActive=true` and the user retains access until
     * `gracePeriodEndsAt` elapses (default 3d, env BILLING_GRACE_DAYS).
     */
    billingIssue: serverSub?.billingIssue ?? null,
    /** Which TrialPromptCard variant (if any) the dashboard should render. */
    trialPromptVariant,
    /** Mid-trial encouragement (Day 14). */
    shouldShowMidTrialEncouragement: trialPromptVariant === "midTrialEncouragement",
    /** "Add payment details" prompt (Day 15..21). */
    shouldShowPaymentPrompt: trialPromptVariant === "payment",
    /** Pre-trial-end urgency prompt (Day 25..28). */
    shouldShowEndOfTrialPrompt: trialPromptVariant === "endOfTrial",
    isLoading: customerInfoQuery.isLoading || offeringsQuery.isLoading,
    error: customerInfoQuery.error || offeringsQuery.error,
    purchase: purchaseMutation.mutateAsync,
    isPurchasing: purchaseMutation.isPending,
    purchaseError: purchaseMutation.error as Error | null,
    restore: restoreMutation.mutateAsync,
    isRestoring: restoreMutation.isPending,
    refresh: () => {
      customerInfoQuery.refetch();
      offeringsQuery.refetch();
      serverSubscriptionQuery.refetch();
    },
  };
}

type SubscriptionContextValue = ReturnType<typeof useSubscriptionContext>;
const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const value = useSubscriptionContext();
  const resolved = DEV_UNLOCK_ALL
    ? (DEV_SUBSCRIPTION as unknown as SubscriptionContextValue)
    : value;
  return <SubscriptionContext.Provider value={resolved}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error("useSubscription must be used within a SubscriptionProvider");
  return ctx;
}

/** Helpers to format package data for the paywall UI. */
export function findPackage(
  offering: PurchasesOffering | null,
  packageIdentifier: string,
): PurchasesPackage | undefined {
  if (!offering) return undefined;
  return offering.availablePackages.find(
    (p) => p.identifier === packageIdentifier,
  );
}

// ---- Singleton query client guard -------------------------------------
// Prevents accidental re-creation if this file is hot-reloaded.
let _qc: QueryClient | undefined;
export function getOrCreateQueryClient(): QueryClient {
  if (!_qc) _qc = new QueryClient();
  return _qc;
}
