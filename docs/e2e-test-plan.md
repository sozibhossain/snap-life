# SNAP Life End-to-End Test Plan

This is the canonical user-journey script that should run against
**staging** before every production promotion. It is designed to be
executed by the testing skill (`runTest`) — paste the script in the
`testPlan` argument and the `relevantTechnicalDocumentation` argument
as shown.

## Why this script exists

Task #35 asked for a "no isolated systems" closed-loop validation: PWA
install → signup → onboarding → first-week usage → trial-end prompt →
sandbox purchase → admin dashboard reflects the new Premium user → AI
personalisation surfaces user-specific context → weekly SNAP Shot has
real numbers → user deletes → data is gone. Each step in the script
below corresponds to a step in that journey, so a failure in any one
row points at exactly one cross-system seam.

## Prerequisites

- Staging is deployed and the smoke checklist in `STAGING.md` section 4
  is green.
- An admin Clerk user exists in staging with `users.is_admin = true`.
- A RevenueCat sandbox project is wired to staging via
  `EXPO_PUBLIC_REVENUECAT_*` env vars and the webhook points at
  `https://staging.snaplife.app/api/revenuecat/webhook`.
- The OpenAI integration is reachable from staging.

## Two layers of validation

The platform deliberately runs e2e validation at **two cadences**.
The split is not a workaround — it reflects the platform's
constraints. Three things in the user journey are physically
impossible to drive from a scheduled job:

- **RevenueCat sandbox purchases** happen inside StoreKit / Play
  Billing in the native mobile app. There is no headless surface
  that can complete one.
- **Clerk email-verification sign-up** can only be automated by
  bypassing it through the Clerk backend SDK, which means it stops
  being a real sign-up flow.
- **`runTest` itself** is an agent-sandbox callback, not something
  a Replit Scheduled Deployment can invoke.

So the nightly tier covers every cross-system seam that *is*
automatable, and the manual tier covers the rest, gated by the
launch checklist before each production promotion.

1. **Nightly (automated, in-repo)** — `scripts/src/nightlyE2e.ts`,
   triggered by a Replit Scheduled Deployment at 03:00 UTC via
   `pnpm --filter @workspace/scripts run nightly-e2e`. Walks the
   journey sequentially using two identities: the long-lived
   Clerk-backed staging tester (`STAGING_TESTER_JWT` +
   `STAGING_TESTER_EMAIL`, has a real `users` row) for the
   user-row-dependent assertions, and a throwaway legacy-bearer
   identity (minted via `/auth/bootstrap` per run, exists in
   `user_tokens` only) for the bearer-token lifecycle seam. Steps:
   liveness → HSTS/CSP on api + admin SPA → `GET /auth/me` as the
   tester (captures `appUserId`) → `POST /events` →
   `GET /events/weekly` reads it back → seed a fresh bootstrap
   bearer + write a `calcium_logged` event under it →
   `POST /chat/bone-buddy` with that same bearer opens an SSE
   stream (the chat route resolves the user via `softUserId()`
   which only looks up legacy bearer tokens; Clerk JWTs do not
   resolve there, so a bootstrap bearer is used here on purpose
   with a freshly-written event under the same appUserId so the
   `softUserId() → buildEngagementProfile() →
   renderBehaviouralContext()` path actually has data to ground on)
   → `GET /me/export` returns a JSON
   attachment whose `appUserId` matches → `GET /admin/users/lookup`
   by tester email returns the same `appUserId` (proves admin
   reflection of a real user) →
   `/admin/metrics/{users,engagement,subscriptions}` each return a
   JSON object (and `users.totalUsers` is numeric) → admin-gate
   probe: a fresh non-admin bearer hitting `/admin/test-accounts`
   is rejected with 403 → ephemeral bearer lifecycle: bootstrap →
   log event → `DELETE /me` → same bearer rejected with 401
   `unknown bearer token` (the actual semantics for bootstrap-only
   identities — the cascade hard-deletes the token row, the auth
   layer fails first; the full Clerk-user 410 soft-delete cascade
   is exercised in the manual walkthrough below) → audit filter
   chip regression guards (step 17): `GET /admin/audit?action=`
   returns only rows with that action; `GET /admin/audit?from=&to=`
   with a far-future range returns 0 rows cleanly; the admin SPA
   loads HTTP 200 when all four chip params (action, actor, target,
   date) are present in the URL — the chip click-to-clear
   behaviour is covered by the `admin-test` CI validation (see
   below) → 65s cooldown → deliberate 6-burst against
   `/auth/bootstrap` confirms the auth limiter returns 429 on the
   6th call. Posts pass/fail + failing checks to the on-call Slack
   channel and writes a JSON results artifact under
   `nightly-results/`. Exit non-zero pages on-call. Setup details
   + escalation owner live in `docs/runbook.md` section 8.

   **CI validation (`admin-test`)** — `pnpm --filter @workspace/admin
   run test` is registered as the `admin-test` named validation
   command (`isValidation = true` in `.replit`), which is Replit's
   release-gate mechanism: it fires automatically before every
   deployment promotion and a non-zero exit blocks the release.
   It additionally runs in `scripts/post-merge.sh` (the post-merge
   hook), where `set -e` ensures a test failure aborts the merge
   itself. Either trigger independently prevents a broken build from
   reaching production. This Vitest suite
   (`artifacts/admin/src/pages/__tests__/audit.test.tsx` and
   `audit-filter-summary.test.tsx`) covers the audit filter chip
   contract at the unit level: chip rendering for each URL param
   (action, actorAppUserId, targetAppUserId, from/to), the
   click-to-clear behaviour that removes only the targeted filter
   while leaving all others intact, and the filter-summary label
   accuracy as action types are added or removed. No browser or live
   staging credentials are required.

   **CI validation (`admin-e2e`)** — `pnpm --filter @workspace/admin
   run test:e2e` is registered as the `admin-e2e` named validation
   command (`isValidation = true` in `.replit`) and fires on every
   deployment promotion via the same Replit release-gate mechanism.
   This Playwright suite
   (`artifacts/admin/e2e/audit-filter-chips.spec.ts`) covers the
   full filter chip contract for the audit page in a real browser:
   chip visibility when each URL param (action, actorAppUserId,
   targetAppUserId, from/to) is set; clicking each chip removes only
   that filter, stays on /admin/audit (not redirected to dashboard),
   and leaves all other chips visible; applying a filter via the
   action dropdown or actor ID input shows the corresponding chip.
   The suite also includes a dedicated **date chip text-content
   regression guard** (task #109): it visits
   `/admin/audit?from=2025-01-01&to=2025-01-31` and asserts the
   chip's full rendered label is exactly "Date: 2025-01-01 →
   2025-01-31" — a single composite-string assertion that catches
   regressions in the arrow separator character or surrounding
   whitespace that per-substring assertions cannot detect — and
   that clicking the chip removes both `from` and `to` URL params.
   Tests run against a local Vite dev build with
   `VITE_TEST_BYPASS_AUTH=true` so no live staging credentials are
   required. `admin-test` provides complementary unit-level coverage
   of the component internals (no browser required); both validations
   must pass for a deployment to proceed.
2. **Pre-release (manual, full UI)** — the `runTest`-driven UI
   walkthrough below. Covers the surfaces the nightly probe
   physically can't reach: the PWA install banner, the Clerk
   sign-up form, the RevenueCat sandbox purchase, the Bone Buddy
   chat *content* (does the assistant's reply actually reference
   the user's calcium total?), the weekly SNAP Shot card, and the
   admin dashboard's 30s polling tile. Required gate before every
   production promotion (launch-checklist row A5 also requires the
   most recent nightly to be green).

## How to run the manual UI walkthrough

```javascript
const result = await runTest({
  defaultScreenWidth: 400,
  defaultScreenHeight: 720,
  testClerkAuth: true,
  testPlan: `<paste the script below>`,
  relevantTechnicalDocumentation: `<paste the docs section below>`,
});
```

---

## Test plan (paste into `testPlan`)

```text
1. [New Context] Create a new browser context.
2. [Browser] Navigate to the staging PWA root (path: /).
3. [Verify] Cookie notice banner is visible with the text "We use first-party storage only" and a "Got it" button.
4. [Browser] Click "Got it" and confirm the banner dismisses.
5. [Clerk Auth] Sign in as { firstName: "E2E", lastName: "Tester", email: `e2e-${nanoid(8)}@snaplife-test.com` }. Note the email as ${e2eEmail}.
6. [API] As an admin Clerk user (note their JWT as ${adminJwt}), POST /api/admin/test-accounts with { email: ${e2eEmail}, displayName: "E2E Tester" } so the account is marked isTester=true. Assert HTTP 200.
7. [Browser] Reload the page. Walk through the onboarding screens, accepting the Privacy Policy and Terms on the final step.
8. [Verify] Land on the Dashboard tab. Today's Focus, Bone Buddy banner, and Quick Actions are visible.
9. [Browser] Log a meal via Health → Nutrition → Add. Confirm a success toast.
10. [Browser] Log a wellbeing entry via the mood picker on the Dashboard.
11. [Browser] Log a movement session via Health → Movement → Start a guided session.
12. [Browser] Open Bone Buddy. Send the message "What should I focus on this week?" and wait for the assistant reply.
13. [Verify] The assistant reply references the user's actual recent activity (calcium intake number, mood trend, or session count) — not generic copy.
14. [Browser] From the Profile tab, open Subscription. Tap the "Start free trial" CTA.
15. [Browser] Complete the RevenueCat sandbox purchase flow with a sandbox card.
16. [API] Within 30s, GET /api/admin/users/lookup?email=${e2eEmail} with the admin Clerk JWT and assert the returned subscriber row shows isActive === true (or isInTrial === true) — confirms the RevenueCat webhook landed and updated the subscribers row.
17. [Browser] In a separate browser context, sign into /admin/ as the admin Clerk user.
18. [Verify] On the Admin Dashboard, the "Premium users" KPI has incremented by ≥ 1 within the last 30s polling window.
19. [Browser] In Admin → Users, search for ${e2eEmail}. Assert subscriptionStatus = active and isTester = true.
20. [Browser] Back in the user context, open the Weekly SNAP Shot card on the Dashboard. Assert that the displayed sessions / active minutes / calcium-days numbers match what the test logged in steps 9–11 (sessions ≥ 1, calcium days ≥ 1).
21. [Browser] Open Settings → Privacy & Data. Tap "Export my data".
22. [Verify] A JSON file downloads (or the native share sheet opens with a JSON attachment) and includes the meal, wellbeing, and movement entries logged earlier.
23. [Browser] In Settings → Privacy & Data, tap "Delete my account". Confirm the destructive dialog.
24. [Browser] After the redirect to the sign-in screen, attempt to sign back in as ${e2eEmail}.
25. [Verify] Sign-in fails because Clerk has erased the account.
26. [API] Hit GET /api/auth/me with the captured JWT from before deletion. Assert HTTP 410 with body { error: "account_deleted" }.
27. [Browser] In the admin context, search Admin → Users for ${e2eEmail}. Assert the row shows soft-deleted state (display name redacted, hardDeleteAfter set ~30 days from now).
28. [API] Confirm a row exists in pending_emails for kind='account_deletion_confirmation' tied to the deleted user id.
29. [Cleanup] Reset the tester data for any other staging tester accounts via Settings → Privacy & Data → "Reset my data" if their data was incidentally affected.
```

## Technical documentation (paste into `relevantTechnicalDocumentation`)

```text
- Staging URLs: PWA https://staging.snaplife.app, admin https://staging.snaplife.app/admin/, API https://staging.snaplife.app/api.
- Auth: Clerk; the testing harness signs in programmatically — no UI typing of email/password.
- Tester provisioning: POST /api/admin/test-accounts is admin-gated and idempotent on email; returns 404 in production (gated by SNAP_LIFE_ENV=staging).
- Subscription: RevenueCat sandbox; webhook → POST /api/revenuecat/webhook; payload writes users.subscription_status + appends to subscription_events.
- GDPR endpoints:
  - GET /api/me/export → JSON archive with Content-Disposition: attachment.
  - DELETE /api/me → soft-deletes + sets hard_delete_after = now + 30d, redacts PII, deletes Clerk identity, queues pending_emails row.
  - requireUser returns HTTP 410 account_deleted for soft-deleted accounts.
- Rate limits: auth 5/min/IP, events 60/min/user, chat 20/min/user. Bursts in this script stay well below.
- AI personalisation: chat handler reads BehaviouralStats (calcium intake, mood, session count). Fresh accounts will get generic replies; the script logs ≥1 of each before chatting so the assistant has signal.
- Admin polling: Dashboard refetches every 30s — wait at least 30s after the purchase before asserting the KPI ticked.
- Cleanup: Step 23 deletes the e2e account; the hourly hard-delete worker purges per-user rows on day 30.
```

---

## Failure-mode pass

Run the following short scenarios after the happy-path script. Each is
intentionally small so it can be re-run cheaply.

### F1. API is down

1. Stop the staging api-server workflow.
2. Open the PWA. Confirm the app shell renders from the service-worker
   cache, signed-in screens show a friendly offline state, and writes
   queue locally.
3. Restart api-server. Confirm queued writes flush within ~30s.

### F2. Clerk is unreachable

1. Block `*.clerk.com` at the OS / DNS layer for the test browser.
2. Try to sign in. The app shows a clear "Sign-in unavailable" message
   and does not crash.
3. Unblock and retry — sign-in succeeds.

### F3. RevenueCat webhook delayed

1. In the RevenueCat dashboard, pause webhook deliveries.
2. Make a sandbox purchase. Premium does **not** unlock (expected).
3. Force-foreground the app — `Purchases.getCustomerInfo()` reconciles
   and Premium unlocks within ~5s without the webhook.
4. Re-enable the webhook. The delayed delivery arrives and writes the
   `subscription_events` row.
