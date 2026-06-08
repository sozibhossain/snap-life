/**
 * Helmet configuration for the SNAP Life API.
 *
 * Helmet sets a battery of security headers (X-Frame-Options,
 * Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy,
 * etc) and a Content-Security-Policy. Mounted in `app.ts` after CORS but
 * before route handlers — rate-limit middleware sits closer to each
 * route so IP/user keying is correct.
 *
 * CSP notes:
 *   - The API serves JSON, so the default `default-src 'self'` blocks
 *     all script execution by default.
 *   - We allow `connect-src` to point at the public Replit/dev domains
 *     so a browser-based admin app on the same host (artifacts/admin)
 *     can call /api/* without CSP failures. CORS still gates origins.
 *   - Frame ancestors are forbidden — the API should never be loaded
 *     in an iframe.
 */

import helmet from "helmet";
import type { RequestHandler } from "express";

export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
    // Replit's edge proxy already terminates TLS for *.replit.app /
    // *.replit.dev. HSTS via the API is mostly belt-and-braces; a
    // 6-month max-age with subdomains is conservative.
    strictTransportSecurity: {
      maxAge: 60 * 60 * 24 * 180,
      includeSubDomains: true,
      preload: false,
    },
    // The API never embeds in a frame.
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "no-referrer" },
    crossOriginResourcePolicy: { policy: "same-site" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
  });
}
