/**
 * SSRF-safe Web Push endpoint validation.
 *
 * Browser-generated PushSubscription.endpoint values always point to one of
 * the major push-service providers listed below. Anything outside this
 * allowlist is treated as a potential SSRF probe and rejected.
 *
 * Covers:
 *   *.googleapis.com            — Chrome / Android (FCM)
 *   *.push.services.mozilla.com — Firefox (Mozilla Push Service)
 *   *.push.apple.com            — Safari (iOS 16.4+ / macOS)
 *   *.notify.windows.com        — Edge / Windows Notification Service
 *   *.samsungosp.com            — Samsung Internet
 *   *.push.hicloud.com          — Huawei browser (HMS)
 */
const PUSH_SERVICE_SUFFIXES = [
  ".googleapis.com",
  ".push.services.mozilla.com",
  ".push.apple.com",
  ".notify.windows.com",
  ".samsungosp.com",
  ".push.hicloud.com",
] as const;

const MAX_ENDPOINT_LEN = 2048;

/**
 * Returns true if `raw` is a well-formed HTTPS URL whose hostname belongs
 * to a known push-service provider. Rejects private/internal addresses
 * implicitly because none of the allowlisted suffixes resolve to RFC 1918
 * ranges or loopback.
 */
export function validateWebPushEndpoint(raw: string): boolean {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_ENDPOINT_LEN) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_SUFFIXES.some(
    (suffix) => host === suffix.slice(1) || host.endsWith(suffix),
  );
}
