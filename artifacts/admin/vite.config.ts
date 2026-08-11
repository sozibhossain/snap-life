import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// PORT is only used by the dev / preview server — not by vite build.
// Fall back to the canonical port so `pnpm run build` works without env vars.
const rawPort = process.env.PORT ?? "23744";
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// BASE_PATH drives the `base` config key and must match the proxy prefix.
// Fall back to the canonical admin path for local builds.
const basePath = process.env.BASE_PATH ?? "/admin/";

// Where the api-server lives in local dev. In production the admin SPA is
// served from the same origin as the API behind a reverse proxy, so the
// SPA's relative `/api/*` calls Just Work. Locally the two run on
// different ports, so Vite forwards `/api/*` to the api-server here.
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:5050";

// Browser extensions execute in the page context and can emit global errors.
// Keep those unrelated failures from being promoted to a Vite app-error overlay.
const browserExtensionStackPattern =
  /(?:chrome|moz|safari-web)-extension:\/\//i;

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss({ optimize: false }),
    runtimeErrorOverlay({
      filter: (error) => !browserExtensionStackPattern.test(error.stack ?? ""),
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    // Mirror the security headers we set in production (via the meta
    // tags in index.html) at the dev server level too, so a tester
    // hitting the dev preview gets the same browser hardening.
    headers: securityHeaders(),
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    headers: securityHeaders(),
  },
});

function securityHeaders(): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.clerk.accounts.dev https://*.clerk.com https://clerk.snaplife.co.uk https://challenges.cloudflare.com",
      "worker-src blob:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://clerk.snaplife.co.uk https://clerk-telemetry.com",
      "frame-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://clerk.snaplife.co.uk https://challenges.cloudflare.com",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; "),
  };
}
