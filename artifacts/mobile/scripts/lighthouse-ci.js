/**
 * Lighthouse CI gate for the SNAP Life PWA bundle.
 *
 * Why this exists
 * ---------------
 * `docs/launch-checklist.md` row I1 requires a Lighthouse PWA score
 * >= 90 on every release. Doing that by hand once a release means the
 * release we forget is the release that ships a regressed manifest,
 * a broken icon, or a service worker that no longer registers. This
 * script wires the same audit into the build pipeline so we cannot
 * promote a release that fails it.
 *
 * What it does
 * ------------
 *   1. Boots a tiny static HTTP server that serves
 *      `artifacts/mobile/static-build/web/` exactly the way the
 *      production `serve.js` does (same MIME types, same SW headers,
 *      SPA fallback to `index.html`).
 *   2. Launches headless Chromium via `chrome-launcher`.
 *   3. Runs Lighthouse against `http://localhost:<port>/` collecting
 *      the four release-blocking categories: Performance, Accessibility,
 *      Best Practices, PWA.
 *   4. Writes the full JSON + HTML report to
 *      `static-build/lighthouse/<timestamp>/` so each release has an
 *      archived trail for trend tracking.
 *   5. Exits non-zero if any audited category scored below the
 *      threshold (default 0.90), failing the build.
 *
 * Skipping
 * --------
 * Set `LIGHTHOUSE_SKIP=1` to bypass the gate. This is intentionally
 * loud (warning logged, exit code still 0) for local builds where you
 * cannot launch Chromium. Production deploys must NOT set this.
 *
 * Lighthouse version
 * ------------------
 * Pinned to ^11 because Lighthouse 12 removed the PWA category, and
 * the launch checklist explicitly requires a PWA score. If we ever
 * upgrade past 11 we have to drop the PWA threshold here too.
 */

const fs = require("fs");
const http = require("http");
const path = require("path");
const zlib = require("zlib");

const projectRoot = path.resolve(__dirname, "..");
const WEB_ROOT = path.join(projectRoot, "static-build", "web");
const ARCHIVE_ROOT = path.join(projectRoot, "static-build", "lighthouse");

const THRESHOLD = Number(process.env.LIGHTHOUSE_THRESHOLD || "0.90");
const CATEGORIES = ["performance", "accessibility", "best-practices", "pwa"];

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
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

function safeJoin(root, urlPath) {
  const safe = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const joined = path.join(root, safe);
  if (!joined.startsWith(root)) return null;
  return joined;
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      let pathname = url.pathname;

      const direct = safeJoin(WEB_ROOT, pathname);
      let filePath = null;
      if (direct && fs.existsSync(direct) && fs.statSync(direct).isFile()) {
        filePath = direct;
      } else if (!/\.[a-z0-9]+$/i.test(pathname)) {
        // SPA fallback so navigation requests resolve to the shell.
        filePath = path.join(WEB_ROOT, "index.html");
      }

      if (!filePath || !fs.existsSync(filePath)) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not Found");
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      const acceptsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
      const compressible = /^(?:text\/|application\/(?:javascript|json|manifest\+json))/.test(
        contentType,
      );
      const useGzip = acceptsGzip && compressible;
      const headers = {
        "content-type": contentType,
        "cache-control":
          ext === ".html" ||
          pathname === "/sw.js" ||
          pathname === "/manifest.webmanifest"
            ? "no-cache, no-store, must-revalidate"
            : "public, max-age=31536000, immutable",
        ...(useGzip ? { "content-encoding": "gzip", vary: "accept-encoding" } : {}),
        ...(pathname === "/sw.js"
          ? { "service-worker-allowed": "/" }
          : {}),
      };
      res.writeHead(200, headers);
      const source = fs.createReadStream(filePath);
      if (useGzip) source.pipe(zlib.createGzip()).pipe(res);
      else source.pipe(res);
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Static server failed to bind"));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

function formatScore(score) {
  if (score == null) return "n/a";
  return `${Math.round(score * 100)}`;
}

async function runAudit(targetUrl, archiveDir) {
  const chromeLauncher = await import("chrome-launcher");
  const lighthouse = (await import("lighthouse")).default;

  const chrome = await chromeLauncher.launch({
    chromeFlags: [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
    ],
  });

  try {
    const result = await lighthouse(
      targetUrl,
      {
        port: chrome.port,
        output: ["json", "html"],
        logLevel: "error",
        onlyCategories: CATEGORIES,
      },
      {
        extends: "lighthouse:default",
        settings: {
          formFactor: "mobile",
          screenEmulation: {
            mobile: true,
            width: 412,
            height: 823,
            deviceScaleFactor: 1.75,
            disabled: false,
          },
          throttlingMethod: "simulate",
        },
      },
    );

    if (!result) throw new Error("Lighthouse returned no result");

    fs.mkdirSync(archiveDir, { recursive: true });
    const [jsonReport, htmlReport] = result.report;
    fs.writeFileSync(path.join(archiveDir, "report.json"), jsonReport);
    fs.writeFileSync(path.join(archiveDir, "report.html"), htmlReport);

    return result.lhr;
  } finally {
    await chrome.kill();
  }
}

async function main() {
  if (process.env.LIGHTHOUSE_SKIP === "1") {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "LIGHTHOUSE_SKIP=1 is not allowed in production builds — the PWA audit is a release gate.",
      );
    }
    console.warn(
      "[Lighthouse] LIGHTHOUSE_SKIP=1 — release-blocking PWA audit was bypassed (non-production build).",
    );
    return;
  }

  if (!fs.existsSync(path.join(WEB_ROOT, "index.html"))) {
    throw new Error(
      `[Lighthouse] static-build/web/index.html not found — build the web bundle first (expected at ${WEB_ROOT}).`,
    );
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace(/Z$/, "");
  const archiveDir = path.join(ARCHIVE_ROOT, timestamp);

  const { server, port } = await startStaticServer();
  const targetUrl = `http://127.0.0.1:${port}/`;
  console.log(`[Lighthouse] Auditing ${targetUrl}`);

  let lhr;
  try {
    lhr = await runAudit(targetUrl, archiveDir);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }

  const summary = {};
  const failures = [];
  for (const id of CATEGORIES) {
    const cat = lhr.categories[id];
    const score = cat ? cat.score : null;
    summary[id] = score;
    const label = cat ? cat.title : id;
    const display = formatScore(score);
    if (score == null || score < THRESHOLD) {
      failures.push(`${label}: ${display} (< ${Math.round(THRESHOLD * 100)})`);
      console.error(`[Lighthouse] FAIL  ${label.padEnd(16)} ${display}`);
    } else {
      console.log(`[Lighthouse] PASS  ${label.padEnd(16)} ${display}`);
    }
  }

  fs.writeFileSync(
    path.join(archiveDir, "summary.json"),
    JSON.stringify(
      {
        timestamp,
        url: targetUrl,
        threshold: THRESHOLD,
        scores: summary,
        passed: failures.length === 0,
      },
      null,
      2,
    ),
  );

  console.log(`[Lighthouse] Report archived: ${archiveDir}`);

  if (failures.length > 0) {
    throw new Error(
      `Lighthouse gate failed:\n  - ${failures.join("\n  - ")}\nReport: ${archiveDir}/report.html`,
    );
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = { main };
