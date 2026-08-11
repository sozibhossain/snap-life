/**
 * Standalone production server for the SNAP Life build.
 *
 * Three responsibilities, served from one tiny zero-dependency server:
 *
 *   1) PWA shell — Browsers (no `expo-platform` header) hit `/` and get
 *      the Expo web export from `static-build/web/`. This is the
 *      installable progressive web app.
 *
 *   2) Expo Go manifest — `expo-platform: ios|android` requests on `/`
 *      or `/manifest` get the platform-specific Expo Updates manifest
 *      from `static-build/<platform>/manifest.json`.
 *
 *   3) Install landing page — `/install` returns the QR-code page so
 *      desktop users can scan into Expo Go even when the PWA is the
 *      default. (Used to live at `/`.)
 *
 * Cache-Control:
 *   - HTML / sw.js / manifest.webmanifest → no-cache (fast updates)
 *   - Hashed `_expo/static/**` and `assets/**` → 1y immutable
 *   - Other static assets → public, max-age=300 (sane default)
 *
 * Zero external dependencies — uses only Node.js built-ins.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const STATIC_ROOT = path.resolve(__dirname, "..", "static-build");
const WEB_ROOT = path.join(STATIC_ROOT, "web");
const TEMPLATE_PATH = path.resolve(__dirname, "templates", "landing-page.html");
const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

function getAppName() {
  try {
    const appJsonPath = path.resolve(__dirname, "..", "app.json");
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf-8"));
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function safeJoin(root, urlPath) {
  // Normalise + strip any leading "../" attempts before joining.
  const safe = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const joined = path.join(root, safe);
  if (!joined.startsWith(root)) return null;
  return joined;
}

function isImmutableAssetPath(pathname) {
  // Expo's web export emits hashed JS/CSS filenames under _expo/static/**
  // and bundle assets under assets/**. Both are safe to cache forever.
  return (
    pathname.startsWith("/_expo/static/") || pathname.startsWith("/assets/")
  );
}

function isPwaIconPath(pathname) {
  // Hand-authored PWA icons in /public — not content-hashed, but they
  // change at most once per release, so a 30-day TTL is a safe win for
  // homescreen-installed users.
  return (
    /^\/icon-(\d+|maskable-\d+)\.png$/.test(pathname) ||
    pathname === "/apple-touch-icon.png" ||
    pathname === "/favicon.ico"
  );
}

function cacheControlFor(pathname, ext) {
  if (
    pathname === "/sw.js" ||
    pathname.endsWith("/sw.js") ||
    pathname === "/manifest.webmanifest" ||
    ext === ".webmanifest" ||
    ext === ".html"
  ) {
    return "no-cache, no-store, must-revalidate";
  }
  if (isImmutableAssetPath(pathname)) {
    return "public, max-age=31536000, immutable";
  }
  if (isPwaIconPath(pathname)) {
    return "public, max-age=2592000";
  }
  return "public, max-age=300";
}

function writeFile(req, res, filePath, urlPath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const acceptsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
  const compressible = /^(?:text\/|application\/(?:javascript|json|manifest\+json))/.test(
    contentType,
  );
  const useGzip = acceptsGzip && compressible;

  const headers = {
    "content-type": contentType,
    "cache-control": cacheControlFor(urlPath, ext),
    ...(useGzip ? { "content-encoding": "gzip", vary: "accept-encoding" } : {}),
    // Allow the SW to control the whole origin even though it lives at /sw.js.
    ...(urlPath === "/sw.js" ? { "service-worker-allowed": "/" } : {}),
  };

  if (req.method === "HEAD") {
    res.writeHead(200, headers);
    res.end();
    return;
  }

  res.writeHead(200, headers);
  const source = fs.createReadStream(filePath);
  if (useGzip) source.pipe(zlib.createGzip()).pipe(res);
  else source.pipe(res);
}

function serveExpoManifest(platform, res) {
  const manifestPath = path.join(STATIC_ROOT, platform, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ error: `Manifest not found for platform: ${platform}` }),
    );
    return;
  }

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.writeHead(200, {
    "content-type": "application/json",
    "expo-protocol-version": "1",
    "expo-sfv-version": "0",
    "cache-control": "no-cache, no-store, must-revalidate",
  });
  res.end(manifest);
}

function serveLandingPage(req, res, landingPageTemplate, appName) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = forwardedProto || "https";
  const host = req.headers["x-forwarded-host"] || req.headers["host"];
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-cache, no-store, must-revalidate",
  });
  res.end(html);
}

/**
 * Try to serve a file from the PWA web bundle. Returns true if a
 * response was written. For unknown paths we fall back to index.html
 * so deep-linked Expo Router routes (e.g. `/health`) still resolve.
 */
function tryServeWeb(req, res, urlPath) {
  if (!fs.existsSync(WEB_ROOT)) return false;

  // Direct file hit (manifest.webmanifest, sw.js, /_expo/static/*, icons).
  const directPath = safeJoin(WEB_ROOT, urlPath);
  if (
    directPath &&
    fs.existsSync(directPath) &&
    fs.statSync(directPath).isFile()
  ) {
    writeFile(req, res, directPath, urlPath);
    return true;
  }

  // Treat extension-less / "navigation" requests as SPA shell loads.
  const looksLikeAsset = /\.[a-z0-9]+$/i.test(urlPath);
  if (!looksLikeAsset) {
    const shell = path.join(WEB_ROOT, "index.html");
    if (fs.existsSync(shell)) {
      writeFile(req, res, shell, "/");
      return true;
    }
  }

  return false;
}

/**
 * Try to serve a file from the legacy static-build root (iOS/Android
 * artefacts plus arbitrary assets that older deploys put there).
 */
function tryServeLegacyStatic(req, res, urlPath) {
  const filePath = safeJoin(STATIC_ROOT, urlPath);
  if (
    filePath &&
    fs.existsSync(filePath) &&
    fs.statSync(filePath).isFile()
  ) {
    writeFile(req, res, filePath, urlPath);
    return true;
  }
  return false;
}

const landingPageTemplate = fs.readFileSync(TEMPLATE_PATH, "utf-8");
const appName = getAppName();

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  let pathname = url.pathname;

  // Strip the artifact prefix injected by the global proxy.
  if (basePath && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length) || "/";
  }

  const platform = req.headers["expo-platform"];

  // 1) Expo Go manifest — recognised by header, always wins on /, /manifest.
  if (
    (pathname === "/" || pathname === "/manifest") &&
    (platform === "ios" || platform === "android")
  ) {
    return serveExpoManifest(platform, res);
  }

  // 2) Install landing page — explicit opt-in for desktop users that want
  //    the QR code into Expo Go.
  if (pathname === "/install" || pathname === "/install/") {
    return serveLandingPage(req, res, landingPageTemplate, appName);
  }

  // 3) PWA web bundle (default browser path).
  if (tryServeWeb(req, res, pathname)) return;

  // 4) Legacy static-build/* assets — iOS/Android JS bundles, downloaded
  //    asset files, anything build.js drops outside of static-build/web.
  if (tryServeLegacyStatic(req, res, pathname)) return;

  // 5) If nothing matched and `/` was requested but no PWA shell is built
  //    yet, fall back to the install landing page so the deploy is never
  //    a blank 404.
  if (pathname === "/") {
    return serveLandingPage(req, res, landingPageTemplate, appName);
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not Found");
});

const port = parseInt(process.env.PORT || "3000", 10);
server.listen(port, "0.0.0.0", () => {
  console.log(`Serving SNAP Life on port ${port}`);
  console.log(`PWA bundle: ${fs.existsSync(WEB_ROOT) ? "yes" : "no"}`);
});
