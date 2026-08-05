const PASSWORD_ONLY_EMAIL = "rabby.raziul@gmail.com";
const PASSWORD_ONLY_CLERK_USER_ID = "user_3EtJ1aDRCwq8jdKRhdjo6dIaZU7";

const CLERK_API_BASE = "https://api.clerk.com/v1";
const TICKET_TTL_SECONDS = 60;

export type PasswordOnlySignInResult =
  | { ok: true; ticket: string }
  | { ok: false; reason: "invalid_credentials" | "rate_limited" | "clerk_error" };

/**
 * Password-only sign-in is deliberately restricted to one support-approved
 * account. Clerk still verifies the password; the short-lived, one-use ticket
 * only replaces Client Trust's new-device email code for this user.
 */
export async function createPasswordOnlySignInTicket(
  email: string,
  password: string,
  secretKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PasswordOnlySignInResult> {
  if (email.trim().toLowerCase() !== PASSWORD_ONLY_EMAIL) {
    return { ok: false, reason: "invalid_credentials" };
  }

  const headers = {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
  };
  const encodedUserId = encodeURIComponent(PASSWORD_ONLY_CLERK_USER_ID);
  const verifyResponse = await fetchImpl(
    `${CLERK_API_BASE}/users/${encodedUserId}/verify_password`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ password }),
    },
  );

  if (!verifyResponse.ok) {
    if (verifyResponse.status === 429) {
      return { ok: false, reason: "rate_limited" };
    }
    if ([400, 401, 404, 422].includes(verifyResponse.status)) {
      return { ok: false, reason: "invalid_credentials" };
    }
    return { ok: false, reason: "clerk_error" };
  }

  const verification = (await verifyResponse.json()) as { verified?: unknown };
  if (verification.verified !== true) {
    return { ok: false, reason: "invalid_credentials" };
  }

  const ticketResponse = await fetchImpl(`${CLERK_API_BASE}/sign_in_tokens`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      user_id: PASSWORD_ONLY_CLERK_USER_ID,
      expires_in_seconds: TICKET_TTL_SECONDS,
    }),
  });

  if (!ticketResponse.ok) {
    if (ticketResponse.status === 429) {
      return { ok: false, reason: "rate_limited" };
    }
    return { ok: false, reason: "clerk_error" };
  }

  const data = (await ticketResponse.json()) as { token?: unknown };
  if (typeof data.token !== "string" || data.token.length === 0) {
    return { ok: false, reason: "clerk_error" };
  }
  return { ok: true, ticket: data.token };
}

