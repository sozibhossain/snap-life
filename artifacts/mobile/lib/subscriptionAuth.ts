export type SubscriptionAuthHeader = Record<string, string>;

/**
 * Subscription endpoints are account-level and must work on every signed-in
 * device. Prefer the Clerk session JWT for them; the legacy per-device bearer
 * token can already be claimed by a different device and legitimately return
 * no token here.
 */
export async function resolveSubscriptionAuthHeader(
  getClerkToken: (() => Promise<string | null>) | null | undefined,
  getLegacyHeader: () => Promise<SubscriptionAuthHeader>,
): Promise<SubscriptionAuthHeader> {
  if (getClerkToken) {
    try {
      const token = await getClerkToken();
      if (token) return { Authorization: `Bearer ${token}` };
    } catch {
      // A transient Clerk failure can still fall back to this device's
      // existing legacy token when one is available.
    }
  }

  try {
    return await getLegacyHeader();
  } catch {
    return {};
  }
}
