import * as Sentry from "@sentry/node";
import type { Express } from "express";

const DSN = process.env.SENTRY_DSN;

/**
 * Initialise Sentry. Silently skipped if SENTRY_DSN is not set.
 * Must be called before any other imports/setup to ensure all modules
 * are properly instrumented.
 */
export function initSentry() {
  if (!DSN) return;

  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
    enabled: !!DSN,
  });
}

/**
 * Attach the Sentry Express error handler.
 * Must be called AFTER all routes and BEFORE any other error-handling middleware.
 */
export function attachSentryErrorHandler(app: Express) {
  if (!DSN) return;
  Sentry.setupExpressErrorHandler(app);
}

export { Sentry };
