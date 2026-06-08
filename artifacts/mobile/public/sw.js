/**
 * SNAP Life service worker — installable PWA shell.
 *
 * Strategy:
 *   - On install: pre-cache the app shell (root URL + manifest + favicon)
 *     so the app can launch from the home screen even when offline.
 *   - On fetch:
 *       - Same-origin navigation requests → cache-first stale-while-
 *         revalidate against the shell cache. The cached shell is
 *         returned instantly (offline launches "just work"), and the
 *         network response refreshes the shell in the background so
 *         the next launch picks up new app versions.
 *       - Same-origin static assets under /_expo/static/** → cache-first
 *         (the filenames are content-hashed, so they're safely immutable).
 *       - /api/* → stale-while-revalidate, **partitioned by a hash of
 *         the request's Authorization header**. Each user's responses
 *         live in their own cache namespace (`*-api-<authHash>`), so
 *         account switches in a shared browser profile never serve
 *         another user's data. Anonymous (no Authorization) requests
 *         live in `*-api-anonymous`. The app may also post
 *         `{ type: "snaplife/auth-change" }` to the SW on logout to
 *         purge every per-user partition immediately.
 *       - Everything else → straight network with a cache fallback.
 *
 * We never cache opaque (non-200) responses, never cache POST/PUT/etc, and
 * skip caching entirely when the request comes from a different origin
 * than the SW scope.
 */

const VERSION = "snaplife-pwa-v2";
const SHELL_CACHE = `${VERSION}-shell`;
const STATIC_CACHE = `${VERSION}-static`;
const API_CACHE_PREFIX = `${VERSION}-api-`;
const SHELL_URLS = [
  "/",
  "/manifest.webmanifest",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        // `addAll` is atomic; if any URL fails, install fails. We tolerate
        // missing icons by falling back to per-URL adds that swallow 404s.
        Promise.all(
          SHELL_URLS.map((url) =>
            cache.add(url).catch(() => {
              // Soft-fail any optional asset (e.g. a maskable icon that
              // hasn't been generated yet) so the SW still installs.
            }),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          // Drop everything that isn't from the current VERSION — including
          // every `*-api-*` partition from a previous deploy.
          keys
            .filter((k) => !k.startsWith(VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// ---------------------------------------------------------------------------
// Web Push — push event + notificationclick
// ---------------------------------------------------------------------------

/**
 * Receive an incoming Web Push message from the server. The payload is a
 * JSON string with shape: { title, body, data }.
 *
 * We always show a notification (required for Web Push — a silent handler
 * that never calls showNotification will cause browsers to show a generic
 * "Site has been updated" notice and may eventually revoke permission).
 */
self.addEventListener("push", (event) => {
  let title = "Bone Buddy";
  let body = "You have a new nudge from Bone Buddy.";
  let data = {};

  if (event.data) {
    try {
      const payload = event.data.json();
      if (payload.title) title = String(payload.title);
      if (payload.body) body = String(payload.body);
      if (payload.data && typeof payload.data === "object") data = payload.data;
    } catch {
      // Fallback to defaults above if JSON parsing fails.
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data,
    }),
  );
});

/**
 * Handle notification clicks. Opens (or focuses) the SNAP Life PWA and
 * closes the notification. Deep-link data from `notification.data` is
 * forwarded to the page via a postMessage so the app can navigate.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const notifData = event.notification.data || {};

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // If there's already an open window, focus it and send the data.
        for (const client of clientList) {
          if ("focus" in client) {
            client.focus();
            client.postMessage({ type: "snaplife/notification-click", data: notifData });
            return;
          }
        }
        // No open window — open a new one.
        if (self.clients.openWindow) {
          return self.clients.openWindow("/").then((client) => {
            if (client) {
              client.postMessage({ type: "snaplife/notification-click", data: notifData });
            }
          });
        }
      }),
  );
});

// ---------------------------------------------------------------------------
// App-driven cache invalidation
// ---------------------------------------------------------------------------

/**
 * App-driven cache invalidation. Clients (the React app) can post
 * `{ type: "snaplife/auth-change" }` after sign-out / account switch to
 * eagerly purge every per-user `/api/*` partition. This is belt-and-
 * suspenders alongside the per-request hash partitioning, but it frees
 * disk and guarantees that an offline launch after sign-out cannot
 * resurface the previous user's data.
 */
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "snaplife/auth-change") {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith(API_CACHE_PREFIX))
            .map((k) => caches.delete(k)),
        ),
      ),
    );
  }
});

function isSameOrigin(url) {
  try {
    return new URL(url, self.location.origin).origin === self.location.origin;
  } catch {
    return false;
  }
}

/**
 * Compute a short hex hash of the request's auth credential so each user
 * gets their own cache namespace. We never write the credential itself
 * anywhere — only its 8-byte digest. Anonymous requests share a single
 * "anonymous" partition.
 */
async function authPartition(request) {
  const auth = request.headers.get("Authorization");
  if (!auth) return "anonymous";

  try {
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(auth),
    );
    return Array.from(new Uint8Array(buf).slice(0, 8))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    // If SubtleCrypto is unavailable for any reason, fall back to a
    // dedicated "unknown" partition that we treat as a single shared
    // bucket. We deliberately do NOT mix it with "anonymous" so the
    // worst case is degraded cache hit-rate, never cross-user leak.
    return "unknown";
  }
}

/**
 * Cache-first stale-while-revalidate against the shell cache. Returns
 * the cached shell immediately on hit, and refreshes the cache from the
 * network in the background. Falls back to the cached "/" if the
 * request itself was never cached (deep links).
 */
async function shellSwr(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = (await cache.match(request)) || (await cache.match("/"));

  const networkPromise = fetch(request)
    .then((res) => {
      // Only cache same-origin success responses; never opaque or error.
      if (res && res.status === 200 && res.type === "basic") {
        // Refresh both the request URL and the canonical shell entry so
        // home-screen launches always get the newest shell.
        cache.put(request, res.clone()).catch(() => {});
        cache.put("/", res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => null);

  if (cached) return cached;
  const fresh = await networkPromise;
  if (fresh) return fresh;
  return new Response("Offline", { status: 503, statusText: "Offline" });
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.status === 200) {
      cache.put(request, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch {
    if (cached) return cached;
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

/**
 * Stale-while-revalidate, scoped to a per-user cache so account
 * switches in a shared browser profile never leak data across users.
 */
async function apiSwr(request) {
  const partition = await authPartition(request);
  const cache = await caches.open(`${API_CACHE_PREFIX}${partition}`);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((res) => {
      // Never cache error responses; never cache opaque cross-origin.
      // Cookies are not used for auth on SNAP Life (Bearer JWTs only),
      // so we don't need to strip Set-Cookie.
      if (res && res.status === 200 && res.type === "basic") {
        cache.put(request, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => null);

  return (
    cached ||
    (await network) ||
    new Response("Offline", { status: 503, statusText: "Offline" })
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Only handle GETs — never cache mutations.
  if (request.method !== "GET") return;
  if (!isSameOrigin(request.url)) return;

  const url = new URL(request.url);

  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(shellSwr(request));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(apiSwr(request));
    return;
  }

  if (
    url.pathname.startsWith("/_expo/static/") ||
    url.pathname.startsWith("/assets/") ||
    /\.(?:js|css|png|jpe?g|webp|svg|ico|woff2?|ttf)$/i.test(url.pathname)
  ) {
    event.respondWith(cacheFirstStatic(request));
    return;
  }

  // Anything else: try network, fall back to whatever we may have cached.
  event.respondWith(
    fetch(request).catch(() =>
      caches
        .match(request)
        .then((m) => m || new Response("Offline", { status: 503 })),
    ),
  );
});
