import { useAuth as useClerkAuth, useClerk, useUser } from "@clerk/expo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import {
  fetchAppIdentity,
  postAuthLink,
  resolveApiBase,
} from "@/lib/serverIdentity";
import { getUserToken } from "@/lib/userToken";
import { runLegacyMigration } from "@/lib/userMigration";
import {
  applySnapshotToAsyncStorage,
  enqueueSync,
  flushQueue,
  migrateQueueOwner,
  pullSnapshot,
  SyncPaths,
} from "@/lib/syncClient";
import { runSyncMigration, syncMigrationKey } from "@/lib/syncMigration";

/**
 * Tell the PWA service worker to purge every per-user `/api/*` cache
 * partition. The SW already partitions API responses by Authorization
 * header hash, so cross-user leaks aren't possible — this is the
 * belt-and-suspenders cleanup that frees disk and removes stale data
 * for the previous user the moment they sign out. No-op on native.
 */
function notifyServiceWorkerAuthChange() {
  if (Platform.OS !== "web") return;
  try {
    const sw =
      typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    sw?.controller?.postMessage({ type: "snaplife/auth-change" });
  } catch {
    // Service workers aren't available in every web context (e.g.
    // private windows, file:// previews). The cache partition guarantee
    // still holds even if we can't post the message.
  }
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  /** Given name, captured during onboarding. */
  firstName?: string;
  /** Family name, captured during onboarding. */
  lastName?: string;
  /** ISO date string (YYYY-MM-DD). Age is derived from this at render time. */
  dateOfBirth?: string;
  /** Free-text city / town / region the user provides (distinct from the ISO `country` code). */
  location?: string;
  age?: number;
  gender?: string;
  condition?: "osteoporosis" | "osteopenia" | "at_risk" | "healthy";
  joinedAt: string;
  level: number;
  xp: number;
  xpToNextLevel: number;
  streakDays: number;
  totalPoints: number;
  /** ISO-3166-1 alpha-2 country code (e.g. `GB`, `US`). */
  country?: string;
  /** IANA timezone (e.g. `Europe/London`); auto-detected on first launch. */
  timezone?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isOnboarded: boolean;
  isAdmin: boolean;
  isTester: boolean;
  isIdentityResolved: boolean;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<User>) => Promise<void>;
  completeOnboarding: (data: Partial<User>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const PROFILE_KEY_PREFIX = "@snaplife/profile/v1:";
const ONBOARDED_KEY_PREFIX = "@snaplife/onboarded/v1:";
const MIGRATION_KEY_PREFIX = "@snaplife/migrated/v1:";
const APPUSER_KEY_PREFIX = "@snaplife/appUserId/v1:";
const ARCHIVE_KEY_PREFIX = "@snaplife/legacyArchive/v1:";
const REMEMBER_ME_KEY = "@snaplife/rememberMe/v1";
const LEGACY_USER_KEY = "snap_user";
const LEGACY_ONBOARDED_KEY = "snap_onboarded";

function profileKey(clerkUserId: string): string {
  return `${PROFILE_KEY_PREFIX}${clerkUserId}`;
}
function onboardedKey(clerkUserId: string): string {
  return `${ONBOARDED_KEY_PREFIX}${clerkUserId}`;
}
function migrationKey(clerkUserId: string): string {
  return `${MIGRATION_KEY_PREFIX}${clerkUserId}`;
}
function appUserIdKey(clerkUserId: string): string {
  return `${APPUSER_KEY_PREFIX}${clerkUserId}`;
}
function archiveKey(clerkUserId: string): string {
  return `${ARCHIVE_KEY_PREFIX}${clerkUserId}`;
}

interface StoredProfile {
  name?: string;
  email?: string;
  avatar?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  location?: string;
  age?: number;
  gender?: string;
  condition?: User["condition"];
  joinedAt?: string;
  level?: number;
  xp?: number;
  xpToNextLevel?: number;
  streakDays?: number;
  totalPoints?: number;
  country?: string;
  timezone?: string;
}

/**
 * Best-effort device timezone (IANA). Falls back to `UTC` on platforms
 * where `Intl.DateTimeFormat().resolvedOptions().timeZone` returns
 * undefined (very old Android web views, Hermes builds without ICU).
 */
function deviceTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof tz === "string" && tz.length > 0) return tz;
  } catch {
    // fall through
  }
  return "UTC";
}

function freshProfile(): Required<
  Pick<
    StoredProfile,
    "joinedAt" | "level" | "xp" | "xpToNextLevel" | "streakDays" | "totalPoints"
  >
> {
  return {
    joinedAt: new Date().toISOString().split("T")[0],
    level: 1,
    xp: 0,
    xpToNextLevel: 500,
    streakDays: 0,
    totalPoints: 0,
  };
}

function buildUser(args: {
  appUserId: string;
  clerkName: string;
  clerkEmail: string;
  profile: StoredProfile | null;
}): User {
  const base = freshProfile();
  const p = args.profile ?? {};
  // Prefer stored firstName + lastName for the display name so onboarding
  // choices take precedence over the Clerk-synced full name.
  const derivedName =
    [p.firstName, p.lastName].filter(Boolean).join(" ").trim() ||
    p.name?.trim() ||
    args.clerkName ||
    args.clerkEmail.split("@")[0] ||
    "";
  return {
    id: args.appUserId,
    name: derivedName,
    email: args.clerkEmail || p.email || "",
    avatar: p.avatar,
    firstName: typeof p.firstName === "string" ? p.firstName : undefined,
    lastName: typeof p.lastName === "string" ? p.lastName : undefined,
    dateOfBirth: typeof p.dateOfBirth === "string" ? p.dateOfBirth : undefined,
    location: typeof p.location === "string" ? p.location : undefined,
    age: p.age,
    gender: p.gender,
    condition: p.condition,
    joinedAt: p.joinedAt || base.joinedAt,
    level: typeof p.level === "number" ? p.level : base.level,
    xp: typeof p.xp === "number" ? p.xp : base.xp,
    xpToNextLevel:
      typeof p.xpToNextLevel === "number" ? p.xpToNextLevel : base.xpToNextLevel,
    streakDays: typeof p.streakDays === "number" ? p.streakDays : base.streakDays,
    totalPoints:
      typeof p.totalPoints === "number" ? p.totalPoints : base.totalPoints,
    country: typeof p.country === "string" ? p.country : undefined,
    // First launch on this device: seed timezone from the device so
    // server-side per-day rollups (events, etc.) are aligned to the
    // user's local clock without forcing them through a settings screen.
    timezone:
      typeof p.timezone === "string" && p.timezone.length > 0
        ? p.timezone
        : deviceTimezone(),
  };
}

function userToStoredProfile(u: User): StoredProfile {
  return {
    name: u.name,
    email: u.email,
    avatar: u.avatar,
    firstName: u.firstName,
    lastName: u.lastName,
    dateOfBirth: u.dateOfBirth,
    location: u.location,
    age: u.age,
    gender: u.gender,
    condition: u.condition,
    joinedAt: u.joinedAt,
    level: u.level,
    xp: u.xp,
    xpToNextLevel: u.xpToNextLevel,
    streakDays: u.streakDays,
    totalPoints: u.totalPoints,
    country: u.country,
    timezone: u.timezone,
  };
}

const ME_RETRY_DELAYS_MS = [0, 500, 1500];

async function resolveAppIdentityWithRetry(
  getSessionToken: () => Promise<string | null>,
  shouldCancel: () => boolean,
) {
  for (const delay of ME_RETRY_DELAYS_MS) {
    if (shouldCancel()) return null;
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    if (shouldCancel()) return null;
    let token: string | null = null;
    try {
      token = await getSessionToken();
    } catch (err) {
      console.warn("[auth] getToken failed during identity resolve", err);
    }
    if (shouldCancel()) return null;
    const identity = await fetchAppIdentity(token);
    if (identity) return identity;
  }
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded: clerkLoaded, isSignedIn, getToken } = useClerkAuth();
  const { user: clerkUser } = useUser();
  const clerk = useClerk();

  const [user, setUser] = useState<User | null>(null);
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isTester, setIsTester] = useState(false);
  const [isIdentityResolved, setIsIdentityResolved] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [rememberMeChecked, setRememberMeChecked] = useState(false);

  const hydratedClerkIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!clerkLoaded || rememberMeChecked) return;
    let cancelled = false;
    (async () => {
      try {
        if (isSignedIn) {
          const remember = await AsyncStorage.getItem(REMEMBER_ME_KEY);
          if (remember === "false") {
            await AsyncStorage.removeItem(REMEMBER_ME_KEY);
            await clerk.signOut();
            notifyServiceWorkerAuthChange();
          }
        }
      } catch (err) {
        console.warn("[auth] remember-me check failed", err);
      } finally {
        if (!cancelled) setRememberMeChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clerkLoaded, isSignedIn, rememberMeChecked, clerk]);

  useEffect(() => {
    if (!clerkLoaded || !rememberMeChecked) return;

    if (!isSignedIn || !clerkUser) {
      hydratedClerkIdRef.current = null;
      setUser(null);
      setIsOnboarded(false);
      setIsAdmin(false);
      setIsIdentityResolved(false);
      setProfileLoaded(true);
      return;
    }

    const clerkUserId = clerkUser.id;
    let cancelled = false;
    const shouldCancel = () => cancelled;
    setProfileLoaded(false);

    // Server sync bootstrap (migration walk → flush → snapshot pull →
    // local cache write). MUST only run with a CANONICAL appUserId —
    // we previously also ran it with the provisional clerkUserId
    // fallback when /auth/me retries failed, which silently wrote
    // snapshot data into the wrong AsyncStorage namespace
    // (`snap_nutrition:${clerkUserId}` vs `snap_nutrition:${appUserId}`)
    // and made the contexts look empty after identity finally
    // resolved. Tracked per-id so we don't re-run if the cached and
    // freshly-resolved ids match.
    const bootstrappedRef = { current: null as string | null };
    const bootstrapServerSync = async (
      appUserId: string,
      apiBaseUrl: string,
    ): Promise<void> => {
      if (bootstrappedRef.current === appUserId) return;
      bootstrappedRef.current = appUserId;
      const getAuthHeader = async (): Promise<string | null> => {
        try {
          const t = await getToken();
          return t ? `Bearer ${t}` : null;
        } catch {
          return null;
        }
      };
      try {
        await runSyncMigration({
          appUserId,
          clerkUserId,
          deps: {
            readKey: (k) => AsyncStorage.getItem(k),
            hasMigrated: async (id) =>
              (await AsyncStorage.getItem(syncMigrationKey(id))) === "true",
            markMigrated: async (id) => {
              await AsyncStorage.setItem(syncMigrationKey(id), "true");
            },
            // enqueueSync now returns a Promise; the walker awaits
            // each one so the marker is only set after every item
            // is durably persisted to the queue.
            enqueue: (a) => enqueueSync(a),
          },
        });
      } catch (err) {
        console.warn("[sync] migration walk failed", err);
      }
      // Drain the queue BEFORE pulling the snapshot. On a first-
      // device migration this pushes every legacy row to the server
      // so the snapshot we then pull mirrors what we just sent —
      // which avoids an empty server snapshot overwriting a richer
      // local cache. Best-effort: a network failure leaves us on
      // the local cache and we re-converge on the next 30s flush.
      try {
        await flushQueue({ appUserId, apiBaseUrl, getAuthHeader });
      } catch (err) {
        console.warn("[sync] pre-snapshot flush failed", err);
      }
      try {
        const snap = await pullSnapshot({ apiBaseUrl, getAuthHeader });
        if (snap) {
          await applySnapshotToAsyncStorage({
            snapshot: snap,
            appUserId,
            clerkUserId,
          });
        }
      } catch (err) {
        console.warn("[sync] snapshot pull failed", err);
      }
    };

    (async () => {
      let migrationBlocked = false;
      try {
        const migrationStatus = await runLegacyMigration(clerkUserId, {
          getLegacyProfile: async () => {
            const raw = await AsyncStorage.getItem(LEGACY_USER_KEY);
            if (!raw) return null;
            try {
              return JSON.parse(raw);
            } catch {
              return null;
            }
          },
          getLegacyOnboarded: async () =>
            (await AsyncStorage.getItem(LEGACY_ONBOARDED_KEY)) === "true",
          getLegacyToken: (legacyAppUserId) => getUserToken(legacyAppUserId),
          getClerkSessionToken: () => getToken(),
          postLink: postAuthLink,
          saveProfile: async (cid, profile, onboarded) => {
            await AsyncStorage.setItem(profileKey(cid), JSON.stringify(profile));
            if (onboarded) {
              await AsyncStorage.setItem(onboardedKey(cid), "true");
            }
          },
          clearLegacy: async () => {
            await AsyncStorage.multiRemove([
              LEGACY_USER_KEY,
              LEGACY_ONBOARDED_KEY,
            ]);
          },
          hasMigrated: async (cid) =>
            (await AsyncStorage.getItem(migrationKey(cid))) === "true",
          markMigrated: async (cid) => {
            await AsyncStorage.setItem(migrationKey(cid), "true");
          },
          saveCanonicalAppUserId: async (cid, canonicalAppUserId) => {
            await AsyncStorage.setItem(appUserIdKey(cid), canonicalAppUserId);
          },
          archiveLegacyProfile: async (cid, profile, onboarded) => {
            await AsyncStorage.setItem(
              archiveKey(cid),
              JSON.stringify({
                profile,
                onboarded,
                archivedAt: new Date().toISOString(),
              }),
            );
          },
        });

        if (cancelled) return;

        if (migrationStatus === "error") {
          migrationBlocked = true;
          console.warn(
            "[auth] legacy migration deferred — skipping /auth/me to preserve linkability",
          );
          return;
        }

        const cachedAppUserId = await AsyncStorage.getItem(
          appUserIdKey(clerkUserId),
        );

        let appUserId: string | null = cachedAppUserId;
        let identityResolved = Boolean(cachedAppUserId);
        let adminFlag = false;
        let testerFlag = false;

        if (!cachedAppUserId) {
          const fresh = await resolveAppIdentityWithRetry(
            getToken,
            shouldCancel,
          );
          if (cancelled) return;
          if (fresh) {
            appUserId = fresh.appUserId;
            adminFlag = fresh.isAdmin;
            testerFlag = fresh.isTester;
            identityResolved = true;
            await AsyncStorage.setItem(
              appUserIdKey(clerkUserId),
              fresh.appUserId,
            );
          } else {
            appUserId = clerkUserId;
            identityResolved = false;
          }
        }

        // ---- Server sync: pull snapshot + run one-time migration BEFORE
        // hydrating from AsyncStorage so the contexts that mount after
        // us (Health, Nutrition, Wellbeing, Gamification) read the
        // freshly-synced data rather than a stale per-device cache.
        // Best-effort: a network failure simply leaves us on the
        // offline cache and we re-converge on the next foreground
        // flush.
        //
        // Only fires when identity is fully resolved (we have a
        // canonical appUserId, not the provisional clerkUserId). The
        // deferred `/auth/me` retry below re-runs this for the
        // canonical id so a transient first-call failure still ends
        // up hydrating from the server before any user interaction.
        const apiBaseUrl = resolveApiBase();
        if (
          !cancelled &&
          apiBaseUrl !== null &&
          appUserId !== null &&
          identityResolved
        ) {
          await bootstrapServerSync(appUserId, apiBaseUrl);
          if (cancelled) return;
        }

        if (cancelled) return;
        const [profileRaw, onboardedRaw] = await Promise.all([
          AsyncStorage.getItem(profileKey(clerkUserId)),
          AsyncStorage.getItem(onboardedKey(clerkUserId)),
        ]);
        let storedProfile: StoredProfile | null = null;
        if (profileRaw) {
          try {
            storedProfile = JSON.parse(profileRaw) as StoredProfile;
          } catch {
            storedProfile = null;
          }
        }

        if (cancelled || appUserId === null) return;
        const next = buildUser({
          appUserId,
          clerkName:
            (clerkUser.fullName ??
              clerkUser.firstName ??
              clerkUser.username ??
              "") || "",
          clerkEmail: clerkUser.primaryEmailAddress?.emailAddress ?? "",
          profile: storedProfile,
        });
        setUser(next);
        setIsOnboarded(onboardedRaw === "true");
        setIsAdmin(adminFlag);
        setIsTester(testerFlag);
        setIsIdentityResolved(identityResolved);
        hydratedClerkIdRef.current = clerkUserId;
      } catch (err) {
        console.warn("[auth] hydrate failed", err);
      } finally {
        if (!cancelled) setProfileLoaded(true);
      }

      if (cancelled || migrationBlocked) return;
      const fresh = await resolveAppIdentityWithRetry(getToken, shouldCancel);
      if (cancelled || !fresh) return;
      await AsyncStorage.setItem(
        appUserIdKey(clerkUserId),
        fresh.appUserId,
      );
      if (hydratedClerkIdRef.current !== clerkUserId) return;
      // Move any sync-queue items that were enqueued under the
      // provisional id (clerkUserId) into the canonical appUserId
      // namespace so the flusher can drain them. If they match
      // (cached identity path), this no-ops.
      try {
        await migrateQueueOwner(clerkUserId, fresh.appUserId);
      } catch (err) {
        console.warn("[sync] queue owner migration failed", err);
      }
      // First-time canonical resolution: the bootstrap above only
      // ran if identity was already resolved on the cached path. If
      // we got here from the provisional fallback, run the server
      // sync bootstrap now under the canonical id so contexts that
      // already hydrated from the local cache will pick up the
      // server-side data the next time they re-read (and any
      // subsequent writes will land in the right namespace).
      if (!cancelled) {
        const apiBaseUrl = resolveApiBase();
        if (apiBaseUrl !== null) {
          await bootstrapServerSync(fresh.appUserId, apiBaseUrl);
          if (cancelled) return;
        }
      }
      setIsAdmin(fresh.isAdmin);
      setIsTester(fresh.isTester);
      setIsIdentityResolved(true);
      setUser((prev) =>
        prev && prev.id !== fresh.appUserId
          ? { ...prev, id: fresh.appUserId }
          : prev,
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [clerkLoaded, isSignedIn, clerkUser, getToken, rememberMeChecked]);

  const persistProfile = useCallback(
    async (next: User) => {
      const cid = clerkUser?.id;
      if (!cid) return;
      const stored = userToStoredProfile(next);
      await AsyncStorage.setItem(profileKey(cid), JSON.stringify(stored));
      // Mirror to the server. `next.id` is the resolved appUserId after
      // /auth/me — for unresolved sessions this still points at the
      // clerk id and the enqueue will get re-attributed once
      // `setUser({ ...prev, id: fresh.appUserId })` re-fires this with
      // the canonical id.
      enqueueSync({
        appUserId: next.id,
        domain: "profile",
        modifier: null,
        method: "PUT",
        path: SyncPaths.profile(),
        body: { profile: stored, updatedAtMs: Date.now() },
      });
    },
    [clerkUser?.id],
  );

  const updateUser = useCallback(
    async (updates: Partial<User>) => {
      setUser((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...updates };
        void persistProfile(next);
        return next;
      });
    },
    [persistProfile],
  );

  const completeOnboarding = useCallback(
    async (data: Partial<User>) => {
      const cid = clerkUser?.id;
      setUser((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...data };
        void persistProfile(next);
        return next;
      });
      if (cid) {
        await AsyncStorage.setItem(onboardedKey(cid), "true");
      }
      setIsOnboarded(true);
    },
    [clerkUser?.id, persistProfile],
  );

  // Periodic + on-foreground sync queue flusher. The queue is per-user so
  // we re-arm whenever the active appUserId changes; cleanup tears down
  // the interval and AppState listener so a logout (or user switch on a
  // shared device) stops the previous user's drain immediately.
  useEffect(() => {
    if (!isSignedIn || !user?.id) return;
    const apiBaseUrl = resolveApiBase();
    if (apiBaseUrl === null) return;
    const userId = user.id;
    let cancelled = false;
    const getAuthHeader = async (): Promise<string | null> => {
      try {
        const t = await getToken();
        return t ? `Bearer ${t}` : null;
      } catch {
        return null;
      }
    };
    const flush = () => {
      if (cancelled) return;
      void flushQueue({ appUserId: userId, apiBaseUrl, getAuthHeader });
    };
    // Drain anything left over from the last session right after sign-in.
    flush();
    const interval = setInterval(flush, 30_000);
    const sub = AppState.addEventListener(
      "change",
      (s: AppStateStatus) => {
        if (s === "active") flush();
      },
    );
    return () => {
      cancelled = true;
      clearInterval(interval);
      sub.remove();
    };
  }, [isSignedIn, user?.id, getToken]);

  const logout = useCallback(async () => {
    await AsyncStorage.removeItem(REMEMBER_ME_KEY);
    try {
      await clerk.signOut();
    } finally {
      notifyServiceWorkerAuthChange();
      hydratedClerkIdRef.current = null;
      setUser(null);
      setIsOnboarded(false);
      setIsAdmin(false);
      setIsIdentityResolved(false);
      setProfileLoaded(true);
    }
  }, [clerk]);

  const isLoading =
    !clerkLoaded ||
    !rememberMeChecked ||
    (isSignedIn === true && !profileLoaded);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isOnboarded,
        isAdmin,
        isTester,
        isIdentityResolved,
        logout,
        updateUser,
        completeOnboarding,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
