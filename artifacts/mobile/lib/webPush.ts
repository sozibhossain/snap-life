/**
 * Browser-side Web Push opt-in / opt-out for Bone Buddy push notifications
 * when running as an installed PWA.
 *
 * Flow:
 *   1. User flips on the "Daily Bone Buddy nudge" toggle on web.
 *   2. We check that the browser supports Web Push and that the app is
 *      running in an installed PWA context (service worker available).
 *   3. We request `Notification` permission.
 *   4. We create a PushSubscription using the VAPID public key fetched
 *      from the server and subscribe the browser to the push service.
 *   5. We POST the subscription to the api-server so the Bone Buddy
 *      scheduler can later deliver nudges.
 *   6. We persist the opt-in state + endpoint in AsyncStorage so the
 *      toggle renders correctly on next open without re-querying the SW.
 *
 * Designed to never throw — the caller shows a friendly error instead.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { authHeader } from "./userToken";

const WEB_PUSH_PREF_PREFIX = "@snaplife/web-push/v1:";

export interface WebPushState {
  optedIn: boolean;
  endpoint: string | null;
}

const DEFAULT_WEB_PUSH_STATE: WebPushState = { optedIn: false, endpoint: null };

function webPushKey(appUserId: string | null | undefined): string {
  return `${WEB_PUSH_PREF_PREFIX}${appUserId ?? "anon"}`;
}

export async function loadWebPushState(
  appUserId: string | null | undefined,
): Promise<WebPushState> {
  try {
    const raw = await AsyncStorage.getItem(webPushKey(appUserId));
    if (!raw) return { ...DEFAULT_WEB_PUSH_STATE };
    const parsed = JSON.parse(raw) as Partial<WebPushState>;
    return {
      optedIn: !!parsed.optedIn,
      endpoint: typeof parsed.endpoint === "string" ? parsed.endpoint : null,
    };
  } catch {
    return { ...DEFAULT_WEB_PUSH_STATE };
  }
}

async function saveWebPushState(
  appUserId: string | null | undefined,
  state: WebPushState,
): Promise<void> {
  try {
    await AsyncStorage.setItem(webPushKey(appUserId), JSON.stringify(state));
  } catch {
    // Non-critical local state.
  }
}

function getApiBaseUrl(): string {
  const override = process.env.EXPO_PUBLIC_API_URL;
  if (override) return override.replace(/\/$/, "");
  return "";
}

/** Convert a base64url string to a Uint8Array for applicationServerKey. */
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output.buffer;
}

/** Fetch the VAPID public key from the server. Cached for the session. */
let cachedVapidKey: string | null = null;

async function getVapidPublicKey(): Promise<string | null> {
  if (cachedVapidKey) return cachedVapidKey;
  try {
    const r = await fetch(`${getApiBaseUrl()}/api/push/web/vapid-public-key`);
    if (!r.ok) return null;
    const json = (await r.json()) as { vapidPublicKey?: string };
    if (typeof json.vapidPublicKey === "string" && json.vapidPublicKey.length > 0) {
      cachedVapidKey = json.vapidPublicKey;
      return cachedVapidKey;
    }
    return null;
  } catch {
    return null;
  }
}

export type WebPushOptInOutcome =
  | { ok: true; endpoint: string }
  | {
      ok: false;
      reason:
        | "not_supported"
        | "sw_unavailable"
        | "permission_denied"
        | "vapid_unavailable"
        | "subscribe_failed"
        | "register_failed"
        | "no_user"
        | "auth_unavailable";
    };

/**
 * Opt the current browser in to Web Push. Returns an outcome object so
 * the caller can show appropriate error copy.
 */
export async function optInToWebPush(
  appUserId: string | null | undefined,
): Promise<WebPushOptInOutcome> {
  if (!appUserId) return { ok: false, reason: "no_user" };

  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return { ok: false, reason: "not_supported" };
  }

  // Ensure the service worker is ready.
  let swReg: ServiceWorkerRegistration;
  try {
    swReg = await navigator.serviceWorker.ready;
  } catch {
    return { ok: false, reason: "sw_unavailable" };
  }

  // Request notification permission.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: "permission_denied" };
  }

  // Fetch VAPID public key from server.
  const vapidKey = await getVapidPublicKey();
  if (!vapidKey) {
    return { ok: false, reason: "vapid_unavailable" };
  }

  // Subscribe to push.
  let subscription: PushSubscription;
  try {
    subscription = await swReg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });
  } catch {
    return { ok: false, reason: "subscribe_failed" };
  }

  const endpoint = subscription.endpoint;
  const p256dhKey = btoa(
    String.fromCharCode(
      ...new Uint8Array(subscription.getKey("p256dh") as ArrayBuffer),
    ),
  ).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const authKey = btoa(
    String.fromCharCode(
      ...new Uint8Array(subscription.getKey("auth") as ArrayBuffer),
    ),
  ).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  // Register with the api-server.
  try {
    const auth = await authHeader(appUserId);
    if (!auth.Authorization) return { ok: false, reason: "auth_unavailable" };
    const r = await fetch(`${getApiBaseUrl()}/api/push/web/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ endpoint, p256dhKey, authKey }),
    });
    if (!r.ok) return { ok: false, reason: "register_failed" };
  } catch {
    return { ok: false, reason: "register_failed" };
  }

  await saveWebPushState(appUserId, { optedIn: true, endpoint });
  return { ok: true, endpoint };
}

/**
 * Opt the current browser out of Web Push. Updates the server and clears
 * local state. Always updates local state even if the server call fails.
 */
export async function optOutOfWebPush(
  appUserId: string | null | undefined,
): Promise<void> {
  if (!appUserId) return;
  const state = await loadWebPushState(appUserId);

  // Unsubscribe from the browser push service.
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    try {
      const swReg = await navigator.serviceWorker.ready;
      const sub = await swReg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch {
      // Non-blocking.
    }
  }

  // Inform the server.
  if (state.endpoint) {
    try {
      const auth = await authHeader(appUserId);
      if (auth.Authorization) {
        await fetch(`${getApiBaseUrl()}/api/push/web/unregister`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...auth },
          body: JSON.stringify({ endpoint: state.endpoint }),
        });
      }
    } catch {
      // Non-blocking.
    }
  }

  await saveWebPushState(appUserId, { optedIn: false, endpoint: null });
}
