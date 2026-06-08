/**
 * Mobile-side opt-in / opt-out for Bone Buddy push notifications.
 *
 * Flow:
 *   1. User flips on the "Daily Bone Buddy nudge" toggle.
 *   2. We request OS-level notification permission.
 *   3. On grant, we obtain an Expo push token and POST it to the api-server
 *      (with the user's bearer token attached) so the server can later send
 *      ≤1 personalised push per 24h.
 *   4. We persist the user's preference + the token id locally so the UI
 *      can re-render without re-asking the OS each time.
 *
 * Designed to no-op gracefully on web (Expo notifications are mobile-only)
 * and to never throw — the caller can show a friendly error instead.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { authHeader } from "./userToken";

const PREF_KEY_PREFIX = "@snaplife/push/v1:";

export interface PushOptInState {
  /** Last known user preference. May be true even if OS-level permission
   *  was later revoked — the UI re-checks permission on next interaction. */
  optedIn: boolean;
  /** Most recent Expo token we registered, if any. Used to unregister. */
  token: string | null;
  /** Has the user ever been asked? Drives the "ask" vs "manage" copy. */
  hasBeenAsked: boolean;
}

const DEFAULT_STATE: PushOptInState = {
  optedIn: false,
  token: null,
  hasBeenAsked: false,
};

function keyFor(appUserId: string | null | undefined): string {
  return `${PREF_KEY_PREFIX}${appUserId ?? "anon"}`;
}

function getApiBaseUrl(): string {
  const override = process.env.EXPO_PUBLIC_API_URL;
  if (override) return override.replace(/\/$/, "");
  if (Platform.OS === "web") return "";
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) return "";
  return domain.startsWith("http") ? domain : `https://${domain}`;
}

/**
 * Narrow accessors for the bits of `expo-constants` we need. The official
 * types (`ExpoConfig`) declare `extra` as `Record<string, any>`, so we
 * model the small slice we actually read here without resorting to `any`.
 */
interface ExpoConfigShape {
  extra?: { eas?: { projectId?: string | null } | null } | null;
}
interface ExpoLegacyEasConfig {
  easConfig?: { projectId?: string | null } | null;
}

function readEasProjectId(): string | undefined {
  const cfg: ExpoConfigShape | null | undefined =
    Constants.expoConfig as ExpoConfigShape | null | undefined;
  const fromExpoConfig = cfg?.extra?.eas?.projectId;
  if (typeof fromExpoConfig === "string" && fromExpoConfig.length > 0) {
    return fromExpoConfig;
  }
  // Fall back to the older `Constants.easConfig` shape used by some Expo
  // SDK versions / dev clients.
  const legacy = Constants as unknown as ExpoLegacyEasConfig;
  const fromLegacy = legacy.easConfig?.projectId;
  if (typeof fromLegacy === "string" && fromLegacy.length > 0) {
    return fromLegacy;
  }
  return undefined;
}

export async function loadPushState(appUserId: string | null | undefined): Promise<PushOptInState> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(appUserId));
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<PushOptInState>;
    return {
      optedIn: !!parsed.optedIn,
      token: typeof parsed.token === "string" ? parsed.token : null,
      hasBeenAsked: !!parsed.hasBeenAsked,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

async function savePushState(appUserId: string | null | undefined, state: PushOptInState): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(appUserId), JSON.stringify(state));
  } catch {
    // Soft-fail — preference is non-critical local state.
  }
}

export type OptInOutcome =
  | { ok: true; token: string }
  | {
      ok: false;
      reason:
        | "web_unsupported"
        | "no_user"
        | "no_device"
        | "permission_denied"
        | "token_unavailable"
        | "register_failed"
        | "auth_unavailable";
    };

/**
 * Opt this device in: request OS permission, fetch the Expo push token,
 * register it with the api-server, and persist the local preference.
 */
export async function optInToBoneBuddyPush(appUserId: string | null | undefined): Promise<OptInOutcome> {
  if (Platform.OS === "web") return { ok: false, reason: "web_unsupported" };
  if (!appUserId) return { ok: false, reason: "no_user" };
  if (!Device.isDevice) return { ok: false, reason: "no_device" };

  // 1) Permission. Only ask if not already determined.
  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.status === "granted";
  if (!granted) {
    const requested = await Notifications.requestPermissionsAsync();
    granted = requested.status === "granted";
  }
  await markAsked(appUserId);
  if (!granted) return { ok: false, reason: "permission_denied" };

  // 2) Token. Expo SDK ≥48 requires a projectId for getExpoPushTokenAsync.
  const projectId = readEasProjectId();
  let token: string;
  try {
    const t = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    token = t.data;
    if (!token) return { ok: false, reason: "token_unavailable" };
  } catch {
    return { ok: false, reason: "token_unavailable" };
  }

  // 3) Register with the server (authed).
  try {
    const auth = await authHeader(appUserId);
    if (!auth.Authorization) return { ok: false, reason: "auth_unavailable" };
    const r = await fetch(`${getApiBaseUrl()}/api/push/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ expoToken: token, platform: Platform.OS }),
    });
    if (!r.ok) return { ok: false, reason: "register_failed" };
  } catch {
    return { ok: false, reason: "register_failed" };
  }

  // 4) Persist preference + Android channel for nice presentation.
  if (Platform.OS === "android") {
    try {
      await Notifications.setNotificationChannelAsync("bone-buddy", {
        name: "Bone Buddy",
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: "default",
        showBadge: true,
      });
    } catch {
      // non-fatal
    }
  }
  await savePushState(appUserId, { optedIn: true, token, hasBeenAsked: true });
  return { ok: true, token };
}

/**
 * Opt this device out — flips the server flag and clears the local pref.
 * Always succeeds locally so the UI can update immediately.
 */
export async function optOutOfBoneBuddyPush(appUserId: string | null | undefined): Promise<void> {
  if (!appUserId) return;
  const state = await loadPushState(appUserId);
  if (state.token) {
    try {
      const auth = await authHeader(appUserId);
      if (auth.Authorization) {
        await fetch(`${getApiBaseUrl()}/api/push/unregister`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...auth },
          body: JSON.stringify({ expoToken: state.token }),
        });
      }
    } catch {
      // Non-blocking — local state is the source of truth for UX.
    }
  }
  await savePushState(appUserId, { ...state, optedIn: false });
}

async function markAsked(appUserId: string | null | undefined): Promise<void> {
  const state = await loadPushState(appUserId);
  if (!state.hasBeenAsked) {
    await savePushState(appUserId, { ...state, hasBeenAsked: true });
  }
}
