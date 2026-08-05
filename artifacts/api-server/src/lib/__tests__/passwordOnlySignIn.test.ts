import { describe, expect, it, vi } from "vitest";
import { createPasswordOnlySignInTicket } from "../passwordOnlySignIn";

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createPasswordOnlySignInTicket", () => {
  it("rejects every account except the approved account without calling Clerk", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await createPasswordOnlySignInTicket(
      "someone@example.com",
      "password",
      "sk_test",
      fetchImpl,
    );

    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("verifies the approved user's password before issuing a 60-second ticket", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { verified: true }))
      .mockResolvedValueOnce(response(200, { token: "one-use-ticket" }));

    const result = await createPasswordOnlySignInTicket(
      " RABBY.RAZIUL@GMAIL.COM ",
      "correct password",
      "sk_test",
      fetchImpl,
    );

    expect(result).toEqual({ ok: true, ticket: "one-use-ticket" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain(
      "/users/user_3EtJ1aDRCwq8jdKRhdjo6dIaZU7/verify_password",
    );
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({
      user_id: "user_3EtJ1aDRCwq8jdKRhdjo6dIaZU7",
      expires_in_seconds: 60,
    });
  });

  it("does not issue a ticket when Clerk rejects the password", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(422, { errors: [] }));

    const result = await createPasswordOnlySignInTicket(
      "rabby.raziul@gmail.com",
      "wrong password",
      "sk_test",
      fetchImpl,
    );

    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
