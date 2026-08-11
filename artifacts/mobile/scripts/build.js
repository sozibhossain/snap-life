const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

let metroProcess = null;

function spawnPnpm(args, options) {
  // pnpm exposes the JavaScript entrypoint of the currently running CLI.
  // Invoking it with Node avoids Windows' inability to direct-spawn .cmd
  // shims while retaining the normal `pnpm` fallback outside lifecycle runs.
  if (process.env.npm_execpath) {
    const execPath = process.env.npm_execpath;
    if (/\.(?:cjs|mjs|js)$/i.test(execPath)) {
      return spawn(process.execPath, [execPath, ...args], options);
    }
    return spawn(execPath, args, options);
  }
  return spawn(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, {
    ...options,
    shell: process.platform === "win32",
  });
}

const projectRoot = path.resolve(__dirname, "..");

function findWorkspaceRoot(startDir) {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error("Could not find workspace root (no pnpm-workspace.yaml found)");
}

const workspaceRoot = findWorkspaceRoot(projectRoot);
const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");

function exitWithError(message) {
  console.error(message);
  if (metroProcess) {
    metroProcess.kill();
  }
  process.exit(1);
}

function setupSignalHandlers() {
  const cleanup = () => {
    if (metroProcess) {
      console.log("Cleaning up Metro process...");
      metroProcess.kill();
    }
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("SIGHUP", cleanup);
}

function stripProtocol(domain) {
  let urlString = domain.trim();

  if (!/^https?:\/\//i.test(urlString)) {
    urlString = `https://${urlString}`;
  }

  return new URL(urlString).host;
}

function getDeploymentDomain() {
  if (process.env.REPLIT_INTERNAL_APP_DOMAIN) {
    return stripProtocol(process.env.REPLIT_INTERNAL_APP_DOMAIN);
  }

  if (process.env.REPLIT_DEV_DOMAIN) {
    return stripProtocol(process.env.REPLIT_DEV_DOMAIN);
  }

  if (process.env.EXPO_PUBLIC_DOMAIN) {
    return stripProtocol(process.env.EXPO_PUBLIC_DOMAIN);
  }

  console.error(
    "ERROR: No deployment domain found. Set REPLIT_INTERNAL_APP_DOMAIN, REPLIT_DEV_DOMAIN, or EXPO_PUBLIC_DOMAIN",
  );
  process.exit(1);
}

function prepareDirectories(timestamp) {
  console.log("Preparing build directories...");

  const staticBuild = path.join(projectRoot, "static-build");
  if (fs.existsSync(staticBuild)) {
    fs.rmSync(staticBuild, { recursive: true });
  }

  const dirs = [
    path.join(staticBuild, timestamp, "_expo", "static", "js", "ios"),
    path.join(staticBuild, timestamp, "_expo", "static", "js", "android"),
    path.join(staticBuild, "ios"),
    path.join(staticBuild, "android"),
    path.join(staticBuild, "web"),
  ];

  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }

  console.log("Build:", timestamp);
}

/**
 * Inject PWA meta tags + service-worker registration into the index.html
 * that `expo export` produced.
 *
 * Why post-process instead of using `app/+html.tsx`?
 *   When `app.json -> web.output` is `"single"` (which is what we want for
 *   a SPA-style installable PWA), Expo Router uses its own minimal HTML
 *   shell and ignores `+html.tsx`. Rather than switch to `static` output
 *   (which would force every route to be server-rendered and fight with
 *   our `Platform.OS === "web"` guards), we keep the `single` shell and
 *   stitch the PWA `<head>` into it after the export.
 *
 * Idempotent: safe to call repeatedly — the patcher checks for a sentinel
 * comment before injecting.
 */
function patchWebHtml() {
  const indexPath = path.join(projectRoot, "static-build", "web", "index.html");
  if (!fs.existsSync(indexPath)) {
    console.warn("[WebExport] index.html not found, skipping PWA patch");
    return;
  }

  let html = fs.readFileSync(indexPath, "utf-8");
  if (html.includes("<!-- snap-life-pwa-head -->")) {
    return;
  }

  const headInject = `
    <!-- snap-life-pwa-head -->
    <meta name="background-color" content="#0f172a">
    <link rel="manifest" href="/manifest.webmanifest">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-title" content="SNAP Life">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
    <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
    <link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png">
    <link rel="shortcut icon" href="/favicon.ico">
    <style id="snap-life-pwa-bg">
      html, body, #root { background-color: #0f172a; min-height: 100%; }
      #root { position: relative; z-index: 1; min-height: 100vh; }
      #snap-app-shell {
        position: fixed; inset: 0; z-index: 0; pointer-events: none;
        display: flex; flex-direction: column; align-items: center;
        justify-content: center; box-sizing: border-box; padding: 24px;
        color: #fff; text-align: center;
        background: linear-gradient(180deg, #1C3A4A 0%, #0D2530 100%);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #snap-app-shell img { width: 85px; height: auto; margin-bottom: 18px; }
      #snap-app-shell strong { font-size: 48px; line-height: 1.04; letter-spacing: -1px; }
      #snap-app-shell strong span { color: #55C7DE; display: block; }
      #snap-app-shell p { margin: 14px 0 0; color: #D8EDF2; font-size: 16px; }
      @media (prefers-color-scheme: light) {
        html, body, #root { background-color: #F7FAFB; }
      }
    </style>
`;

  // Tighten the viewport so iOS standalone mode covers the notch.
  html = html.replace(
    /<meta name="viewport"[^>]*>/,
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  );

  html = html.replace("</head>", `${headInject}  </head>`);

  html = html.replace(
    /<body([^>]*)>/,
    `<body$1><div id="snap-app-shell" aria-hidden="true"><img src="/icon-192.png" alt=""><strong>Bone Health<span>Movement</span></strong><p>Bone health for life and longevity</p></div>`,
  );

  const bodyInject = `
    <script>
      if ("serviceWorker" in navigator) {
        window.addEventListener("load", function () {
          navigator.serviceWorker
            .register("/sw.js", { scope: "/" })
            .catch(function (err) {
              console.warn("[SNAP Life] SW registration failed:", err);
            });
        });
      }
    </script>
`;
  html = html.replace("</body>", `${bodyInject}  </body>`);

  fs.writeFileSync(indexPath, html);
  console.log("[WebExport] index.html patched with PWA <head> + SW registration");
}

/**
 * Build the installable PWA bundle.
 *
 * Runs `expo export --platform web --output-dir static-build/web` which
 * spins up its own Metro instance, bundles for `react-native-web`, and
 * emits a static SPA shell plus everything from `public/` (manifest,
 * service worker, icons, favicon) at the bundle root.
 *
 * Runs *before* the iOS/Android Metro server so the two Metro instances
 * never fight over port 8081.
 */
function buildWebBundle(expoPublicDomain, expoPublicReplId) {
  return new Promise((resolve, reject) => {
    console.log("Exporting web bundle (expo export --platform web)...");

    const env = {
      ...process.env,
      EXPO_PUBLIC_DOMAIN: expoPublicDomain,
      EXPO_PUBLIC_REPL_ID: expoPublicReplId,
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:
        process.env.CLERK_PUBLISHABLE_KEY ||
        process.env.VITE_CLERK_PUBLISHABLE_KEY ||
        "",
    };

    const child = spawnPnpm(
      [
        "exec",
        "expo",
        "export",
        "--platform",
        "web",
        "--output-dir",
        path.join("static-build", "web"),
        "--clear",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: projectRoot,
        env,
      },
    );

    if (child.stdout) {
      child.stdout.on("data", (data) => {
        const output = data.toString().trim();
        if (output) console.log(`[WebExport] ${output}`);
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (data) => {
        const output = data.toString().trim();
        if (output) console.error(`[WebExport] ${output}`);
      });
    }

    child.on("error", (err) => reject(err));
    child.on("exit", (code) => {
      if (code === 0) {
        try {
          patchWebHtml();
        } catch (err) {
          console.warn(`[WebExport] PWA HTML patch failed: ${err.message}`);
        }
        console.log("Web bundle exported");
        resolve();
        return;
      } else {
        // In production we MUST fail loudly: shipping a deploy without
        // the PWA bundle silently regresses the installable web app
        // and is exactly the kind of thing CI is supposed to catch.
        // In dev we tolerate the failure so iOS/Android bundles still
        // build — the server falls back to the install landing page
        // when no web bundle is present.
        const msg = `expo export exited with code ${code}; web bundle missing`;
        if (process.env.NODE_ENV === "production") {
          console.error(`[WebExport] ${msg}`);
          reject(new Error(msg));
        } else {
          console.warn(`[WebExport] ${msg} (skipped in non-production build)`);
          resolve();
        }
      }
    });
  });
}

function clearMetroCache() {
  console.log("Clearing Metro cache...");

  const cacheDirs = [
    path.join(projectRoot, ".metro-cache"),
    path.join(projectRoot, "node_modules/.cache/metro"),
  ];

  for (const dir of cacheDirs) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log("Cache cleared");
}

async function checkMetroHealth() {
  try {
    const response = await fetch("http://localhost:8081/status", {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function getExpoPublicReplId() {
  return process.env.REPL_ID || process.env.EXPO_PUBLIC_REPL_ID;
}

async function startMetro(expoPublicDomain, expoPublicReplId) {
  const isRunning = await checkMetroHealth();
  if (isRunning) {
    console.log("Metro already running");
    return;
  }

  console.log("Starting Metro...");
  console.log(`Setting EXPO_PUBLIC_DOMAIN=${expoPublicDomain}`);
  const env = {
    ...process.env,
    EXPO_PUBLIC_DOMAIN: expoPublicDomain,
    EXPO_PUBLIC_REPL_ID: expoPublicReplId,
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:
      process.env.CLERK_PUBLISHABLE_KEY ||
      process.env.VITE_CLERK_PUBLISHABLE_KEY ||
      "",
  };

  if (expoPublicReplId) {
    console.log(`Setting EXPO_PUBLIC_REPL_ID=${expoPublicReplId}`);
  }

  if (!env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    console.warn(
      "WARN: CLERK_PUBLISHABLE_KEY is not set — built bundle will fail to initialise Clerk.",
    );
  }

  metroProcess = spawnPnpm(
    [
      "exec",
      "expo",
      "start",
      "--no-dev",
      "--minify",
      "--localhost",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
      cwd: projectRoot,
      env,
    },
  );

  if (metroProcess.stdout) {
    metroProcess.stdout.on("data", (data) => {
      const output = data.toString().trim();
      if (output) console.log(`[Metro] ${output}`);
    });
  }
  if (metroProcess.stderr) {
    metroProcess.stderr.on("data", (data) => {
      const output = data.toString().trim();
      if (output) console.error(`[Metro Error] ${output}`);
    });
  }

  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const healthy = await checkMetroHealth();
    if (healthy) {
      console.log("Metro ready");
      return;
    }
  }

  console.error("Metro timeout");
  process.exit(1);
}

async function downloadFile(url, outputPath) {
  const controller = new AbortController();
  const fiveMinMS = 5 * 60 * 1_000;
  const timeoutId = setTimeout(() => controller.abort(), fiveMinMS);

  try {
    console.log(`Downloading: ${url}`);
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const file = fs.createWriteStream(outputPath);
    await pipeline(Readable.fromWeb(response.body), file);

    const fileSize = fs.statSync(outputPath).size;

    if (fileSize === 0) {
      fs.unlinkSync(outputPath);
      throw new Error("Downloaded file is empty");
    }
  } catch (error) {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    if (error.name === "AbortError") {
      throw new Error(`Download timeout after 5m: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function downloadBundle(platform, timestamp) {
  const entryPath = path.resolve(projectRoot, "node_modules", "expo-router", "entry");
  const bundlePath = path.relative(workspaceRoot, entryPath);
  const url = new URL(`http://localhost:8081/${bundlePath}.bundle`);
  url.searchParams.set("platform", platform);
  url.searchParams.set("dev", "false");
  url.searchParams.set("hot", "false");
  url.searchParams.set("lazy", "false");
  url.searchParams.set("minify", "true");

  const output = path.join(
    "static-build",
    timestamp,
    "_expo",
    "static",
    "js",
    platform,
    "bundle.js",
  );

  console.log(`Fetching ${platform} bundle...`);
  await downloadFile(url.toString(), output);
  console.log(`${platform} bundle ready`);
}

async function downloadManifest(platform) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300_000);

  try {
    console.log(`Fetching ${platform} manifest...`);
    const response = await fetch("http://localhost:8081/manifest", {
      headers: { "expo-platform": platform },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const manifest = await response.json();
    console.log(`${platform} manifest ready`);
    return manifest;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        `Manifest download timeout after 5m for platform: ${platform}`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function downloadBundlesAndManifests(timestamp) {
  console.log("Downloading bundles and manifests...");
  console.log("This may take several minutes for production builds...");

  try {
    // Bundles are sequential — Metro can't handle both platforms simultaneously
    // without stalling. Manifests are cheap and run in parallel after.
    await downloadBundle("ios", timestamp);
    await downloadBundle("android", timestamp);

    const [iosManifest, androidManifest] = await Promise.all([
      downloadManifest("ios"),
      downloadManifest("android"),
    ]);

    console.log("All downloads completed successfully");
    return { ios: iosManifest, android: androidManifest };
  } catch (error) {
    exitWithError(`Download failed: ${error.message}`);
  }
}

function extractAssets(timestamp) {
  const staticBuild = path.join(projectRoot, "static-build");
  const bundles = {
    ios: fs.readFileSync(
      path.join(staticBuild, timestamp, "_expo", "static", "js", "ios", "bundle.js"),
      "utf-8",
    ),
    android: fs.readFileSync(
      path.join(staticBuild, timestamp, "_expo", "static", "js", "android", "bundle.js"),
      "utf-8",
    ),
  };

  const assetsMap = new Map();
  const assetPattern =
    /httpServerLocation:"([^"]+)"[^}]*hash:"([^"]+)"[^}]*name:"([^"]+)"[^}]*type:"([^"]+)"/g;

  const extractFromBundle = (bundle, platform) => {
    for (const match of bundle.matchAll(assetPattern)) {
      const originalPath = match[1];
      const filename = match[3] + "." + match[4];

      const tempUrl = new URL(`http://localhost:8081${originalPath}`);
      const unstablePath = tempUrl.searchParams.get("unstable_path");

      if (!unstablePath) {
        throw new Error(`Asset missing unstable_path: ${originalPath}`);
      }

      const decodedPath = decodeURIComponent(unstablePath);
      const key = path.posix.join(decodedPath, filename);

      if (!assetsMap.has(key)) {
        const asset = {
          url: path.posix.join("/", decodedPath, filename),
          originalPath: originalPath,
          filename: filename,
          relativePath: decodedPath,
          hash: match[2],
          platforms: new Set(),
        };

        assetsMap.set(key, asset);
      }
      assetsMap.get(key).platforms.add(platform);
    }
  };

  extractFromBundle(bundles.ios, "ios");
  extractFromBundle(bundles.android, "android");

  return Array.from(assetsMap.values());
}

async function downloadAssets(assets, timestamp) {
  if (assets.length === 0) {
    return 0;
  }

  console.log("Copying assets...");
  let successCount = 0;
  const failures = [];

  const downloadPromises = assets.map(async (asset) => {
    const tempUrl = new URL(`http://localhost:8081${asset.originalPath}`);
    const unstablePath = tempUrl.searchParams.get("unstable_path");

    if (!unstablePath) {
      throw new Error(`Asset missing unstable_path: ${asset.originalPath}`);
    }

    const decodedPath = decodeURIComponent(unstablePath);

    const outputDir = path.join(
      projectRoot,
      "static-build",
      timestamp,
      "_expo",
      "static",
      "js",
      asset.relativePath,
    );
    fs.mkdirSync(outputDir, { recursive: true });
    const output = path.join(outputDir, asset.filename);

    try {
      const candidates = [
        path.join(projectRoot, decodedPath, asset.filename),
        path.join(workspaceRoot, decodedPath, asset.filename),
      ];
      const found = candidates.find((p) => fs.existsSync(p));
      if (!found) {
        throw new Error(`Asset not found on disk: ${asset.filename}`);
      }
      fs.copyFileSync(found, output);
      successCount++;
    } catch (error) {
      failures.push({
        filename: asset.filename,
        error: error.message,
        url: asset.originalPath,
      });
    }
  });

  await Promise.all(downloadPromises);

  if (failures.length > 0) {
    const errorMsg =
      `Failed to download ${failures.length} asset(s):\n` +
      failures
        .map((f) => `  - ${f.filename}: ${f.error} (${f.url})`)
        .join("\n");
    exitWithError(errorMsg);
  }

  console.log(`Copied ${successCount} assets`);
  return successCount;
}

function updateBundleUrls(timestamp, baseUrl) {
  const updateForPlatform = (platform) => {
    const bundlePath = path.join(
      projectRoot,
      "static-build",
      timestamp,
      "_expo",
      "static",
      "js",
      platform,
      "bundle.js",
    );
    let bundle = fs.readFileSync(bundlePath, "utf-8");

    bundle = bundle.replace(
      /httpServerLocation:"(\/[^"]+)"/g,
      (_match, capturedPath) => {
        const tempUrl = new URL(`http://localhost:8081${capturedPath}`);
        const unstablePath = tempUrl.searchParams.get("unstable_path");

        if (!unstablePath) {
          throw new Error(
            `Asset missing unstable_path in bundle: ${capturedPath}`,
          );
        }

        const decodedPath = decodeURIComponent(unstablePath);
        return `httpServerLocation:"${baseUrl}${basePath}/${timestamp}/_expo/static/js/${decodedPath}"`;
      },
    );

    fs.writeFileSync(bundlePath, bundle);
  };

  updateForPlatform("ios");
  updateForPlatform("android");
  console.log("Updated bundle URLs");
}

function updateManifests(manifests, timestamp, baseUrl, assetsByHash) {
  const updateForPlatform = (platform, manifest) => {
    if (!manifest.launchAsset || !manifest.extra) {
      exitWithError(`Malformed manifest for ${platform}`);
    }

    manifest.launchAsset.url = `${baseUrl}${basePath}/${timestamp}/_expo/static/js/${platform}/bundle.js`;
    manifest.launchAsset.key = `bundle-${timestamp}`;
    manifest.createdAt = new Date(
      Number(timestamp.split("-")[0]),
    ).toISOString();
    manifest.extra.expoClient.hostUri =
      baseUrl.replace("https://", "") + "/" + platform;
    manifest.extra.expoGo.debuggerHost =
      baseUrl.replace("https://", "") + "/" + platform;
    manifest.extra.expoGo.packagerOpts.dev = false;

    if (manifest.assets && manifest.assets.length > 0) {
      manifest.assets.forEach((asset) => {
        if (!asset.url) return;

        const hash = asset.hash;
        if (!hash) return;

        const assetInfo = assetsByHash.get(hash);
        if (!assetInfo) return;

        asset.url = `${baseUrl}${basePath}/${timestamp}/_expo/static/js/${assetInfo.relativePath}/${assetInfo.filename}`;
      });
    }

    fs.writeFileSync(
      path.join(projectRoot, "static-build", platform, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
  };

  updateForPlatform("ios", manifests.ios);
  updateForPlatform("android", manifests.android);
  console.log("Manifests updated");
}

async function main() {
  console.log("Building static Expo Go deployment...");

  setupSignalHandlers();

  const domain = getDeploymentDomain();
  const expoPublicReplId = getExpoPublicReplId();
  const baseUrl = `https://${domain}`;
  const timestamp = `${Date.now()}-${process.pid}`;

  prepareDirectories(timestamp);
  clearMetroCache();

  // Build the PWA web bundle first — it spawns its own Metro and exits,
  // which keeps it from colliding with the long-running iOS/Android
  // Metro instance started below.
  await buildWebBundle(domain, expoPublicReplId);

  // Release-blocking PWA quality gate (launch checklist row I1).
  // In production we MUST fail the build when scores regress; in
  // dev we only warn so iterating on iOS/Android bundles is not
  // blocked by transient web-bundle issues.
  try {
    const { main: runLighthouse } = require("./lighthouse-ci.js");
    await runLighthouse();
  } catch (err) {
    if (process.env.NODE_ENV === "production") {
      exitWithError(`[Lighthouse] ${err.message || err}`);
    } else {
      console.warn(
        `[Lighthouse] ${err.message || err} (gate enforced only in production)`,
      );
    }
  }

  await startMetro(domain, expoPublicReplId);

  const downloadTimeout = 600000;
  const downloadPromise = downloadBundlesAndManifests(timestamp);
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(
        new Error(
          `Overall download timeout after ${downloadTimeout / 1000} seconds. ` +
            "Metro may be struggling to generate bundles. Check Metro logs above.",
        ),
      );
    }, downloadTimeout);
  });

  const manifests = await Promise.race([downloadPromise, timeoutPromise]);

  console.log("Processing assets...");
  const assets = extractAssets(timestamp);
  console.log("Found", assets.length, "unique asset(s)");

  const assetsByHash = new Map();
  for (const asset of assets) {
    assetsByHash.set(asset.hash, {
      relativePath: asset.relativePath,
      filename: asset.filename,
    });
  }

  const assetCount = await downloadAssets(assets, timestamp);

  if (assetCount > 0) {
    updateBundleUrls(timestamp, baseUrl);
  }

  console.log("Updating manifests and creating landing page...");
  updateManifests(manifests, timestamp, baseUrl, assetsByHash);

  console.log("Build complete! Deploy to:", baseUrl);

  if (metroProcess) {
    metroProcess.kill();
  }
  process.exit(0);
}

main().catch((error) => {
  console.error("Build failed:", error.message);
  if (metroProcess) {
    metroProcess.kill();
  }
  process.exit(1);
});
