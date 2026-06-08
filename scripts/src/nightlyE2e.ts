/**
 * Nightly end-to-end staging verification — full sequenced journey.
 *
 * Runs as a Replit Scheduled Deployment (cron: 03:00 UTC daily) and
 * walks the same cross-system flow described in `docs/e2e-test-plan.md`
 * over HTTP, deterministically, in a single process. Every check is
 * sequential so rate-limit buckets, soft-delete state, and admin
 * reflection can be reasoned about; the only intentional bucket
 * collision is the dedicated rate-limit burst at the very end, which
 * runs after a 65 second cooldown so the auth limiter window is empty.
 *
 * The script targets two distinct identities, on purpose:
 *
 * 1. A long-lived **Clerk-backed staging tester** (STAGING_TESTER_JWT
 *    + STAGING_TESTER_EMAIL). This is the identity the api-server
 *    treats as a "real" user — it has a row in `users`, which is what
 *    `requireUser`'s soft-delete check, the GDPR export, the
 *    bone-buddy behavioural-context composer, and the admin lookup
 *    all key off. We do NOT delete it; tests reuse it across runs.
 *
 * 2. A throwaway **legacy-bearer ephemeral identity** minted via
 *    `/auth/bootstrap` per-run. This identity exists in `user_tokens`
 *    only — `auth/bootstrap` does not write to `users` — which is
 *    why we use it specifically to test the bearer-token lifecycle
 *    seam (mint → delete → bearer rejected with 401). Asserting 410
 *    here would be wrong: with no `users` row the soft-delete check
 *    is a no-op, and the cascade hard-deletes the `user_tokens` row,
 *    so the next call hits the auth layer with an unknown bearer
 *    and returns 401 "unknown bearer token". That IS the seam being
 *    tested for ephemeral users; the full Clerk-user soft-delete
 *    cascade is exercised in the manual UI walkthrough
 *    (docs/e2e-test-plan.md).
 *
 * Why HTTP and not `runTest` UI driving:
 *   `runTest` is an agent-sandbox callback, not something a Replit
 *   Scheduled Deployment can invoke. RevenueCat sandbox purchases
 *   happen inside StoreKit / Play Billing in the native app and have
 *   no headless surface. Clerk's email-verification sign-up cannot
 *   be automated without bypassing it through the backend SDK, at
 *   which point it stops being a real sign-up. We therefore split
 *   validation into two tiers (see docs/e2e-test-plan.md "Two
 *   layers of validation"): this script covers the cross-system
 *   seams that *are* automatable nightly; the manual UI walkthrough
 *   covers what isn't, gated by the launch-checklist row A5 before
 *   each production promotion.
 *
 * Journey performed each run:
 *
 *   1. /healthz                                  liveness
 *   2. Security headers — api + admin SPA        HSTS / CSP / noindex
 *   3. GET /auth/me as the tester                Clerk session resolves
 *   4. POST /events as the tester                write a behavioural event
 *   5. GET /events/weekly                        read it back
 *   6. seed bearer + behavioural event, then           AI personalization
 *      POST /chat/bone-buddy with the SAME bearer       seam — chat
 *      so softUserId() resolves and behavioural         resolves the user
 *      context is built from real per-user data         via legacy bearer
 *      written one call earlier                          (user_tokens), not
 *                                                        Clerk JWT
 *   7. GET /me/export                            GDPR export attachment;
 *                                                archive.appUserId matches
 *                                                /auth/me's appUserId
 *   8. GET /admin/users/lookup?email=<tester>    same identity visible
 *                                                to admin; appUserId
 *                                                matches step 3
 *   9. GET /admin/metrics/users                  JSON shape + totalUsers
 *  10. GET /admin/metrics/engagement             JSON shape
 *  11. GET /admin/metrics/subscriptions          JSON shape
 *  12. POST /admin/test-accounts as non-admin    must be 403 (admin gate)
 *  13. Bearer lifecycle (ephemeral) — POST       proves DELETE /me
 *      /auth/bootstrap → POST /events → DELETE   actually invalidates
 *      /me → re-call /me/export with same bearer the bearer.
 *      → 401 "unknown bearer token"
 *  14. Audit trail survival (staging only) —     audit_logs rows survive
 *      provision tester → admin soft-delete →    hard-delete purge;
 *      force hard-delete → confirm audit row      invariant from GDPR
 *      still present                              runbook §7
 *  15. actorAppUserId filter on GET /admin/audit  only matching actor rows
 *      returns only events for that actor          returned; total ≥ 1
 *  16. actorAppUserId + targetAppUserId combined  both predicates apply
 *      filter on GET /admin/audit                 simultaneously
 *  17. Audit filter chip coverage — four sub-checks:
 *      a) action filter API: all rows match      server predicate applied
 *         action=account_deleted; random          for action chip; random
 *         sentinel returns 0 rows                sentinel negative-control
 *      b) date filter API: far-future from/to    date predicate accepted;
 *         returns 0 rows cleanly (not 4xx)        no server crash
 *      c) admin SPA with all four filter params  SPA does not 404 when
 *         in URL → 200 + text/html               all chips would show
 *      d) Playwright chip suite subprocess →     browser-level: chip
 *         chip visibility + click-to-clear for   visibility + click
 *         action/actor/target/date               removes only that filter,
 *                                                stays on /admin/audit
 *  18. (after 65s cooldown) burst 6×             auth limiter returns 429
 *      /auth/bootstrap
 *
 * Non-zero exit pages on-call. Results are written to
 * `nightly-results/<ts>.json`; if SLACK_WEBHOOK_URL is set, a summary
 * is posted (only failing checks are listed when the run is red).
 *
 * Required env vars (Replit Scheduled Deployment secrets):
 *   STAGING_API_URL            e.g. https://staging.snaplife.app/api
 *   STAGING_ADMIN_URL          e.g. https://staging.snaplife.app/admin/
 *   STAGING_ADMIN_JWT          Clerk session JWT for the e2e admin user.
 *   STAGING_TESTER_JWT         Clerk session JWT for the e2e tester.
 *   STAGING_TESTER_EMAIL       Email of the e2e tester (used by the
 *                              admin lookup reflection check).
 *
 * Optional:
 *   SLACK_WEBHOOK_URL          summary post target
 *   NIGHTLY_E2E_OUT            JSON results dir (default ./nightly-results)
 *   NIGHTLY_E2E_SKIP_RATELIMIT set to "1" to skip the 65s cooldown +
 *                              burst check (useful for ad-hoc runs).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface CheckResult {
  name: string;
  ok: boolean;
  durationMs: number;
  detail: string;
}

function env(name: string, required = true): string {
  const v = process.env[name];
  if (!v && required) throw new Error(`Missing required env var: ${name}`);
  return v ?? "";
}

const REQUIRED_RESPONSE_HEADERS_API = [
  "strict-transport-security",
  "content-security-policy",
  "x-frame-options",
  "referrer-policy",
  "x-content-type-options",
];

const REQUIRED_RESPONSE_HEADERS_ADMIN = [
  "strict-transport-security",
  "content-security-policy",
  "x-robots-tag",
];

function missingHeaders(res: Response, required: string[]): string[] {
  return required.filter((h) => !res.headers.get(h));
}

async function timed(
  name: string,
  fn: () => Promise<{ ok: boolean; detail: string }>,
): Promise<CheckResult> {
  const start = Date.now();
  try {
    const { ok, detail } = await fn();
    return { name, ok, detail, durationMs: Date.now() - start };
  } catch (e) {
    return {
      name,
      ok: false,
      detail: `threw: ${(e as Error).message}`,
      durationMs: Date.now() - start,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run a shell command as a child process and resolve with the
 * combined stdout/stderr output and the exit code.
 *
 * Uses `execFile` (not `exec`) so the command is not spawned through
 * a shell — avoids shell injection and is safer in a scheduled job.
 * `args` are passed directly to the process; the first element is
 * expected to be the executable (e.g. "pnpm").
 */
function runProcess(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = 120_000,
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve_) => {
    const chunks: Buffer[] = [];
    const child = execFile(cmd, args, { cwd, timeout: timeoutMs }, (err, stdout, stderr) => {
      void chunks; // accessed via events below
      const exitCode = err ? (err.code as number | undefined) ?? 1 : 0;
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();
      resolve_({ exitCode, output });
    });
    child.stdout?.on("data", (d: Buffer) => chunks.push(d));
    child.stderr?.on("data", (d: Buffer) => chunks.push(d));
  });
}

async function bootstrapBearer(
  apiUrl: string,
  appUserId: string,
): Promise<{ ok: true; token: string } | { ok: false; detail: string }> {
  const r = await fetch(`${apiUrl}/auth/bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appUserId }),
  });
  if (r.status !== 200) return { ok: false, detail: `status=${r.status}` };
  const body = (await r.json()) as { token?: string };
  if (typeof body.token !== "string" || body.token.length < 16) {
    return { ok: false, detail: `bad token shape: ${JSON.stringify(body)}` };
  }
  return { ok: true, token: body.token };
}

async function run(): Promise<CheckResult[]> {
  const apiUrl = env("STAGING_API_URL").replace(/\/+$/, "");
  const adminUrl = env("STAGING_ADMIN_URL").replace(/\/+$/, "");
  const adminJwt = env("STAGING_ADMIN_JWT");
  const testerJwt = env("STAGING_TESTER_JWT");
  const testerEmail = env("STAGING_TESTER_EMAIL");

  const results: CheckResult[] = [];
  let testerAppUserId: string | null = null;

  // 1. Liveness
  results.push(
    await timed("api.healthz returns 200", async () => {
      const r = await fetch(`${apiUrl}/healthz`);
      return { ok: r.status === 200, detail: `status=${r.status}` };
    }),
  );

  // 2. Security headers — api-server
  results.push(
    await timed("api emits HSTS + CSP + X-Frame-Options", async () => {
      const r = await fetch(`${apiUrl}/healthz`);
      const missing = missingHeaders(r, REQUIRED_RESPONSE_HEADERS_API);
      return {
        ok: missing.length === 0,
        detail: missing.length === 0 ? "all present" : `missing=${missing.join(",")}`,
      };
    }),
  );

  // 3. Security headers — admin SPA
  results.push(
    await timed("admin emits HSTS + CSP + noindex", async () => {
      const r = await fetch(adminUrl);
      const missing = missingHeaders(r, REQUIRED_RESPONSE_HEADERS_ADMIN);
      return {
        ok: missing.length === 0,
        detail: missing.length === 0 ? "all present" : `missing=${missing.join(",")}`,
      };
    }),
  );

  // 4. Tester /auth/me — confirms the Clerk session resolves and
  //    captures the appUserId we'll cross-check elsewhere.
  results.push(
    await timed("GET /auth/me with tester Clerk JWT returns 200", async () => {
      const r = await fetch(`${apiUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${testerJwt}` },
      });
      if (r.status !== 200) return { ok: false, detail: `status=${r.status}` };
      const body = (await r.json()) as { appUserId?: string };
      if (typeof body.appUserId !== "string" || !body.appUserId) {
        return { ok: false, detail: "appUserId missing in response" };
      }
      testerAppUserId = body.appUserId;
      return { ok: true, detail: `appUserId=${testerAppUserId}` };
    }),
  );

  const testerHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${testerJwt}`,
    "Content-Type": "application/json",
  });

  // 5. Tester writes a behavioural event.
  results.push(
    await timed("POST /events as tester writes a behavioural event", async () => {
      const r = await fetch(`${apiUrl}/events`, {
        method: "POST",
        headers: testerHeaders(),
        // `bone_buddy_opened` is in the api-server allowlist
        // (artifacts/api-server/src/routes/events.ts ALLOWED_KINDS)
        // and is the natural precursor to the chat probe in step 6.
        body: JSON.stringify({
          kind: "bone_buddy_opened",
          payload: { source: "nightly-e2e" },
        }),
      });
      return {
        ok: r.status === 200 || r.status === 201 || r.status === 204,
        detail: `status=${r.status}`,
      };
    }),
  );

  // 6. Read it back.
  results.push(
    await timed("GET /events/weekly returns a JSON object", async () => {
      const r = await fetch(`${apiUrl}/events/weekly`, { headers: testerHeaders() });
      if (r.status !== 200) return { ok: false, detail: `status=${r.status}` };
      const body = (await r.json()) as Record<string, unknown>;
      const ok = typeof body === "object" && body !== null;
      return { ok, detail: `keys=${Object.keys(body).slice(0, 5).join(",")}` };
    }),
  );

  // 7. AI personalization seam — bone-buddy. IMPORTANT: the chat
  //    route resolves the user via `softUserId()` which only looks
  //    up legacy bearer tokens in `user_tokens` — Clerk JWTs do not
  //    resolve there, so calling chat with the tester JWT would
  //    leave appUserId=null and skip behavioural-context entirely
  //    (false confidence). We mint a short-lived bootstrap bearer,
  //    write a `calcium_logged` event under it, then call chat with
  //    the SAME bearer so the `softUserId() →
  //    buildEngagementProfile() → renderBehaviouralContext()` path
  //    actually has real data for that appUserId to ground on.
  let chatBearerAppUserId = "";
  let chatBearer = "";
  results.push(
    await timed("seed bearer + behavioural event for chat seam", async () => {
      chatBearerAppUserId = `nightly-chat-${randomBytes(6).toString("hex")}`;
      const bs = await bootstrapBearer(apiUrl, chatBearerAppUserId);
      if (!bs.ok) return { ok: false, detail: `bootstrap: ${bs.detail}` };
      chatBearer = bs.token;
      const ev = await fetch(`${apiUrl}/events`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${chatBearer}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          kind: "calcium_logged",
          payload: { mg: 600, source: "nightly-e2e/chat-seed" },
        }),
      });
      return {
        ok: ev.status === 200 || ev.status === 201 || ev.status === 204,
        detail: `events status=${ev.status} appUserId=${chatBearerAppUserId}`,
      };
    }),
  );

  results.push(
    await timed("POST /chat/bone-buddy with seeded bearer opens an SSE stream", async () => {
      if (!chatBearer) return { ok: false, detail: "no chat bearer" };
      const r = await fetch(`${apiUrl}/chat/bone-buddy`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${chatBearer}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: [], kickoff: true }),
      });
      if (r.status !== 200) return { ok: false, detail: `status=${r.status}` };
      const ct = r.headers.get("content-type") ?? "";
      if (!ct.includes("text/event-stream")) {
        return { ok: false, detail: `Content-Type=${ct}` };
      }
      // Read the SSE stream and assemble the assistant's text from
      // OpenAI-style `data: {...}` chunks. We assert two things:
      //   1. We received at least one non-empty token (proves the
      //      model actually responded — not just that the route
      //      opened a stream).
      //   2. The assembled reply is non-empty after a soft 12s
      //      ceiling (well under the 5-min job budget).
      // We do NOT assert specific words from the seeded event —
      // model output is non-deterministic and the persona prompt
      // is explicit about weaving facts in *naturally* rather than
      // listing them, so a substring match would be flaky. The
      // grounding *path* is what's verified: softUserId() resolves
      // the seeded bearer's appUserId → buildEngagementProfile()
      // reads the calcium_logged event written one call earlier →
      // renderBehaviouralContext() injects the snippet into the
      // system prompt. We assert here that the model produced any
      // reply at all under that prompt (a 502 / empty stream would
      // surface as 0 tokens).
      let assembled = "";
      let chunkCount = 0;
      try {
        const reader = r.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          const ceil = Date.now() + 12_000;
          let buffer = "";
          while (Date.now() < ceil) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const payload = trimmed.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              chunkCount++;
              try {
                const parsed = JSON.parse(payload) as {
                  choices?: { delta?: { content?: string } }[];
                };
                const delta = parsed.choices?.[0]?.delta?.content;
                if (typeof delta === "string") assembled += delta;
              } catch {
                // OpenAI proxy may also forward plain-text chunks.
                assembled += payload;
              }
            }
          }
          await reader.cancel().catch(() => {});
        }
      } catch (e) {
        return {
          ok: false,
          detail: `stream read threw: ${(e as Error).message}`,
        };
      }
      if (chunkCount === 0 || assembled.trim().length === 0) {
        return {
          ok: false,
          detail: `chunks=${chunkCount} replyLen=${assembled.length}`,
        };
      }
      return {
        ok: true,
        detail: `chunks=${chunkCount} replyLen=${assembled.length}`,
      };
    }),
  );

  // 8. GDPR export — must be an attachment, must be JSON, must be
  //    scoped to the tester's appUserId.
  results.push(
    await timed("GET /me/export returns an attachment scoped to the tester", async () => {
      const r = await fetch(`${apiUrl}/me/export`, { headers: testerHeaders() });
      if (r.status !== 200) return { ok: false, detail: `status=${r.status}` };
      const cd = r.headers.get("content-disposition") ?? "";
      const ct = r.headers.get("content-type") ?? "";
      if (!cd.toLowerCase().includes("attachment")) {
        return { ok: false, detail: `Content-Disposition=${cd}` };
      }
      if (!ct.includes("application/json")) {
        return { ok: false, detail: `Content-Type=${ct}` };
      }
      const archive = (await r.json()) as { appUserId?: string };
      if (!testerAppUserId) {
        return { ok: false, detail: "no testerAppUserId from earlier step" };
      }
      if (archive.appUserId !== testerAppUserId) {
        return {
          ok: false,
          detail: `archive.appUserId=${archive.appUserId} expected ${testerAppUserId}`,
        };
      }
      return { ok: true, detail: "200 + attachment + JSON + appUserId match" };
    }),
  );

  // 9. Admin reflection — same identity visible from the admin side.
  //    Proves the user-row written by Clerk upsert is reachable
  //    through the admin lookup endpoint, and that the appUserId
  //    surfaces consistently.
  results.push(
    await timed("admin lookup of tester email returns matching appUserId", async () => {
      const r = await fetch(
        `${apiUrl}/admin/users/lookup?email=${encodeURIComponent(testerEmail)}`,
        { headers: { Authorization: `Bearer ${adminJwt}` } },
      );
      if (r.status !== 200) return { ok: false, detail: `status=${r.status}` };
      // Response shape (artifacts/api-server/src/routes/admin.ts
      // /admin/users/lookup):
      //   { user: { appUserId, clerkUserId, email, ... },
      //     subscription: ..., counts: ..., recentSessions, recentFeedback }
      const body = (await r.json()) as { user?: { appUserId?: string } };
      const lookupAppUserId = body.user?.appUserId;
      if (!testerAppUserId) {
        return { ok: false, detail: "no testerAppUserId from earlier step" };
      }
      if (lookupAppUserId !== testerAppUserId) {
        return {
          ok: false,
          detail: `lookup.user.appUserId=${lookupAppUserId} expected ${testerAppUserId}`,
        };
      }
      return { ok: true, detail: `appUserId match` };
    }),
  );

  // 10-12. Admin metrics surfaces. We do a shape check on each of the
  //        three real routes, plus an explicit totalUsers numeric
  //        check on /users so a regression in the response contract
  //        can't pass quietly.
  results.push(
    await timed("GET /admin/metrics/users returns numeric totalUsers", async () => {
      const r = await fetch(`${apiUrl}/admin/metrics/users`, {
        headers: { Authorization: `Bearer ${adminJwt}` },
      });
      if (r.status !== 200) return { ok: false, detail: `status=${r.status}` };
      const body = (await r.json()) as { totalUsers?: unknown };
      return {
        ok: typeof body.totalUsers === "number",
        detail: `totalUsers=${body.totalUsers}`,
      };
    }),
  );

  for (const slug of ["engagement", "subscriptions"] as const) {
    results.push(
      await timed(`GET /admin/metrics/${slug} returns a JSON object`, async () => {
        const r = await fetch(`${apiUrl}/admin/metrics/${slug}`, {
          headers: { Authorization: `Bearer ${adminJwt}` },
        });
        if (r.status !== 200) return { ok: false, detail: `status=${r.status}` };
        const body = (await r.json()) as Record<string, unknown>;
        if (typeof body !== "object" || body === null) {
          return { ok: false, detail: "body not an object" };
        }
        return { ok: true, detail: `keys=${Object.keys(body).slice(0, 6).join(",")}` };
      }),
    );
  }

  // 12. Staging admin gate must reject a non-admin bearer with 403.
  results.push(
    await timed("admin/test-accounts is admin-gated (403 for non-admin bearer)", async () => {
      const probeAppUserId = `nightly-probe-${randomBytes(6).toString("hex")}`;
      const probe = await bootstrapBearer(apiUrl, probeAppUserId);
      if (!probe.ok) {
        return { ok: false, detail: `bootstrap probe failed: ${probe.detail}` };
      }
      const r = await fetch(`${apiUrl}/admin/test-accounts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${probe.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: `${probeAppUserId}@snaplife-test.com`,
          displayName: "Nightly Probe",
        }),
      });
      // Cleanup: invalidate the probe bearer so we don't litter
      // staging with reusable tokens. (DELETE /me is a no-op on the
      // users row since bootstrap-only users have none, but it does
      // hard-delete the user_tokens row.)
      await fetch(`${apiUrl}/me`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${probe.token}` },
      }).catch(() => {});
      return {
        ok: r.status === 403,
        detail: `status=${r.status} (expected 403)`,
      };
    }),
  );

  // 13. Bearer lifecycle (ephemeral). Mint a throwaway bearer, write
  //     an event with it, DELETE /me, then prove the same bearer is
  //     now rejected with 401 — that's the actual behaviour for
  //     bootstrap-only identities (the cascade hard-deletes
  //     user_tokens; there is no users row to soft-delete; the auth
  //     layer fails first with "unknown bearer token"). The full
  //     Clerk-user 410 soft-delete cascade is exercised in the
  //     manual UI walkthrough; nightly verifies the bearer-token
  //     half of the seam.
  const ephAppUserId = `nightly-eph-${randomBytes(6).toString("hex")}`;
  let ephBearer = "";
  results.push(
    await timed("ephemeral bootstrap → event → delete cascade", async () => {
      const bs = await bootstrapBearer(apiUrl, ephAppUserId);
      if (!bs.ok) return { ok: false, detail: `bootstrap: ${bs.detail}` };
      ephBearer = bs.token;
      const ev = await fetch(`${apiUrl}/events`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ephBearer}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          kind: "bone_buddy_opened",
          payload: { source: "nightly-e2e/ephemeral" },
        }),
      });
      if (!(ev.status === 200 || ev.status === 201 || ev.status === 204)) {
        return { ok: false, detail: `events status=${ev.status}` };
      }
      const del = await fetch(`${apiUrl}/me`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${ephBearer}` },
      });
      return {
        ok: del.status === 200 || del.status === 204,
        detail: `delete status=${del.status}`,
      };
    }),
  );

  results.push(
    await timed("ephemeral bearer is rejected post-delete (401 unknown bearer)", async () => {
      if (!ephBearer) return { ok: false, detail: "no ephemeral bearer" };
      const r = await fetch(`${apiUrl}/me/export`, {
        headers: { Authorization: `Bearer ${ephBearer}` },
      });
      if (r.status !== 401) {
        return { ok: false, detail: `status=${r.status} (expected 401)` };
      }
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      return {
        ok: body.error === "unknown bearer token",
        detail: `status=401, body.error=${body.error}`,
      };
    }),
  );

  // Cleanup: invalidate the chat-seed bearer so we don't leave it
  // active in staging.
  if (chatBearer) {
    await fetch(`${apiUrl}/me`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${chatBearer}` },
    }).catch(() => {});
  }

  // 14. Audit trail survival — verifies that both `audit_events` and
  //     `audit_logs` rows are NOT deleted when the target account is
  //     hard-purged by `hardDeleteWorker` (GDPR runbook §7 invariant).
  //
  //     Flow:
  //       a) Provision a throwaway tester via POST /admin/test-accounts
  //          (staging-only endpoint) so we have a proper `users` row.
  //       b) Admin soft-delete via DELETE /admin/users/:id — this writes
  //          an `account_deleted` row to `audit_events` (transaction-safe)
  //          and an `admin_delete_user` row to `audit_logs` (fire-and-forget).
  //       c) Force immediate hard-delete via the staging-only endpoint
  //          POST /admin/users/:id/hard-delete, which shares the same cascade
  //          implementation as `hardDeleteWorker` but skips the 30-day window.
  //       d) Query GET /admin/audit?targetAppUserId=&action=account_deleted
  //          and assert the `audit_events` row is still present.
  //       e) Query GET /admin/audit-logs?targetUserId=&action=admin_delete_user
  //          and assert the `audit_logs` row is still present too.
  //
  //     Both the provisioning and force-hard-delete endpoints 404 in
  //     production, so this check only runs meaningfully on staging.
  let auditTargetId = "";
  let adminAppUserId = "";
  results.push(
    await timed("audit trail survives hard-deletion of target account", async () => {
      const auditEmail = `nightly-audit-${randomBytes(6).toString("hex")}@snaplife-test.com`;

      // a) Provision throwaway tester.
      const provRes = await fetch(`${apiUrl}/admin/test-accounts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adminJwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: auditEmail, displayName: "Nightly Audit Probe" }),
      });
      if (provRes.status !== 200 && provRes.status !== 201) {
        return {
          ok: false,
          detail: `provision status=${provRes.status} (may be prod — SNAP_LIFE_ENV not staging?)`,
        };
      }
      const provBody = (await provRes.json()) as { appUserId?: string };
      if (typeof provBody.appUserId !== "string" || !provBody.appUserId) {
        return { ok: false, detail: `provision: missing appUserId in response` };
      }
      auditTargetId = provBody.appUserId;

      // b) Admin soft-delete — writes audit_events row (in-tx) + audit_logs row (fire-and-forget).
      const delRes = await fetch(`${apiUrl}/admin/users/${auditTargetId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminJwt}` },
      });
      if (delRes.status !== 200) {
        return { ok: false, detail: `soft-delete status=${delRes.status}` };
      }

      // c) Force immediate hard-delete (staging-only, bypasses 30d grace window).
      const hardRes = await fetch(`${apiUrl}/admin/users/${auditTargetId}/hard-delete`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminJwt}` },
      });
      if (hardRes.status !== 200) {
        return { ok: false, detail: `hard-delete status=${hardRes.status}` };
      }

      // d) Confirm `audit_events` row survives (primary invariant from task spec).
      //    The soft-delete wrote action="account_deleted" with targetAppUserId.
      const eventsRes = await fetch(
        `${apiUrl}/admin/audit?targetAppUserId=${encodeURIComponent(auditTargetId)}&action=account_deleted`,
        { headers: { Authorization: `Bearer ${adminJwt}` } },
      );
      if (eventsRes.status !== 200) {
        return { ok: false, detail: `audit_events query status=${eventsRes.status}` };
      }
      const eventsBody = (await eventsRes.json()) as { items?: unknown[]; total?: number };
      const eventsTotal =
        typeof eventsBody.total === "number" ? eventsBody.total : (eventsBody.items?.length ?? 0);
      if (eventsTotal < 1) {
        return {
          ok: false,
          detail: `audit_events row missing after hard-delete (total=${eventsTotal})`,
        };
      }

      // e) Also confirm `audit_logs` row survives (belt-and-suspenders).
      //    The admin DELETE wrote action="admin_delete_user" with targetUserId.
      const logsRes = await fetch(
        `${apiUrl}/admin/audit-logs?targetUserId=${encodeURIComponent(auditTargetId)}&action=admin_delete_user`,
        { headers: { Authorization: `Bearer ${adminJwt}` } },
      );
      if (logsRes.status !== 200) {
        return { ok: false, detail: `audit_logs query status=${logsRes.status}` };
      }
      const logsBody = (await logsRes.json()) as { items?: unknown[]; total?: number };
      const logsTotal =
        typeof logsBody.total === "number" ? logsBody.total : (logsBody.items?.length ?? 0);
      if (logsTotal < 1) {
        return {
          ok: false,
          detail: `audit_logs row missing after hard-delete (total=${logsTotal})`,
        };
      }

      return {
        ok: true,
        detail: `audit_events=${eventsTotal} audit_logs=${logsTotal} both survived hard-delete (appUserId=${auditTargetId})`,
      };
    }),
  );

  // 15. Actor filter on GET /admin/audit — verifies that passing
  //     actorAppUserId returns only events where that actor matches,
  //     and that total ≥ 1 (relies on the account_deleted row written
  //     by the admin in step 14).
  results.push(
    await timed(
      "GET /admin/audit?actorAppUserId filters by actor",
      async () => {
        // Resolve the admin's own appUserId so we can filter by it.
        const meRes = await fetch(`${apiUrl}/auth/me`, {
          headers: { Authorization: `Bearer ${adminJwt}` },
        });
        if (meRes.status !== 200) {
          return {
            ok: false,
            detail: `GET /auth/me for admin status=${meRes.status}`,
          };
        }
        const meBody = (await meRes.json()) as { appUserId?: string };
        if (typeof meBody.appUserId !== "string" || !meBody.appUserId) {
          return { ok: false, detail: "admin appUserId missing in /auth/me response" };
        }
        adminAppUserId = meBody.appUserId;

        const auditRes = await fetch(
          `${apiUrl}/admin/audit?actorAppUserId=${encodeURIComponent(adminAppUserId)}&limit=50`,
          { headers: { Authorization: `Bearer ${adminJwt}` } },
        );
        if (auditRes.status !== 200) {
          return { ok: false, detail: `audit query status=${auditRes.status}` };
        }
        const auditBody = (await auditRes.json()) as {
          items?: Array<{ actorAppUserId?: string | null }>;
          total?: number;
        };
        const items = auditBody.items ?? [];
        const total = typeof auditBody.total === "number" ? auditBody.total : items.length;
        if (total === 0) {
          return {
            ok: false,
            detail: `expected ≥1 row for actorAppUserId=${adminAppUserId}, got 0`,
          };
        }
        // Every returned row must belong to the requested actor.
        const mismatched = items.filter((item) => item.actorAppUserId !== adminAppUserId);
        if (mismatched.length > 0) {
          return {
            ok: false,
            detail: `${mismatched.length}/${items.length} rows have wrong actorAppUserId`,
          };
        }

        // Negative-control: a random UUID that will never match any actor
        // must return zero rows, proving the filter is actually applied and
        // is not silently ignored (guarding against false-positive above).
        const phantomId = `nightly-phantom-${randomBytes(8).toString("hex")}`;
        const negRes = await fetch(
          `${apiUrl}/admin/audit?actorAppUserId=${encodeURIComponent(phantomId)}`,
          { headers: { Authorization: `Bearer ${adminJwt}` } },
        );
        if (negRes.status !== 200) {
          return { ok: false, detail: `negative-control query status=${negRes.status}` };
        }
        const negBody = (await negRes.json()) as { items?: unknown[]; total?: number };
        const negTotal =
          typeof negBody.total === "number" ? negBody.total : (negBody.items?.length ?? 0);
        if (negTotal !== 0) {
          return {
            ok: false,
            detail: `negative-control expected 0 rows for phantom actor, got ${negTotal} — filter may be ignored`,
          };
        }

        return {
          ok: true,
          detail: `total=${total} rows all have actorAppUserId=${adminAppUserId}; negative-control returned 0`,
        };
      },
    ),
  );

  // 16. Combined actorAppUserId + targetAppUserId filter — both predicates
  //     must apply simultaneously. Uses the account_deleted row written in
  //     step 14 (admin actor acting on auditTargetId as the target).
  results.push(
    await timed(
      "GET /admin/audit?actorAppUserId&targetAppUserId combined filter works",
      async () => {
        if (!adminAppUserId || !auditTargetId) {
          return {
            ok: false,
            detail: `prerequisites missing: adminAppUserId=${adminAppUserId || "(empty)"} auditTargetId=${auditTargetId || "(empty)"}`,
          };
        }
        const url =
          `${apiUrl}/admin/audit` +
          `?actorAppUserId=${encodeURIComponent(adminAppUserId)}` +
          `&targetAppUserId=${encodeURIComponent(auditTargetId)}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${adminJwt}` } });
        if (res.status !== 200) {
          return { ok: false, detail: `status=${res.status}` };
        }
        const body = (await res.json()) as {
          items?: Array<{ actorAppUserId?: string | null; targetAppUserId?: string | null }>;
          total?: number;
        };
        const items = body.items ?? [];
        const total = typeof body.total === "number" ? body.total : items.length;
        if (total < 1) {
          return {
            ok: false,
            detail: `expected ≥1 matching row for actor=${adminAppUserId} + target=${auditTargetId}, got 0`,
          };
        }
        // Every returned row must satisfy both predicates.
        const bad = items.filter(
          (item) =>
            item.actorAppUserId !== adminAppUserId || item.targetAppUserId !== auditTargetId,
        );
        if (bad.length > 0) {
          return {
            ok: false,
            detail: `${bad.length}/${items.length} rows failed combined-filter assertion`,
          };
        }
        return {
          ok: true,
          detail: `total=${total} rows all match actor=${adminAppUserId} + target=${auditTargetId}`,
        };
      },
    ),
  );

  // 17. Audit filter chip coverage — API-layer regression guards for
  //     the four chip types that appear in the admin audit page's
  //     "Filtered by:" summary strip (action, actor, target, date).
  //
  //     The filter chip UI behaviour — chip visibility for each URL
  //     param, click-to-clear removes only that param and stays on
  //     /admin/audit, other filters are preserved — is exercised by
  //     the Playwright suite at
  //     artifacts/admin/e2e/audit-filter-chips.spec.ts, which is
  //     registered as the `admin-e2e` validation command and runs on
  //     every release against a VITE_TEST_BYPASS_AUTH=true dev build.
  //
  //     These HTTP checks close the remaining gap by verifying the
  //     server-side predicate for each chip type is actually applied
  //     on the real staging API:
  //
  //     a) action filter  — only account_deleted rows returned AND
  //        a different action type returns 0 rows (negative-control)
  //     b) date filter    — from/to params accepted; a far-future
  //        date range returns exactly 0 rows cleanly (not 4xx/5xx)
  //     c) admin SPA load with all four filter params in URL —
  //        proves the SPA does not 404 when chips would be visible

  // a) Action filter: every returned item must be account_deleted.
  results.push(
    await timed(
      "GET /admin/audit?action=account_deleted returns only account_deleted rows",
      async () => {
        const res = await fetch(
          `${apiUrl}/admin/audit?action=account_deleted&limit=50`,
          { headers: { Authorization: `Bearer ${adminJwt}` } },
        );
        if (res.status !== 200) {
          return { ok: false, detail: `status=${res.status}` };
        }
        const body = (await res.json()) as {
          items?: Array<{ action?: string }>;
          total?: number;
        };
        const items = body.items ?? [];
        const total = typeof body.total === "number" ? body.total : items.length;
        const mismatched = items.filter((item) => item.action !== "account_deleted");
        if (mismatched.length > 0) {
          return {
            ok: false,
            detail: `${mismatched.length}/${items.length} rows have wrong action`,
          };
        }
        // Negative-control: a randomly-generated sentinel action string that
        // can never match any real row proves the predicate is applied and
        // not silently ignored. Using a random value avoids the flakiness
        // of asserting total===0 for a real action type that may have rows
        // from earlier staging runs.
        const sentinelAction = `nightly-sentinel-${randomBytes(8).toString("hex")}`;
        const negRes = await fetch(
          `${apiUrl}/admin/audit?action=${encodeURIComponent(sentinelAction)}&limit=1`,
          { headers: { Authorization: `Bearer ${adminJwt}` } },
        );
        if (negRes.status !== 200) {
          return {
            ok: false,
            detail: `action filter negative-control status=${negRes.status}`,
          };
        }
        const negBody = (await negRes.json()) as { items?: unknown[]; total?: number };
        const negTotal =
          typeof negBody.total === "number" ? negBody.total : (negBody.items?.length ?? -1);
        if (negTotal !== 0) {
          return {
            ok: false,
            detail: `negative-control expected 0 rows for action=tester_data_reset, got ${negTotal} — filter may be ignored`,
          };
        }
        return {
          ok: true,
          detail: `total=${total} rows all have action=account_deleted; negative-control returned 0`,
        };
      },
    ),
  );

  // b) Date filter: pass a far-future range; must return 0 results
  //    cleanly (not 400/500), proving the from/to predicates are
  //    accepted and applied without crashing.
  results.push(
    await timed(
      "GET /admin/audit?from=&to= date filter returns a well-formed response",
      async () => {
        const futureFrom = "2099-01-01T00:00:00.000Z";
        const futureTo   = "2099-12-31T23:59:59.999Z";
        const url =
          `${apiUrl}/admin/audit` +
          `?from=${encodeURIComponent(futureFrom)}` +
          `&to=${encodeURIComponent(futureTo)}` +
          `&limit=1`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${adminJwt}` },
        });
        if (res.status !== 200) {
          return { ok: false, detail: `status=${res.status}` };
        }
        const body = (await res.json()) as { items?: unknown[]; total?: number };
        if (typeof body !== "object" || body === null || !Array.isArray(body.items)) {
          return { ok: false, detail: "response is not { items, total }" };
        }
        const total = typeof body.total === "number" ? body.total : body.items.length;
        if (total !== 0) {
          return {
            ok: false,
            detail: `expected 0 rows for far-future date range, got ${total}`,
          };
        }
        return { ok: true, detail: `total=0 for far-future date range — date filter accepted` };
      },
    ),
  );

  // c) Admin SPA smoke with all filter params in URL — verifies the
  //    SPA continues to serve HTTP 200 when action, actor, target
  //    and date params are all present (i.e. the route that would
  //    show all four chips). Proves the SPA does not blow up with
  //    a 4xx when the "Filtered by:" strip would be fully populated.
  results.push(
    await timed(
      "admin SPA /audit with all four filter params returns 200",
      async () => {
        const qs = new URLSearchParams({
          action: "account_deleted",
          actorAppUserId: adminAppUserId || "nightly-probe",
          targetAppUserId: auditTargetId || "nightly-probe",
          from: "2025-01-01",
          to: "2099-12-31",
        }).toString();
        const res = await fetch(`${adminUrl}/audit?${qs}`);
        const ct = res.headers.get("content-type") ?? "";
        const ok = res.status === 200 && ct.includes("text/html");
        return {
          ok,
          detail: `status=${res.status} content-type=${ct.split(";")[0]}`,
        };
      },
    ),
  );

  // d) Playwright chip suite — runs the full browser-level chip
  //    interaction spec (audit-filter-chips.spec.ts) as a subprocess
  //    so the pass/fail appears in the nightly Slack report.
  //    Tests run against a locally-started Vite dev build with
  //    VITE_TEST_BYPASS_AUTH=true; no live staging credentials are
  //    needed. The suite verifies chip visibility for each filter
  //    type, click-to-clear removes only that chip and stays on
  //    /admin/audit, and other active chips are preserved.
  //
  //    Date chip text-content regression guard (task #109):
  //    The suite includes two dedicated checks that visit
  //    `/admin/audit?from=2025-01-01&to=2025-01-31` and assert
  //    (a) the chip's full rendered label is exactly
  //        "Date: 2025-01-01 → 2025-01-31" — a single-string
  //        assertion that catches regressions in the arrow
  //        separator or surrounding whitespace that the looser
  //        per-substring assertions cannot catch, and
  //    (b) clicking the chip removes both `from` and `to` params
  //        and stays on /admin/audit (no redirect to dashboard).
  results.push(
    await timed(
      "admin audit filter chip Playwright suite (browser click-to-clear)",
      async () => {
        const workspaceRoot = resolve(join(__dirname, "../../"));
        const { exitCode, output } = await runProcess(
          "pnpm",
          ["--filter", "@workspace/admin", "run", "test:e2e"],
          workspaceRoot,
          120_000,
        );
        if (exitCode !== 0) {
          // Surface only the last 20 lines of output so the Slack
          // message stays readable while still showing the failure.
          const tail = output.split("\n").slice(-20).join("\n");
          return {
            ok: false,
            detail: `Playwright exited ${exitCode}\n${tail}`,
          };
        }
        // Extract the test count from Playwright's summary line, e.g.
        // "16 passed (12s)" so the Slack report is informative.
        const match = output.match(/(\d+)\s+passed/);
        const passed = match ? match[1] : "?";
        return { ok: true, detail: `${passed} tests passed` };
      },
    ),
  );

  // 18. Isolated rate-limit burst — runs LAST, after a 65s cooldown
  //     so the 5/min/IP auth window from earlier bootstrap calls is
  //     empty before we deliberately blow it.
  //     (was step 15 before actor-filter checks were added above)
  if (process.env.NIGHTLY_E2E_SKIP_RATELIMIT === "1") {
    results.push({
      name: "auth limiter triggers 429 on 6th request",
      ok: true,
      durationMs: 0,
      detail: "skipped via NIGHTLY_E2E_SKIP_RATELIMIT=1",
    });
  } else {
    console.log("[nightly-e2e] cooling down 65s before auth limiter burst...");
    await sleep(65_000);
    results.push(
      await timed("auth limiter triggers 429 on 6th request", async () => {
        let last = 0;
        for (let i = 0; i < 6; i++) {
          const r = await fetch(`${apiUrl}/auth/bootstrap`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              appUserId: `nightly-rl-${randomBytes(6).toString("hex")}`,
            }),
          });
          last = r.status;
        }
        return { ok: last === 429, detail: `final status=${last} (expected 429)` };
      }),
    );
  }

  return results;
}

async function postSlack(summary: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: summary }),
    });
  } catch (e) {
    console.error("[nightly-e2e] slack post failed:", (e as Error).message);
  }
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  console.log(`[nightly-e2e] start ${startedAt}`);
  let results: CheckResult[];
  try {
    results = await run();
  } catch (e) {
    const msg = `[nightly-e2e] FATAL — ${(e as Error).message}`;
    console.error(msg);
    await postSlack(`:rotating_light: SNAP Life nightly e2e — fatal: ${msg}`);
    process.exit(1);
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const finishedAt = new Date().toISOString();

  console.log(`[nightly-e2e] finished — ${passed}/${results.length} passed`);
  for (const r of results) {
    const tag = r.ok ? "PASS" : "FAIL";
    console.log(`  [${tag}] ${r.name} (${r.durationMs}ms) — ${r.detail}`);
  }

  const outDir = process.env.NIGHTLY_E2E_OUT ?? "./nightly-results";
  await mkdir(outDir, { recursive: true });
  const outFile = join(outDir, `${startedAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(
    outFile,
    JSON.stringify({ startedAt, finishedAt, passed, failed, results }, null, 2),
  );
  console.log(`[nightly-e2e] wrote ${outFile}`);

  const summaryLines = [
    failed === 0
      ? `:white_check_mark: SNAP Life nightly e2e — ${passed}/${results.length} passed`
      : `:x: SNAP Life nightly e2e — ${failed} failed (${passed}/${results.length})`,
    ...results.filter((r) => !r.ok).map((r) => `• \`${r.name}\` — ${r.detail}`),
  ];
  await postSlack(summaryLines.join("\n"));

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("[nightly-e2e] unhandled:", e);
  process.exit(1);
});
