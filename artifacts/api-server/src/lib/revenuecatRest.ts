/**
 * Minimal server-side RevenueCat v2 REST client.
 *
 * Used by the authenticated `POST /api/revenuecat/sync` endpoint to fetch
 * the source-of-truth customer state immediately after a successful purchase
 * (so Premium unlocks without waiting for the webhook).
 *
 * Auth uses the Replit RevenueCat connector — we exchange the repl identity
 * token for a short-lived RevenueCat OAuth access token. Settings are cached
 * in-process until their `expires_at` passes; the http client itself is not
 * cached because tokens rotate.
 */

const CONNECTOR_NAME = "revenuecat";
const PROJECT_ID_ENV = "REVENUECAT_PROJECT_ID";
const SECRET_API_KEY_ENVS = [
  "REVENUECAT_SECRET_API_KEY",
  "REVENUECAT_API_KEY",
] as const;
const REVENUECAT_BASE_URL = "https://api.revenuecat.com/v2";

interface ConnectorSettings {
  expires_at?: string | null;
  access_token?: string | null;
  oauth?: { credentials?: { access_token?: string | null } | null } | null;
}
interface ConnectorItem {
  settings?: ConnectorSettings | null;
}

let cachedSettings: ConnectorSettings | undefined;

function tokenFromSettings(s: ConnectorSettings | undefined): string | null {
  if (!s) return null;
  return s.access_token ?? s.oauth?.credentials?.access_token ?? null;
}

async function getAccessToken(): Promise<string> {
  // Render and other conventional deployments use a RevenueCat v2 secret
  // key directly. Keep the connector path below as a backwards-compatible
  // fallback for Replit deployments.
  for (const envName of SECRET_API_KEY_ENVS) {
    const directToken = process.env[envName]?.trim();
    if (directToken) return directToken;
  }

  const cachedToken = tokenFromSettings(cachedSettings);
  if (
    cachedToken &&
    cachedSettings?.expires_at &&
    new Date(cachedSettings.expires_at).getTime() > Date.now() + 30_000
  ) {
    return cachedToken;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? `repl ${process.env.REPL_IDENTITY}`
    : process.env.WEB_REPL_RENEWAL
    ? `depl ${process.env.WEB_REPL_RENEWAL}`
    : null;
  if (!hostname || !xReplitToken) {
    throw new Error(
      "RevenueCat server auth unavailable: configure REVENUECAT_SECRET_API_KEY, or provide the Replit RevenueCat connector environment.",
    );
  }

  const res = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=${CONNECTOR_NAME}`,
    { headers: { Accept: "application/json", "X-Replit-Token": xReplitToken } },
  );
  if (!res.ok) {
    throw new Error(`RevenueCat connector lookup failed: ${res.status}`);
  }
  const data = (await res.json()) as { items?: ConnectorItem[] };
  cachedSettings = data.items?.[0]?.settings ?? undefined;
  const token = tokenFromSettings(cachedSettings);
  if (!token) throw new Error("RevenueCat connector returned no access token.");
  return token;
}

export function getRevenueCatProjectId(): string {
  const id = process.env[PROJECT_ID_ENV];
  if (!id) {
    throw new Error(`${PROJECT_ID_ENV} is not configured.`);
  }
  return id;
}

async function rcFetch<T>(path: string): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${REVENUECAT_BASE_URL}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(
      `RevenueCat ${res.status} for ${path}: ${body.slice(0, 200)}`,
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

// -- v2 response shapes (only the fields we use) --

export interface RcCustomerEntitlement {
  entitlement_id: string;
  expires_at: number | null;
}

interface RcListCustomerEntitlements {
  items: RcCustomerEntitlement[];
}

export type RcStore =
  | "amazon"
  | "app_store"
  | "mac_app_store"
  | "play_store"
  | "promotional"
  | "stripe"
  | "rc_billing";

export type RcAutoRenewalStatus =
  | "will_renew"
  | "will_not_renew"
  | "will_change_product"
  | "will_pause"
  | "requires_price_increase_consent"
  | "has_already_renewed";

export type RcStatus =
  | "trialing"
  | "active"
  | "expired"
  | "in_grace_period"
  | "in_billing_retry"
  | "paused"
  | "unknown"
  | "incomplete";

export interface RcSubscription {
  id: string;
  product_id: string | null;
  starts_at: number;
  current_period_starts_at: number;
  current_period_ends_at: number | null;
  gives_access: boolean;
  auto_renewal_status: RcAutoRenewalStatus;
  status: RcStatus;
  store: RcStore;
  entitlements?: { items?: Array<{ id?: string }> };
}

interface RcListSubscriptions {
  items: RcSubscription[];
}

export async function listCustomerActiveEntitlements(
  appUserId: string,
): Promise<RcCustomerEntitlement[]> {
  const projectId = getRevenueCatProjectId();
  const data = await rcFetch<RcListCustomerEntitlements>(
    `/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(
      appUserId,
    )}/active_entitlements`,
  );
  return data.items ?? [];
}

export async function listCustomerSubscriptions(
  appUserId: string,
): Promise<RcSubscription[]> {
  const projectId = getRevenueCatProjectId();
  const data = await rcFetch<RcListSubscriptions>(
    `/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(
      appUserId,
    )}/subscriptions`,
  );
  return data.items ?? [];
}

/** Test-only helper: clear the cached connector token between tests. */
export function __resetRevenueCatRestForTests(): void {
  cachedSettings = undefined;
}
