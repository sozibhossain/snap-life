/**
 * Admin SPA production server.
 *
 * Replit's static-deploy mode (`serve = "static"`) cannot emit arbitrary
 * HTTP response headers, which means key browser hardening — Strict-
 * Transport-Security in particular — cannot be set via the static
 * pipeline. We therefore serve the built admin SPA through a tiny
 * Express + Helmet shim so we can apply the same header set the API
 * server uses (HSTS, CSP, X-Content-Type-Options, Referrer-Policy,
 * Permissions-Policy, X-Frame-Options).
 *
 * The server is intentionally minimal: serve `dist/public` static
 * assets, fall back to `index.html` for SPA client routes, and apply
 * helmet middleware. No application code lives here — all business
 * logic is bundled into the Vite output.
 */

import express from "express";
import helmet from "helmet";
import compression from "compression";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const rawPort = process.env.PORT;
if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/admin/";
const distDir = path.resolve(__dirname, "dist", "public");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

// Helmet: CSP must allow Clerk + Google Fonts + the inline script tags
// Vite emits when bundling. Frame-ancestors 'none' prevents clickjacking
// on the admin dashboard.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          "https://*.clerk.accounts.dev",
          "https://*.clerk.com",
          "https://challenges.cloudflare.com",
        ],
        "style-src": [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
        ],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "img-src": ["'self'", "data:", "blob:", "https:"],
        "connect-src": [
          "'self'",
          "https://*.clerk.accounts.dev",
          "https://*.clerk.com",
          "https://clerk-telemetry.com",
        ],
        "frame-src": [
          "'self'",
          "https://*.clerk.accounts.dev",
          "https://*.clerk.com",
          "https://challenges.cloudflare.com",
        ],
        "worker-src": ["blob:"],
        "frame-ancestors": ["'none'"],
        "base-uri": ["'self'"],
        "object-src": ["'none'"],
      },
    },
    strictTransportSecurity: {
      maxAge: 31_536_000,
      includeSubDomains: true,
      preload: false,
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    crossOriginEmbedderPolicy: false,
  }),
);

app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
});

app.use(compression());

const staticOptions = {
  index: false,
  maxAge: "1h",
  setHeaders: (res, filePath) => {
    if (filePath.endsWith("index.html")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    }
  },
};

app.use(basePath, express.static(distDir, staticOptions));
app.use(express.static(distDir, staticOptions));

// SPA fallback — let client-side routing handle anything that didn't
// match a static asset. Express 5 / path-to-regexp v8 requires named
// wildcard params: bare "*" throws PathError at startup.
app.get("/{*path}", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.listen(port, () => {
  console.log(`admin SPA listening on :${port} (base ${basePath})`);
});
