/**
 * Generate a fresh VAPID key pair for Web Push.
 *
 * Run once during initial setup:
 *   pnpm --filter @workspace/scripts run generate-vapid-keys
 *
 * Then set the three printed env vars in your deployment environment:
 *   VAPID_PUBLIC_KEY   — copy the "Public key" line
 *   VAPID_PRIVATE_KEY  — copy the "Private key" line  (treat as a secret)
 *   VAPID_SUBJECT      — e.g. "mailto:admin@snaplife.app"
 *
 * The public key also needs to be available at runtime on the mobile/web
 * client. The PWA fetches it from GET /api/push/web/vapid-public-key, so
 * you only need to set it server-side. There is no EXPO_PUBLIC_ env var
 * required.
 *
 * IMPORTANT: Once real users are subscribed, never rotate the VAPID keys
 * without also clearing all rows in `web_push_subscriptions` — existing
 * browser subscriptions are bound to the original key pair and will
 * return 401 if you send with a different pair.
 */

import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();

console.log("\n=== VAPID Key Pair ===\n");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_SUBJECT=mailto:admin@snaplife.app`);
console.log(
  "\nStore VAPID_PRIVATE_KEY as a secret (never commit it). " +
  "VAPID_PUBLIC_KEY and VAPID_SUBJECT can be plain env vars.\n"
);
