/**
 * openManageSubscription — open the user's native subscription
 * management page.
 *
 * Prefers the RevenueCat-provided `managementURL` when available (this
 * is the most accurate deep link, accounting for the actual purchase
 * store on the customer's account). Falls back to the platform default
 * page when we don't know the store yet — used by the BillingIssue
 * banner CTA when a payment retry has failed and the user needs to
 * update their card.
 */

import { Linking, Platform } from "react-native";

interface OpenManageOptions {
  managementUrl?: string | null;
  /** RevenueCat entitlement.store: "APP_STORE" | "PLAY_STORE" | ... */
  purchaseStore?: string | null;
}

const APPLE_URL = "https://apps.apple.com/account/subscriptions";
const GOOGLE_URL = "https://play.google.com/store/account/subscriptions";

export function openManageSubscription(opts: OpenManageOptions = {}): void {
  const { managementUrl, purchaseStore } = opts;
  if (managementUrl) {
    Linking.openURL(managementUrl).catch(() => {});
    return;
  }
  const fallback =
    purchaseStore === "APP_STORE" ||
    (!purchaseStore && Platform.OS === "ios")
      ? APPLE_URL
      : purchaseStore === "PLAY_STORE" ||
        (!purchaseStore && Platform.OS === "android")
      ? GOOGLE_URL
      : APPLE_URL;
  Linking.openURL(fallback).catch(() => {});
}
